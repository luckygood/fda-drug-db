#!/usr/bin/env python3
"""RxNorm 归一化辅助（P4 Part 1）：708 个 NME 成分 → RxCUI + 同义名。

输出 public/data/rxnorm_map.json（write_dataset）：
{ingredients: {ING: {rxcui, synonyms[≤12]}}}  # synonyms 含 INN/品牌名/盐型变体
用法：
  python3 scripts/build_rxnorm_map.py --start 0 --limit 100
  python3 scripts/build_rxnorm_map.py --merge
缓存 scripts/.cache/rxnav/，断点续跑。
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
from build_global_access import norm_keys, strip_salts

API = "https://rxnav.nlm.nih.gov/REST"
SLEEP = 0.25
MAX_RETRY = 4
CACHE = Path(__file__).resolve().parent / ".cache" / "rxnav"

_last_request = 0.0


def rx_get(path):
    global _last_request
    url = f"{API}/{path}"
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
            req = urllib.request.Request(url, headers={"User-Agent": "fda-drug-db/rxnorm"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            cache_file.write_text(json.dumps(data, ensure_ascii=False))
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429 or 500 <= e.code < 600:
                if attempt < MAX_RETRY - 1:
                    time.sleep(min(2 ** attempt * 2, 30))
                    continue
            print(f"  !! HTTP {e.code}: {url[:120]}", file=sys.stderr)
            return None
        except Exception as e:  # noqa: BLE001
            if attempt < MAX_RETRY - 1:
                time.sleep(min(2 ** attempt * 2, 30))
                continue
            print(f"  !! {type(e).__name__}: {e} for {url[:120]}", file=sys.stderr)
            return None
    return None


def fetch_ingredient(ing):
    """单方：取归一化变体逐个试 /rxcui.json?name=；命中后拉 allrelated 同义名。复方跳过 RxCUI。"""
    if ";" in ing:
        return {"rxcui": None, "synonyms": [], "note": "combo_skipped"}
    keys = sorted({strip_salts(k).strip() for k in norm_keys(ing) if strip_salts(k).strip()})
    rxcui = None
    for k in keys[:3]:
        r = rx_get(f"rxcui.json?name={urllib.parse.quote(k)}")
        if r is None:
            return {"error": True}
        ids = (r.get("idGroup") or {}).get("rxnormId") or []
        if ids:
            rxcui = ids[0]
            break
    if not rxcui:
        return {"rxcui": None, "synonyms": []}
    r = rx_get(f"rxcui/{rxcui}/allrelated.json")
    if r is None:
        return {"error": True}
    syns = set()
    for grp in (r.get("allRelatedGroup") or {}).get("conceptGroup") or []:
        if grp.get("tty") not in ("IN", "PIN", "BN", "MIN", "SBD", "SBDC"):
            continue
        for cp in grp.get("conceptProperties") or []:
            n = (cp.get("name") or "").strip()
            if n and len(n) <= 60:
                syns.add(n.upper())
    base = strip_salts(ing).strip().upper()
    syns.discard(base)
    return {"rxcui": rxcui, "synonyms": sorted(syns)[:12]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()

    ga = json.loads((DATA / "global_access.json").read_text())
    names = sorted(ga["records"])
    print(f"NME 成分 {len(names)} 个")

    if args.merge:
        merged = {}
        for part in sorted(DATA.glob("rxnorm_map.partial-*.json")):
            merged.update(json.loads(part.read_text()))
        n_cui = sum(1 for v in merged.values() if v.get("rxcui"))
        n_syn = sum(1 for v in merged.values() if v.get("synonyms"))
        n_err = sum(1 for v in merged.values() if v.get("error"))
        print(f"合并 {len(merged)}：有 RxCUI {n_cui}，有同义名 {n_syn}，失败 {n_err}")
        write_dataset("rxnorm_map", {
            "scope": "RxNorm/RxNav 归一化辅助：RxCUI + INN/品牌名同义词（NMPA 匹配键补充）",
            "ingredients": dict(sorted(merged.items())),
        })
        for part in DATA.glob("rxnorm_map.partial-*.json"):
            part.unlink()
        print("已写出 public/data/rxnorm_map.json")
        return

    slice_names = names[args.start:args.start + args.limit]
    if not slice_names:
        print("切片为空，退出")
        return
    results = {}
    part = DATA / f"rxnorm_map.partial-{args.start}.json"
    for i, ing in enumerate(slice_names, 1):
        print(f"[{i}/{len(slice_names)}] {ing}")
        results[ing] = fetch_ingredient(ing)
        part.write_text(json.dumps(results, ensure_ascii=False, separators=(",", ":")))
    print(f"已写出 {part.name}（{len(results)} 条）")


if __name__ == "__main__":
    main()
