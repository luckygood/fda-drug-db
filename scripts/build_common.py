"""build 脚本共享工具：版本戳 + 快照归档（Fix 5）.

每个数据构建脚本在输出 JSON 中写入 generated_at + method_version，
并在写出 public/data/<name>.json 后归档一份到 scripts/snapshots/<name>-<YYYYMMDD>.json，
每个数据集仅保留最新 3 份快照（防止仓库膨胀）。
"""

import json
import shutil
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"
SNAPSHOTS = REPO / "scripts" / "snapshots"
METHOD_VERSION = "1.1"
KEEP_SNAPSHOTS = 3


def write_dataset(name, payload, today=None):
    """写入 public/data/<name>.json（附 generated_at/method_version）并归档快照。

    payload 中已存在的 generated_at / method_version 会被覆盖为统一值。
    返回输出路径。
    """
    today = today or date.today()
    payload = dict(payload)
    payload["generated_at"] = today.isoformat()
    payload["method_version"] = METHOD_VERSION

    out_path = DATA / f"{name}.json"
    with open(out_path, "w") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    snap = SNAPSHOTS / f"{name}-{today.strftime('%Y%m%d')}.json"
    shutil.copy2(out_path, snap)
    # 裁剪：每个数据集只留最新 KEEP_SNAPSHOTS 份
    snaps = sorted(SNAPSHOTS.glob(f"{name}-*.json"))
    for old in snaps[:-KEEP_SNAPSHOTS]:
        old.unlink()
    return out_path
