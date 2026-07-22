#!/usr/bin/env python3
"""Build public/data/nme_annual.json — 报告 C：年度新分子实体（NME）全景数据.

NME 口径：活性成分的首次 FDA 原始 NDA/BLA 获批（fda_ever）落在 2020-01-01 至今；
排除美版生物类似药四字母后缀名（-XXXX，如 ADALIMUMAB-AACF）；不含 ANDA。

分子类型分类（规则法，按以下优先级命中即停）：
  1. 核酸类      名称含 -SIRAN（siRNA）或 -RSEN（ASO）结尾
  2. ADC         名称含已知载荷/连接子词干：VEDOTIN / DERUXTECAN / GOVITECAN /
                 EMTANSINE / TESIRINE / PBD / MMAE（抗体偶联药物）
  3. 细胞/基因疗法 名称以 -CEL 结尾，或含 GENE / ONASEMNOGENE 词干
  4. 疫苗        名称含 VACCINE
  5. 单抗        名称以 -MAB 系列结尾（MAB/UMAB/XIMB/ZUMAB/…统一按 MAB 判定）
  6. 融合蛋白     名称以 -CEPT 结尾
  7. 多肽        名称以 -TIDE 结尾
  8. 酶          名称以 -ASE 结尾
  9. 兜底        申请类型 BLA → 其他生物药；NDA → 小分子
（多肽/融合蛋白/酶规则仅对 BLA 生效；NDA 命中 -TIDE 也归为多肽。）

用法：python3 scripts/build_nme_annual.py
"""

import json
import re
from collections import Counter
from datetime import date
from pathlib import Path
from statistics import median

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"
CUTOFF = "2020-01-01"
TODAY = date(2026, 7, 22)

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
    """归一化实体键：去括号修饰，按 ';' 拆复方，逐段去盐基后重组。"""
    name = re.sub(r"\([^)]*\)", " ", name.upper())
    parts = re.split(r"[;/]", name)
    cleaned = []
    for p in parts:
        toks = [t for t in p.split() if t.strip(",.") not in SALT_TOKENS]
        seg = " ".join(toks).strip()
        # 美版生物制品四字母后缀（LECANEMAB-IRMB → LECANEMAB）；
        # 全新生物药与生物类似药都带后缀，归一后由“首次获批时间”自然区分
        seg = re.sub(r"-[A-Z]{4}$", "", seg)
        cleaned.append(seg)
    return "; ".join(p for p in cleaned if p)


def load(name):
    with open(DATA / name) as f:
        return json.load(f)


def stem(name: str) -> str:
    """取 INN 词干：归一化后末段最后一句。"""
    base = norm_entity(name)
    toks = base.replace(";", " ").split()
    return toks[-1] if toks else name


def classify(name: str, appl_type: str) -> str:
    s = stem(name.upper())
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


def main():
    products = load("products.json")
    entity_map = load("entity_map.json")
    global_access = load("global_access.json")
    disease_index = load("diseases/index.json")

    idx = {n: i for i, n in enumerate(products["fields"])}

    # ---------- NME 集合：按归一化实体键分组，首次 NDA/BLA 获批 >= 2020 ----------
    first = {}  # norm_key -> {"date", "appl_type", "sponsor", "raw", "variants": set}
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
        cur = first.get(key)
        if cur is None:
            first[key] = {"date": d, "appl_type": row[idx["appl_type"]],
                          "sponsor": row[idx["sponsor_name"]] or "",
                          "raw": raw, "variants": {raw}}
        else:
            cur["variants"].add(raw)
            if d < cur["date"]:
                cur.update({"date": d, "appl_type": row[idx["appl_type"]],
                            "sponsor": row[idx["sponsor_name"]] or ""})
            # 展示名取 2020+ 首获批记录的原始名
            if d >= CUTOFF and d < cur.get("raw_date", "9999"):
                cur["raw"], cur["raw_date"] = raw, d

    nmes = {k: v for k, v in first.items() if v["date"] >= CUTOFF}
    print(f"NME 总数（2020+ 首次 NDA/BLA，去盐基归并/去生物类似药后缀）: {len(nmes)}")

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
            """在按原始成分名索引的映射中，用任一原始变体命中。"""
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
            })

        total = len(cohort)
        n_ga = sum(1 for _, v in cohort if lookup(ga_records, v["variants"]))
        years[ys] = {
            "total": total,
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
        "generated_at": TODAY.isoformat(),
        "scope": "首次 FDA NDA/BLA 获批 ≥ 2020-01-01（去生物类似药 -XXXX 后缀，不含 ANDA）",
        "years": years,
    }
    dest = DATA / "nme_annual.json"
    with open(dest, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"写出 {dest}（{len(years)} 个年度）")

    # ---------- 分类抽检 ----------
    sample_year = "2025"
    if sample_year in years:
        print(f"\n--- {sample_year} 抽检（共 {years[sample_year]['total']} 个 NME）---")
        print("类型分布:", years[sample_year]["type_dist"])
        for item in years[sample_year]["ingredients"]:
            s = stem(item["ing"])
            if s.endswith("MAB") or item["type"] == "小分子":
                print(f"  {item['ing'][:50]:<52} {item['date']}  {item['type']}")


if __name__ == "__main__":
    main()
