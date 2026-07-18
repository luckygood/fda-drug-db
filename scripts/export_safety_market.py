#!/usr/bin/env python3
"""第二梯队深度分析导出：安全性图谱 / 撤市全景 / 首仿时滞 / 生物制剂崛起。

运行目录：数据工作区根（fda_drugs.db、fda_labels.db 与 fda-drug-web/ 同级）。
输出到 fda-drug-web/public/data/：
  safety_boxed.json / withdrawn.json / generic_lag.json / biologics.json
"""
import json
import os
import re
import sqlite3
import time
from collections import defaultdict

from disease_drugs import unpack
from export_companies import normalize, alias_for

DB_DRUGS = "fda_drugs.db"
DB_LABELS = "fda_labels.db"
OUT_DIR = "fda-drug-web/public/data"

NME_SQL = """
    SELECT appl_no, MIN(status_date) FROM submissions
    WHERE submission_type = 'ORIG' AND submission_status = 'AP'
      AND submission_class LIKE 'Type 1%'
    GROUP BY appl_no
"""

# 黑框警示主题词表（英文关键词小写匹配，一药可中多主题）
THEMES = [
    ("death", "死亡风险", ["death", "fatal", "mortality"]),
    ("cardio", "心血管", ["myocardial", "cardiovascular", "qt prolong", "arrhythmia", "heart failure", "cardiac"]),
    ("hepato", "肝毒性", ["hepatotox", "hepatic", "liver failure", "liver injury"]),
    ("suicide", "自杀倾向", ["suicid"]),
    ("infection", "感染", ["infection", "sepsis", "tuberculosis", "progressive multifocal", "pml"]),
    ("thrombo", "血栓", ["thrombo", "embolism", "blood clot", "dvt"]),
    ("tumor", "肿瘤", ["malignan", "lymphoma", "cancer", "tumor", "neoplasm"]),
    ("fetal", "胎儿毒性", ["fetal", "embryo", "pregnanc", "birth defect", "teratogen"]),
    ("marrow", "骨髓抑制", ["myelosuppression", "bone marrow", "neutropenia", "agranulocytosis", "aplastic anemia"]),
    ("abuse", "滥用成瘾", ["abuse", "addiction", "dependence", "misuse", "opioid"]),
]

APPN_RE = re.compile(r"^(NDA|ANDA|BLA)(\d+)$")


def era_of(year: int) -> str:
    if year < 1990:
        return "1990 前"
    return f"{year // 10 * 10}s"


def main() -> None:
    t0 = time.time()
    drugs = sqlite3.connect(DB_DRUGS)
    labels = sqlite3.connect(DB_LABELS)

    appl_type = dict(drugs.execute("SELECT appl_no, appl_type FROM applications"))
    appl_date = dict(drugs.execute("SELECT appl_no, approval_date FROM applications"))
    sponsor = dict(drugs.execute("SELECT appl_no, sponsor_name FROM applications"))
    first_drug = {}
    for a, dn in drugs.execute("SELECT appl_no, drug_name FROM products WHERE drug_name IS NOT NULL"):
        first_drug.setdefault(a, dn)

    # ============ 1. safety_boxed.json ============
    print("===== 1. 黑框警告挖掘 =====")
    # 每个申请：是否带黑框（labels 聚合）+ 最新有效黑框文本（label_deep）
    app_boxed = defaultdict(int)  # appl_no -> 0/1
    app_brand = {}
    app_deep_sid = {}  # appl_no -> (effective_time, set_id) 最新带 deep 的文档
    for appno, brand, hbw, sid, eff in labels.execute(
        "SELECT application_number, brand_name, has_boxed_warning, set_id, effective_time FROM labels"
    ):
        m = APPN_RE.match(appno or "")
        if not m:
            continue
        appl_no = m.group(2)
        if hbw:
            app_boxed[appl_no] = 1
        else:
            app_boxed.setdefault(appl_no, 0)
        if brand and appl_no not in app_brand:
            app_brand[appl_no] = brand
        prev = app_deep_sid.get(appl_no)
        if sid and (prev is None or (eff or "") > prev[0]):
            app_deep_sid[appl_no] = (eff or "", sid)

    deep_texts = labels.execute("SELECT COUNT(*) FROM label_deep").fetchone()[0]
    boxed_texts = labels.execute(
        "SELECT COUNT(*) FROM label_deep WHERE boxed_warning IS NOT NULL AND LENGTH(boxed_warning) > 0"
    ).fetchone()[0]
    label_docs = labels.execute("SELECT COUNT(*) FROM labels").fetchone()[0]

    # 黑框文本（解 zlib）
    boxed_text_of = {}
    for appl_no, (_eff, sid) in app_deep_sid.items():
        row = labels.execute(
            "SELECT boxed_warning FROM label_deep WHERE set_id = ?", (sid,)
        ).fetchone()
        if row and row[0]:
            txt = re.sub(r"\s+", " ", unpack(row[0])).strip()
            if txt:
                boxed_text_of[appl_no] = txt

    labeled_apps = len(app_boxed)
    boxed_apps = sum(1 for v in app_boxed.values() if v)
    print(f"labels 文档 {label_docs} | deep 文本 {deep_texts} | 含黑框文本 {boxed_texts}")
    print(f"有说明书申请 {labeled_apps} | 带黑框 {boxed_apps} ({boxed_apps/labeled_apps*100:.1f}%)")

    # ① 按获批年代携带率（分母=有说明书的申请）
    era_stat = defaultdict(lambda: [0, 0])  # era -> [apps, boxed]
    for appl_no, hbw in app_boxed.items():
        d = appl_date.get(appl_no)
        if not d:
            continue
        era = era_of(int(d[:4]))
        era_stat[era][0] += 1
        era_stat[era][1] += hbw
    era_rates = [
        {"era": e, "apps": v[0], "boxed": v[1], "rate": round(v[1] / v[0] * 100, 1)}
        for e, v in sorted(era_stat.items())
    ]
    print("年代携带率:", era_rates)

    # ② 主题分类（基于黑框文本）
    theme_hits = defaultdict(list)  # theme_key -> [appl_no]
    app_themes = {}
    for appl_no, txt in boxed_text_of.items():
        low = txt.lower()
        hits = [k for k, _zh, kws in THEMES if any(kw in low for kw in kws)]
        app_themes[appl_no] = hits
        for k in hits:
            theme_hits[k].append(appl_no)
    themes_out = []
    for k, zh, _kws in THEMES:
        apps = theme_hits.get(k, [])
        examples = sorted({(app_brand.get(a) or first_drug.get(a) or "").strip() for a in apps} - {""})[:5]
        themes_out.append({"key": k, "name_zh": zh, "count": len(apps), "examples": examples})
    themes_out.sort(key=lambda x: -x["count"])
    print("主题分布:", [(t["name_zh"], t["count"]) for t in themes_out])

    # ③ 携带黑框警告的 NME
    nme_date = dict(drugs.execute(NME_SQL))
    nme_boxed = []
    for appl_no, ap_date in nme_date.items():
        if not app_boxed.get(appl_no):
            continue
        zh_hits = [zh for k, zh, _ in THEMES if k in app_themes.get(appl_no, [])]
        snippet = boxed_text_of.get(appl_no, "")
        nme_boxed.append({
            "application_number": f"{appl_type.get(appl_no, '')}{appl_no}",
            "drug_name": first_drug.get(appl_no, "") or app_brand.get(appl_no, ""),
            "sponsor": sponsor.get(appl_no) or "",
            "ap_date": ap_date,
            "themes": zh_hits,
            "snippet": snippet[:220],
        })
    nme_boxed.sort(key=lambda x: x["ap_date"] or "", reverse=True)
    print(f"带黑框 NME: {len(nme_boxed)}")

    safety = {
        "coverage": {
            "label_docs": label_docs,
            "deep_texts": deep_texts,
            "boxed_texts": boxed_texts,
            "labeled_apps": labeled_apps,
            "boxed_apps": boxed_apps,
            "boxed_rate": round(boxed_apps / labeled_apps * 100, 1),
        },
        "era_rates": era_rates,
        "themes": themes_out,
        "nme_boxed": nme_boxed,
    }
    with open(os.path.join(OUT_DIR, "safety_boxed.json"), "w", encoding="utf-8") as f:
        json.dump(safety, f, ensure_ascii=False, separators=(",", ":"))

    # ============ 2. withdrawn.json ============
    print("===== 2. 撤市全景 =====")
    last_action = {}
    for appl_no, sd in drugs.execute(
        "SELECT appl_no, MAX(status_date) FROM submissions GROUP BY appl_no"
    ):
        last_action[appl_no] = sd or ""
    w_rows = list(drugs.execute(
        """SELECT p.appl_no, p.drug_name, p.active_ingredient, p.form
           FROM products p WHERE p.marketing_status_id = 3"""
    ))
    by_decade = defaultdict(int)
    ing_cnt = defaultdict(int)
    form_cnt = defaultdict(int)
    recent = []
    for appl_no, dname, ing, form in w_rows:
        d = appl_date.get(appl_no)
        if d:
            by_decade[f"{int(d[:4]) // 10 * 10}s"] += 1
        ing_cnt[(ing or "").strip().upper()] += 1
        form_cnt[(form or "未知").strip()] += 1
        recent.append({
            "application_number": f"{appl_type.get(appl_no, '')}{appl_no}",
            "drug_name": dname or "",
            "ingredient": (ing or "").strip().upper(),
            "approval_date": d or "",
            "last_action": last_action.get(appl_no, ""),
        })
    recent.sort(key=lambda x: x["last_action"], reverse=True)

    anchors = []
    for name, ing in (("VIOXX", "ROFECOXIB"), ("BAYCOL（西立伐他汀）", "CERIVASTATIN"), ("SELDANE（特非那定）", "TERFENADINE")):
        rows = [r for r in recent if r["ingredient"].startswith(ing)]
        anchors.append({
            "name": name,
            "found": bool(rows),
            "approval_date": rows[0]["approval_date"] if rows else None,
            "last_action": rows[0]["last_action"] if rows else None,
        })
    print("锚点:", anchors)

    withdrawn = {
        "total": len(w_rows),
        "by_decade": [{"decade": k, "n": by_decade[k]} for k in sorted(by_decade)],
        "top_ingredients": [
            {"ingredient": k, "n": v}
            for k, v in sorted(ing_cnt.items(), key=lambda kv: -kv[1]) if k
        ][:20],
        "top_forms": [
            {"form": k, "n": v}
            for k, v in sorted(form_cnt.items(), key=lambda kv: -kv[1])
        ][:12],
        "anchors": anchors,
        "recent": recent[:30],
    }
    with open(os.path.join(OUT_DIR, "withdrawn.json"), "w", encoding="utf-8") as f:
        json.dump(withdrawn, f, ensure_ascii=False, separators=(",", ":"))
    print(f"撤市 {len(w_rows)} | Top 成分: {withdrawn['top_ingredients'][:3]}")

    # ============ 3. generic_lag.json ============
    print("===== 3. 首仿时滞 =====")
    ing_first = {}  # ing -> {"nda": date, "bla": date, "anda": date}
    for atype, ing, adate in drugs.execute(
        """SELECT a.appl_type, p.active_ingredient, MIN(a.approval_date)
           FROM applications a JOIN products p ON p.appl_no = a.appl_no
           WHERE a.approval_date IS NOT NULL AND p.active_ingredient IS NOT NULL
           GROUP BY a.appl_type, p.active_ingredient"""
    ):
        key = re.sub(r"\s+", " ", ing.strip().upper())
        if ";" in key:
            continue  # 仅单成分
        rec = ing_first.setdefault(key, {})
        if atype in ("NDA", "BLA", "ANDA"):
            cur = rec.get(atype.lower())
            if cur is None or adate < cur:
                rec[atype.lower()] = adate

    lags = []
    matched = {}  # ing -> (origin_date, anda_date)
    for ing, rec in ing_first.items():
        origin = min((d for d in (rec.get("nda"), rec.get("bla")) if d), default=None)
        anda = rec.get("anda")
        if not origin or not anda:
            continue
        lag = round((int(anda[:4]) * 12 + int(anda[5:7]) - int(origin[:4]) * 12 - int(origin[5:7])) / 12, 1)
        if lag < 0:
            continue
        lags.append(lag)
        matched[ing] = (origin, anda)
    lags.sort()
    median_lag = lags[len(lags) // 2]
    hist = defaultdict(int)
    for l in lags:
        b = min(int(l), 20)
        hist[b] += 1
    lag_hist = [{"bucket": f"{b}" if b < 20 else "20+", "n": hist[b]} for b in sorted(hist)]
    print(f"匹配成分 {len(lags)} | 中位时滞 {median_lag} 年")
    for ing in ("ATORVASTATIN CALCIUM", "OMEPRAZOLE"):
        o, a = matched.get(ing, (None, None))
        if o:
            lag = round((int(a[:4]) * 12 + int(a[5:7]) - int(o[:4]) * 12 - int(o[5:7])) / 12, 1)
            print(f"锚点 {ing}: {o[:4]} → {a[:4]} = {lag} 年")

    # 无仿制药老药：首批 ≥10 年前、有在售产品、无任何 ANDA
    active_by_ing = defaultdict(int)
    example_by_ing = {}
    for appl_no, ing, ms, dname in drugs.execute(
        "SELECT appl_no, active_ingredient, marketing_status_id, drug_name FROM products"
    ):
        key = re.sub(r"\s+", " ", (ing or "").strip().upper())
        if not key or ";" in key:
            continue
        if ms in (1, 2):
            active_by_ing[key] += 1
            example_by_ing.setdefault(key, (dname or "", appl_no))
    no_generic = []
    for ing, rec in ing_first.items():
        origin = min((d for d in (rec.get("nda"), rec.get("bla")) if d), default=None)
        if not origin or rec.get("anda"):
            continue
        yr = int(origin[:4])
        if yr > 2016:  # 获批 ≥10 年（快照 2026）
            continue
        act = active_by_ing.get(ing, 0)
        if act == 0:
            continue
        dname, appl_no = example_by_ing.get(ing, ("", ""))
        no_generic.append({
            "ingredient": ing,
            "first_year": yr,
            "active_products": act,
            "example_drug": dname,
            "application_number": f"{appl_type.get(appl_no, '')}{appl_no}",
        })
    no_generic.sort(key=lambda x: -x["active_products"])
    print(f"无仿制药老药（≥10年在售无 ANDA）: {len(no_generic)}，Top3: {[x['ingredient'] for x in no_generic[:3]]}")

    # 竞争最激烈成分（ANDA 持证数）
    anda_holders = defaultdict(set)
    anda_apps = defaultdict(set)
    for appl_no, ing in drugs.execute(
        """SELECT a.appl_no, p.active_ingredient FROM applications a
           JOIN products p ON p.appl_no = a.appl_no WHERE a.appl_type = 'ANDA'"""
    ):
        key = re.sub(r"\s+", " ", (ing or "").strip().upper())
        if not key or ";" in key:
            continue
        anda_apps[key].add(appl_no)
        anda_holders[key].add(normalize(sponsor.get(appl_no) or ""))
    top_comp = sorted(anda_apps.items(), key=lambda kv: (-len(kv[1])))[:15]
    top_competition = [
        {"ingredient": ing, "holders": len(anda_holders[ing]), "anda_apps": len(apps)}
        for ing, apps in top_comp
    ]

    generic_lag = {
        "n_matched": len(lags),
        "median_lag": median_lag,
        "lag_hist": lag_hist,
        "no_generic_old": no_generic[:20],
        "top_competition": top_competition,
        "anchors": {
            "atorvastatin_calcium": matched.get("ATORVASTATIN CALCIUM"),
            "omeprazole": matched.get("OMEPRAZOLE"),
        },
    }
    with open(os.path.join(OUT_DIR, "generic_lag.json"), "w", encoding="utf-8") as f:
        json.dump(generic_lag, f, ensure_ascii=False, separators=(",", ":"))

    # ============ 4. biologics.json ============
    print("===== 4. 生物制剂崛起 =====")
    yearly = defaultdict(lambda: {"nda": 0, "bla": 0, "bla_nme": 0})
    for appl_no, adate in drugs.execute(
        "SELECT appl_no, approval_date FROM applications WHERE approval_date IS NOT NULL"
    ):
        t = appl_type.get(appl_no, "")
        yr = adate[:4]
        if int(yr) < 1985:
            continue
        if t == "BLA":
            yearly[yr]["bla"] += 1
            if appl_no in nme_date:
                yearly[yr]["bla_nme"] += 1
        elif t == "NDA":
            yearly[yr]["nda"] += 1
    bio_yearly = [
        {
            "yr": yr,
            "bla": v["bla"],
            "nda": v["nda"],
            "share": round(v["bla"] / (v["bla"] + v["nda"]) * 100, 1) if v["bla"] + v["nda"] else 0,
            "bla_nme": v["bla_nme"],
        }
        for yr, v in sorted(yearly.items())
    ]
    bla_sponsors = defaultdict(int)
    for appl_no in drugs.execute("SELECT appl_no FROM applications WHERE appl_type = 'BLA'"):
        bla_sponsors[normalize(sponsor.get(appl_no[0]) or "")] += 1
    top_sponsors = sorted(bla_sponsors.items(), key=lambda kv: -kv[1])[:15]
    biologics = {
        "yearly": bio_yearly,
        "top_sponsors": [
            {"name": n, "name_zh": alias_for(n), "n": c} for n, c in top_sponsors
        ],
        "latest_share": bio_yearly[-1]["share"] if bio_yearly else 0,
    }
    with open(os.path.join(OUT_DIR, "biologics.json"), "w", encoding="utf-8") as f:
        json.dump(biologics, f, ensure_ascii=False, separators=(",", ":"))
    print(f"最新年份份额: {biologics['latest_share']}% | Top 持证: {biologics['top_sponsors'][:3]}")

    for fn in ("safety_boxed.json", "withdrawn.json", "generic_lag.json", "biologics.json"):
        print(f"  {fn}: {os.path.getsize(os.path.join(OUT_DIR, fn))/1024:.1f} KB")
    print(f"总耗时: {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
