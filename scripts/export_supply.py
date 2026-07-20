#!/usr/bin/env python3
"""导出药品短缺 × 单一来源供应风险：openFDA drug-shortages -> fda_aux.db + supply_risk.json

数据源：data_lake/shortages/drug-shortages-0001-of-0001.json（openFDA，版本 2026-07-18）
联动：fda_drugs.db 在售 Rx/OTC 成分（marketing_status_id IN (1,2)）按申请号去重仅 1 个 = 单一来源
      （与 export_mining.py 的 supply_risk.single_source_count 口径一致）
风险分级：
  高   = 当前短缺（status=Current）且单一来源
  中   = 曾短缺 / 停产中（Resolved / To Be Discontinued，当前无 Current 记录）
  观察 = 单一来源且无短缺记录
  另附：当前短缺但多来源成分清单（信息项）
运行：从工作区根目录  python fda-drug-web/scripts/export_supply.py
"""
import json
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SH_JSON = ROOT / "data_lake/shortages/drug-shortages-0001-of-0001.json"
DRUGS_DB = ROOT / "fda_drugs.db"
AUX_DB = ROOT / "fda_aux.db"
OUT_JSON = ROOT / "fda-drug-web/public/data/supply_risk.json"

TODAY = date.today()

FORM_WORDS = re.compile(
    r"\b(CAPSULE|CAPSULES|TABLET|TABLETS|INJECTION|SPRAY|SOLUTION|SUSPENSION|CREAM|OINTMENT|GEL|PATCH|"
    r"EXTENDED RELEASE|DELAYED RELEASE|ORAL|TOPICAL|NASAL|OPHTHALMIC|OTIC|POWDER|FOR|SYRUP|ELIXIR|DROPS|"
    r"INHALATION|INTRAVENOUS|SUPPOSITORY|KIT|PREFILLED|SYRINGE|VIAL|PEN|IMPLANT|RING|FILM|LOTION|SHAMPOO|"
    r"FOAM|EMULSION|GRANULES|CHEWABLE|DISINTEGRATING|EFFERVESCENT|LIPOSOMAL|LYOPHILIZED|READY TO USE|"
    r"CONCENTRATE|DILUENT|INFUSION|PUMP|CARTRIDGE|AUTOINJECTOR|METERED|DOSE|MULTI|SINGLE|STERILE)\b",
    re.I,
)


def mdy(s):
    """'07/10/2026' -> date"""
    if not s:
        return None
    try:
        return datetime.strptime(s, "%m/%d/%Y").date()
    except ValueError:
        return None


def main():
    raw = json.load(open(SH_JSON, encoding="utf-8"))
    sh_version = raw["meta"]["last_updated"]
    recs = raw["results"]
    print(f"openFDA shortages version={sh_version} records={len(recs)}")

    drugs = sqlite3.connect(DRUGS_DB)

    # ---------- 1. 成分词表与单一来源（沿用 export_mining.py 口径） ----------
    db_ings = set()
    ing_apps = defaultdict(set)
    for appl_no, ing in drugs.execute(
        "SELECT appl_no, active_ingredient FROM products WHERE marketing_status_id IN (1,2)"
    ):
        key = (ing or "").strip().upper()
        db_ings.add(key)
        ing_apps[key].add(appl_no)
    # 口径与 export_mining.py 完全一致（含空成分组，共 1005）；输出时剔除空成分
    single_source_all = {ing: apps for ing, apps in ing_apps.items() if len(apps) == 1}
    single_source = {ing: apps for ing, apps in single_source_all.items() if ing}
    print(f"single_source_count={len(single_source_all)} (应为 1005, 其中空成分 {len(single_source_all)-len(single_source)} 个)")

    comp_map = defaultdict(set)
    for ing in db_ings:
        if not ing:
            continue
        for part in ing.split(";"):
            comp_map[part.strip()].add(ing)

    onmarket_cnt = defaultdict(int)
    for ing, cnt in drugs.execute(
        "SELECT UPPER(TRIM(active_ingredient)), COUNT(*) FROM products WHERE marketing_status_id IN (1,2) GROUP BY UPPER(TRIM(active_ingredient))"
    ):
        onmarket_cnt[ing] = cnt

    def match_ingredients(r):
        subs = (r.get("openfda") or {}).get("substance_name") or []
        matched = set()
        for s in subs:
            s = s.strip().upper()
            if s in db_ings:
                matched.add(s)
            matched |= comp_map.get(s, set())
        if not matched:
            base = FORM_WORDS.sub(" ", r.get("generic_name", "")).strip().upper()
            base = re.sub(r"[,;%].*$", "", base).strip()
            base = re.sub(r"\s+", " ", base)
            if base in db_ings:
                matched.add(base)
            elif base in comp_map:
                matched |= comp_map[base]
        return matched

    # ---------- 2. 短缺记录入 fda_aux.db ----------
    aux = sqlite3.connect(AUX_DB)
    cur = aux.cursor()
    cur.executescript(
        """
        DROP TABLE IF EXISTS shortage;
        CREATE TABLE shortage(
            package_ndc TEXT, generic_name TEXT, company_name TEXT, status TEXT,
            availability TEXT, update_type TEXT, dosage_form TEXT, presentation TEXT,
            therapeutic_category TEXT, initial_posting_date TEXT, update_date TEXT,
            discontinued_date TEXT, resolved_note TEXT, shortage_reason TEXT,
            application_numbers TEXT, substance_names TEXT, matched_ingredients TEXT
        );
        """
    )
    for r in recs:
        of = r.get("openfda") or {}
        matched = match_ingredients(r)
        cur.execute(
            "INSERT INTO shortage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                r.get("package_ndc", ""), r.get("generic_name", ""), r.get("company_name", ""),
                r.get("status", ""), r.get("availability"), r.get("update_type", ""),
                r.get("dosage_form", ""), r.get("presentation", ""),
                "; ".join(r.get("therapeutic_category") or []),
                r.get("initial_posting_date", ""), r.get("update_date", ""),
                r.get("discontinued_date", ""), r.get("resolved_note", ""),
                r.get("shortage_reason", ""),
                ";".join(of.get("application_number") or []),
                ";".join(of.get("substance_name") or []),
                ";".join(sorted(matched)),
            ),
        )
    cur.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('shortages_version', ?)", (sh_version,))
    aux.commit()

    # ---------- 3. 成分级短缺状态聚合 ----------
    ing_status = defaultdict(lambda: {"current": [], "past": []})
    unmatched = 0
    for r in recs:
        matched = match_ingredients(r)
        if not matched:
            unmatched += 1
            continue
        bucket = "current" if r.get("status") == "Current" else "past"
        for ing in matched:
            ing_status[ing][bucket].append(r)
    print(f"unmatched records: {unmatched}")

    # ---------- 4. 风险分级 ----------
    high, medium, watch, shortage_multi = [], [], [], []
    for ing, st in ing_status.items():
        if st["current"]:
            companies = sorted({r.get("company_name", "") for r in st["current"]})
            forms = sorted({r.get("dosage_form", "") for r in st["current"] if r.get("dosage_form")})
            cats = sorted({c for r in st["current"] for c in (r.get("therapeutic_category") or [])})
            since = min((mdy(r.get("initial_posting_date")) for r in st["current"] if mdy(r.get("initial_posting_date"))), default=None)
            latest = max((mdy(r.get("update_date")) for r in st["current"] if mdy(r.get("update_date"))), default=None)
            entry = {
                "ingredient": ing,
                "n_presentations": len(st["current"]),
                "companies": companies[:6], "n_companies": len(companies),
                "dosage_forms": forms[:5], "therapeutic_category": cats[:4],
                "since": since.isoformat() if since else None,
                "latest_update": latest.isoformat() if latest else None,
                "onmarket_products": onmarket_cnt.get(ing, 0),
                "single_source": ing in single_source,
            }
            (high if ing in single_source else shortage_multi).append(entry)
        else:
            latest = max((mdy(r.get("update_date")) for r in st["past"] if mdy(r.get("update_date"))), default=None)
            statuses = sorted({r.get("status", "") for r in st["past"]})
            medium.append({
                "ingredient": ing,
                "last_status": "; ".join(statuses),
                "latest_update": latest.isoformat() if latest else None,
                "n_records": len(st["past"]),
                "single_source": ing in single_source,
                "onmarket_products": onmarket_cnt.get(ing, 0),
            })
    for ing, apps in single_source.items():
        if ing not in ing_status:
            appl_no = next(iter(apps))
            brand = drugs.execute(
                "SELECT drug_name FROM products WHERE appl_no=? AND marketing_status_id IN (1,2) LIMIT 1",
                (appl_no,),
            ).fetchone()
            watch.append({
                "ingredient": ing, "appl_no": appl_no,
                "brand": brand[0] if brand else "",
                "onmarket_products": onmarket_cnt.get(ing, 0),
            })
    high.sort(key=lambda x: x["since"] or "9999")
    medium.sort(key=lambda x: x["latest_update"] or "", reverse=True)
    watch.sort(key=lambda x: x["ingredient"])
    shortage_multi.sort(key=lambda x: x["since"] or "9999")
    print(f"high={len(high)} medium={len(medium)} watch={len(watch)} shortage_multi={len(shortage_multi)}")

    # ---------- 5. 当前短缺明细（前端表格，限 120 条） ----------
    current_details = []
    for r in recs:
        if r.get("status") != "Current":
            continue
        matched = match_ingredients(r)
        current_details.append({
            "generic_name": r.get("generic_name", ""),
            "company_name": r.get("company_name", ""),
            "dosage_form": r.get("dosage_form", ""),
            "availability": r.get("availability"),
            "therapeutic_category": (r.get("therapeutic_category") or [])[:3],
            "initial_posting_date": r.get("initial_posting_date", ""),
            "update_date": r.get("update_date", ""),
            "matched_ingredient": ";".join(sorted(matched)) if matched else None,
            "single_source": any(m in single_source for m in matched),
        })
    current_details.sort(key=lambda x: (x["single_source"], x["initial_posting_date"]), reverse=False)
    current_details.sort(key=lambda x: not x["single_source"])

    out = {
        "generated_at": TODAY.isoformat(),
        "shortages_version": sh_version,
        "fetch_date": TODAY.isoformat(),
        "source": "openFDA drug/shortages endpoint (FDA Drug Shortages)",
        "kpis": {
            "shortage_records": len(recs),
            "current_records": sum(1 for r in recs if r.get("status") == "Current"),
            "current_ingredients": sum(1 for v in ing_status.values() if v["current"]),
            "high_risk": len(high), "medium_risk": len(medium), "watch": len(watch),
            "shortage_multi": len(shortage_multi),
            "single_source_count": len(single_source_all),
            "unmatched_records": unmatched,
        },
        "high": high,
        "medium": medium[:200],
        "watch": watch,
        "shortage_multi": shortage_multi,
        "current_details": current_details[:120],
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT_JSON} ({OUT_JSON.stat().st_size/1024:.0f} KB)")
    aux.close()
    drugs.close()


if __name__ == "__main__":
    main()
