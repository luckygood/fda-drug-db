#!/usr/bin/env python3
"""Build public/data/global_access.json — 全球可及性专题一期：FDA×EMA 批准对齐.

范围：2020-01-01 至今有 ≥1 个 FDA 原始 NDA/BLA 获批的活性成分（不含 ANDA）。

EMA 数据源（官方 JSON 端点，每日更新）：
  https://www.ema.europa.eu/en/documents/report/medicines-output-medicines_json-report_en.json
  （xlsx 版本有 Akamai 反爬，JSON 端点可直接下载；需带浏览器 UA）

匹配策略（逐成分，Human 类别）：
  1. exact      FDA 成分名（UPCASE）== EMA active_substance / INN（UPCASE）
  2. normalized 去盐基后缀（HYDROCHLORIDE/SODIUM/…）后比较；复方按 ';' 拆分与 EMA '/' 拆分排序比较
  3. unmatched  其余

用法: python3 scripts/build_global_access.py [--ema-file /tmp/ema_medicines.json]
"""

import argparse
import json
import re
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"
EMA_URL = "https://www.ema.europa.eu/en/documents/report/medicines-output-medicines_json-report_en.json"
EMA_CACHE = Path("/tmp/ema_medicines.json")
CUTOFF = "2020-01-01"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

SALT_TOKENS = {
    "HYDROCHLORIDE", "DIHYDROCHLORIDE", "HYDROBROMIDE", "MESILATE", "MESYLATE",
    "SODIUM", "POTASSIUM", "CALCIUM", "MAGNESIUM", "SULFATE", "SULPHATE",
    "TARTRATE", "BITARTRATE", "PHOSPHATE", "DIPHOSPHATE", "ACETATE", "MALEATE",
    "SUCCINATE", "BESILATE", "BESYLATE", "TOSILATE", "TOSYLATE", "CITRATE",
    "NITRATE", "OXALATE", "LACTATE", "FUMARATE", "PAMOATE", "PALMITATE",
    "HEMIHYDRATE", "MONOHYDRATE", "DIHYDRATE", "TRIHYDRATE", "HYDRATE",
    "ANHYDROUS", "MICRONIZED", "FREE", "BASE", "ACID",
}

# EMA 状态归一
STATUS_MAP = {
    "Authorised": "authorised",
    "Withdrawn": "withdrawn",
    "Revoked": "withdrawn",
    "Suspended": "withdrawn",
    "Expired": "withdrawn",
    "Lapsed": "withdrawn",
    "Refused": "refused",
    "Application withdrawn": "application_withdrawn",
    "Opinion": "opinion",
    "Opinion under re-examination": "opinion",
    "Withdrawn from rolling review": "application_withdrawn",
}


def download_ema(path):
    req = urllib.request.Request(EMA_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=240) as resp:
        path.write_bytes(resp.read())


def strip_salts(name):
    toks = [t for t in name.split() if t.strip(";,.") not in SALT_TOKENS]
    return " ".join(toks)


def split_combo(name):
    """复方拆分：FDA 用 ';'，EMA 用 ';'/'/'/'+'；去掉 "(as sulfate)" 修饰，返回排序后的元组。"""
    name = re.sub(r"\([^)]*\)", " ", name)
    parts = re.split(r"[;/+]", name)
    return tuple(sorted(p.strip() for p in parts if p.strip()))


def combo_key(name):
    """复方匹配键：先拆分，逐段去盐基，排序后 join；单成分返回 None。"""
    parts = split_combo(name.upper())
    parts = [p for p in (strip_salts(p).strip() for p in parts) if p]
    if len(parts) <= 1:
        return None
    return "|".join(sorted(parts))


def norm_keys(name):
    """为一个名字生成匹配键集合（原名 + 去盐基）。"""
    name = re.sub(r"\([^)]*\)", " ", name)
    u = re.sub(r"\s+", " ", name.strip().upper())
    keys = {u}
    stripped = strip_salts(u)
    if stripped != u:
        keys.add(stripped)
    return keys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ema-file", default=str(EMA_CACHE))
    args = ap.parse_args()

    ema_path = Path(args.ema_file)
    if not ema_path.exists():
        print(f"下载 EMA 数据 -> {ema_path}")
        download_ema(ema_path)
    ema = json.load(open(ema_path))
    print(f"EMA 记录: {ema['meta']['total_records']} (timestamp {ema['meta']['timestamp']})")

    # ---------- 目标成分：2020+ FDA 原始 NDA/BLA ----------
    products = json.load(open(DATA / "products.json"))
    idx = {n: i for i, n in enumerate(products["fields"])}
    target = {}  # ing -> earliest NDA/BLA date >= cutoff
    for row in products["rows"]:
        if row[idx["appl_type"]] not in ("NDA", "BLA"):
            continue
        d = row[idx["approval_date"]] or ""
        if d < CUTOFF:
            continue
        ing = (row[idx["active_ingredient"]] or "").strip().upper()
        if not ing:
            continue
        if ing not in target or d < target[ing]:
            target[ing] = d
    print(f"目标成分（2020+ FDA NDA/BLA）: {len(target)}")

    # ---------- EMA 索引：匹配键 -> 记录 ----------
    ema_by_key = defaultdict(list)   # key -> [records]
    for r in ema["data"]:
        if r.get("category") != "Human":
            continue
        names = [r.get("active_substance") or "", r.get("international_non_proprietary_name_common_name") or ""]
        for name in names:
            if not name:
                continue
            for k in norm_keys(name):
                ema_by_key[k].append(r)
            # 复方键：拆分后逐段去盐基再 join
            ck = combo_key(name)
            if ck:
                ema_by_key[ck].append(r)

    # ---------- 匹配 ----------
    records = {}
    stats = {"authorised": 0, "withdrawn": 0, "refused": 0, "other": 0, "unmatched": 0}
    matched_samples, unmatched = [], []

    for ing in sorted(target):
        keys = norm_keys(ing)
        ck = combo_key(ing)
        if ck:
            keys.add(ck)

        hits = []
        match_type = "unmatched"
        for k in keys:
            if k in ema_by_key:
                hits = ema_by_key[k]
                match_type = "exact" if k == ing else "normalized"
                break

        if not hits:
            records[ing] = {
                "ema_status": None, "ema_first_date": None,
                "ema_product": None, "match_type": "unmatched",
            }
            stats["unmatched"] += 1
            unmatched.append(ing)
            continue

        # 去重（一个产品可能因多个键重复命中），按产品号
        seen = {}
        for r in hits:
            seen[r["ema_product_number"]] = r
        hits = list(seen.values())

        # 优先已授权产品；首批准日取所有命中产品最早的 MA 日期
        norm_status = [STATUS_MAP.get(r.get("medicine_status", ""), "other") for r in hits]
        if "authorised" in norm_status:
            overall = "authorised"
            pool = [r for r in hits if STATUS_MAP.get(r.get("medicine_status", ""), "other") == "authorised"]
        elif "withdrawn" in norm_status:
            overall = "withdrawn"
            pool = [r for r in hits if STATUS_MAP.get(r.get("medicine_status", ""), "other") == "withdrawn"]
        elif "refused" in norm_status:
            overall = "refused"
            pool = hits
        else:
            overall = "other"
            pool = hits

        def iso(d):
            m = re.match(r"(\d{2})/(\d{2})/(\d{4})", d or "")
            return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else (d or "")

        # EMA 日期为 DD/MM/YYYY，先归一为 ISO 再取最早
        dates = [iso(r.get("marketing_authorisation_date")) for r in pool]
        dates = [d for d in dates if d]
        first_date = min(dates) if dates else None
        product = pool[0]["name_of_medicine"]

        records[ing] = {
            "ema_status": overall,
            "ema_first_date": first_date,
            "ema_product": product,
            "match_type": match_type,
        }
        stats[overall] = stats.get(overall, 0) + 1
        if len(matched_samples) < 5:
            matched_samples.append((ing, overall, first_date, product, match_type))

    out = {
        "generated_at": date.today().isoformat(),
        "scope": "fda_nda_2020plus",
        "ema_source_url": EMA_URL,
        "ema_timestamp": ema["meta"]["timestamp"],
        "stats": {"total": len(target), **stats},
        "records": records,
    }
    out_path = DATA / "global_access.json"
    with open(out_path, "w") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"\n=== 匹配统计 ===")
    print(f"总数: {len(target)}")
    for k in ("authorised", "withdrawn", "refused", "other", "unmatched"):
        print(f"  {k}: {stats.get(k, 0)}")
    print(f"输出: {out_path} ({out_path.stat().st_size/1024:.0f} KB)")
    print("\n匹配样例（前 5）:")
    for s in matched_samples:
        print(f"  {s[0][:45]:<45} {s[1]:<10} {s[2]} {s[3]} ({s[4]})")
    print("\n未匹配样例（前 15，人工核查）:")
    for ing in unmatched[:15]:
        print(f"  {ing}")


if __name__ == "__main__":
    main()
