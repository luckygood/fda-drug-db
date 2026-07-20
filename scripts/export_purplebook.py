#!/usr/bin/env python3
"""导出紫皮书生物类似药图谱：FDA Purple Book 月度 CSV -> fda_aux.db + biosimilars.json

数据源：data_lake/purplebook/purplebook-search-June-2026-data-download.csv（2026 年 6 月月度版）
产出：
  - fda_aux.db 表 purplebook（28 列全量）
  - fda-drug-web/public/data/biosimilars.json
    参比制剂 -> 类似药/可互换药数量、获批时间线、参比制剂独占期到期
    与 fda_drugs.db 的 BLA 申请交叉验证
运行：从工作区根目录  python fda-drug-web/scripts/export_purplebook.py
"""
import csv
import json
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PB_DIR = ROOT / "data_lake/purplebook"
DRUGS_DB = ROOT / "fda_drugs.db"
AUX_DB = ROOT / "fda_aux.db"
OUT_JSON = ROOT / "fda-drug-web/public/data/biosimilars.json"

TODAY = date.today()
WINDOW_END = date(TODAY.year + 3, TODAY.month, TODAY.day)

_MONTHS = {m.lower(): i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"])}


def _parse_pb_name(name):
    """'purplebook-search-June-2026-data-download.csv' / 'purplebook-search-June-data-download.csv'
    -> (year, month)；无年份时按当年计。解析失败返回 None。"""
    m = re.search(r"purplebook-search-([A-Za-z]+)(?:-(\d{4}))?-data-download", name)
    if not m:
        return None
    mon = _MONTHS.get(m.group(1).lower())
    if not mon:
        return None
    return (int(m.group(2)) if m.group(2) else TODAY.year, mon)


def _find_pb_csv():
    """取 data_lake/purplebook 下最新月份的紫皮书 CSV（幂等：月更新文件落盘后自动切换）。"""
    cands = []
    for p in PB_DIR.glob("purplebook-search-*-data-download.csv"):
        ym = _parse_pb_name(p.name)
        if ym:
            cands.append((ym, p))
    if not cands:
        raise FileNotFoundError(f"{PB_DIR} 下未找到 purplebook-search-*-data-download.csv")
    return sorted(cands, key=lambda t: t[0])[-1][1]


PB_CSV = _find_pb_csv()
_PB_YM = _parse_pb_name(PB_CSV.name)
PB_VERSION = f"{_PB_YM[0]}-{_PB_YM[1]:02d}"


def pdate(s):
    """'5-Jun-26' -> date"""
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%d-%b-%y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def main():
    rows = list(csv.reader(open(PB_CSV, encoding="utf-8-sig")))
    hdr_idx = [i for i, r in enumerate(rows) if "BLA Number" in r][-1]
    hdr = rows[hdr_idx]
    data = [r for r in rows[hdr_idx + 1:] if len(r) >= len(hdr) - 2 and r[2].strip()]
    print(f"purplebook {PB_VERSION}: {len(data)} product rows")
    col = {name: i for i, name in enumerate(hdr)}

    def g(r, name):
        i = col.get(name)
        return r[i].strip() if i is not None and i < len(r) else ""

    # ---------- 1. 入库 ----------
    aux = sqlite3.connect(AUX_DB)
    cur = aux.cursor()
    cur.execute("DROP TABLE IF EXISTS purplebook")
    cols_sql = ",".join(f"c{i} TEXT" for i in range(len(hdr)))
    cur.execute(f"CREATE TABLE purplebook({cols_sql})")
    for r in data:
        cur.execute(
            f"INSERT INTO purplebook VALUES({','.join('?' * len(hdr))})",
            [(r[i].strip() if i < len(r) else "") for i in range(len(hdr))],
        )
    cur.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('pb_version', ?)", (PB_VERSION,))
    cur.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('pb_download_date', ?)", (TODAY.isoformat(),))
    aux.commit()

    # ---------- 2. 参比制剂（351(a)）侧信息 ----------
    rp_info = {}
    for r in data:
        if g(r, "License Type") != "351(a)":
            continue
        proper = g(r, "Proper Name").upper()
        if not proper:
            continue
        info = rp_info.setdefault(proper, {
            "proper_name": g(r, "Proper Name"), "brands": set(), "applicants": set(),
            "bla_numbers": set(), "first_licensure": None, "exclusivity_exp": [],
            "orphan_exclusivity_exp": [], "patent_list_provided": False,
            "marketing_status": set(), "center": set(),
        })
        info["brands"].add(g(r, "Proprietary Name"))
        info["applicants"].add(g(r, "Applicant"))
        info["bla_numbers"].add(g(r, "BLA Number"))
        info["marketing_status"].add(g(r, "Marketing Status"))
        info["center"].add(g(r, "Center"))
        fl = pdate(g(r, "Date of First Licensure"))
        if fl and (info["first_licensure"] is None or fl < info["first_licensure"]):
            info["first_licensure"] = fl
        for key, bucket in (("Exclusivity Expiration Date", "exclusivity_exp"),
                            ("Orphan Exclusivity Exp. Date", "orphan_exclusivity_exp")):
            d = pdate(g(r, key))
            if d:
                info[bucket].append(d)
        if g(r, "Patent List Provided").upper() in ("Y", "YES", "TRUE", "1"):
            info["patent_list_provided"] = True

    # ---------- 3. 351(k) 按参比制剂聚合 ----------
    rp_biosim = defaultdict(lambda: {"biosimilars": [], "interchangeables": []})
    for r in data:
        lt = g(r, "License Type")
        if not lt.startswith("351(k)"):
            continue
        ref_proper = (g(r, "Ref. Product Proper Name") or g(r, "Proper Name")).upper()
        entry = {
            "brand": g(r, "Proprietary Name"), "proper_name": g(r, "Proper Name"),
            "applicant": g(r, "Applicant"), "bla_number": g(r, "BLA Number"),
            "license_type": lt, "marketing_status": g(r, "Marketing Status"),
            "approval_date": (pdate(g(r, "Approval Date")) or date.min).isoformat() if pdate(g(r, "Approval Date")) else None,
            "interchangeable_approval_date": (pdate(g(r, "Inter. Approval Date")) or date.min).isoformat() if pdate(g(r, "Inter. Approval Date")) else None,
            "first_interchangeable_exclusivity_exp": (pdate(g(r, "First Interchangeable Exclusivity Exp. Date")) or date.min).isoformat() if pdate(g(r, "First Interchangeable Exclusivity Exp. Date")) else None,
            "ref_product_exclusivity_exp": (pdate(g(r, "Ref. Product Exclusivity Exp. Date")) or date.min).isoformat() if pdate(g(r, "Ref. Product Exclusivity Exp. Date")) else None,
            "strength_forms": sorted({g(r, "Dosage Form")}),
        }
        bucket = "interchangeables" if "Interchangeable" in lt else "biosimilars"
        # 同一 BLA 多规格合并：按 (bla_number, license_type) 去重产品行
        lst = rp_biosim[ref_proper][bucket]
        if not any(e["bla_number"] == entry["bla_number"] and e["brand"] == entry["brand"] for e in lst):
            rp_biosim[ref_proper][bucket].append(entry)

    rp_list = []
    for ref_proper, grp in rp_biosim.items():
        info = rp_info.get(ref_proper, {})
        all_entries = grp["biosimilars"] + grp["interchangeables"]
        if not all_entries:
            continue
        n_bla = len({e["bla_number"] for e in all_entries})
        n_inter_bla = len({e["bla_number"] for e in grp["interchangeables"]})
        # 参比制剂独占期：351(k) 行上的 ref 列优先，其次 351(a) 行最大值
        ref_exps = [e["ref_product_exclusivity_exp"] for e in all_entries if e["ref_product_exclusivity_exp"]]
        if not ref_exps and info.get("exclusivity_exp"):
            ref_exps = [max(info["exclusivity_exp"]).isoformat()]
        first_inter_exps = [e["first_interchangeable_exclusivity_exp"] for e in all_entries if e["first_interchangeable_exclusivity_exp"]]
        approvals = sorted(e["approval_date"] for e in all_entries if e["approval_date"])
        rp_list.append({
            "ref_proper_name": info.get("proper_name", ref_proper.title()),
            "ref_brands": sorted(info.get("brands", [])),
            "ref_applicants": sorted(info.get("applicants", [])),
            "ref_bla_numbers": sorted(info.get("bla_numbers", [])),
            "center": sorted(info.get("center", [])),
            "marketing_status": sorted(info.get("marketing_status", [])),
            "date_of_first_licensure": info["first_licensure"].isoformat() if info.get("first_licensure") else None,
            "ref_exclusivity_exp": max(ref_exps) if ref_exps else None,
            "orphan_exclusivity_exp": max(info["orphan_exclusivity_exp"]).isoformat() if info.get("orphan_exclusivity_exp") else None,
            "patent_list_provided": bool(info.get("patent_list_provided")),
            "n_biosimilar_blas": n_bla,
            "n_interchangeable_blas": n_inter_bla,
            "n_products": len(all_entries),
            "first_biosimilar_approval": approvals[0] if approvals else None,
            "first_interchangeable_exclusivity_exp": min(first_inter_exps) if first_inter_exps else None,
            "biosimilars": sorted(all_entries, key=lambda e: (e["approval_date"] or "9999")),
        })
    rp_list.sort(key=lambda x: (-x["n_biosimilar_blas"], x["ref_proper_name"]))
    print(f"reference products with biosimilars: {len(rp_list)}")

    # ---------- 4. 参比制剂独占期 36 个月窗口 ----------
    rp_excl_window = []
    for rp in rp_list:
        for key, label in (("ref_exclusivity_exp", "参比制剂独占期"),
                           ("first_interchangeable_exclusivity_exp", "首个可互换独占期")):
            d = rp.get(key)
            if d and TODAY.isoformat() <= d <= WINDOW_END.isoformat():
                rp_excl_window.append({
                    "ref_proper_name": rp["ref_proper_name"], "ref_brands": rp["ref_brands"],
                    "kind": label, "expiry": d,
                    "n_biosimilar_blas": rp["n_biosimilar_blas"],
                    "n_interchangeable_blas": rp["n_interchangeable_blas"],
                })
    rp_excl_window.sort(key=lambda x: x["expiry"])

    # ---------- 5. 与 fda_drugs.db 交叉验证 ----------
    drugs = sqlite3.connect(DRUGS_DB)
    db_bla = drugs.execute("SELECT COUNT(*) FROM applications WHERE appl_type='BLA'").fetchone()[0]
    csv_bla = len({g(r, "BLA Number") for r in data})
    csv_bla_351k = len({g(r, "BLA Number") for r in data if g(r, "License Type").startswith("351(k)")})
    db_351k_like = drugs.execute(
        "SELECT COUNT(*) FROM applications WHERE appl_type='BLA' AND appl_no LIKE '761%'"
    ).fetchone()[0]
    print(f"cross-check: db BLA={db_bla} (761xxx={db_351k_like}) vs csv BLA={csv_bla} (351k={csv_bla_351k})")

    n_products_351k = sum(1 for r in data if g(r, "License Type") == "351(k) Biosimilar")
    n_products_inter = sum(1 for r in data if g(r, "License Type") == "351(k) Interchangeable")
    out = {
        "generated_at": TODAY.isoformat(),
        "pb_version": PB_VERSION,
        "fetch_date": TODAY.isoformat(),
        "source": "FDA Purple Book monthly data download (purplebooksearch.fda.gov)",
        "window": {"start": TODAY.isoformat(), "end": WINDOW_END.isoformat(), "months": 36},
        "kpis": {
            "pb_products": len(data),
            "pb_blas": csv_bla,
            "products_351a": sum(1 for r in data if g(r, "License Type") == "351(a)"),
            "products_biosimilar": n_products_351k,
            "products_interchangeable": n_products_inter,
            "blas_biosimilar": len({g(r, "BLA Number") for r in data if g(r, "License Type") == "351(k) Biosimilar"}),
            "blas_interchangeable": len({g(r, "BLA Number") for r in data if g(r, "License Type") == "351(k) Interchangeable"}),
            "rp_with_biosimilars": len(rp_list),
            "rp_excl_in_window": len(rp_excl_window),
            "crosscheck_db_bla": db_bla,
            "crosscheck_db_bla_761": db_351k_like,
        },
        "reference_products": rp_list,
        "exclusivity_window": rp_excl_window,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT_JSON} ({OUT_JSON.stat().st_size/1024:.0f} KB)")
    aux.close()
    drugs.close()


if __name__ == "__main__":
    main()
