#!/usr/bin/env python3
"""Build public/data/disease_pubmed.json — 疾病级 PubMed 证据（报告 A 数据地基）.

选取口径：diseases/index.json 中按获批药物数（drug_count）降序取 Top 20，
并强制纳入两个试点疾病（atopic-dermatitis、iga-nephropathy）——共 22 个疾病。

每个疾病查询 NCBI eutils（检索词 = 疾病英文名[MeSH/Title-Abstract]，窗口 2023:2026[dp]）：
  - clinical_count: clinical trial / RCT 文献数
  - review_count:   review / meta-analysis 文献数
  - recent:         最新 8 篇（临床+综述优先检索，按日期倒序；pmid/title/journal/pubdate/pubtype）

用法：
  python3 scripts/build_disease_pubmed.py --start 0 --limit 22   # 切片
  python3 scripts/build_disease_pubmed.py --merge                # 合并 partial
（22 个疾病 × 3-4 次查询，单跑即可；保留切片模式以便失败重跑）
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
TOP_N = 20
# 试点疾病：slug -> 英文名兜底（iga-nephropathy 暂无本地疾病页，仍预取数据备报告 A 使用）
PILOTS = {"atopic-dermatitis": "atopic dermatitis", "iga-nephropathy": "IgA nephropathy"}

# 英文名 → PubMed 检索词微调（index.json 的 name_en 不够检索友好时覆盖）
TERM_OVERRIDE = {
    "hiv": "HIV infections[MeSH Terms]",
    "smoking-cessation": "smoking cessation[MeSH Terms]",
    "depression": "depressive disorder, major[MeSH Terms]",
    "gerd": "gastroesophageal reflux[MeSH Terms]",
}

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


def esearch_ids(term, retmax=8):
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
            "pubtype": item.get("pubtype", []),
        })
    return out


def disease_term(slug, name_en):
    if slug in TERM_OVERRIDE:
        base = TERM_OVERRIDE[slug]
    else:
        base = f'"{name_en}"[MeSH Terms] OR "{name_en}"[Title/Abstract]'
    return f"({base}) AND 2023:2026[dp]"


CLINICAL_PT = '("clinical trial"[pt] OR "randomized controlled trial"[pt])'
REVIEW_PT = '("review"[pt] OR "meta-analysis"[pt])'


def fetch_disease(slug, name_en):
    term = disease_term(slug, name_en)
    clinical = esearch_count(f"{term} AND {CLINICAL_PT}")
    review = esearch_count(f"{term} AND {REVIEW_PT}")
    # 最新文献：限临床+综述类型，按日期倒序取 8 篇
    recent = esummary(esearch_ids(f"{term} AND ({CLINICAL_PT} OR {REVIEW_PT})", retmax=8))
    return {
        "clinical_count": clinical,
        "review_count": review,
        "recent": recent,
    }


def select_diseases():
    idx = json.load(open(DATA / "diseases" / "index.json"))
    ranked = sorted(idx["diseases"], key=lambda x: -x["drug_count"])
    picked = {d["slug"]: d["name_en"] for d in ranked[:TOP_N]}
    by_slug = {d["slug"]: d["name_en"] for d in idx["diseases"]}
    for slug, fallback_name in PILOTS.items():
        if slug not in picked:
            picked[slug] = by_slug.get(slug, fallback_name)
    return picked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()

    if args.merge:
        merged = {}
        for f in sorted(glob.glob(str(DATA / "disease_pubmed.partial-*.json"))):
            part = json.load(open(f))
            merged.update(part["diseases"])
        out = {
            "generated_at": date.today().isoformat(),
            "diseases": merged,
        }
        out_path = DATA / "disease_pubmed.json"
        with open(out_path, "w") as fh:
            json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"merged {len(merged)} diseases -> {out_path} ({out_path.stat().st_size/1024:.0f} KB)")
        return

    picked = select_diseases()
    slugs = sorted(picked)
    print(f"目标疾病: {len(slugs)} 个（Top {TOP_N} by drug_count + 试点）; 切片 [{args.start}, {args.start + args.limit})")

    result = {}
    failed = []
    slice_slugs = slugs[args.start:args.start + args.limit]
    for i, slug in enumerate(slice_slugs, 1):
        name_en = picked[slug]
        print(f"[{i}/{len(slice_slugs)}] {slug} ({name_en})")
        entry = fetch_disease(slug, name_en)
        if entry["clinical_count"] is None and entry["review_count"] is None and not entry["recent"]:
            failed.append(slug)
        result[slug] = entry
        print(f"    clinical={entry['clinical_count']} review={entry['review_count']} recent={len(entry['recent'])}")

    out_path = DATA / f"disease_pubmed.partial-{args.start}.json"
    with open(out_path, "w") as fh:
        json.dump({"diseases": result}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"写出 {out_path} ({len(result)} 条)")
    if failed:
        print(f"失败疾病（需重跑）: {failed}")


if __name__ == "__main__":
    main()
