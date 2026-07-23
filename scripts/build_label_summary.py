#!/usr/bin/env python3
"""Build public/data/label_summary.json — 成分级 FDA 说明书要点摘要.

来源：public/data/cards/*.json（~12k 张按申请号分片的疗效/安全摘要卡，
由 import_labels / export_app_cards 生成，仅原始 NDA/BLA 有 efficacy 卡）。

聚合口径：每个成分取其最早获批的原始 NDA/BLA 申请号对应的卡片
（原研首批准标签最能代表"首次上市"时的疗效/安全表述）。

输出：{ingredient: {application_number, drug_name,
  efficacy: {key_results: [...≤2], source_section: str(截断)} | null,
  safety: {boxed_warning: str|None(截断), warnings: [...≤4],
           common_adverse_reactions: str|None(截断)} | null}}
仅收录 efficacy 或 safety 至少一项有内容的成分。

用法：python3 scripts/build_label_summary.py
"""

import json
from pathlib import Path

from build_common import write_dataset

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"

MAX_KEY_RESULTS = 2
MAX_WARNINGS = 4
MAX_TEXT = 600  # 单字段字符上限（控制文件体积）


def cut(s, n=MAX_TEXT):
    if not s:
        return s
    return s if len(s) <= n else s[:n].rstrip() + "…"


def load(name):
    with open(DATA / name) as f:
        return json.load(f)


def shard_candidates(app_no):
    """与前端 getAppCard 相同的分片定位规则。"""
    pfx = "".join(c for c in app_no if c.isalpha())
    digits = app_no[len(pfx):]
    return [f"{pfx}-{digits[:3]}.json", f"{pfx}-{digits[:2]}.json", f"{pfx}.json"]


def main():
    products = load("products.json")
    idx = {n: i for i, n in enumerate(products["fields"])}

    # 成分 -> 最早原始 NDA/BLA 申请
    first = {}  # ing -> (date, app_no, drug_name)
    for row in products["rows"]:
        if row[idx["appl_type"]] not in ("NDA", "BLA"):
            continue
        d = row[idx["approval_date"]] or ""
        ing = (row[idx["active_ingredient"]] or "").strip().upper()
        app = row[idx["application_number"]]
        if not ing or not d or not app:
            continue
        if ing not in first or d < first[ing][0]:
            first[ing] = (d, app, row[idx["drug_name"]] or "")

    # 加载全部分片
    shards = {}
    for f in sorted((DATA / "cards").glob("*.json")):
        if f.name == "index.json":
            continue
        shards[f.name] = json.load(open(f))

    def get_card(app_no):
        for name in shard_candidates(app_no):
            if name in shards:
                return shards[name].get(app_no)
        return None

    out = {}
    n_eff, n_saf = 0, 0
    for ing, (_, app, drug) in sorted(first.items()):
        card = get_card(app)
        if not card:
            continue
        eff = card.get("efficacy_card")
        saf = card.get("safety_card")
        entry = {"application_number": app, "drug_name": drug}
        has = False
        if eff and (eff.get("key_results") or eff.get("source_section")):
            entry["efficacy"] = {
                "key_results": [cut(x, 400) for x in (eff.get("key_results") or [])[:MAX_KEY_RESULTS]],
                "source_section": cut(eff.get("source_section"), 300),
            }
            has = True
            n_eff += 1
        if saf and (saf.get("boxed_warning") or saf.get("warnings") or saf.get("common_adverse_reactions")):
            entry["safety"] = {
                "boxed_warning": cut(saf.get("boxed_warning"), 400),
                "warnings": (saf.get("warnings") or [])[:MAX_WARNINGS],
                "common_adverse_reactions": cut(saf.get("common_adverse_reactions"), 400),
            }
            has = True
            n_saf += 1
        if has:
            out[ing] = entry

    payload = {
        "scope": "每成分取最早原始 NDA/BLA 申请的 FDA 说明书摘要卡（首批准标签）",
        "ingredients": out,
    }
    out_path = write_dataset("label_summary", payload)
    print(f"成分覆盖: {len(out)}（efficacy {n_eff} / safety {n_saf}）-> {out_path}")


if __name__ == "__main__":
    main()
