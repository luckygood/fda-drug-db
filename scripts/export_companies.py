#!/usr/bin/env python3
"""导出企业画像静态数据到 fda-drug-web/public/data/companies/。

- index.json：全企业摘要（按在售产品数降序）
- <LETTER>.json / OTHER.json：分片详情（按归一名首字母分片）
企业名归一化：大写 → 去标点 → 去尾部公司后缀，相同归一名合并为一组。
"""
import json
import os
import re
import shutil
import sqlite3
import time
from collections import defaultdict

DB = "fda_drugs.db"
OUT = "fda-drug-web/public/data/companies"
DISEASE_DIR = "fda-drug-web/public/data/diseases"

SUFFIXES = {
    "LTD", "LIMITED", "INC", "LLC", "CORP", "CORPORATION", "COMPANY", "CO",
    "USA", "US", "PHARMS", "GMBH", "AG", "SA", "BV", "SRL", "SPA", "PLC",
    "APS", "AS", "KK", "LP", "LLP", "NV", "PTY", "PTE", "SAS", "SARL", "SPA",
}

# 知名企业中文别名（归一名前缀匹配）
ALIASES = {
    "HENGRUI": "恒瑞医药",
    "BEIGENE": "百济神州",
    "AKESO": "康方生物",
    "DIZAL": "迪哲医药",
    "JIANGSU HANSOH": "翰森制药",
    "CSPC": "石药集团",
    "SINO BIOPHARM": "中国生物制药",
    "NOVARTIS": "诺华",
    "ELI LILLY": "礼来",
    "PFIZER": "辉瑞",
    "MERCK SHARP DOHME": "默沙东",
    "ASTRAZENECA": "阿斯利康",
    "ROCHE": "罗氏",
    "GENENTECH": "罗氏·基因泰克",
    "BRISTOL MYERS SQUIBB": "百时美施贵宝",
    "GILEAD": "吉利德",
    "JANSSEN": "强生",
    "SANOFI": "赛诺菲",
    "GLAXOSMITHKLINE": "葛兰素史克",
    "TAKEDA": "武田",
    "BAYER": "拜耳",
    "BOEHRINGER INGELHEIM": "勃林格殷格翰",
    "AMGEN": "安进",
    "REGENERON": "再生元",
    "VERTEX": "福泰制药",
    "MODERNA": "莫德纳",
    "ABBVIE": "艾伯维",
}

NME_SQL = """
    SELECT appl_no, MIN(status_date) FROM submissions
    WHERE submission_type = 'ORIG' AND submission_status = 'AP'
      AND submission_class LIKE 'Type 1%'
    GROUP BY appl_no
"""

STATUS_LABEL = {1: "处方药", 2: "OTC", 3: "已撤市", 4: "暂定批准"}


def normalize(name: str) -> str:
    """大写 → 非标点字母数字转空格 → 去尾部公司后缀（循环）→ 去孤立 AND。"""
    s = re.sub(r"[^A-Z0-9]+", " ", (name or "").upper()).strip()
    if not s:
        return "UNKNOWN"
    toks = s.split()
    while toks and toks[-1] in SUFFIXES:
        toks.pop()
    while toks and toks[-1] == "AND":
        toks.pop()
    return " ".join(toks) or "UNKNOWN"


def slugify(norm: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", norm.lower()).strip("-")
    return s or "unknown"


def alias_for(norm: str) -> str | None:
    for key, zh in ALIASES.items():
        if norm == key or norm.startswith(key + " "):
            return zh
    return None


def main() -> None:
    t0 = time.time()
    conn = sqlite3.connect(DB)

    # ---------- 1. 企业分组 ----------
    groups = defaultdict(lambda: {"variants": set(), "appls": []})
    appl_type = {}
    appl_date = {}
    for appl_no, atype, sponsor, adate in conn.execute(
        "SELECT appl_no, appl_type, sponsor_name, approval_date FROM applications"
    ):
        norm = normalize(sponsor)
        g = groups[norm]
        g["variants"].add((sponsor or "").strip())
        g["appls"].append(appl_no)
        appl_type[appl_no] = atype
        appl_date[appl_no] = adate

    # ---------- 2. 产品层统计 ----------
    prod_rows = list(
        conn.execute(
            "SELECT appl_no, drug_name, active_ingredient, marketing_status_id FROM products"
        )
    )
    appl_group = {}  # appl_no -> norm
    for norm, g in groups.items():
        for a in g["appls"]:
            appl_group[a] = norm

    prods_by_group = defaultdict(list)  # norm -> product rows
    for row in prod_rows:
        g = appl_group.get(row[0])
        if g:
            prods_by_group[g].append(row)

    # ---------- 3. NME / 孤儿药 / 优先审评 ----------
    nme_date = dict(conn.execute(NME_SQL))
    orphan_set = {
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT appl_no FROM submission_property WHERE code = 'Orphan'"
        )
    }
    pri_set = {
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT appl_no FROM submissions "
            "WHERE submission_type = 'ORIG' AND submission_status = 'AP' "
            "AND review_priority = 'PRIORITY'"
        )
    }
    first_drug = {}
    for appl_no, dname, _ing, _ms in prod_rows:
        if appl_no not in first_drug and dname:
            first_drug[appl_no] = dname

    # ---------- 4. 疾病矩阵覆盖 ----------
    co_diseases = defaultdict(lambda: defaultdict(set))  # norm -> slug -> app set
    disease_name = {}
    for fn in os.listdir(DISEASE_DIR):
        if not fn.endswith(".json") or fn == "index.json":
            continue
        d = json.load(open(os.path.join(DISEASE_DIR, fn)))
        disease_name[d["slug"]] = d["name_zh"]
        for drug in d["drugs"]:
            norm = normalize(drug.get("sponsor_name") or "")
            co_diseases[norm][d["slug"]].add(drug["application_number"])

    # ---------- 5. 组装 ----------
    slug_seen = {}
    index_entries = []
    details = {}  # norm -> detail dict
    for norm, g in groups.items():
        base_slug = slugify(norm)
        n = slug_seen.get(base_slug, 0) + 1
        slug_seen[base_slug] = n
        slug = base_slug if n == 1 else f"{base_slug}-{n}"

        appls = g["appls"]
        years = [appl_date[a][:4] for a in appls if appl_date.get(a)]
        n_type = defaultdict(int)
        timeline = defaultdict(lambda: {"nda": 0, "anda": 0, "bla": 0})
        for a in appls:
            t = (appl_type.get(a) or "").upper()
            key = t.lower() if t in ("NDA", "ANDA", "BLA") else "other"
            n_type[key] += 1
            yr = (appl_date.get(a) or "")[:4]
            if yr and key != "other":
                timeline[yr][key] += 1

        st = {"active": 0, "discontinued": 0, "tentative": 0}
        active_prods = []
        # 产品层按 appl 归组
        for a, dname, ing, ms in prods_by_group.get(norm, []):
            if ms in (1, 2):
                st["active"] += 1
                active_prods.append((a, dname, ing, ms))
            elif ms == 3:
                st["discontinued"] += 1
            elif ms == 4:
                st["tentative"] += 1
        active_prods.sort(key=lambda p: appl_date.get(p[0]) or "", reverse=True)
        top_products = [
            {
                "application_number": f"{appl_type.get(a, '')}{a}",
                "drug_name": dname or "",
                "active_ingredient": ing or "",
                "approval_date": appl_date.get(a) or "",
                "marketing_status": STATUS_LABEL.get(ms, "其他"),
            }
            for a, dname, ing, ms in active_prods[:30]
        ]

        nme_list = []
        for a in appls:
            if a in nme_date:
                nme_list.append(
                    {
                        "application_number": f"{appl_type.get(a, '')}{a}",
                        "drug_name": first_drug.get(a, ""),
                        "ap_date": nme_date[a],
                        "orphan": 1 if a in orphan_set else 0,
                        "priority": 1 if a in pri_set else 0,
                    }
                )
        nme_list.sort(key=lambda x: x["ap_date"] or "", reverse=True)

        diseases = sorted(
            (
                {"slug": s, "name_zh": disease_name.get(s, s), "drug_count": len(apps)}
                for s, apps in co_diseases.get(norm, {}).items()
            ),
            key=lambda x: -x["drug_count"],
        )[:20]

        details[norm] = {
            "slug": slug,
            "name": norm,
            "name_zh": alias_for(norm),
            "variants": sorted(v for v in g["variants"] if v),
            "stats": {
                "nda": n_type["nda"],
                "anda": n_type["anda"],
                "bla": n_type["bla"],
                "other": n_type["other"],
                "active": st["active"],
                "discontinued": st["discontinued"],
                "tentative": st["tentative"],
            },
            "timeline": {yr: v for yr, v in sorted(timeline.items())},
            "nme_list": nme_list[:80],
            "top_products": top_products,
            "diseases": diseases,
        }
        index_entries.append(
            {
                "slug": slug,
                "name": norm,
                "name_zh": alias_for(norm),
                "variants": len(g["variants"]),
                "applications": len(appls),
                "active_products": st["active"],
                "nme_count": len(nme_list),
                "first_year": min(years) if years else None,
                "latest_year": max(years) if years else None,
            }
        )

    index_entries.sort(key=lambda x: (-x["active_products"], x["name"]))

    # ---------- 6. 写文件 ----------
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"companies": index_entries}, f, ensure_ascii=False, separators=(",", ":"))

    # sponsor_map.json：原始 sponsor 名（大写）→ 企业 slug；另含归一名键作回退
    sponsor_map = {}
    for norm, det in details.items():
        for raw in det["variants"]:
            key = raw.strip().upper()
            if key:
                sponsor_map[key] = det["slug"]
    for norm, det in details.items():
        sponsor_map.setdefault(norm, det["slug"])
    with open(os.path.join(OUT, "sponsor_map.json"), "w", encoding="utf-8") as f:
        json.dump(sponsor_map, f, ensure_ascii=False, separators=(",", ":"))

    shards = defaultdict(list)
    for norm, det in details.items():
        first = det["slug"][0].upper()
        letter = first if "A" <= first <= "Z" else "OTHER"
        shards[letter].append(det)
    for letter, items in shards.items():
        items.sort(key=lambda x: -x["stats"]["active"])
        with open(os.path.join(OUT, f"{letter}.json"), "w", encoding="utf-8") as f:
            json.dump({"companies": items}, f, ensure_ascii=False, separators=(",", ":"))

    # ---------- 7. 报告 ----------
    idx_kb = os.path.getsize(os.path.join(OUT, "index.json")) / 1024
    shard_sizes = {
        fn: round(os.path.getsize(os.path.join(OUT, fn)) / 1024, 1)
        for fn in sorted(os.listdir(OUT))
        if fn != "index.json"
    }
    print(f"企业组总数: {len(index_entries)}（合并前原始 sponsor 变体数: ", end="")
    print(f"{sum(len(g['variants']) for g in groups.values())}）")
    print(f"index.json: {idx_kb:.1f} KB | 分片数: {len(shard_sizes)}")
    print(f"分片体积: {shard_sizes}")
    auro = details.get("AUROBINDO PHARMA")
    if auro:
        print(f"AUROBINDO PHARMA 变体({len(auro['variants'])}): {auro['variants']}")
        print(f"  在售产品: {auro['stats']['active']}")
    multi = sum(1 for g in groups.values() if len(g["variants"]) > 1)
    print(f"含多变体的企业组: {multi}")
    print(f"耗时: {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
