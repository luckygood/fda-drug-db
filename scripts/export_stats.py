#!/usr/bin/env python3
"""Export pre-aggregated stats from fda_drugs.db to stats.json for the Insights page."""
import json
import os
import re
import sqlite3
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "fda_drugs.db")
OUT = os.path.join(BASE, "fda-drug-web", "public", "data", "stats.json")

START_YEAR = 1995
CURRENT_YEAR = 2026

# 持证商名称归一化：去尾部公司后缀
SUFFIX_RE = re.compile(
    r"\b(LTD|LIMITED|INC|LLC|CORP|CORPORATION|CO|COMPANY|USA|US|PHARMS|"
    r"PHARMACEUTICALS|PHARMACEUTICAL|PHARMA|LABORATORIES|LABS|HOLDINGS|"
    r"GROUP|AG|GMBH|SA|PLC|LLP|LP)\b\.?,?\s*$",
    re.IGNORECASE,
)


def normalize_sponsor(name: str) -> str:
    n = (name or "").strip().upper()
    n = re.sub(r"[.,;]+$", "", n)
    for _ in range(3):  # 反复剥尾部后缀，如 "ABC PHARMACEUTICALS INC"
        new = SUFFIX_RE.sub("", n).strip().rstrip(".,;").strip()
        if new == n:
            break
        n = new
    return n.title() if n else "未知"


def main():
    conn = sqlite3.connect(DB)
    stats = {}

    # 1) 每年各类型 COUNT(DISTINCT appl_no)
    rows = conn.execute(
        """
        SELECT substr(approval_date, 1, 4) AS yr, appl_type, COUNT(DISTINCT appl_no)
        FROM applications
        WHERE approval_date IS NOT NULL AND CAST(substr(approval_date, 1, 4) AS INTEGER) >= ?
        GROUP BY yr, appl_type
        """
        , (START_YEAR,),
    ).fetchall()
    yearly = defaultdict(lambda: {"NDA": 0, "ANDA": 0, "BLA": 0})
    for yr, t, c in rows:
        if t in ("NDA", "ANDA", "BLA"):
            yearly[yr][t] = c
    years = sorted(yearly)
    stats["yearly_by_type"] = {
        "years": years,
        "NDA": [yearly[y]["NDA"] for y in years],
        "ANDA": [yearly[y]["ANDA"] for y in years],
        "BLA": [yearly[y]["BLA"] for y in years],
        "incomplete_year": str(CURRENT_YEAR),
    }

    # 2) 每年 NME（Type 1 新分子实体）
    rows = conn.execute(
        """
        SELECT substr(status_date, 1, 4) AS yr, COUNT(DISTINCT appl_no)
        FROM submissions
        WHERE submission_type = 'ORIG' AND submission_status = 'AP'
          AND submission_class LIKE 'Type 1%'
          AND CAST(substr(status_date, 1, 4) AS INTEGER) >= ?
        GROUP BY yr
        """
        , (START_YEAR,),
    ).fetchall()
    nme = {yr: c for yr, c in rows}
    nme_years = sorted(nme)
    stats["nme_by_year"] = {
        "years": nme_years,
        "counts": [nme[y] for y in nme_years],
    }

    # 3) 近 15 年优先审评数量与占比（ORIG + AP）
    rows = conn.execute(
        """
        SELECT substr(status_date, 1, 4) AS yr,
               COUNT(*) AS total,
               SUM(CASE WHEN review_priority = 'PRIORITY' THEN 1 ELSE 0 END) AS pri
        FROM submissions
        WHERE submission_type = 'ORIG' AND submission_status = 'AP'
          AND CAST(substr(status_date, 1, 4) AS INTEGER) >= ?
        GROUP BY yr
        """
        , (CURRENT_YEAR - 14,),
    ).fetchall()
    pri_years = sorted(r[0] for r in rows)
    d = {r[0]: (r[1], r[2] or 0) for r in rows}
    stats["priority_by_year"] = {
        "years": pri_years,
        "total": [d[y][0] for y in pri_years],
        "priority": [d[y][1] for y in pri_years],
        "ratio": [round(d[y][1] / d[y][0], 4) if d[y][0] else 0 for y in pri_years],
    }

    # 4) 在售产品数 Top 15 持证商（归一化合并）
    rows = conn.execute(
        """
        SELECT sponsor_name, COUNT(DISTINCT a.appl_no || '|' || p.id)
        FROM products p JOIN applications a ON a.appl_no = p.appl_no
        WHERE p.marketing_status_id IN (1, 2)
        GROUP BY sponsor_name
        """
    ).fetchall()
    merged = defaultdict(int)
    for name, c in rows:
        merged[normalize_sponsor(name)] += c
    top = sorted(merged.items(), key=lambda kv: kv[1], reverse=True)[:15]
    stats["top_sponsors"] = {"names": [t[0] for t in top], "counts": [t[1] for t in top]}

    # 5) 在售 ANDA 竞争最激烈成分 Top 15
    rows = conn.execute(
        """
        SELECT UPPER(TRIM(p.active_ingredient)) AS ing, COUNT(DISTINCT p.appl_no) AS c
        FROM products p JOIN applications a ON a.appl_no = p.appl_no
        WHERE p.marketing_status_id IN (1, 2) AND a.appl_type = 'ANDA'
        GROUP BY ing
        ORDER BY c DESC
        LIMIT 15
        """
    ).fetchall()
    stats["top_ingredients"] = {
        "names": [r[0] for r in rows],
        "counts": [r[1] for r in rows],
    }

    # 6) 在售产品剂型分布 Top 10 + 其他
    rows = conn.execute(
        """
        SELECT form, COUNT(*) FROM products
        WHERE marketing_status_id IN (1, 2)
        GROUP BY form
        ORDER BY COUNT(*) DESC
        """
    ).fetchall()
    top10 = rows[:10]
    other = sum(c for _, c in rows[10:])
    stats["dosage_forms"] = {
        "names": [r[0] or "未知" for r in top10] + (["其他"] if other else []),
        "counts": [r[1] for r in top10] + ([other] if other else []),
    }

    # 7) 关键数字
    stats["headline"] = {
        "total_applications": conn.execute("SELECT COUNT(DISTINCT appl_type || appl_no) FROM applications").fetchone()[0],
        "active_products": conn.execute("SELECT COUNT(*) FROM products WHERE marketing_status_id IN (1, 2)").fetchone()[0],
        "discontinued_products": conn.execute("SELECT COUNT(*) FROM products WHERE marketing_status_id = 3").fetchone()[0],
        "tentative_applications": conn.execute("SELECT COUNT(DISTINCT appl_no) FROM products WHERE marketing_status_id = 4").fetchone()[0],
        "nme_2025": nme.get("2025", 0),
        "total_sponsors": conn.execute("SELECT COUNT(DISTINCT sponsor_name) FROM applications WHERE sponsor_name IS NOT NULL AND sponsor_name != ''").fetchone()[0],
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUT)
    print(f"stats.json: {size/1024:.1f} KB")
    for k, v in stats.items():
        if isinstance(v, dict) and "years" in v:
            print(f"  {k}: {len(v['years'])} years")
        elif isinstance(v, dict) and "names" in v:
            print(f"  {k}: {len(v['names'])} items")
        else:
            print(f"  {k}: {v}")
    conn.close()


if __name__ == "__main__":
    main()
