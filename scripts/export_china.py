#!/usr/bin/env python3
"""导出中国药企出海数据（public/data/china_pharma.json）与疾病相似性网络（disease_network.json）。

中国实体识别：对归一化企业名做"词边界"关键词匹配（避免 HEC 误中 APOTHECON、
BIOTHERA 误中 STEALTH 等子串误报），再经人工排除清单复核。全部命中打印供人工判断。
"""
import json
import os
import re
import sqlite3
import time
from collections import defaultdict

from export_companies import normalize, slugify, alias_for

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "fda_drugs.db")
DIS_DIR = os.path.join(BASE, "fda-drug-web", "public", "data", "diseases")
OUT_CHINA = os.path.join(BASE, "fda-drug-web", "public", "data", "china_pharma.json")
OUT_NET = os.path.join(BASE, "fda-drug-web", "public", "data", "disease_network.json")

NME_SQL = """
    SELECT appl_no, MIN(status_date) FROM submissions
    WHERE submission_type = 'ORIG' AND submission_status = 'AP'
      AND submission_class LIKE 'Type 1%'
    GROUP BY appl_no
"""

# 中国实体关键词（对归一名做词边界匹配）
KEYWORDS = [
    "HENGRUI", "HANSOH", "BEIGENE", "AKESO", "DIZAL", "CSPC", "SINO BIOPHARM",
    "CHIA TAI TIANQING", "QILU", "ZAI LAB", "HUTCHMED", "INNOVENT", "LEGEND",
    "JUNSHI", "FOSUN", "HISUN", "HUADONG", "YILING", "TASLY", "KELUN", "HUAHAI",
    "ZHEJIANG", "JIANGSU", "SHANDONG", "SHANGHAI", "BEIJING", "GUANGDONG",
    "NORTH CHINA", "SHIJIAZHUANG", "XINHUA", "NHU", "JIUZHOU", "PRINSTON",
    "SOLCO", "HUABO", "SIMCERE", "GENOR", "MABPHARM", "BIO THERA", "HENLIUS",
    "LIVZON", "CHENGDU", "SICHUAN", "HEC", "SUNSHINE", "LUYE", "XIANJUAN",
]

# 人工复核排除（词边界匹配仍命中的非中资实体）
MANUAL_EXCLUDE = {
    "HARMONY",  # Harmony Biosciences（美国，WAKIX 持证商）
}

# 中国实体中文别名补充（export_companies 的 27 条之外）
CN_ALIASES = {
    "CHIA TAI TIANQING": "正大天晴",
    "QILU": "齐鲁制药",
    "FOSUN": "复星医药",
    "HISUN": "海正药业",
    "YILING": "以岭药业",
    "HEC": "东阳光药",
    "SUNSHINE LAKE": "东阳光药",
    "SUNSHINE": "东阳光药",
    "SHANDONG XINHUA": "新华制药",
    "SHANDONG NEW TIME": "鲁南制药",
    "LUYE": "绿叶制药",
    "PRINSTON": "华海药业",
    "ZHEJIANG POLY": "普利制药",
    "ZHEJIANG JIUZHOU": "九洲药业",
    "ZHEJIANG XIANJU": "仙琚制药",
    "ZHEJIANG JINGXIN": "京新药业",
    "ZHEJIANG YONGTAI": "永太药业",
    "LIVZON": "丽珠集团",
    "SHANGHAI HENLIUS": "复宏汉霖",
    "BEIJING SL": "双鹭药业",
    "CHENGDU SHUODE": "成都硕德",
}


def cn_alias(norm: str) -> str | None:
    zh = alias_for(norm)
    if zh:
        return zh
    for key, name in CN_ALIASES.items():
        if norm == key or norm.startswith(key + " "):
            return name
    return None


def kw_match(norm: str) -> bool:
    for kw in KEYWORDS:
        if re.search(rf"\b{re.escape(kw)}\b", norm):
            return True
    return False


def main() -> None:
    t0 = time.time()
    conn = sqlite3.connect(DB)

    # ---------- 1. 企业分组（沿用 export_companies 归一化） ----------
    groups = defaultdict(lambda: {"variants": set(), "appls": []})
    appl_type, appl_date = {}, {}
    for appl_no, atype, sponsor, adate in conn.execute(
        "SELECT appl_no, appl_type, sponsor_name, approval_date FROM applications"
    ):
        norm = normalize(sponsor)
        groups[norm]["variants"].add((sponsor or "").strip())
        groups[norm]["appls"].append(appl_no)
        appl_type[appl_no] = atype
        appl_date[appl_no] = adate

    china = {n: g for n, g in groups.items() if kw_match(n) and n not in MANUAL_EXCLUDE}
    print(f"===== 中国实体命中 {len(china)} 组（人工复核清单） =====")
    for n in sorted(china, key=lambda x: -len(china[x]["appls"])):
        g = china[n]
        print(f"  {n:44s} apps={len(g['appls']):4d} 变体: {sorted(g['variants'])[:2]}")

    # ---------- 2. 产品 / NME / 暂定 ----------
    nme_date = dict(conn.execute(NME_SQL))
    orphan_set = {r[0] for r in conn.execute(
        "SELECT DISTINCT appl_no FROM submission_property WHERE code = 'Orphan'")}
    pri_set = {r[0] for r in conn.execute(
        "SELECT DISTINCT appl_no FROM submissions WHERE submission_type='ORIG' "
        "AND submission_status='AP' AND review_priority='PRIORITY'")}
    prods = list(conn.execute(
        "SELECT appl_no, drug_name, active_ingredient, marketing_status_id FROM products"))
    prods_by_appl = defaultdict(list)
    for a, dn, ing, ms in prods:
        prods_by_appl[a].append((dn, ing, ms))
    first_drug = {}
    for a, dn, _i, _m in prods:
        if a not in first_drug and dn:
            first_drug[a] = dn

    slug_seen = {}
    entities = []
    tot = {"nda": 0, "anda": 0, "bla": 0, "active": 0, "nme": 0, "tentative": 0, "apps": 0}
    timeline = defaultdict(lambda: {"nda": 0, "anda": 0, "bla": 0})
    innovation = []
    pipeline_map = defaultdict(lambda: {"appls": set(), "sponsors": set()})

    for norm, g in sorted(china.items(), key=lambda kv: -len(kv[1]["appls"])):
        base = slugify(norm)
        k = slug_seen.get(base, 0) + 1
        slug_seen[base] = k
        slug = base if k == 1 else f"{base}-{k}"

        st = {"nda": 0, "anda": 0, "bla": 0, "active": 0, "tentative": 0}
        years = []
        for a in g["appls"]:
            t = (appl_type.get(a) or "").upper()
            if t in ("NDA", "ANDA", "BLA"):
                st[t.lower()] += 1
                tot[t.lower()] += 1
            yr = (appl_date.get(a) or "")[:4]
            if yr:
                years.append(yr)
                if t in ("NDA", "ANDA", "BLA"):
                    timeline[yr][t.lower()] += 1
            if a in nme_date:
                tot["nme"] += 1
                innovation.append({
                    "application_number": f"{appl_type.get(a, '')}{a}",
                    "drug_name": first_drug.get(a, ""),
                    "sponsor": norm,
                    "sponsor_zh": cn_alias(norm),
                    "ap_date": nme_date[a],
                    "orphan": 1 if a in orphan_set else 0,
                    "priority": 1 if a in pri_set else 0,
                })
            for dn, ing, ms in prods_by_appl.get(a, []):
                if ms in (1, 2):
                    st["active"] += 1
                    tot["active"] += 1
                elif ms == 4:
                    st["tentative"] += 1
                    tot["tentative"] += 1
                    key = (ing or "").strip().upper()
                    if key:
                        pipeline_map[key]["appls"].add(a)
                        pipeline_map[key]["sponsors"].add(norm)
        entities.append({
            "slug": slug,
            "name": norm,
            "name_zh": cn_alias(norm),
            "applications": len(g["appls"]),
            "active": st["active"],
            "nda": st["nda"], "anda": st["anda"], "bla": st["bla"],
            "nme_count": sum(1 for a in g["appls"] if a in nme_date),
            "tentative_count": st["tentative"],
            "first_year": min(years) if years else None,
        })
        tot["apps"] += len(g["appls"])

    entities.sort(key=lambda x: (-x["active"], -x["applications"]))
    innovation.sort(key=lambda x: x["ap_date"] or "", reverse=True)
    pipeline = sorted(
        ({"ingredient": ing, "n": len(v["appls"]), "sponsors": sorted(v["sponsors"])}
         for ing, v in pipeline_map.items()),
        key=lambda x: -x["n"],
    )

    china_payload = {
        "summary": {
            "company_count": len(entities),
            "applications": tot["apps"],
            "nda": tot["nda"], "anda": tot["anda"], "bla": tot["bla"],
            "active_products": tot["active"],
            "nme_count": len(innovation),
            "tentative_count": tot["tentative"],
        },
        "timeline": {yr: v for yr, v in sorted(timeline.items())},
        "companies": entities,
        "innovation": innovation,
        "pipeline": pipeline,
    }
    with open(OUT_CHINA, "w", encoding="utf-8") as f:
        json.dump(china_payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\nchina_pharma.json: {os.path.getsize(OUT_CHINA)/1024:.1f} KB")
    print(f"  企业 {len(entities)} | 申请 {tot['apps']} (NDA {tot['nda']} ANDA {tot['anda']} BLA {tot['bla']})")
    print(f"  在售 {tot['active']} | NME {len(innovation)} | 暂定 {tot['tentative']} | 管线成分 {len(pipeline)}")

    # ---------- 3. 疾病相似性网络 ----------
    diseases = []
    drug_sets = {}  # slug -> {(drug_name|ingredient) 大写}
    drug_label = {}  # key -> 展示名
    for fn in sorted(os.listdir(DIS_DIR)):
        if not fn.endswith(".json") or fn in ("index.json", "app_index.json"):
            continue
        d = json.load(open(os.path.join(DIS_DIR, fn)))
        diseases.append({"slug": d["slug"], "name_zh": d["name_zh"], "area": d["area"], "drug_count": len(d["drugs"])})
        s = set()
        for drug in d["drugs"]:
            key = f"{(drug.get('drug_name') or '').upper()}|{(drug.get('active_ingredient') or '').upper()}"
            s.add(key)
            drug_label.setdefault(key, (drug.get("drug_name") or "").strip())
        drug_sets[d["slug"]] = s

    slugs = [d["slug"] for d in diseases]
    edges = {}
    top3 = defaultdict(list)
    for i in range(len(slugs)):
        for j in range(i + 1, len(slugs)):
            a, b = drug_sets[slugs[i]], drug_sets[slugs[j]]
            if not a or not b:
                continue
            inter = a & b
            if not inter:
                continue
            w = len(inter) / len(a | b)
            pair = (slugs[i], slugs[j])
            if w >= 0.15:
                edges[pair] = (w, inter)
            top3[slugs[i]].append((w, pair, inter))
            top3[slugs[j]].append((w, pair, inter))
    # 每节点 Top 3 强边取并集
    for slug, lst in top3.items():
        lst.sort(key=lambda x: -x[0])
        for w, pair, inter in lst[:3]:
            if w > 0:
                edges.setdefault(pair, (w, inter))

    edge_list = []
    for (s, t), (w, inter) in edges.items():
        examples = sorted({drug_label.get(k, "") for k in inter if drug_label.get(k)})[:3]
        edge_list.append({
            "source": s, "target": t,
            "weight": round(w, 3), "shared": len(inter),
            "examples": examples,
        })
    edge_list.sort(key=lambda x: -x["weight"])
    net_payload = {"nodes": diseases, "edges": edge_list}
    with open(OUT_NET, "w", encoding="utf-8") as f:
        json.dump(net_payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"disease_network.json: {os.path.getsize(OUT_NET)/1024:.1f} KB | 节点 {len(diseases)} 边 {len(edge_list)}")
    print(f"耗时: {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
