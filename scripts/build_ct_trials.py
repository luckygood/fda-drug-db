#!/usr/bin/env python3
"""ClinicalTrials.gov API v2 集成：疾病 / 成分两维度的在研管线计量（P2）.

每个实体一组确定性查询：
- total：AREA 过滤 + countTotal
- by_phase：EARLY_PHASE1/PHASE1..PHASE4 逐个计数
- by_status（仅疾病维度）：6 个主要状态逐个计数
- top：按最近更新排序取前 N 条（NCTId/标题/阶段/状态/申办方/日期/样本量）

用法：
  python3 scripts/build_ct_trials.py --dim disease --start 0 --limit 40
  python3 scripts/build_ct_trials.py --dim ingredient --start 0 --limit 70
  python3 scripts/build_ct_trials.py --dim disease --merge
  python3 scripts/build_ct_trials.py --dim ingredient --merge

查询失败标记 error:true（缺失 ≠ 0，前端三态诚实口径）。
原始响应缓存到 scripts/.cache/ct/（sha1(url)），中断可续跑。
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

API = "https://clinicaltrials.gov/api/v2/studies"
SLEEP = 0.32
MAX_RETRY = 4
CACHE = Path(__file__).resolve().parent / ".cache" / "ct"

PHASES = ["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4"]
STATUSES = [
    "RECRUITING", "NOT_YET_RECRUITING", "ACTIVE_NOT_RECRUITING",
    "COMPLETED", "TERMINATED", "WITHDRAWN",
]
TOP_FIELDS = (
    "NCTId,BriefTitle,Phase,OverallStatus,LeadSponsorName,"
    "StartDate,CompletionDate,EnrollmentCount"
)

# 疾病 slug → CT 检索词微调（沿用 disease_pubmed 的覆盖思路，但 CT 用自然语言词）
CT_TERM_OVERRIDE = {
    "hiv": "HIV",
    "smoking-cessation": "smoking cessation",
    "depression": "major depressive disorder",
    "gerd": "gastroesophageal reflux disease",
}

WINDOW_NOTE = (
    "ClinicalTrials.gov API v2 全库计量（不限时间窗）；ConditionSearch 含同义词扩展，"
    "InterventionName 为干预名文本匹配（含对照组提及），计数偏宽；"
    "top 列表按最近更新排序。"
)

_last_request = 0.0


def ct_get(params):
    """GET /api/v2/studies，带缓存 + 限速 + 429/5xx 退避。失败返回 None。"""
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
            req = urllib.request.Request(url, headers={"User-Agent": "fda-drug-db/ct-sync"})
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            cache_file.write_text(json.dumps(data, ensure_ascii=False))
            return data
        except urllib.error.HTTPError as e:
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


def count_query(term):
    r = ct_get({"query.term": term, "countTotal": "true", "pageSize": 1, "fields": "NCTId"})
    if r is None:
        return None
    return int(r.get("totalCount", 0))


def top_query(term, n):
    r = ct_get({
        "query.term": term, "pageSize": n,
        "sort": "LastUpdatePostDate:desc", "fields": TOP_FIELDS,
    })
    if r is None:
        return []
    out = []
    for s in r.get("studies", []):
        ps = s.get("protocolSection", {})
        idm = ps.get("identificationModule", {})
        stm = ps.get("statusModule", {})
        spm = ps.get("sponsorCollaboratorsModule", {})
        dsm = ps.get("designModule", {})
        phases = dsm.get("phases") or []
        out.append({
            "nctId": idm.get("nctId", ""),
            "title": (idm.get("briefTitle") or "").strip(),
            "phase": phases[0] if phases else None,
            "status": stm.get("overallStatus"),
            "sponsor": (spm.get("leadSponsor") or {}).get("name"),
            "startDate": (stm.get("startDateStruct") or {}).get("date"),
            "completionDate": (stm.get("completionDateStruct") or {}).get("date"),
            "enrollment": (dsm.get("enrollmentInfo") or {}).get("count"),
        })
    return out


def fetch_entity(term, top_n, with_status):
    entry = {}
    total = count_query(term)
    if total is None:
        return {"error": True}
    entry["total"] = total
    by_phase = {}
    for p in PHASES:
        c = count_query(f"{term} AND AREA[Phase]{p}")
        if c is None:
            entry["error"] = True
            break
        if c:
            by_phase[p] = c
    entry["by_phase"] = by_phase
    if with_status:
        by_status = {}
        for st in STATUSES:
            c = count_query(f"{term} AND AREA[OverallStatus]{st}")
            if c is None:
                entry["error"] = True
                break
            if c:
                by_status[st] = c
        entry["by_status"] = by_status
    entry["top"] = top_query(term, top_n)
    return entry


# ---------- 实体清单与检索词 ----------

def disease_targets():
    idx = json.loads((DATA / "diseases" / "index.json").read_text())
    out = []
    for d in idx["diseases"]:
        slug, name_en = d["slug"], d["name_en"]
        term_text = CT_TERM_OVERRIDE.get(slug, name_en)
        out.append((slug, f'AREA[ConditionSearch]({term_text})'))
    return out


def ingredient_targets():
    ga = json.loads((DATA / "global_access.json").read_text())
    out = []
    for ing in sorted(ga["records"]):
        keys = set()
        for k in norm_keys(ing):
            kk = strip_salts(k).strip()
            if kk:
                keys.add(kk)
            if len(keys) >= 4:
                break
        if not keys:
            keys = {ing}
        # 复方：按成分 OR；单方：按归一化变体 OR
        if ";" in ing:
            parts = [strip_salts(p.strip()).strip() for p in ing.split(";") if p.strip()]
            quoted = " OR ".join(f'"{p}"' for p in parts)
        else:
            quoted = " OR ".join(f'"{k}"' for k in sorted(keys)[:4])
        out.append((ing, f"AREA[InterventionName]({quoted})"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dim", choices=["disease", "ingredient"], required=True)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()

    name = f"ct_{args.dim}"
    targets = disease_targets() if args.dim == "disease" else ingredient_targets()
    print(f"{args.dim}: {len(targets)} 个实体")

    if args.merge:
        merged = {}
        for part in sorted(DATA.glob(f"{name}.partial-*.json")):
            merged.update(json.loads(part.read_text()))
        n_err = sum(1 for v in merged.values() if v.get("error"))
        n_hit = sum(1 for v in merged.values() if not v.get("error") and v.get("total", 0) > 0)
        print(f"合并 {len(merged)} 条：命中(≥1 试验) {n_hit}，失败 {n_err}")
        key = "diseases" if args.dim == "disease" else "ingredients"
        write_dataset(name, {
            "scope": "ClinicalTrials.gov API v2 在研管线计量",
            "window_note": WINDOW_NOTE,
            key: dict(sorted(merged.items())),
        })
        for part in DATA.glob(f"{name}.partial-*.json"):
            part.unlink()
        print(f"已写出 public/data/{name}.json")
        return

    slice_targets = targets[args.start:args.start + args.limit]
    if not slice_targets:
        print("切片为空，退出")
        return
    top_n = 10 if args.dim == "disease" else 5
    with_status = args.dim == "disease"
    results = {}
    part = DATA / f"{name}.partial-{args.start}.json"
    for i, (key, term) in enumerate(slice_targets, 1):
        print(f"[{i}/{len(slice_targets)}] {key}")
        results[key] = fetch_entity(term, top_n, with_status)
        part.write_text(json.dumps(results, ensure_ascii=False, separators=(",", ":")))  # 增量落盘
    print(f"已写出 {part.name}（{len(results)} 条）")


if __name__ == "__main__":
    main()
