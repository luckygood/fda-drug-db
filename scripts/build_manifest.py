#!/usr/bin/env python3
"""Build public/data/manifest.json — 开放数据底座：全量数据集的生成时间/方法版本清单.

扫描 public/data/*.json（跳过采集切片 partial-* 与 manifest 自身），
提取每个文件的 generated_at / method_version / 文件大小，
供「开放数据」页免下载大文件即可展示各数据集的鲜度。

用法: python3 scripts/build_manifest.py
"""

import json
import os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"


def main():
    datasets = {}
    for f in sorted(DATA.glob("*.json")):
        if f.name.startswith("manifest") or ".partial-" in f.name:
            continue
        entry = {"size_bytes": os.path.getsize(f)}
        try:
            with open(f) as fh:
                d = json.load(fh)
            if isinstance(d, dict):
                ga = d.get("generated_at")
                if ga:
                    # 统一截到日期（个别文件带时区时间）
                    entry["generated_at"] = str(ga)[:10]
                mv = d.get("method_version")
                if mv:
                    entry["method_version"] = str(mv)
        except Exception as e:  # noqa: BLE001
            entry["error"] = str(e)
        datasets[f.name] = entry

    payload = {
        "scope": "public/data 顶层 JSON 文件清单（分片目录 companies/diseases/api/cards 见开放数据页说明）",
        "count": len(datasets),
        "datasets": datasets,
    }
    out = DATA / "manifest.json"
    with open(out, "w") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    total_mb = sum(e.get("size_bytes", 0) for e in datasets.values()) / 1024 / 1024
    dated = sum(1 for e in datasets.values() if e.get("generated_at"))
    print(f"manifest: {len(datasets)} 个文件，合计 {total_mb:.1f} MB，{dated} 个带 generated_at")


if __name__ == "__main__":
    main()
