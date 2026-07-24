#!/usr/bin/env python3
"""说明书安全信号包（P3 Part 1）：黑框警告 + 标签修订日期。

双源策略：
1. openFDA drug/label.json（当前有效标签）：查 generic_name 精确短语，取 effective_time
   最新一条的 boxed_warning / warnings / effective_time。
2. 本地标签卡（label_summary.json，首批准标签）：openFDA 未命中时兜底。

输出 public/data/label_safety.json：
{ingredients: {ING: {boxed_warning, bw_excerpt(≤300), warnings_present,
                     label_effective_date|null, source}}}

用法：
  python3 scripts/build_label_safety.py --start 0 --limit 100
  python3 scripts/build_label_safety.py --merge
缓存 scripts/.cache/openfda/（sha1(url)），429/5xx 退避，断点续跑。
"""

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from build_common import write_dataset, DATA

API = "https://api.fda.gov/drug/label.json"
SLEEP = 0.28  # openFDA 无 key 限 240/min，留足余量
MAX_RETRY = 4
CACHE = Path(__file__).resolve().parent / ".cache" / "openfda"

_last_request = 0.0


def fda_get(params):
    """GET drug/label.json，带缓存 + 限速 + 退避。404（无匹配）返回 {}；硬失败返回 None。"""
    global _last_request
    url = f"{API}?{urllib.parse.urlencode(params)}"
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE / f"{hashlib.sha1(url.encode()).hexdigest()}.json"
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text())
        except Exception:  # noqa: BLE001
            cache_file.unlink(missing_ok=True)
    for attempt in range(MAX_RETRY):
        wait = SLEEP - (time.time() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fda-drug-db/label-safety"})
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            cache_file.write_text(json.dumps(data, ensure_ascii=False))
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                cache_file.write_text("{}")
                return {}
            if e.code == 429 or 500 <= e.code < 600:
                if attempt < MAX_RETRY - 1:
                    time.sleep(min(2 ** attempt * 2, 30))
                    continue
            print(f"  !! HTTP {e.code}: {url[:140]}", file=sys.stderr)
            return None
        except Exception as e:  # noqa: BLE001
            if attempt < MAX_RETRY - 1:
                time.sleep(min(2 ** attempt * 2, 30))
                continue
            print(f"  !! {type(e).__name__}: {e} for {url[:140]}", file=sys.stderr)
            return None
    return None


def fmt_date(raw):
    """openFDA effective_time: YYYYMMDD → YYYY-MM-DD。"""
    if raw and len(raw) >= 8:
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    return None


def query_openfda(ing):
    """按成分名查当前有效标签；复方逐成分 OR。命中返回结果 dict，未命中 {}，失败 None。"""
    parts = [p.strip() for p in ing.split(";") if p.strip()]
    if len(parts) > 1:
        term = "+".join(f'openfda.substance_name:"{p}"' for p in parts[:3])
    else:
        term = f'openfda.generic_name:"{ing}"'
    r = fda_get({"search": term, "limit": 1, "sort": "effective_time:desc"})
    if not r:
        return r
    res = (r.get("results") or [None])[0]
    if res is None:
        return {}
    return res


def fetch_ingredient(ing, local):
    hit = query_openfda(ing)
    if hit:  # openFDA 命中（非空 dict）
        bw = hit.get("boxed_warning") or []
        warns = hit.get("warnings") or hit.get("warnings_and_cautions") or []
        return {
            "boxed_warning": bool(bw),
            "bw_excerpt": (bw[0][:300] if bw else None),
            "warnings_present": bool(warns),
            "label_effective_date": fmt_date(hit.get("effective_time", "")),
            "source": "openfda_label",
        }
    if hit is None:
        return {"error": True}
    # 兜底：本地首批准标签卡
    safety = (local or {}).get("safety") or {}
    bw_text = safety.get("boxed_warning")
    return {
        "boxed_warning": bool(bw_text),
        "bw_excerpt": (bw_text[:300] if bw_text else None),
        "warnings_present": bool(safety.get("warnings")),
        "label_effective_date": None,
        "source": "label_summary_cards",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()

    ls = json.loads((DATA / "label_summary.json").read_text())["ingredients"]
    names = sorted(ls)
    print(f"label_summary 成分 {len(names)} 个")

    if args.merge:
        merged = {}
        for part in sorted(DATA.glob("label_safety.partial-*.json")):
            merged.update(json.loads(part.read_text()))
        n_err = sum(1 for v in merged.values() if v.get("error"))
        n_bw = sum(1 for v in merged.values() if v.get("boxed_warning"))
        n_fda = sum(1 for v in merged.values() if v.get("source") == "openfda_label")
        n_date = sum(1 for v in merged.values() if v.get("label_effective_date"))
        print(f"合并 {len(merged)}：黑框 {n_bw}，openFDA 命中 {n_fda}，有修订日期 {n_date}，失败 {n_err}")
        write_dataset("label_safety", {
            "scope": "说明书安全信号：黑框警告/警告事项/标签修订日期（openFDA 当前标签 + 本地首批准标签兜底）",
            "ingredients": dict(sorted(merged.items())),
        })
        for part in DATA.glob("label_safety.partial-*.json"):
            part.unlink()
        print("已写出 public/data/label_safety.json")
        return

    slice_names = names[args.start:args.start + args.limit]
    if not slice_names:
        print("切片为空，退出")
        return
    results = {}
    part = DATA / f"label_safety.partial-{args.start}.json"
    for i, ing in enumerate(slice_names, 1):
        print(f"[{i}/{len(slice_names)}] {ing}")
        results[ing] = fetch_ingredient(ing, ls.get(ing))
        part.write_text(json.dumps(results, ensure_ascii=False, separators=(",", ":")))
    print(f"已写出 {part.name}（{len(results)} 条）")


if __name__ == "__main__":
    main()
