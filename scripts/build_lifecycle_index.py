#!/usr/bin/env python3
"""Build public/data/lifecycle_index.json — 药品生命周期计算引擎.

Aggregates products.json by active_ingredient, classifies each ingredient
into a lifecycle stage (引入期/成长期/成熟期/衰退期/仿制成熟期), extracts
PLCM (product lifecycle management) signals, and emits patent-expiry alerts.

Run from repo root:  python3 scripts/build_lifecycle_index.py
"""

import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "public" / "data"
TODAY = date(2026, 7, 22)  # 固定的“今天”
MAX_PLCM = 10

# marketing_status 值视为“仍在市”的状态
ACTIVE_STATUSES = {"Prescription", "Over-the-counter", "None (Tentative Approval)"}
ON_MARKET_STATUSES = {"Prescription", "Over-the-counter"}


def load(name):
    with open(DATA / name) as f:
        return json.load(f)


def parse_date(s):
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def months_between(d1, d2):
    """d2 - d1 的整月数（负数表示 d1 已过）。"""
    return (d2.year - d1.year) * 12 + (d2.month - d1.month)


def main():
    products = load("products.json")
    details = load("details.json")
    patent_cliff = load("patent_cliff.json")
    withdrawn = load("withdrawn.json")
    supply = load("supply_risk.json")

    f = products["fields"]
    idx = {name: i for i, name in enumerate(f)}

    # ---------- 外部索引 ----------
    withdrawn_ings = set()
    for item in withdrawn.get("top_ingredients", []):
        withdrawn_ings.add(item["ingredient"].upper())
    for item in withdrawn.get("recent", []):
        if item.get("ingredient"):
            withdrawn_ings.add(item["ingredient"].upper())

    patent_map = {}  # ingredient -> {earliest, latest}
    for item in patent_cliff.get("patent_cliff", []):
        patent_map[item["ingredient"].upper()] = (
            item.get("earliest_expiry"),
            item.get("latest_expiry"),
        )
    excl_map = {}  # ingredient -> earliest exclusivity expiry
    for item in patent_cliff.get("exclusivity_cliff", []):
        excl_map[item["ingredient"].upper()] = item.get("expiry")

    shortage_map = {}  # ingredient -> high/medium/watch
    for level in ("high", "medium", "watch"):
        for item in supply.get(level, []):
            ing = (item.get("ingredient") or "").upper()
            if ing and ing not in shortage_map:
                shortage_map[ing] = level

    # ---------- 按成分聚合 products ----------
    ing_data = defaultdict(lambda: {
        "nda": [], "anda": [], "bla": [],
        "statuses": set(),
        "forms": {},      # form -> earliest approval date
        "strengths": {},  # strength -> earliest approval date
        "app_numbers": set(),
    })

    for row in products["rows"]:
        ing = (row[idx["active_ingredient"]] or "").strip().upper()
        if not ing:
            continue
        rec = ing_data[ing]
        appl_type = row[idx["appl_type"]]
        adate = parse_date(row[idx["approval_date"]])
        sponsor = row[idx["sponsor_name"]] or ""
        status = row[idx["marketing_status"]] or ""
        rec["statuses"].add(status)
        rec["app_numbers"].add(row[idx["application_number"]])
        entry = (adate, sponsor, row[idx["application_number"]])
        if appl_type in ("NDA", "BLA"):
            rec[appl_type.lower()].append(entry)
        elif appl_type == "ANDA":
            rec["anda"].append(entry)
        form = row[idx["form"]] or ""
        strength = row[idx["strength"]] or ""
        if form and adate:
            if form not in rec["forms"] or adate < rec["forms"][form]:
                rec["forms"][form] = adate
        if strength and adate:
            if strength not in rec["strengths"] or adate < rec["strengths"][strength]:
                rec["strengths"][strength] = adate

    # ---------- 逐成分判定 ----------
    records = {}
    stage_counts = Counter()
    expiring_24m = []
    plcm_total = 0

    for ing, rec in ing_data.items():
        originators = rec["nda"] + rec["bla"]
        originators_dated = [e for e in originators if e[0]]
        first_approval = min((e[0] for e in originators_dated), default=None)
        originator = None
        if originators_dated:
            originator = min(originators_dated, key=lambda e: e[0])[1] or None

        anda_dated = [e for e in rec["anda"] if e[0]]
        n_anda = len(rec["anda"])
        anda_companies = {e[1] for e in rec["anda"] if e[1]}
        # ANDA 竞争者：获批的 ANDA（暂定批准不算竞争者上市，但算作竞争信号；
        # 这里按获批 ANDA 申请数统计）
        n_anda_approved = len(anda_dated)

        pat = patent_map.get(ing)
        pat_earliest = pat[0] if pat else None
        pat_latest = pat[1] if pat else None
        # 独占期也视作保护期参考
        excl_expiry = excl_map.get(ing)

        # months_to_expiry：优先专利最早到期，否则独占期
        expiry_ref = parse_date(pat_earliest) or parse_date(excl_expiry)
        months_to_expiry = months_between(expiry_ref, TODAY) if expiry_ref else None
        patent_expired = bool(expiry_ref and expiry_ref <= TODAY)

        is_withdrawn = ing in withdrawn_ings
        all_off_market = bool(rec["statuses"]) and not (rec["statuses"] & ON_MARKET_STATUSES)

        # ---- 阶段判定 ----
        if not originators:
            stage = "仿制成熟期"
        elif is_withdrawn or (patent_expired and n_anda_approved >= 1) or all_off_market:
            stage = "衰退期"
        else:
            age_years = (TODAY - first_approval).days / 365.25 if first_approval else 99
            if age_years >= 7:
                stage = "成熟期"
            elif age_years >= 2 and n_anda_approved == 0:
                stage = "成长期"
            elif age_years < 2:
                stage = "引入期"
            else:
                # 2-7 年但已有 ANDA 竞争者 -> 按成熟期处理
                stage = "成熟期"
        stage_counts[stage] += 1

        # ---- PLCM 动作 ----
        plcm = []
        seen = set()
        # 1) 新 EFFICACY 补充（拓适应症），仅看原研申请
        orig_apps = {e[2] for e in originators}
        for app in orig_apps:
            for sub in details.get("records", {}).get(app, {}).get("submissions", []):
                if len(sub) >= 5 and sub[4] == "EFFICACY" and sub[2] == "AP":
                    d = parse_date(sub[3])
                    if d:
                        key = ("新适应症", d.year)
                        if key not in seen:
                            seen.add(key)
                            plcm.append({
                                "type": "新适应症", "year": d.year,
                                "note": f"{app} EFFICACY 补充获批（{sub[3]}）",
                            })
        # 2) 新剂型 / 新规格：同成分不同 form/strength 的首获批年（排除首年）
        base_year = first_approval.year if first_approval else None
        for form, d in sorted(rec["forms"].items(), key=lambda kv: kv[1]):
            if base_year and d.year > base_year:
                key = ("新剂型", form)
                if key not in seen:
                    seen.add(key)
                    plcm.append({"type": "新剂型", "year": d.year, "note": f"新剂型 {form}（{d.isoformat()}）"})
        for strength, d in sorted(rec["strengths"].items(), key=lambda kv: kv[1]):
            if base_year and d.year > base_year:
                key = ("新规格", strength)
                if key not in seen:
                    seen.add(key)
                    plcm.append({"type": "新规格", "year": d.year, "note": f"新规格 {strength}（{d.isoformat()}）"})
        plcm.sort(key=lambda x: x["year"])
        plcm = plcm[:MAX_PLCM]
        plcm_total += len(plcm)

        record = {
            "ingredient": ing,
            "stage": stage,
            "first_approval": first_approval.isoformat() if first_approval else None,
            "originator": originator,
            "n_nda": len(rec["nda"]) + len(rec["bla"]),
            "n_anda": n_anda,
            "n_anda_companies": len(anda_companies),
            "patent_earliest_expiry": pat_earliest,
            "patent_latest_expiry": pat_latest,
            "months_to_expiry": months_to_expiry,
            "withdrawn": is_withdrawn,
            "shortage_risk": shortage_map.get(ing),
            "plcm_actions": plcm,
        }
        records[ing] = record

    # months_to_expiry 符号约定：正数 = 剩余月数，负数 = 已过期
    for ing, record in records.items():
        ref = parse_date(record["patent_earliest_expiry"]) or parse_date(excl_map.get(ing))
        if ref:
            record["months_to_expiry"] = months_between(TODAY, ref)

    expiring_24m = []
    for ing, record in records.items():
        m = record["months_to_expiry"]
        if m is not None and 0 <= m <= 24:
            ref = parse_date(record["patent_earliest_expiry"]) or parse_date(excl_map.get(ing))
            expiring_24m.append({
                "ingredient": ing,
                "expiry": ref.isoformat(),
                "months_to_expiry": m,
                "stage": record["stage"],
                "n_anda": record["n_anda"],
            })
    expiring_24m.sort(key=lambda x: x["expiry"])

    out = {
        "generated_at": TODAY.isoformat(),
        "total_ingredients": len(records),
        "stage_counts": dict(stage_counts),
        "alerts": {"expiring_24m": expiring_24m},
        "records": records,
    }
    out_path = DATA / "lifecycle_index.json"
    with open(out_path, "w") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    # ---------- 统计摘要 ----------
    print("=== 生命周期索引构建完成 ===")
    print(f"成分总数: {len(records)}")
    print("阶段分布:")
    for stage, n in stage_counts.most_common():
        print(f"  {stage}: {n}")
    print(f"24 个月到期预警成分数: {len(expiring_24m)}")
    print("预警 Top 20（按到期日升序）:")
    for item in expiring_24m[:20]:
        print(f"  {item['expiry']}  {item['ingredient'][:50]:<50} 剩 {item['months_to_expiry']} 月  {item['stage']}  ANDA={item['n_anda']}")
    print(f"PLCM 动作总数: {plcm_total}")
    print(f"输出: {out_path} ({out_path.stat().st_size/1024:.0f} KB)")

    # ---------- 抽查 ----------
    print("\n=== 抽查 ===")
    for probe in ("CARFILZOMIB", "ADALIMUMAB", "EMPAGLIFLOZIN"):
        r = records.get(probe)
        if not r:
            print(f"{probe}: 未找到")
            continue
        print(json.dumps({k: v for k, v in r.items() if k != "plcm_actions"}, ensure_ascii=False, indent=2))
        print(f"  plcm_actions({len(r['plcm_actions'])}):",
              [(a["type"], a["year"]) for a in r["plcm_actions"]])


if __name__ == "__main__":
    main()
