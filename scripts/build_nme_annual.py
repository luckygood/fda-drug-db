#!/usr/bin/env python3
"""Build public/data/nme_annual.json — 报告 C：年度新分子实体（NME）全景数据.

双口径设计（P0 可信度修复 Fix 1）：
  - 官方口径（主展示）：FDA CDER 官方 Novel Drug Approvals 名单
    （scripts/official_nme_seed.json，转录自 FDA 各年度 Novel Drug Approvals 页面，
    计数 = 2020:53 / 2021:50 / 2022:37 / 2023:55 / 2024:50 / 2025:46；2026 年官方名单未发布）。
    注：官方名单为 CDER 口径，不含 CBER（疫苗/血液/细胞基因疗法）。
  - 平台补充推断（辅展示）：本地 products.json 推导——首次 FDA 原始 NDA/BLA 获批
    ≥ 2020-01-01 的活性成分；不同盐型/水合物/生物制品四字母后缀归并为同一实体；不含 ANDA。
    推导集合 ∩ 官方名单 → source="official"；仅在推导集合中的 → source="derived"（补充推断）。
  匹配方式：先按归一化成分键，再按商品名（products.json drug_name ↔ 官方名单 Drug Name）。

分子类型分类（规则法，按以下优先级命中即停）：
  1. 核酸类      词干以 -SIRAN（siRNA）或 -RSEN（ASO）结尾
  2. ADC         含已知载荷/连接子词干：VEDOTIN/DERUXTECAN/GOVITECAN/EMTANSINE/TESIRINE/MAFODOTIN/MMAE
  3. 细胞/基因疗法 以 -CEL 结尾，或含 GENE / ONASEMNOGENE 词干
  4. 疫苗        含 VACCINE
  5. 单抗        以 -MAB 结尾
  6. 融合蛋白     以 -CEPT 结尾
  7. 多肽        以 -TIDE 结尾
  8. 酶          以 -ASE 结尾（仅 BLA）
  9. 兜底        申请类型 BLA → 其他生物药；NDA → 小分子

用法：python3 scripts/build_nme_annual.py
"""

import json
import re
from collections import Counter
from datetime import date
from pathlib import Path
from statistics import median

from build_common import write_dataset

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"
SCRIPTS = REPO / "scripts"
CUTOFF = "2020-01-01"
TODAY = date.today()

ADC_TOKENS = ("VEDOTIN", "DERUXTECAN", "GOVITECAN", "EMTANSINE", "TESIRINE", "MAFODOTIN", "MMAE")
CELL_GENE_TOKENS = ("ONASEMNOGENE", "GENE")

# 盐基/水合物词（同 build_global_access 口径，用于把不同盐型归并成同一分子实体）
SALT_TOKENS = {
    "HYDROCHLORIDE", "DIHYDROCHLORIDE", "HYDROBROMIDE", "MESILATE", "MESYLATE",
    "SODIUM", "POTASSIUM", "CALCIUM", "MAGNESIUM", "SULFATE", "SULPHATE",
    "TARTRATE", "BITARTRATE", "PHOSPHATE", "DIPHOSPHATE", "ACETATE", "MALEATE",
    "SUCCINATE", "BESILATE", "BESYLATE", "TOSILATE", "TOSYLATE", "CITRATE",
    "NITRATE", "OXALATE", "LACTATE", "FUMARATE", "PAMOATE", "PALMITATE",
    "HEMIHYDRATE", "MONOHYDRATE", "DIHYDRATE", "TRIHYDRATE", "HYDRATE",
    "ANHYDROUS", "MICRONIZED", "FREE", "BASE", "ACID", "CHOLINE", "ADIPATE",
}


def norm_entity(name: str) -> str:
    """归一化实体键：去括号修饰，按 ;/,/and// 拆复方，逐段去盐基+四字母后缀，排序重组。"""
    name = re.sub(r"\([^)]*\)", " ", name.upper())
    name = re.sub(r"\s+(?:AND|,)\s+", "; ", name)
    parts = re.split(r"[;/]", name)
    cleaned = []
    for p in parts:
        toks = [t for t in p.split() if t.strip(",.") not in SALT_TOKENS]
        seg = " ".join(toks).strip()
        # 美版生物制品四字母后缀（LECANEMAB-IRMB → LECANEMAB）
        seg = re.sub(r"-[A-Z]{4}$", "", seg)
        cleaned.append(seg)
    return "; ".join(sorted(p for p in cleaned if p))


def stem(name: str) -> str:
    base = norm_entity(name)
    toks = base.replace(";", " ").split()
    return toks[-1] if toks else name


def classify(name: str, appl_type: str) -> str:
    s = stem(name)
    if s.endswith("SIRAN") or s.endswith("RSEN"):
        return "核酸类"
    if any(t in s for t in ADC_TOKENS):
        return "抗体偶联药物（ADC）"
    if s.endswith("CEL") or any(t in name.upper() for t in CELL_GENE_TOKENS):
        return "细胞/基因疗法"
    if "VACCINE" in name.upper():
        return "疫苗"
    if s.endswith("MAB"):
        return "单克隆抗体"
    if s.endswith("CEPT"):
        return "融合蛋白"
    if s.endswith("TIDE"):
        return "多肽"
    if s.endswith("ASE") and appl_type == "BLA":
        return "酶"
    return "其他生物药" if appl_type == "BLA" else "小分子"


def months_between(d1: str, d2: str) -> int:
    return (int(d2[:4]) - int(d1[:4])) * 12 + (int(d2[5:7]) - int(d1[5:7]))


def load(name):
    with open(DATA / name) as f:
        return json.load(f)


def main():
    products = load("products.json")
    entity_map = load("entity_map.json")
    global_access = load("global_access.json")
    disease_index = load("diseases/index.json")
    seed = json.load(open(SCRIPTS / "official_nme_seed.json"))

    idx = {n: i for i, n in enumerate(products["fields"])}

    # ---------- 推导集合：按归一化实体键分组，首次 NDA/BLA 获批 >= 2020 ----------
    first = {}  # norm_key -> {date, appl_type, sponsor, raw, trade, variants}
    for row in products["rows"]:
        if row[idx["appl_type"]] not in ("NDA", "BLA"):
            continue
        d = row[idx["approval_date"]] or ""
        raw = (row[idx["active_ingredient"]] or "").strip().upper()
        if not raw or not d:
            continue
        key = norm_entity(raw)
        if not key:
            continue
        trade = (row[idx["drug_name"]] or "").strip()
        cur = first.get(key)
        if cur is None:
            first[key] = {"date": d, "appl_type": row[idx["appl_type"]],
                          "sponsor": row[idx["sponsor_name"]] or "",
                          "raw": raw, "trade": trade, "variants": {raw}}
        else:
            cur["variants"].add(raw)
            if d < cur["date"]:
                cur.update({"date": d, "appl_type": row[idx["appl_type"]],
                            "sponsor": row[idx["sponsor_name"]] or ""})
            if d >= CUTOFF and d < cur.get("raw_date", "9999"):
                cur["raw"], cur["raw_date"], cur["trade"] = raw, d, trade

    nmes = {k: v for k, v in first.items() if v["date"] >= CUTOFF}
    print(f"推导集合（2020+ 首次 NDA/BLA，归并后）: {len(nmes)}")

    # ---------- 官方名单索引 ----------
    official_by_key, official_by_trade = {}, {}
    for year, entries in seed["years"].items():
        for e in entries:
            rec = {"year": year, "name": e["name"], "date": e["date"]}
            if e["ing"]:
                official_by_key.setdefault(norm_entity(e["ing"]), rec)
            official_by_trade.setdefault(re.sub(r"\s+", " ", e["name"].strip().upper()), rec)

    # ---------- 匹配：推导集合 → 官方名单 ----------
    n_official, matched_official_ids = 0, set()
    for key, v in nmes.items():
        hit = official_by_key.get(key)
        if not hit:
            for cand in {re.sub(r"\s+", " ", v["trade"].upper()),
                         re.sub(r"\s+", " ", v["trade"].upper()).split("(")[0].strip()}:
                if cand and cand in official_by_trade:
                    hit = official_by_trade[cand]
                    break
        if hit:
            v["source"] = "official"
            v["official_name"] = hit["name"]
            matched_official_ids.add((hit["year"], hit["name"]))
            n_official += 1
        else:
            v["source"] = "derived"
    print(f"推导集合中命中官方名单: {n_official}；补充推断: {len(nmes) - n_official}")

    # 官方名单中未命中推导集合的条目（应为极少数；2020 年仅商品名匹配可能漏）
    for year, entries in seed["years"].items():
        missing = [e["name"] for e in entries if (year, e["name"]) not in matched_official_ids]
        if missing:
            print(f"  !! {year} 官方名单未匹配到推导记录 {len(missing)} 个: {missing[:8]}")

    # 疾病 slug -> 名称 / 领域
    slug_name, slug_area = {}, {}
    for d in disease_index["diseases"]:
        slug_name[d["slug"]] = d["name_zh"]
        slug_area[d["slug"]] = d["area"]

    ga_records = global_access["records"]

    # ---------- 按年聚合 ----------
    years = {}
    for year in range(2020, TODAY.year + 1):
        ys = str(year)
        cohort = sorted(
            [(k, v) for k, v in nmes.items() if v["date"][:4] == ys],
            key=lambda x: x[1]["date"],
        )
        if not cohort and year < TODAY.year:
            continue
        monthly = [0] * 12
        type_dist = Counter()
        area_count = Counter()
        company_count = Counter()
        ingredients = []
        ema_lags, pmda_lags = [], []
        n_ema, n_pmda = 0, 0

        def lookup(mapping, variants):
            for raw in sorted(variants):
                if raw in mapping:
                    return mapping[raw]
            return None

        for key, v in cohort:
            d, appl_type, sponsor = v["date"], v["appl_type"], v["sponsor"]
            variants = v["variants"]
            t = classify(key, appl_type)
            type_dist[t] += 1
            monthly[int(d[5:7]) - 1] += 1
            company = sponsor.strip() or "未知"
            company_count[company] += 1

            ent = lookup(entity_map["ingredients"], variants) or {}
            d_slugs = ent.get("diseases") or []
            d_names = [slug_name.get(s, s) for s in d_slugs]
            for a in {slug_area.get(s) for s in d_slugs if s in slug_area}:
                area_count[a] += 1

            rec = lookup(ga_records, variants)
            if rec:
                if rec.get("ema_status") == "authorised":
                    n_ema += 1
                    if rec.get("ema_first_date"):
                        ema_lags.append(months_between(d, rec["ema_first_date"]))
                if rec.get("pmda_status") == "approved":
                    n_pmda += 1
                    if rec.get("pmda_first_date"):
                        pmda_lags.append(months_between(d, rec["pmda_first_date"]))

            ingredients.append({
                "ing": key,
                "date": d,
                "company": company,
                "type": t,
                "diseases": d_names[:6],
                "source": v["source"],
                **({"official_name": v["official_name"]} if v["source"] == "official" else {}),
            })

        # 官方名单中未命中推导记录的条目：补 stub（保证清单完整覆盖官方名单）
        for e in seed["years"].get(ys, []):
            if (ys, e["name"]) in matched_official_ids:
                continue
            ingredients.append({
                "ing": (e["ing"] or e["name"]).upper(),
                "date": e["date"] or "",
                "company": "—",
                "type": classify(e["ing"], "NDA") if e["ing"] else "—",
                "diseases": [],
                "source": "official",
                "official_name": e["name"],
                "stub": True,
            })
        ingredients.sort(key=lambda x: (x["date"] == "", x["date"]))

        total = len(cohort)
        n_off = sum(1 for _, v in cohort if v["source"] == "official")
        official_count = len(seed["years"].get(ys, [])) or None
        n_ga = sum(1 for _, v in cohort if lookup(ga_records, v["variants"]))
        years[ys] = {
            "total": total,
            "official_count": official_count,
            "official_matched": n_off,
            "derived_extra": total - n_off,
            "type_dist": dict(type_dist.most_common()),
            "monthly": monthly,
            "top_areas": area_count.most_common(8),
            "top_companies": company_count.most_common(5),
            "global": {
                "ema_pct": round(n_ema / total * 100, 1) if total else None,
                "pmda_pct": round(n_pmda / total * 100, 1) if total else None,
                "ema_median_lag": int(median(ema_lags)) if ema_lags else None,
                "pmda_median_lag": int(median(pmda_lags)) if pmda_lags else None,
                "ema_n": len(ema_lags),
                "pmda_n": len(pmda_lags),
                "n_with_data": n_ga,
            },
            "ingredients": ingredients,
        }

    out = {
        "scope": "官方口径 = FDA CDER Novel Drug Approvals 名单（CDER，不含 CBER）；补充推断 = 平台按首次 FDA NDA/BLA ≥ 2020-01-01 推导（盐型/后缀归并，不含 ANDA）",
        "official_source_url": seed["sources"]["compilation"],
        "official_retrieved_at": seed["retrieved_at"],
        "years": years,
    }
    out_path = write_dataset("nme_annual", out, TODAY)
    print(f"写出 {out_path}（{len(years)} 个年度）")
    for ys, yv in years.items():
        print(f"  {ys}: 官方 {yv['official_count']} / 命中 {yv['official_matched']} / 补充推断 {yv['derived_extra']} / 推导合计 {yv['total']}")


if __name__ == "__main__":
    main()
