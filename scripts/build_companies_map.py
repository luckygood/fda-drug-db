#!/usr/bin/env python3
"""企业地图 phase 2: 最简四字段（名称/城市/国家/官网）+ FDA 画像匹配
来源: BIO-Europe_2025.db (SQLite) + PharmaGO 中国申报药品库·单抗 (xlsx)
输出: public/data/companies_map.json（不含来源字段；fda_slug 为站内企业画像链接键）

phase 2 变更:
- canon key 强化: 去除全部非字母数字字符（容忍空格/标点差异，如 "F. Hoffmann" vs "F.Hoffmann"）
- 国家归一为英文规范名（中国→China、美国→United States 等；前端用 zh 标签映射展示）
- FDA 匹配: canon 名 → companies/index.json 及 sponsor_map.json 变体反查，输出 fda_slug
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
    """phase 2: 仅保留字母/数字/中日韩字符（消除空格、标点、连字符差异）。"""
    n = (name or "").strip()
    n = SUFFIX.sub("", n).strip()
    n = re.sub(r"[^0-9A-Za-z一-鿿]+", "", n)
    return n.casefold()

# 中文国家/地区名 → 英文规范名（xlsx 侧取值实测全集；未命中者保留原样并计数上报）
COUNTRY_CN2EN = {
    "中国": "China", "美国": "United States", "德国": "Germany", "日本": "Japan",
    "瑞士": "Switzerland", "韩国": "South Korea", "英国": "United Kingdom", "法国": "France",
    "加拿大": "Canada", "澳大利亚": "Australia", "意大利": "Italy", "瑞典": "Sweden",
    "比利时": "Belgium", "荷兰": "Netherlands", "爱尔兰": "Ireland", "新加坡": "Singapore",
    "丹麦": "Denmark", "俄罗斯": "Russia", "立陶宛": "Lithuania",
    "台湾": "Taiwan", "香港": "Hong Kong", "开曼群岛": "Cayman Islands",
}
# 英文变体 → 英文规范名（BIO 库原始取值归一）
COUNTRY_EN_ALIAS = {
    "Hong Kong, S.A.R.": "Hong Kong",
    "Taiwan, China": "Taiwan",
    "Russian Federation": "Russia",
}
unmapped_countries = {}

def norm_country(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    if raw in COUNTRY_CN2EN:
        return COUNTRY_CN2EN[raw]
    if raw in COUNTRY_EN_ALIAS:
        return COUNTRY_EN_ALIAS[raw]
    if re.search(r"[一-鿿]", raw):  # 含中文但未在映射表
        unmapped_countries[raw] = unmapped_countries.get(raw, 0) + 1
    return raw

def split_country_region(raw: str):
    """'United States:Massachusetts' -> ('United States','Massachusetts'); 'Germany' -> ('Germany','')"""
    raw = (raw or "").strip()
    if not raw:
        return "", ""
    if ":" in raw:
        c, r = raw.split(":", 1)
        return c.strip(), r.strip()
    return raw, ""

def parse_cn_location(raw: str):
    """'美国; 中国重庆市; 中国香港特别行政区; 中国北京市' -> (country, first_cn_city)"""
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
    country = norm_country(countries[0]) if countries else ""
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
    country = norm_country(country)  # 已是英文为主，China 保持不变
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

# --- 3. FDA 企业画像匹配（canon → slug，含名称变体） ---
idx = json.load(open(ROOT / "public" / "data" / "companies" / "index.json"))["companies"]
sponsor_map = json.load(open(ROOT / "public" / "data" / "companies" / "sponsor_map.json"))
canon2slug = {}
for ent in idx:
    canon2slug.setdefault(canon(ent["name"]), ent["slug"])
for variant, slug in sponsor_map.items():
    canon2slug.setdefault(canon(variant), slug)
n_fda = 0
for rec in companies.values():
    slug = canon2slug.get(canon(rec["name"]))
    rec["fda_slug"] = slug
    if slug:
        n_fda += 1

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
    "method_version": "2.0",
    "scope_note": "企业地图：名称/城市/国家/官网四字段。city 为最细可用地区粒度（州/省/城市）；国家为英文规范名。",
    "stats": {
        "total": len(records),
        "with_website": with_site,
        "countries": len(countries),
        "fda_linked": n_fda,
        "top_countries": top,
    },
    "companies": [
        {k: r[k] for k in ("name", "city", "country", "website", "fda_slug")} for r in records
    ],
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))

# 内部溯源版（不公开，保留 sources 供后续数据治理）
priv = dict(out)
priv["companies"] = records
priv["stats"]["merged_multi_source"] = both
priv["stats"]["bio_rows"] = n_bio
priv["stats"]["pharmago_rows"] = n_pg_rows
(ROOT / "scripts" / "snapshots").mkdir(exist_ok=True)
(ROOT / "scripts" / "snapshots" / f"companies_map-internal-{date.today():%Y%m%d}.json").write_text(
    json.dumps(priv, ensure_ascii=False))
print(f"total={len(records)} bio={n_bio} pg_rows={n_pg_rows} merged={both} with_site={with_site} countries={len(countries)}")
print(f"fda_linked={n_fda} ({n_fda / max(1, len(records)) * 100:.1f}%) unmapped_countries={unmapped_countries}")
print("top:", top[:10])

