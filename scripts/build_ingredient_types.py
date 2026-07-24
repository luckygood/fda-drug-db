#!/usr/bin/env python3
"""分子类型全量化（P3 Part 1）：对 lifecycle_index 全部成分跑规则分类器，
结果折叠进 report_metrics.json 的 ingredients[<name>].mol_type。

分类器复用 build_nme_annual.classify（词干规则 + BLA/NDA 兜底）；
申请类型门控 = 该成分在 products.json 中是否有 BLA 原始申请（有 BLA → BLA，否则 NDA）。

用法：python3 scripts/build_ingredient_types.py
"""

import json
from collections import Counter

from build_common import write_dataset, DATA
from build_nme_annual import classify

METHOD_NOTE = (
    "mol_type 规则分类：词干后缀（-SIRAN/-RSEN 核酸、ADC 载荷词干、-CEL 细胞基因、"
    "VACCINE 疫苗、-MAB 单抗、-CEPT 融合蛋白、-TIDE 多肽、-ASE 酶[仅 BLA]），"
    "兜底按申请类型：BLA→其他生物药、NDA→小分子；复方按归一化末词干判定。"
)


def main():
    products = json.loads((DATA / "products.json").read_text())
    idx_t = products["fields"].index("appl_type")
    idx_i = products["fields"].index("active_ingredient")

    bla_ings = set()
    all_ings = set()
    for row in products["rows"]:
        ing = row[idx_i]
        if not ing:
            continue
        all_ings.add(ing)
        if row[idx_t] == "BLA":
            bla_ings.add(ing)

    rm = json.loads((DATA / "report_metrics.json").read_text())
    ings = rm["ingredients"]
    dist = Counter()
    missing = 0
    for name in ings:
        appl_type = "BLA" if name in bla_ings else "NDA"
        if name not in all_ings:
            missing += 1
        t = classify(name, appl_type)
        ings[name]["mol_type"] = t
        dist[t] += 1

    rm["notes"] = rm.get("notes", "") + " " + METHOD_NOTE
    write_dataset("report_metrics", rm)

    total = sum(dist.values())
    print(f"成分总数 {total}（products.json 未匹配 {missing}）")
    for t, n in dist.most_common():
        print(f"  {t}: {n} ({n / total * 100:.1f}%)")


if __name__ == "__main__":
    main()
