#!/usr/bin/env python3
"""导出橙皮书专利悬崖数据：openFDA drug-orangebook -> fda_aux.db + patent_cliff.json

数据源：data_lake/orangebook/drug-orangebook-0001-of-0001.json（openFDA，版本 2026-07-18）
产出：
  - fda_aux.db 表 ob_products / ob_patents / ob_exclusivity / meta
  - fda-drug-web/public/data/patent_cliff.json
运行：从工作区根目录  python fda-drug-web/scripts/export_orangebook.py
"""
import json
import re
import sqlite3
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OB_JSON = ROOT / "data_lake/orangebook/drug-orangebook-0001-of-0001.json"
DRUGS_DB = ROOT / "fda_drugs.db"
AUX_DB = ROOT / "fda_aux.db"
OUT_JSON = ROOT / "fda-drug-web/public/data/patent_cliff.json"

TODAY = date.today()
WINDOW_MONTHS = 36
WINDOW_END = date(TODAY.year + 3, TODAY.month, TODAY.day)  # 36 个月


def ymd(s):
    """'20261121' -> date；非法返回 None"""
    if not s or len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except ValueError:
        return None


def main():
    raw = json.load(open(OB_JSON, encoding="utf-8"))
    ob_version = raw["meta"]["last_updated"]
    records = raw["results"]
    print(f"openFDA orangebook version={ob_version} records={len(records)}")

    # ---------- 1. 入库 fda_aux.db ----------
    aux = sqlite3.connect(AUX_DB)
    cur = aux.cursor()
    cur.executescript(
        """
        DROP TABLE IF EXISTS ob_products;
        DROP TABLE IF EXISTS ob_patents;
        DROP TABLE IF EXISTS ob_exclusivity;
        CREATE TABLE ob_products(
            appl_no TEXT, product_no TEXT, brand_name TEXT, ingredient TEXT,
            applicant TEXT, appl_type TEXT, marketing_status TEXT,
            rld INTEGER, rs INTEGER, te_code TEXT, approval_date TEXT,
            dosage_form TEXT, route TEXT,
            PRIMARY KEY(appl_no, product_no)
        );
        CREATE TABLE ob_patents(
            appl_no TEXT, product_no TEXT, patent_no TEXT, base_patent_no TEXT,
            is_ped INTEGER, expire_date TEXT, ds_flag INTEGER, dp_flag INTEGER,
            use_code TEXT, submission_date TEXT
        );
        CREATE INDEX idx_ob_patents_exp ON ob_patents(expire_date);
        CREATE INDEX idx_ob_patents_appl ON ob_patents(appl_no);
        CREATE TABLE ob_exclusivity(
            appl_no TEXT, product_no TEXT, code TEXT, expire_date TEXT
        );
        CREATE INDEX idx_ob_excl_exp ON ob_exclusivity(expire_date);
        CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
        """
    )

    n_pat = n_exc = 0
    for rec in records:
        prods = rec.get("products") or []
        if not prods:
            continue
        p = prods[0]
        appl_no = p.get("application_number", "")
        product_no = rec.get("product_number", "")
        ings = [a.get("name", "").strip() for a in (p.get("active_ingredients") or []) if a.get("name")]
        ingredient = "; ".join(ings)
        cur.execute(
            "INSERT OR REPLACE INTO ob_products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                appl_no, product_no, p.get("brand_name", ""), ingredient,
                p.get("application_full_name") or p.get("application_name", ""),
                p.get("application_type", ""), p.get("marketing_status", ""),
                1 if p.get("reference_listed_drug") else 0,
                1 if p.get("reference_standard") else 0,
                ";".join(p.get("therapeutic_equivalence_codes") or []),
                rec.get("approval_date", ""), p.get("dosage_form", ""), p.get("route", ""),
            ),
        )
        for pat in rec.get("patents") or []:
            pno = str(pat.get("patent_number", ""))
            is_ped = 1 if pno.upper().endswith("*PED") else 0
            base = re.sub(r"\*PED$", "", pno, flags=re.I)
            cur.execute(
                "INSERT INTO ob_patents VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    appl_no, product_no, pno, base, is_ped,
                    pat.get("expiration_date", ""),
                    1 if pat.get("drug_substance_flag") else 0,
                    1 if pat.get("drug_product_flag") else 0,
                    pat.get("patent_use_code", ""), pat.get("patent_submission_date", ""),
                ),
            )
            n_pat += 1
        for ex in rec.get("exclusivity") or []:
            cur.execute(
                "INSERT INTO ob_exclusivity VALUES(?,?,?,?)",
                (appl_no, product_no, ex.get("exclusivity_code", ""), ex.get("exclusivity_expiration_date", "")),
            )
            n_exc += 1
    cur.execute("INSERT OR REPLACE INTO meta VALUES('ob_version', ?)", (ob_version,))
    cur.execute("INSERT OR REPLACE INTO meta VALUES('ob_download_date', ?)", (TODAY.isoformat(),))
    aux.commit()
    print(f"fda_aux.db: ob_patents={n_pat} ob_exclusivity={n_exc}")

    # ---------- 2. fda_drugs.db 侧聚合（在售产品数 / 暂定批准数） ----------
    drugs = sqlite3.connect(DRUGS_DB)
    onmarket = defaultdict(int)      # 成分 -> 在售产品行数
    onmarket_appls = defaultdict(set)
    tentative = defaultdict(set)     # 成分 -> 暂定批准 appl_no 集合
    for appl_no, ing in drugs.execute(
        "SELECT appl_no, active_ingredient FROM products WHERE marketing_status_id IN (1,2)"
    ):
        key = (ing or "").strip().upper()
        onmarket[key] += 1
        onmarket_appls[key].add(appl_no)
    for appl_no, ing in drugs.execute(
        "SELECT appl_no, active_ingredient FROM products WHERE marketing_status_id = 4"
    ):
        tentative[(ing or "").strip().upper()].add(appl_no)

    # ---------- 3. 专利悬崖：窗口内到期专利按成分聚合 ----------
    w_start, w_end = TODAY, WINDOW_END
    cliff = {}
    for appl_no, product_no, brand, ingredient, applicant, appl_type in aux.execute(
        "SELECT appl_no, product_no, brand_name, ingredient, applicant, appl_type FROM ob_products"
    ):
        pats = aux.execute(
            "SELECT patent_no, base_patent_no, expire_date, ds_flag FROM ob_patents WHERE appl_no=? AND product_no=?",
            (appl_no, product_no),
        ).fetchall()
        if not pats:
            continue
        in_win = [(pn, bp, ymd(ed), ds) for pn, bp, ed, ds in pats]
        in_win = [(pn, bp, ed, ds) for pn, bp, ed, ds in in_win if ed and w_start <= ed <= w_end]
        if not in_win:
            continue
        key = ingredient.strip().upper()
        c = cliff.setdefault(
            key,
            {
                "ingredient": ingredient.strip(),
                "brands": set(), "applicants": set(), "appl_nos": set(),
                "expiries": [], "base_patents": set(), "ds_expiries": [],
                "n_patents_total": 0,
            },
        )
        c["brands"].add(brand)
        c["applicants"].add(applicant)
        c["appl_nos"].add(appl_no)
        c["n_patents_total"] += len(pats)
        for pn, bp, ed, ds in in_win:
            c["expiries"].append(ed)
            c["base_patents"].add(bp)
            if ds:
                c["ds_expiries"].append(ed)

    rows = []
    for key, c in cliff.items():
        expiries = sorted(c["expiries"])
        rows.append(
            {
                "ingredient": c["ingredient"],
                "brands": sorted(c["brands"])[:4],
                "applicants": sorted(c["applicants"])[:3],
                "n_appls": len(c["appl_nos"]),
                "earliest_expiry": expiries[0].isoformat(),
                "latest_expiry": expiries[-1].isoformat(),
                "n_patents_window": len(c["base_patents"]),
                "n_patents_total": c["n_patents_total"],
                "ds_latest": max(c["ds_expiries"]).isoformat() if c["ds_expiries"] else None,
                "onmarket_products": onmarket.get(key, 0),
                "onmarket_appls": len(onmarket_appls.get(key, ())),
                "tentative_andas": len(tentative.get(key, ())),
                "appl_nos": sorted(c["appl_nos"])[:6],
            }
        )
    rows.sort(key=lambda r: (r["earliest_expiry"], -r["onmarket_products"]))
    print(f"patent cliff: {len(rows)} ingredients with patents expiring {w_start}..{w_end}")

    # ---------- 4. 独占期悬崖 ----------
    excl_rows = []
    for appl_no, product_no, code, ed in aux.execute(
        "SELECT appl_no, product_no, code, expire_date FROM ob_exclusivity"
    ):
        d = ymd(ed)
        if not d or not (w_start <= d <= w_end):
            continue
        prod = aux.execute(
            "SELECT brand_name, ingredient FROM ob_products WHERE appl_no=? AND product_no=?",
            (appl_no, product_no),
        ).fetchone()
        if not prod:
            continue
        excl_rows.append(
            {
                "ingredient": prod[1], "brand": prod[0], "code": code,
                "expiry": d.isoformat(), "appl_no": appl_no,
                "tentative_andas": len(tentative.get(prod[1].strip().upper(), ())),
            }
        )
    excl_rows.sort(key=lambda r: r["expiry"])
    print(f"exclusivity cliff: {len(excl_rows)} product-exclusivity rows in window")

    # ---------- 5. 暂定批准榜（锚点验证：APIXABAN≈9 / PALBOCICLIB≈9） ----------
    tentative_top = [
        {"ingredient": ing, "n": len(apps), "onmarket_products": onmarket.get(ing, 0)}
        for ing, apps in sorted(tentative.items(), key=lambda kv: -len(kv[1]))[:30]
    ]
    anchors = {t["ingredient"]: t["n"] for t in tentative_top}
    print("anchors:", {k: anchors.get(k) for k in ("APIXABAN", "PALBOCICLIB")})
    tentative_total = drugs.execute(
        "SELECT COUNT(DISTINCT appl_no) FROM products WHERE marketing_status_id = 4"
    ).fetchone()[0]

    # ---------- 6. ELIQUIS / IBRANCE 时间线 ----------
    def timeline(appl_no, label):
        pats = []
        for product_no, pno, ed, ds, dp, uc in aux.execute(
            "SELECT product_no, patent_no, expire_date, ds_flag, dp_flag, use_code FROM ob_patents WHERE appl_no=? ORDER BY expire_date",
            (appl_no,),
        ):
            d = ymd(ed)
            pats.append(
                {
                    "product_no": product_no, "patent_no": pno,
                    "expiry": d.isoformat() if d else ed,
                    "ds": bool(ds), "dp": bool(dp), "use_code": uc,
                }
            )
        excs = [
            {"product_no": pr, "code": c, "expiry": (ymd(e).isoformat() if ymd(e) else e)}
            for pr, c, e in aux.execute(
                "SELECT product_no, code, expire_date FROM ob_exclusivity WHERE appl_no=? ORDER BY expire_date",
                (appl_no,),
            )
        ]
        brand = aux.execute(
            "SELECT brand_name FROM ob_products WHERE appl_no=? LIMIT 1", (appl_no,)
        ).fetchone()
        return {"label": label, "appl_no": appl_no, "brand": brand[0] if brand else label,
                "patents": pats, "exclusivity": excs}

    timelines = {
        "ELIQUIS": timeline("202155", "ELIQUIS (apixaban)"),
        "IBRANCE": timeline("207103", "IBRANCE (palbociclib)"),
    }

    # ---------- 7. 输出 JSON ----------
    out = {
        "generated_at": TODAY.isoformat(),
        "ob_version": ob_version,
        "source": "openFDA drug/orangebook endpoint (FDA Orange Book monthly data)",
        "window": {"start": w_start.isoformat(), "end": w_end.isoformat(), "months": WINDOW_MONTHS},
        "kpis": {
            "cliff_ingredients": len(rows),
            "cliff_patents": sum(r["n_patents_window"] for r in rows),
            "cliff_onmarket_products": sum(r["onmarket_products"] for r in rows),
            "excl_rows": len(excl_rows),
            "tentative_total_appls": tentative_total,
        },
        "patent_cliff": rows,
        "exclusivity_cliff": excl_rows,
        "tentative_top": tentative_top,
        "timelines": timelines,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT_JSON} ({OUT_JSON.stat().st_size/1024:.0f} KB)")

    aux.close()
    drugs.close()


if __name__ == "__main__":
    main()
