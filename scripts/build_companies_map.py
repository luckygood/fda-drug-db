#!/usr/bin/env python3
"""企业地图 phase 1: 最简四字段（名称/城市/国家/官网）
来源: BIO-Europe_2025.db (SQLite) + PharmaGO 中国申报药品库·单抗 (xlsx)
输出: public/data/companies_map.json
"""
import json, re, sqlite3, sys
from pathlib import Path
from datetime import date

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
WS = ROOT.parent  # 外层工作区，放源文件
OUT = ROOT / "public" / "data" / "companies_map.json"

SUFFIX = re.compile(
    r"[,\s]*(Inc\.?|LLC|Ltd\.?|Limited|Co\.?,?\s*(Ltd\.?|Inc\.?)?|Corp\.?|Corporation|GmbH|AG|SA|S\.A\.|SAS|SARL|BV|B\.V\.|NV|N\.V\.|Pty\.?\s*Ltd\.?|PLC|plc|SE|KGaA|KK|K\.K\.|株式会社|有限公司|股份有限公司)$",
    re.IGNORECASE,
)

def canon(name: str) -> str:
    n = (name or "").strip()
    n = SUFFIX.sub("", n).strip()
    n = re.sub(r"\s+", " ", n)
    return n.casefold()

def split_country_region(raw: str):
    """'United States:Massachusetts' -> ('United States','Massachusetts'); 'Germany' -> ('Germany','')"""
    raw = (raw or "").strip()
    if not raw:
        return "", ""
    if ":" in raw:
        c, r = raw.split(":", 1)
        return c.strip(), r.strip()
    return raw, ""

CN_GEO = re.compile(r"中国(.+?)(?:;|$)")

def parse_cn_location(raw: str):
    """'美国; 中国重庆市; 中国香港特别行政区; 中国北京市' -> (countries, first_cn_city)"""
    raw = (raw or "").strip()
    if not raw:
        return "", ""
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    countries, cities = [], []
    for p in parts:
        if p.startswith("中国"):
            countries.append("中国")
            cities.append(p[2:])
        else:
            countries.append(p)
    country = countries[0] if countries else ""
    city = cities[0] if cities else ""
    return country, city

def norm_website(w: str) -> str:
    w = (w or "").strip()
    if not w:
        return ""
    if not w.startswith(("http://", "https://")):
        w = "https://" + w
    return w

companies = {}  # canon -> record

def clean_name(name: str) -> str:
    n = (name or "").strip()
    n = re.sub(r"^\d+\s*[)）.、]\s*", "", n).strip()  # 序号前缀 "1) "
    if len(n) < 2 or not re.search(r"[A-Za-z一-鿿]", n):
        return ""
    return n

def upsert(name, city, country, website, source):
    name = clean_name(name)
    if not name:
        return
    key = canon(name)
    if not key:
        return
    rec = companies.get(key)
    if rec is None:
        rec = {"name": name.strip(), "city": "", "country": "", "website": "", "sources": []}
        companies[key] = rec
    if city and not rec["city"]:
        rec["city"] = city
    if country and not rec["country"]:
        rec["country"] = country
    if website and not rec["website"]:
        rec["website"] = website
    if source not in rec["sources"]:
        rec["sources"].append(source)

# --- 1. BIO-Europe 2025 ---
db = WS / "BIO-Europe_2025.db"
con = sqlite3.connect(db)
n_bio = 0
for name, craw, website in con.execute("select name, country, website from companies"):
    country, region = split_country_region(craw)
    if country == "China":
        country = "中国"
    upsert(name, region, country, norm_website(website), "bio_europe_2025")
    n_bio += 1
con.close()

# --- 2. PharmaGO 单抗申报库 ---
xl = WS / "pharmago_cn_mab.xlsx"
wb = openpyxl.load_workbook(xl, read_only=True)
ws = wb["数据详情"]
it = ws.iter_rows(values_only=True)
hdr = list(next(it))
i_sponsor = hdr.index("申报企业")
i_loc = hdr.index("企业所在地")
n_pg_rows = 0
for row in it:
    raw = row[i_sponsor]
    if not raw:
        continue
    country, city = parse_cn_location(str(row[i_loc] or ""))
    for ent in re.split(r"[;；]", str(raw)):
        ent = ent.strip()
        if ent:
            upsert(ent, city, country, "", "pharmago_cn_mab")
    n_pg_rows += 1

records = sorted(companies.values(), key=lambda r: r["name"].casefold())
both = sum(1 for r in records if len(r["sources"]) > 1)
with_site = sum(1 for r in records if r["website"])
countries = {}
for r in records:
    if r["country"]:
        countries[r["country"]] = countries.get(r["country"], 0) + 1
top = sorted(countries.items(), key=lambda x: -x[1])[:15]

out = {
    "generated_at": str(date.today()),
    "method_version": "1.0",
    "scope_note": "企业地图一期：仅名称/城市/国家/官网四字段。BIO-Europe 2025 参会快照 + PharmaGO 中国申报药品库·单抗(2026-03)。city 对 BIO 为州/省、对 PharmaGO 为中国城市，口径最细可用值。",
    "stats": {
        "total": len(records),
        "bio_rows": n_bio,
        "pharmago_rows": n_pg_rows,
        "merged_multi_source": both,
        "with_website": with_site,
        "countries": len(countries),
        "top_countries": top,
    },
    "companies": records,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(f"total={len(records)} bio={n_bio} pg_rows={n_pg_rows} merged={both} with_site={with_site} countries={len(countries)}")
print("top:", top[:10])
