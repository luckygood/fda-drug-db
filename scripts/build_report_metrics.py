#!/usr/bin/env python3
"""Build public/data/report_metrics.json — 报告衍生指标层（P1 Part 2）.

输入（全部本地）：entity_map / lifecycle_index / products / ingredient_pubmed /
global_access / disease_pubmed。

输出结构：
{
  diseases: {slug: {
    ingredients_total, crowded_pct(0-1 百分位), crowded_bucket(前25%/中位/后25%),
    hhi, hhi_bucket(分散/中等/集中), top_company, top_company_share
  }},
  ingredients: {ing: {
    erosion: {stage, first_anda, n_anda_companies},
    exclusivity_pct: 0-1 | None（同首获批年队列内 months_to_expiry 百分位，仅专利数据存在时）,
    evidence: {clinical_count, years_on_market, per_year, bucket(高/中/低)} | None,
    global_score: 0-1 | None（0.4*FDA + 0.35*EMA + 0.25*PMDA，仅 2020+ 范围）
  }}
}

用法：python3 scripts/build_report_metrics.py
"""

import json
from datetime import date
from collections import Counter
from pathlib import Path

from build_common import write_dataset

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"


def load(name):
    with open(DATA / name) as f:
        return json.load(f)


def pct_rank(values, v):
    """v 在 values 中的百分位（0-1，越大越靠前）。"""
    if not values:
        return None
    below = sum(1 for x in values if x < v)
    return round(below / len(values), 3)


def main():
    entity_map = load("entity_map.json")
    lifecycle = load("lifecycle_index.json")
    products = load("products.json")
    try:
        ing_pubmed = load("ingredient_pubmed.json")["ingredients"]
    except FileNotFoundError:
        ing_pubmed = {}
    global_access = load("global_access.json")["records"]
    try:
        disease_pubmed = load("disease_pubmed.json")["diseases"]
    except FileNotFoundError:
        disease_pubmed = {}

    # ---------- 成分：首个 ANDA 日期 ----------
    idx = {n: i for i, n in enumerate(products["fields"])}
    first_anda = {}
    for row in products["rows"]:
        if row[idx["appl_type"]] != "ANDA":
            continue
        d = row[idx["approval_date"]] or ""
        ing = (row[idx["active_ingredient"]] or "").strip().upper()
        if not ing or not d:
            continue
        if ing not in first_anda or d < first_anda[ing]:
            first_anda[ing] = d

    # ---------- 疾病指标 ----------
    dis = entity_map["diseases"]
    totals = [v.get("ingredients_total", len(v["ingredients"])) for v in dis.values()]
    # 第一遍：计算原始 HHI（企业-成分链接份额平方和，Σshare=1，HHI∈[0,1]）
    raw = {}
    for slug, v in sorted(dis.items()):
        ings = v["ingredients"]
        total = v.get("ingredients_total", len(ings))
        comp_counter = Counter()
        for ing in ings:
            for c in entity_map["ingredients"].get(ing, {}).get("companies") or []:
                comp_counter[c] += 1
        links_total = sum(comp_counter.values()) or 1
        hhi = round(sum((c / links_total) ** 2 for c in comp_counter.values()), 3)
        top_company, top_n = (comp_counter.most_common(1)[0] if comp_counter else (None, 0))
        raw[slug] = (total, hhi, top_company, round(top_n / links_total, 3) if comp_counter else None)

    hhi_values = [x[1] for x in raw.values()]
    diseases_out = {}
    for slug, (total, hhi, top_company, top_share) in raw.items():
        pct = pct_rank(totals, total)
        hhi_pct = pct_rank(hhi_values, hhi)
        diseases_out[slug] = {
            "ingredients_total": total,
            "crowded_pct": pct,
            "crowded_bucket": "前25%" if pct is not None and pct >= 0.75 else ("后25%" if pct is not None and pct <= 0.25 else "中位"),
            "hhi": hhi,
            "hhi_pct": hhi_pct,
            "hhi_bucket": ("集中" if hhi_pct is not None and hhi_pct >= 0.75
                          else ("分散" if hhi_pct is not None and hhi_pct <= 0.25 else "中等")),
            "top_company": top_company,
            "top_company_share": top_share,
            "pubmed_covered": slug in disease_pubmed,
        }

    # ---------- 成分指标 ----------
    records = lifecycle["records"]
    # 同首获批年队列的 months_to_expiry 分布（仅专利数据存在）
    cohorts = {}
    for ing, r in records.items():
        if r.get("first_approval") and r.get("months_to_expiry") is not None:
            cohorts.setdefault(r["first_approval"][:4], []).append(r["months_to_expiry"])

    ingredients_out = {}
    n_evidence, n_global = 0, 0
    for ing, r in sorted(records.items()):
        entry = {}
        n_comp = r.get("n_anda_companies") or 0
        if n_comp == 0:
            stage = "无仿制"
        elif n_comp <= 2:
            stage = "早期仿制（1-2 家）"
        elif n_comp <= 7:
            stage = "多家竞争"
        else:
            stage = "充分竞争"
        entry["erosion"] = {
            "stage": stage,
            "first_anda": first_anda.get(ing),
            "n_anda_companies": n_comp,
        }
        if r.get("first_approval") and r.get("months_to_expiry") is not None:
            entry["exclusivity_pct"] = pct_rank(
                cohorts.get(r["first_approval"][:4], []), r["months_to_expiry"])

        pm = ing_pubmed.get(ing)
        if pm and pm.get("clinical_count") is not None and r.get("first_approval"):
            years_on = max(1, date.today().year - int(r["first_approval"][:4]))
            per_year = round(pm["clinical_count"] / years_on, 1)
            entry["evidence"] = {
                "clinical_count": pm["clinical_count"],
                "years_on_market": years_on,
                "per_year": per_year,
                "bucket": "高" if per_year >= 50 else ("中" if per_year >= 10 else "低"),
            }
            n_evidence += 1

        ga = global_access.get(ing)
        if ga:
            score = 0.4  # FDA 已获批（范围内前提）
            if ga.get("ema_status") == "authorised":
                score += 0.35
            if ga.get("pmda_status") == "approved":
                score += 0.25
            entry["global_score"] = round(score, 2)
            n_global += 1

        ingredients_out[ing] = entry

    payload = {
        "notes": "crowded_pct/HHI 基于 entity_map（HHI 用展示截断列表近似）；"
                 "evidence 仅覆盖 ingredient_pubmed 已抓取的引入期成分；"
                 "global_score 仅 2020+ NDA/BLA 范围",
        "diseases": diseases_out,
        "ingredients": ingredients_out,
    }
    out_path = write_dataset("report_metrics", payload)
    print(f"疾病指标: {len(diseases_out)}；成分指标: {len(ingredients_out)}"
          f"（evidence {n_evidence} / global_score {n_global}）-> {out_path}")


if __name__ == "__main__":
    main()
