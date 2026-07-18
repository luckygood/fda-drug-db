#!/usr/bin/env python3
"""深度挖掘数据导出 → fda-drug-web/public/data/mining.json

5 块数据：
1. disease_heatmap   疾病创新热度（从 diseases/*.json 计算，无需查库）
2. broad_spectrum    广谱药物 Top 20（跨疾病 JSON 交叉统计）
3. nme               NME 专题（yearly / top_companies / latest）
4. generic_cliff     仿制药悬崖（stats / top_genericized / tentative_top）
5. supply_risk       可及性风险（单一来源成分 / 撤市趋势）
"""
import json
import os
import sqlite3
import time
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
DB_DRUGS = os.path.join(BASE, "fda_drugs.db")
DIS_DIR = os.path.join(BASE, "fda-drug-web", "public", "data", "diseases")
OUT = os.path.join(BASE, "fda-drug-web", "public", "data", "mining.json")

NME_SQL = """
    SELECT appl_no, MIN(status_date) FROM submissions
    WHERE submission_type = 'ORIG' AND submission_status = 'AP'
      AND submission_class LIKE 'Type 1%'
    GROUP BY appl_no
"""


def load_disease_jsons():
    out = {}
    for f in os.listdir(DIS_DIR):
        if f.endswith(".json") and f not in ("index.json", "app_index.json"):
            with open(os.path.join(DIS_DIR, f), encoding="utf-8") as fh:
                out[f[:-5]] = json.load(fh)
    return out


def main():
    t0 = time.time()
    mining = {}

    # ---------- 1. disease_heatmap ----------
    diseases = load_disease_jsons()
    heatmap = []
    for slug, d in diseases.items():
        drugs = d["drugs"]
        recent5 = sum(1 for x in drugs if (x["approval_date"] or "") >= "2021")
        boxed = sum(1 for x in drugs if x["has_boxed_warning"])
        heatmap.append({
            "slug": slug,
            "name_zh": d["name_zh"],
            "area": d["area"],
            "drug_count": len(drugs),
            "recent5": recent5,
            "boxed_pct": round(boxed / len(drugs) * 100, 1) if drugs else 0,
        })
    heatmap.sort(key=lambda x: -x["recent5"])
    mining["disease_heatmap"] = heatmap

    # ---------- 2. broad_spectrum ----------
    # 按 (药名+成分) 归一去重：同一药物可能有多个厂商申请号（ANDA075988/076913...）
    # 代表申请号优先取 BLA > NDA > ANDA（原研优先）
    def _type_rank(appno):
        return 0 if appno.startswith("BLA") else (1 if appno.startswith("NDA") else 2)

    drug_map = {}
    for slug, d in diseases.items():
        seen_in_disease = set()
        for x in d["drugs"]:
            appno = x["application_number"]
            key = (x["drug_name"].strip().upper(), x["active_ingredient"].strip().upper())
            if key in seen_in_disease:
                continue
            seen_in_disease.add(key)
            rec = drug_map.setdefault(key, {"drug_name": x["drug_name"],
                                            "ingredient": x["active_ingredient"],
                                            "diseases": [], "apps": set(), "rep": appno})
            rec["diseases"].append(d["name_zh"])
            rec["apps"].add(appno)
            if _type_rank(appno) < _type_rank(rec["rep"]):
                rec["rep"] = appno
    broad = sorted(drug_map.items(), key=lambda kv: -len(kv[1]["diseases"]))[:20]
    mining["broad_spectrum"] = [
        {
            "application_number": rec["rep"],
            "drug_name": rec["drug_name"],
            "active_ingredient": rec["ingredient"],
            "disease_count": len(rec["diseases"]),
            "application_count": len(rec["apps"]),
            "sample_diseases": rec["diseases"][:5],
        }
        for key, rec in broad
    ]

    # ---------- 3. nme ----------
    conn = sqlite3.connect(DB_DRUGS)
    nme = {}
    for appl_no, ap_date in conn.execute(NME_SQL):
        nme[appl_no] = ap_date
    print(f"NME total: {len(nme)}")

    appl_type = dict(conn.execute("SELECT appl_no, appl_type FROM applications"))
    sponsor = dict(conn.execute("SELECT appl_no, sponsor_name FROM applications"))
    orphan_set = {
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT appl_no FROM submission_property WHERE code = 'Orphan'"
        )
    }
    pri_set = {
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT appl_no FROM submissions "
            "WHERE submission_type = 'ORIG' AND submission_status = 'AP' "
            "AND review_priority = 'PRIORITY'"
        )
    }

    # yearly: 2010 至今
    yearly = defaultdict(lambda: {"nda": 0, "bla": 0, "orphan": 0, "pri": 0, "n": 0})
    for appl_no, ap_date in nme.items():
        yr = (ap_date or "")[:4]
        if not yr or int(yr) < 2010:
            continue
        t = appl_type.get(appl_no, "")
        y = yearly[yr]
        y["n"] += 1
        if t == "NDA":
            y["nda"] += 1
        elif t == "BLA":
            y["bla"] += 1
        if appl_no in orphan_set:
            y["orphan"] += 1
        if appl_no in pri_set:
            y["pri"] += 1
    years = sorted(yearly)
    mining["nme"] = {
        "yearly": [
            {
                "yr": yr,
                "nda": yearly[yr]["nda"],
                "bla": yearly[yr]["bla"],
                "orphan_pct": round(yearly[yr]["orphan"] / yearly[yr]["n"] * 100, 1) if yearly[yr]["n"] else 0,
                "pri_pct": round(yearly[yr]["pri"] / yearly[yr]["n"] * 100, 1) if yearly[yr]["n"] else 0,
            }
            for yr in years
        ]
    }

    # top_companies: 2016 以来
    comp = defaultdict(int)
    for appl_no, ap_date in nme.items():
        if (ap_date or "") >= "2016":
            comp[sponsor.get(appl_no) or "未知"] += 1
    mining["nme"]["top_companies"] = [
        {"sponsor": s, "n": n}
        for s, n in sorted(comp.items(), key=lambda kv: -kv[1])[:12]
    ]

    # latest: 2025 至今明细
    latest = []
    for appl_no, ap_date in nme.items():
        if (ap_date or "") < "2025":
            continue
        drug_name = conn.execute(
            "SELECT drug_name FROM products WHERE appl_no = ? LIMIT 1", (appl_no,)
        ).fetchone()
        appno = f"{appl_type.get(appl_no, '')}{appl_no}"
        latest.append({
            "application_number": appno,
            "drug_name": drug_name[0] if drug_name else "",
            "sponsor": sponsor.get(appl_no) or "",
            "ap_date": ap_date,
            "orphan": 1 if appl_no in orphan_set else 0,
            "priority": 1 if appl_no in pri_set else 0,
        })
    latest.sort(key=lambda x: x["ap_date"], reverse=True)
    mining["nme"]["latest"] = latest

    # ---------- 4. generic_cliff ----------
    # 单成分 NDA 类 NME（2005–2016 获批）
    single_nme = []  # (appl_no, ingredient_upper, nme_yr)
    for appl_no, ap_date in nme.items():
        t = appl_type.get(appl_no, "")
        yr = (ap_date or "")[:4]
        if t != "NDA" or not yr or not (2005 <= int(yr) <= 2016):
            continue
        ing = conn.execute(
            "SELECT active_ingredient FROM products WHERE appl_no = ? LIMIT 1",
            (appl_no,),
        ).fetchone()
        if not ing or not ing[0] or ";" in ing[0]:
            continue
        single_nme.append((appl_no, ing[0].strip().upper(), int(yr)))

    # 成分 → ANDA 列表（含无获批日期的记录；with_anda 口径=存在同成分 ANDA）
    anda_by_ing = defaultdict(list)  # ing -> [(appl_no, yr_or_None)]
    for appl_no, ap_date, ing in conn.execute(
        """
        SELECT a.appl_no, a.approval_date, p.active_ingredient
        FROM applications a JOIN products p ON p.appl_no = a.appl_no
        WHERE a.appl_type = 'ANDA'
        """
    ):
        anda_by_ing[(ing or "").strip().upper()].append(
            (appl_no, int(ap_date[:4]) if ap_date else None)
        )

    with_anda = 0
    lags = []
    genericized = []
    for appl_no, ing, nme_yr in single_nme:
        andas = anda_by_ing.get(ing, [])
        if not andas:
            continue
        anda_apps = {a for a, _ in andas}
        dated_yrs = [y for _, y in andas if y is not None]
        drug_name = conn.execute(
            "SELECT drug_name FROM products WHERE appl_no = ? LIMIT 1", (appl_no,)
        ).fetchone()
        with_anda += 1
        if not dated_yrs:
            continue  # 无获批日期（如仅暂定批准），不计入滞后统计
        first_yr = min(dated_yrs)
        lags.append(first_yr - nme_yr)
        genericized.append({
            "drug": (drug_name[0] if drug_name else "") or ing,
            "nme_yr": nme_yr,
            "anda_yr": first_yr,
            "lag": first_yr - nme_yr,
            "anda_n": len(anda_apps),
        })
    genericized.sort(key=lambda x: -x["anda_n"])
    mining["generic_cliff"] = {
        "stats": {
            "nme_total": len(single_nme),
            "with_anda": with_anda,
            "avg_lag_years": round(sum(lags) / len(lags), 1) if lags else 0,
        },
        "top_genericized": genericized[:15],
    }

    # tentative_top：暂定批准产品按成分聚合
    tent = defaultdict(set)
    for appl_no, ing in conn.execute(
        "SELECT appl_no, active_ingredient FROM products WHERE marketing_status_id = 4"
    ):
        tent[(ing or "").strip().upper()].add(appl_no)
    mining["generic_cliff"]["tentative_top"] = [
        {"ingredient": ing, "n": len(apps)}
        for ing, apps in sorted(tent.items(), key=lambda kv: -len(kv[1]))[:15]
    ]
    mining["generic_cliff"]["tentative_total_appls"] = conn.execute(
        "SELECT COUNT(DISTINCT appl_no) FROM products WHERE marketing_status_id = 4"
    ).fetchone()[0]

    # ---------- 5. supply_risk ----------
    ing_apps = defaultdict(set)  # 在售成分 -> appl_no 集合
    for appl_no, ing in conn.execute(
        "SELECT appl_no, active_ingredient FROM products WHERE marketing_status_id IN (1, 2)"
    ):
        ing_apps[(ing or "").strip().upper()].add(appl_no)
    single_source = {ing: apps for ing, apps in ing_apps.items() if len(apps) == 1}
    examples = []
    for ing, apps in single_source.items():
        appl_no = next(iter(apps))
        ap = conn.execute(
            "SELECT approval_date FROM applications WHERE appl_no = ?", (appl_no,)
        ).fetchone()
        if ap and ap[0] and ap[0] >= "2015":
            t = appl_type.get(appl_no, "")
            examples.append({"ingredient": ing, "appl_no": f"{t}{appl_no}", "approval_date": ap[0]})
    examples.sort(key=lambda x: x["approval_date"], reverse=True)
    mining["supply_risk"] = {
        "single_source_count": len(single_source),
        "single_source_examples": examples[:10],
    }

    # 近 10 年获批产品中已撤市数量
    disc = defaultdict(int)
    for yr, in conn.execute(
        """
        SELECT substr(a.approval_date, 1, 4)
        FROM products p JOIN applications a ON a.appl_no = p.appl_no
        WHERE p.marketing_status_id = 3 AND a.approval_date IS NOT NULL
        """
    ):
        if yr and int(yr) >= 2017:
            disc[yr] += 1
    mining["supply_risk"]["discontinued_by_year"] = [
        {"yr": y, "n": disc[y]} for y in sorted(disc)
    ]

    # ---------- 6. lifecycle：注册生命周期曲线 ----------
    # 每个获批申请：首批日期 / 最后一次获批活动 / 获批补充次数
    last_action = {}
    suppl_cnt = defaultdict(int)
    for appl_no, st_type, st_date in conn.execute(
        "SELECT appl_no, submission_type, status_date FROM submissions WHERE submission_status = 'AP'"
    ):
        if not st_date:
            continue
        if appl_no not in last_action or st_date > last_action[appl_no]:
            last_action[appl_no] = st_date
        if st_type == "SUPPL":
            suppl_cnt[appl_no] += 1

    sponsor_name = dict(conn.execute("SELECT appl_no, sponsor_name FROM applications"))
    first_drug_lc = {}
    for appl_no, dname in conn.execute(
        "SELECT appl_no, drug_name FROM products WHERE drug_name IS NOT NULL"
    ):
        first_drug_lc.setdefault(appl_no, dname)

    spans = []  # (appl_no, span_years)
    for appl_no, ap_date in conn.execute(
        "SELECT appl_no, approval_date FROM applications WHERE approval_date IS NOT NULL"
    ):
        la = last_action.get(appl_no)
        if not la or la <= ap_date:
            continue
        span = round(
            (int(la[:4]) * 12 + int(la[5:7]) - int(ap_date[:4]) * 12 - int(ap_date[5:7])) / 12, 1
        )
        spans.append((appl_no, ap_date, la, span))

    # Top 20 按获批补充次数（注册维护投入）排序，跨度次之
    top_maintained = sorted(spans, key=lambda x: (-suppl_cnt.get(x[0], 0), -x[3]))[:20]
    mining["lifecycle"] = {
        "top_maintained": [
            {
                "application_number": f"{appl_type.get(a, '')}{a}",
                "drug_name": first_drug_lc.get(a, ""),
                "sponsor": sponsor_name.get(a) or "",
                "first_ap": apd,
                "last_action": la,
                "span_years": sp,
                "supplements": suppl_cnt.get(a, 0),
            }
            for a, apd, la, sp in top_maintained
        ]
    }

    # 跨度分布（5 年桶）
    hist = defaultdict(int)
    for _a, _apd, _la, sp in spans:
        b = min(int(sp // 5) * 5, 30)
        hist[b] += 1
    mining["lifecycle"]["span_hist"] = [
        {"bucket": f"{b}-{b+4}", "n": hist[b]} for b in sorted(hist)
    ]

    # 各获批年代的中位维护跨度
    era_spans = defaultdict(list)
    for _a, apd, _la, sp in spans:
        y = int(apd[:4])
        era = f"{y // 5 * 5}-{y // 5 * 5 + 4}"
        era_spans[era].append(sp)
    mining["lifecycle"]["median_by_era"] = [
        {"era": era, "median_span": round(sorted(v)[len(v) // 2], 1), "n": len(v)}
        for era, v in sorted(era_spans.items())
    ]

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(mining, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUT)
    print(f"\nmining.json: {size/1024:.1f} KB")
    print(f"  disease_heatmap: {len(mining['disease_heatmap'])} 疾病")
    print(f"  broad_spectrum: {len(mining['broad_spectrum'])} 药物")
    print(f"  nme.yearly: {len(mining['nme']['yearly'])} 年 | top_companies: {len(mining['nme']['top_companies'])} | latest: {len(mining['nme']['latest'])}")
    print(f"  generic_cliff.stats: {mining['generic_cliff']['stats']}")
    print(f"  tentative_total_appls: {mining['generic_cliff']['tentative_total_appls']}")
    print(f"  supply_risk.single_source_count: {mining['supply_risk']['single_source_count']}")
    print(f"  lifecycle.top_maintained#1: {mining['lifecycle']['top_maintained'][0]}")
    print(f"耗时: {time.time()-t0:.0f}s")
    conn.close()


if __name__ == "__main__":
    main()
