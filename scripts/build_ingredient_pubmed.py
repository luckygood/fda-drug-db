#!/usr/bin/env python3
"""Build public/data/ingredient_pubmed.json — 引入期成分的 PubMed 证据.

Queries NCBI eutils for each 引入期 ingredient in lifecycle_index.json:
  - clinical_count: clinical trial / RCT publications 2023-2026
  - review_count:   review / meta-analysis publications 2023-2026
  - recent:         up to 5 most recent publications (any type)

Usage:
  python3 scripts/build_ingredient_pubmed.py --start 0 --limit 30   # slice
  python3 scripts/build_ingredient_pubmed.py --merge                # merge partials
"""

import argparse
import glob
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
SLEEP = 0.4
MAX_RETRY = 3

_last_request = 0.0


def eutils_get(endpoint, params):
    """GET an eutils endpoint with rate limiting and retry/backoff."""
    global _last_request
    url = f"{EUTILS}/{endpoint}?{urllib.parse.urlencode(params)}"
    for attempt in range(MAX_RETRY):
        wait = SLEEP - (time.time() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.time()
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 or 500 <= e.code < 600:
                if attempt < MAX_RETRY - 1:
                    time.sleep(2 ** attempt)
                    continue
            print(f"  !! HTTP {e.code} for {endpoint} ({url[:120]}...)", file=sys.stderr)
            return None
        except Exception as e:  # noqa: BLE001
            if attempt < MAX_RETRY - 1:
                time.sleep(2 ** attempt)
                continue
            print(f"  !! {type(e).__name__}: {e} for {endpoint}", file=sys.stderr)
            return None
    return None


def esearch_count(term):
    r = eutils_get("esearch.fcgi", {
        "db": "pubmed", "term": term, "retmode": "json", "retmax": 0,
    })
    if not r:
        return None
    return int(r["esearchresult"].get("count", 0))


def esearch_ids(term, retmax=5):
    r = eutils_get("esearch.fcgi", {
        "db": "pubmed", "term": term, "retmode": "json",
        "retmax": retmax, "sort": "pub date",
    })
    if not r:
        return []
    return r["esearchresult"].get("idlist", [])


def esummary(pmids):
    if not pmids:
        return []
    r = eutils_get("esummary.fcgi", {
        "db": "pubmed", "id": ",".join(pmids), "retmode": "json",
    })
    if not r:
        return []
    out = []
    res = r.get("result", {})
    for pid in res.get("uids", []):
        item = res.get(pid, {})
        out.append({
            "pmid": pid,
            "title": item.get("title", "").rstrip("."),
            "journal": item.get("source", ""),
            "pubdate": item.get("pubdate", ""),
        })
    return out


def base_term(ing):
    _Y0 = date.today().year - 3
    return f'("{ing}"[Substance Name] OR "{ing}"[Title/Abstract]) AND {_Y0}:{date.today().year}[dp]'


def fetch_ingredient(ing):
    clinical = esearch_count(
        f'{base_term(ing)} AND ("clinical trial"[pt] OR "randomized controlled trial"[pt])')
    review = esearch_count(
        f'{base_term(ing)} AND ("review"[pt] OR "meta-analysis"[pt])')
    recent = esummary(esearch_ids(base_term(ing)))
    return {
        "clinical_count": clinical,
        "review_count": review,
        "recent": recent,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()

    if args.merge:
        merged = {}
        for f in sorted(glob.glob(str(DATA / "ingredient_pubmed.partial-*.json"))):
            part = json.load(open(f))
            merged.update(part["ingredients"])
        out = {
            "generated_at": date.today().isoformat(),
            "ingredients": merged,
        }
        out_path = DATA / "ingredient_pubmed.json"
        with open(out_path, "w") as fh:
            json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"merged {len(merged)} ingredients -> {out_path} ({out_path.stat().st_size/1024:.0f} KB)")
        return

    idx = json.load(open(DATA / "lifecycle_index.json"))
    ings = sorted(k for k, v in idx["records"].items() if v["stage"] == "引入期")
    print(f"引入期成分总数: {len(ings)}; 处理切片 [{args.start}, {args.start + args.limit})")

    slice_ings = ings[args.start:args.start + args.limit]
    result = {}
    failed = []
    for i, ing in enumerate(slice_ings, 1):
        print(f"[{i}/{len(slice_ings)}] {ing}")
        entry = fetch_ingredient(ing)
        if entry["clinical_count"] is None and entry["review_count"] is None and not entry["recent"]:
            failed.append(ing)
        result[ing] = entry
        print(f"    clinical={entry['clinical_count']} review={entry['review_count']} recent={len(entry['recent'])}")

    out_path = DATA / f"ingredient_pubmed.partial-{args.start}.json"
    with open(out_path, "w") as fh:
        json.dump({"ingredients": result}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"写出 {out_path} ({len(result)} 条)")
    if failed:
        print(f"失败成分（需重跑）: {failed}")


if __name__ == "__main__":
    main()
