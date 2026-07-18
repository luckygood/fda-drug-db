#!/usr/bin/env python3
"""为每个获批申请号生成通用版有效性/安全性摘要卡（无疾病语境），分片存储。

数据源：fda_labels.db 的 labels + label_deep（同一申请多版本取 effective_time 最新）。
输出：
  fda-drug-web/public/data/cards/<SHARD>.json   （NDA.json / ANDA-07.json / BLA.json …）
  fda-drug-web/public/data/cards/index.json     （分片清单与定位规则说明）
分片规则：按 appl_type（application_number 前导字母）分片；单文件超 1.5MB 时
按申请号数字部分前两位再细分（如 NDA-02.json）。
"""
import json
import os
import re
import sqlite3
import time
from collections import defaultdict

from disease_drugs import DB_LABELS, split_study_sections, unpack
from export_diseases import (
    build_safety_card,
    extract_key_results,
    extract_trials,
    norm_text,
)

OUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "fda-drug-web", "public", "data", "cards",
)
SHARD_LIMIT = 1_500_000  # 1.5MB

APPNO_RE = re.compile(r"^([A-Z]+)(\d+)$")


def build_generic_efficacy_card(clinical_text):
    """无疾病语境：对全部 14.x 小节整体提取。"""
    clinical_text = norm_text(clinical_text)
    if not clinical_text:
        return None
    sections = split_study_sections(clinical_text)
    if not sections:
        return None
    full = " ".join(body for _, body in sections)
    trials = extract_trials(full)
    key_results = extract_key_results(full)
    if not trials and not key_results:
        return None
    source = sections[0][0] if sections[0][0] else None
    return {
        "trials": trials,
        "key_results": key_results,
        "source_section": source or "",
    }


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_LABELS)
    t0 = time.time()

    # 每个 application_number 取 effective_time 最新的 labels 记录
    rows = conn.execute(
        """
        SELECT application_number, set_id, effective_time
        FROM labels
        WHERE application_number IS NOT NULL AND application_number != ''
        """
    ).fetchall()
    best = {}
    for appno, set_id, et in rows:
        if appno not in best or (et or "") > (best[appno][1] or ""):
            best[appno] = (set_id, et)
    print(f"distinct application_number: {len(best)}")

    # 逐个生成卡片
    cards = {}
    n_eff = n_safe = 0
    for i, (appno, (set_id, _)) in enumerate(sorted(best.items())):
        deep = conn.execute(
            "SELECT boxed_warning, warnings, adverse_reactions, clinical_studies "
            "FROM label_deep WHERE set_id = ?",
            (set_id,),
        ).fetchone()
        if not deep:
            continue
        eff = build_generic_efficacy_card(unpack(deep[3]))
        saf = build_safety_card(unpack(deep[0]), unpack(deep[1]), unpack(deep[2]))
        if not eff and not saf:
            continue
        if eff:
            n_eff += 1
        if saf:
            n_safe += 1
        cards[appno] = {"efficacy_card": eff, "safety_card": saf}
        if (i + 1) % 5000 == 0:
            print(f"  ... {i+1}/{len(best)} ({time.time()-t0:.0f}s)", flush=True)

    print(f"cards generated: {len(cards)} (efficacy {n_eff}, safety {n_safe})")

    # 分片：先按 appl_type，超限再按数字前两位细分
    by_type = defaultdict(dict)
    for appno, card in cards.items():
        m = APPNO_RE.match(appno)
        if not m:
            continue
        by_type[m.group(1)][appno] = card

    shards = {}
    for appl_type, group in sorted(by_type.items()):
        payload = json.dumps(group, ensure_ascii=False, separators=(",", ":"))
        if len(payload.encode("utf-8")) <= SHARD_LIMIT:
            shards[f"{appl_type}.json"] = group
            continue
        # 按数字前两位细分
        sub = defaultdict(dict)
        for appno, card in group.items():
            digits = APPNO_RE.match(appno).group(2)
            sub[digits[:2]][appno] = card
        for prefix, g in sorted(sub.items()):
            payload = json.dumps(g, ensure_ascii=False, separators=(",", ":"))
            if len(payload.encode("utf-8")) <= SHARD_LIMIT:
                shards[f"{appl_type}-{prefix}.json"] = g
            else:
                # 仍超限：按数字前三位再细分（如 ANDA-204.json）
                sub3 = defaultdict(dict)
                for appno, card in g.items():
                    digits = APPNO_RE.match(appno).group(2)
                    sub3[digits[:3]][appno] = card
                for prefix3, g3 in sorted(sub3.items()):
                    shards[f"{appl_type}-{prefix3}.json"] = g3

    total_bytes = 0
    for name, group in sorted(shards.items()):
        payload = json.dumps(group, ensure_ascii=False, separators=(",", ":"))
        with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8") as f:
            f.write(payload)
        sz = len(payload.encode("utf-8"))
        total_bytes += sz
        print(f"  {name:18s} {len(group):6d} apps  {sz/1024:8.0f} KB")

    index = {
        "shard_rule": (
            "application_number 前导字母为 appl_type，其余为数字。"
            "分片优先级：<type>-<数字前三位>.json > <type>-<数字前两位>.json > <type>.json，"
            "取存在的最细分片。"
        ),
        "shards": sorted(shards.keys()),
    }
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    total_bytes += os.path.getsize(os.path.join(OUT_DIR, "index.json"))

    print("\n===== 汇总 =====")
    print(f"覆盖申请数: {len(cards)}")
    print(f"shard 文件数: {len(shards)} (+index.json)")
    print(f"总体积: {total_bytes/1024/1024:.2f} MB")
    print(f"耗时: {time.time()-t0:.0f}s")
    conn.close()


if __name__ == "__main__":
    main()
