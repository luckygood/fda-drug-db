#!/usr/bin/env python3
"""Build public/data/cn_access.json — 全球可及性专题二期：NMPA（中国）批准状态（三态诚实版）.

范围：与 global_access 相同的 708 个成分（2020-01-01 至今 ≥1 个 FDA 原始 NDA/BLA 获批）。

数据策略（重要）：
  CDE 全站瑞数 202 JS 挑战直连不可达、NMPA datasearch 412、WebBridge 浏览器扩展未连接，
  无法对 708 个成分逐一权威核验。因此本数据集只收录**公开文献/盘点文章正向确认**的
  NMPA 批准（种子见 scripts/cn_approved_seed.json，每条均有出处），其余一律 "unknown"。
  - unknown ≠ 未批！仅表示"本次未检索到公开批准记录"，需人工核实。
  - 本版本不使用 "not_found"（无权威阴性证据源）。
  - 2021/2022 年覆盖薄弱（仅有单篇盘点点名），DIA 2024 年报附录为图片未能全量解析。

匹配：种子英文名 -> norm_keys（build_global_access）+ RxNorm 同义名反查 -> 708 键空间；
匹配不上的种子条目打印出来供人工复核（宁可少匹配也不错配）。

用法: python3 scripts/build_cn_access.py
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"
sys.path.insert(0, str(REPO / "scripts"))
from build_common import write_dataset            # noqa: E402
from build_global_access import norm_keys, combo_key  # noqa: E402

CUTOFF = "2020-01-01"


def load_target():
    """与 build_global_access 相同的 708 成分键空间（2020+ FDA 原始 NDA/BLA）。"""
    products = json.load(open(DATA / "products.json"))
    idx = {n: i for i, n in enumerate(products["fields"])}
    target = {}
    for row in products["rows"]:
        if row[idx["appl_type"]] not in ("NDA", "BLA"):
            continue
        d = row[idx["approval_date"]] or ""
        ing = (row[idx["active_ingredient"]] or "").strip().upper()
        if not ing or not d or d < CUTOFF:
            continue
        if ing not in target or d < target[ing]:
            target[ing] = d
    return target


def main():
    target = load_target()
    print(f"目标成分（2020+ FDA NDA/BLA）: {len(target)}")

    # 反查索引：匹配键 -> 708 成分键
    key2ing = {}
    for ing in target:
        keys = norm_keys(ing)
        ck = combo_key(ing)
        if ck:
            keys.add(ck)
        for k in keys:
            key2ing.setdefault(k, ing)

    # RxNorm 同义名补充反查（SBD 噪音无妨，只在能唯一映射时使用）
    rx = json.load(open(DATA / "rxnorm_map.json"))
    syn_hits = 0
    for ing, rec in rx["ingredients"].items():
        if ing not in target:
            continue
        for syn in rec.get("synonyms") or []:
            for k in norm_keys(syn):
                if k not in key2ing:
                    key2ing[k] = ing
                    syn_hits += 1
    print(f"RxNorm 同义名补充索引键: +{syn_hits}")

    seed = json.load(open(REPO / "scripts" / "cn_approved_seed.json"))
    sources = seed["sources"]

    approved, unmatched = {}, []
    for name, ent in sorted(seed["entries"].items()):
        hit = None
        for k in norm_keys(name):
            if k in key2ing:
                hit = key2ing[k]
                break
        if hit is None:
            ck = combo_key(name)
            if ck and ck in key2ing:
                hit = key2ing[ck]
        if hit is None:
            unmatched.append((name, ent["year"], ent["source"]))
            continue
        # 同一年份冲突时取最早年份 + 保留首条出处
        if hit in approved:
            if ent["year"] < approved[hit]["year"]:
                approved[hit]["year"] = ent["year"]
        else:
            approved[hit] = {"year": ent["year"], "source": ent["source"]}

    print(f"\n种子条目: {len(seed['entries'])}，匹配到 708 键空间: {len(approved)}")
    print(f"未匹配（多为 FDA 老药/非 FDA 药/国产药，预期内）: {len(unmatched)}")
    for name, y, s in unmatched:
        print(f"  [unmatched] {name} ({y}, {s})")

    records = {}
    for ing in sorted(target):
        if ing in approved:
            ent = approved[ing]
            records[ing] = {
                "cn_status": "approved",
                "cn_first_year": ent["year"],
                "cn_product_count": None,
                "match_type": "curated_seed",
                "source": sources.get(ent["source"], ent["source"]),
            }
        else:
            records[ing] = {
                "cn_status": "unknown",
                "cn_first_year": None,
                "cn_product_count": None,
                "match_type": "no_positive_evidence",
                "source": None,
            }

    stats = {
        "total": len(records),
        "approved": sum(1 for r in records.values() if r["cn_status"] == "approved"),
        "unknown": sum(1 for r in records.values() if r["cn_status"] == "unknown"),
        "seed_unmatched": len(unmatched),
    }

    payload = {
        "scope": "fda_nda_2020plus",
        "source_url": "https://www.cde.org.cn/ (直连被瑞数反爬拦截，本版未采集)",
        "coverage_note": (
            "NMPA/CDE 官方库直连不可达（瑞数 202 JS 挑战），WebBridge 浏览器扩展未连接，"
            "本数据集仅为公开文献正向确认（种子见 scripts/cn_approved_seed.json，每条含出处）："
            "STTT 2023 年 NMPA 批准盘点(PMC10879080)、DIA Global Forum 2024 年报正文、"
            "Insight 2025H1 盘点、MedSci 2021 盘点、Echemi 2022 盘点、CPT 2025 综述(PMC12816426)。"
            "unknown ≠ 未批，仅表示本次未检索到公开批准记录，需人工核实；"
            "本版未启用 not_found（无权威阴性证据）。"
            "2021/2022 年覆盖薄弱；DIA 2024 年报附录（83 个进口药全名单）为图片，仅正文约 50 个可解析。"
        ),
        "stats": stats,
        "records": records,
    }
    write_dataset("cn_access", payload)
    print(f"\napproved: {stats['approved']} / {stats['total']}，unknown: {stats['unknown']}")


if __name__ == "__main__":
    main()
