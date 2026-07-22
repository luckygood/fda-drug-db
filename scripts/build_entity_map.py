#!/usr/bin/env python3
"""Build public/data/entity_map.json — 成分↔企业↔疾病↔临床试验实体关系层.

Inputs (all local):
  - public/data/lifecycle_index.json   成分全集（3,324）
  - public/data/products.json          sponsor 关系（原研 + ANDA 申请者）
  - public/data/diseases/*.json        疾病→药品（active_ingredient）
  - public/data/companies/*.json       企业 slug + name variants
  - /tmp/fda-ct/data/ct/*.json         gh-pages 临床试验数据（trial.api 匹配成分）
    （若目录不存在，先执行: git archive origin/gh-pages data/ct | tar -x -C /tmp/fda-ct）

Caps: trials/ingredient ≤20（按启动日期倒序）、diseases/ingredient ≤20、
companies/ingredient ≤30、ingredients/disease ≤50、ingredients/company ≤50。
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"
CT_DIR = Path("/tmp/fda-ct/data/ct")

MAX_TRIALS = 20
MAX_DISEASES = 20
MAX_COMPANIES = 30
MAX_ING_PER_DISEASE = 50
MAX_ING_PER_COMPANY = 50


def load(name):
    with open(DATA / name) as f:
        return json.load(f)


def norm_company(name):
    return re.sub(r"\s+", " ", (name or "").strip().upper())


def main():
    lifecycle = load("lifecycle_index.json")
    ingredients_all = set(lifecycle["records"].keys())

    # ---------- 企业 variant -> slug ----------
    # sponsor_map.json 是现成的 sponsor 写法→slug 映射；企业分片 variants 作补充
    variant_to_slug = {}
    company_name = {}
    sponsor_map = json.load(open(DATA / "companies" / "sponsor_map.json"))
    for name, slug in sponsor_map.items():
        variant_to_slug.setdefault(norm_company(name), slug)
    for f in sorted((DATA / "companies").glob("*.json")):
        if f.name in ("index.json", "sponsor_map.json"):
            continue
        for c in json.load(open(f))["companies"]:
            company_name[c["slug"]] = c["name"]
            for v in c.get("variants", []):
                variant_to_slug.setdefault(norm_company(v), c["slug"])

    # ---------- 成分 -> 企业（原研 + ANDA 申请者） ----------
    products = load("products.json")
    fields = products["fields"]
    idx = {n: i for i, n in enumerate(fields)}
    ing_sponsors = defaultdict(set)   # ingredient -> company slug
    company_ings = defaultdict(set)   # slug -> ingredient
    unmatched_sponsors = set()
    for row in products["rows"]:
        ing = (row[idx["active_ingredient"]] or "").strip().upper()
        if ing not in ingredients_all:
            continue
        slug = variant_to_slug.get(norm_company(row[idx["sponsor_name"]]))
        if not slug:
            unmatched_sponsors.add(row[idx["sponsor_name"]] or "")
            continue
        ing_sponsors[ing].add(slug)
        company_ings[slug].add(ing)

    # ---------- 成分 <-> 疾病 ----------
    ing_diseases = defaultdict(set)
    disease_ings = defaultdict(set)
    disease_files = [f for f in (DATA / "diseases").glob("*.json")]
    disease_slugs = set()
    for f in disease_files:
        d = json.load(open(f))
        slug = d.get("slug") or f.stem
        disease_slugs.add(slug)
        for drug in d.get("drugs", []):
            ing = (drug.get("active_ingredient") or "").strip().upper()
            if ing and ing in ingredients_all:
                ing_diseases[ing].add(slug)
                disease_ings[slug].add(ing)

    # ---------- 成分 -> 临床试验 ----------
    ing_trials = defaultdict(list)  # ing -> [(start, nct_id)]
    ct_trial_count_by_slug = {}
    if CT_DIR.exists():
        for f in CT_DIR.glob("*.json"):
            d = json.load(open(f))
            ct_trial_count_by_slug[f.stem] = d.get("count", len(d.get("trials", [])))
            for t in d.get("trials", []):
                api = (t.get("api") or "").strip().upper()
                if api and api in ingredients_all:
                    ing_trials[api].append((t.get("start") or "", t["nct_id"]))
    else:
        print(f"!! 未找到 {CT_DIR}，trials 映射为空", file=sys.stderr)

    # 疾病 slug 与 ct 文件名的匹配（直接同名优先，其次下划线/连字符归一）
    def ct_count_for_disease(slug):
        if slug in ct_trial_count_by_slug:
            return ct_trial_count_by_slug[slug]
        norm = slug.replace("_", "-").lower()
        return ct_trial_count_by_slug.get(norm, 0)

    # ---------- 组装输出 ----------
    ingredients_out = {}
    for ing in sorted(ingredients_all):
        trials = sorted(ing_trials.get(ing, []), key=lambda x: x[0], reverse=True)
        ncts = []
        seen = set()
        for _, nct in trials:
            if nct not in seen:
                seen.add(nct)
                ncts.append(nct)
            if len(ncts) >= MAX_TRIALS:
                break
        entry = {}
        if ing_diseases.get(ing):
            entry["diseases"] = sorted(ing_diseases[ing])[:MAX_DISEASES]
        if ing_sponsors.get(ing):
            entry["companies"] = sorted(ing_sponsors[ing])[:MAX_COMPANIES]
        if ncts:
            entry["trials"] = ncts
        ingredients_out[ing] = entry

    diseases_out = {}
    for slug in sorted(disease_slugs):
        diseases_out[slug] = {
            "ingredients": sorted(disease_ings.get(slug, set()))[:MAX_ING_PER_DISEASE],
            "trial_count": ct_count_for_disease(slug),
        }

    companies_out = {}
    for slug, ings in sorted(company_ings.items()):
        companies_out[slug] = {
            "name": company_name.get(slug, slug),
            "ingredients": sorted(ings)[:MAX_ING_PER_COMPANY],
        }

    out = {
        "generated_at": lifecycle["generated_at"],
        "ingredients": ingredients_out,
        "diseases": diseases_out,
        "companies": companies_out,
    }
    out_path = DATA / "entity_map.json"
    with open(out_path, "w") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    # ---------- 统计 ----------
    n_dis = sum(1 for e in ingredients_out.values() if e.get("diseases"))
    n_tri = sum(1 for e in ingredients_out.values() if e.get("trials"))
    n_com = sum(1 for e in ingredients_out.values() if e.get("companies"))
    print(f"成分总数: {len(ingredients_out)}")
    print(f"  ≥1 疾病映射: {n_dis} ({n_dis/len(ingredients_out)*100:.1f}%)")
    print(f"  ≥1 临床试验: {n_tri} ({n_tri/len(ingredients_out)*100:.1f}%)")
    print(f"  ≥1 企业映射: {n_com} ({n_com/len(ingredients_out)*100:.1f}%)")
    print(f"疾病条目: {len(diseases_out)}  企业条目: {len(companies_out)}")
    print(f"未匹配 sponsor 写法: {len(unmatched_sponsors)} 种")
    print(f"输出: {out_path} ({out_path.stat().st_size/1024:.0f} KB)")

    # ---------- 抽查：引入期成分的疾病映射 ----------
    intro = [k for k, v in lifecycle["records"].items() if v["stage"] == "引入期"]
    print("\n引入期抽查（前 5 个有疾病映射的成分）:")
    shown = 0
    for ing in intro:
        e = ingredients_out[ing]
        if e.get("diseases"):
            print(f"  {ing}: diseases={e['diseases']}, trials={len(e.get('trials', []))}, companies={e.get('companies', [])[:3]}")
            shown += 1
            if shown >= 5:
                break


if __name__ == "__main__":
    main()
