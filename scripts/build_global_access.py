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

# USAN → INN 命名差异映射（仅收录确信的 1:1 对应）
USAN_TO_INN = {
    "ACETAMINOPHEN": "PARACETAMOL",
    "EPINEPHRINE": "ADRENALINE",
    "NOREPINEPHRINE": "NORADRENALINE",
    "ALBUTEROL": "SALBUTAMOL",
    "ISOPROTERENOL": "ISOPRENALINE",
    "MEPERIDINE": "PETHIDINE",
    "RIFAMPIN": "RIFAMPICIN",
    "TETRACAINE": "AMETHOCAINE",
    "PHENOBARBITAL": "PHENOBARBITONE",
    "AMPHETAMINE": "AMFETAMINE",
    "CYCLOSPORINE": "CICLOSPORIN",
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
    """为一个名字生成匹配键集合（原名 + 去盐基 + 美版生物类似药四字母后缀剥离 + USAN→INN）。"""
    name = re.sub(r"\([^)]*\)", " ", name)
    u = re.sub(r"\s+", " ", name.strip().upper())
    keys = {u}
    stripped = strip_salts(u)
    if stripped != u:
        keys.add(stripped)
    # 美国生物类似药后缀（ADALIMUMAB-AACF → ADALIMUMAB），便于命中 EMA 参比制剂
    for k in list(keys):
        base = re.sub(r"-[A-Z]{4}$", "", k)
        if base != k and len(base) > 4:
            keys.add(base)
    # USAN → INN 全名映射
    for k in list(keys):
        inn = USAN_TO_INN.get(k)
        if inn:
            keys.add(inn)
    return keys


# ---------- PMDA（日本）解析 ----------

PMDA_URL = "https://www.pmda.go.jp/files/000281190.pdf"
PMDA_PAGE_URL = "https://www.pmda.go.jp/english/review-services/reviews/approved-information/drugs/0002.html"
PMDA_CACHE = Path("/tmp/pmda_approved.pdf")

_PMDA_DATE = re.compile(r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.? \d{1,2}, \d{4})")
_PMDA_NOTE_CUT = re.compile(
    r"(A drug|Drugs with|A fixed|A new|An (?:anti|HIV|oral)|For the treatment|\[Orphan|\(\d+\) A drug)")
_PMDA_MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def download_pmda(path):
    req = urllib.request.Request(PMDA_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=240) as resp:
        path.write_bytes(resp.read())


def _pmda_iso(date_str):
    m = re.match(r"([A-Za-z]{3})\.? (\d{1,2}), (\d{4})", date_str)
    if not m:
        return None
    mon = _PMDA_MONTHS.get(m.group(1))
    if not mon:
        return None
    return f"{m.group(3)}-{mon:02d}-{int(m.group(2)):02d}"


def load_pmda(path):
    """解析 PMDA《List of Approved Drugs》PDF，返回 {匹配键: {date, ingredient}}。

    文本结构：每个月度小节内，每条记录为
    `<类别> <日期> <序号> <品牌名(企业)> <Approval/Change>+ <活性成分> <备注>`。
    活性成分区域 = 最后一个 Approval/Change 标记之后、备注起始词之前。
    """
    from pypdf import PdfReader  # 托管运行时自带

    if not path.exists():
        print(f"下载 PMDA 数据 -> {path}")
        download_pmda(path)
    reader = PdfReader(str(path))
    text = "\n".join((p.extract_text() or "") for p in reader.pages)

    hits = {}  # key -> {"date": iso, "ingredient": raw}
    marks = list(_PMDA_DATE.finditer(text))
    for i, m in enumerate(marks):
        block_end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        block = text[m.start():block_end]
        iso = _pmda_iso(m.group(1))
        if not iso:
            continue
        # 活性成分区域：最后一个 Approval/Change 之后
        seps = list(re.finditer(r"\b(?:Approval|Change)\b", block))
        if not seps:
            continue
        region = block[seps[-1].end():]
        cut = _PMDA_NOTE_CUT.search(region)
        if cut:
            region = region[:cut.start()]
        ing = re.sub(r"\s+", " ", region).strip(" .;,")
        ing = re.sub(r"\(genetical recombination\)", "", ing, flags=re.I).strip(" .;,")
        if not ing or len(ing) < 3 or len(ing) > 200:
            continue
        for key in norm_keys(ing):
            ck = combo_key(key)
            for k in ([key] + ([ck] if ck else [])):
                cur = hits.get(k)
                if not cur or iso < cur["date"]:
                    hits[k] = {"date": iso, "ingredient": ing}
    return hits, len(reader.pages)


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

    # ---------- PMDA 索引 ----------
    pmda_hits, pmda_pages = load_pmda(PMDA_CACHE)
    print(f"PMDA 记录: {len(pmda_hits)} 个匹配键（PDF {pmda_pages} 页）")

    # ---------- 匹配 ----------
    records = {}
    stats = {"authorised": 0, "withdrawn": 0, "refused": 0, "other": 0, "unmatched": 0,
             "pmda_approved": 0, "pmda_not_found": 0}
    matched_samples, unmatched = [], []

    for ing in sorted(target):
        keys = norm_keys(ing)
        ck = combo_key(ing)
        if ck:
            keys.add(ck)

        # PMDA 匹配（无论 EMA 是否命中都执行）
        pmda_status, pmda_first = "not_found", None
        for k in keys:
            if k in pmda_hits:
                pmda_status, pmda_first = "approved", pmda_hits[k]["date"]
                break
        stats["pmda_approved" if pmda_status == "approved" else "pmda_not_found"] += 1

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
                "pmda_status": pmda_status, "pmda_first_date": pmda_first,
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
            "pmda_status": pmda_status,
            "pmda_first_date": pmda_first,
        }
        stats[overall] = stats.get(overall, 0) + 1
        if len(matched_samples) < 5:
            matched_samples.append((ing, overall, first_date, product, match_type))

    out = {
        "generated_at": date.today().isoformat(),
        "scope": "fda_nda_2020plus",
        "ema_source_url": EMA_URL,
        "ema_timestamp": ema["meta"]["timestamp"],
        "pmda_source_url": PMDA_URL,
        "pmda_page_url": PMDA_PAGE_URL,
        "stats": {"total": len(target), **stats},
        "records": records,
    }
    out_path = DATA / "global_access.json"
    with open(out_path, "w") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"\n=== 匹配统计 ===")
    print(f"总数: {len(target)}")
    for k in ("authorised", "withdrawn", "refused", "other", "unmatched"):
        print(f"  EMA {k}: {stats.get(k, 0)}")
    print(f"  PMDA 已获批: {stats['pmda_approved']}  未收录: {stats['pmda_not_found']}")
    print(f"输出: {out_path} ({out_path.stat().st_size/1024:.0f} KB)")
    print("\n匹配样例（前 5）:")
    for s in matched_samples:
        print(f"  {s[0][:45]:<45} {s[1]:<10} {s[2]} {s[3]} ({s[4]})")
    print("\n未匹配样例（前 15，人工核查）:")
    for ing in unmatched[:15]:
        print(f"  {ing}")


if __name__ == "__main__":
    main()
