#!/usr/bin/env python3
"""疾病→药物索引查询：从 fda_labels.db 检索适应症，关联 fda_drugs.db 获批信息。

用法:
  python disease_drugs.py "non-small cell lung cancer" \
      --synonyms "NSCLC,non small cell lung cancer" --out analysis/NSCLC
"""
import argparse
import csv
import os
import re
import sqlite3
import time
import zlib

BASE = os.path.dirname(os.path.abspath(__file__))
DB_LABELS = os.path.join(BASE, "fda_labels.db")
DB_DRUGS = os.path.join(BASE, "fda_drugs.db")


def unpack(blob):
    if blob is None:
        return ""
    return zlib.decompress(blob).decode("utf-8", "replace")


def fts_query(synonyms):
    """构造 FTS5 MATCH：每个同义词作为短语，OR 连接。"""
    phrases = []
    for s in synonyms:
        s = s.strip().replace('"', "")
        if s:
            phrases.append(f'"{s}"')
    return " OR ".join(phrases)


def split_study_sections(text):
    """按 14.x 小节标题切分临床研究文本，返回 [(heading, body)]。

    FDA 说明书文本常无换行，故按 "14.数字" 出现位置切分而非按行。
    """
    if not text:
        return []
    marks = [
        m.start()
        for m in re.finditer(r"(?:^|(?<=\s))14\.\d+(?=\s|[A-Z])", text)
    ]
    if not marks:
        return [("", text.strip())]
    sections = []
    for i, start in enumerate(marks):
        end = marks[i + 1] if i + 1 < len(marks) else len(text)
        seg = text[start:end].strip()
        m = re.match(r"(14\.\d+[^.。]{0,120})", seg)
        heading = m.group(1).strip() if m else ""
        sections.append((heading, seg))
    return sections


def efficacy_snippet(clinical_text, keywords):
    """取与疾病相关的小节，截取前 300 字符。"""
    for heading, body in split_study_sections(clinical_text):
        hay = (heading + " " + body).lower()
        if any(k in hay for k in keywords):
            snippet = re.sub(r"\s+", " ", body).strip()
            return snippet[:300]
    return ""


def decade(year):
    if not year or len(year) < 4:
        return "未知"
    return f"{year[:3]}0s"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("disease", help="疾病英文名（主查询词）")
    ap.add_argument("--synonyms", default="", help="逗号分隔的同义词")
    ap.add_argument("--out", required=True, help="输出文件前缀（目录+名称）")
    args = ap.parse_args()

    synonyms = [args.disease] + [s for s in args.synonyms.split(",") if s.strip()]
    # 片段匹配关键词：同义词小写 + 单词 lung（NSCLC 场景）
    keywords = {s.strip().lower() for s in synonyms}
    keywords.add("lung")

    conn = sqlite3.connect(DB_LABELS)
    conn.execute(f"ATTACH DATABASE '{DB_DRUGS}' AS drugs")

    # 1) FTS 检索
    t0 = time.time()
    q = fts_query(synonyms)
    rows = conn.execute(
        """
        SELECT l.id, l.set_id, l.application_number, l.brand_name,
               l.generic_name, l.effective_time, l.has_boxed_warning
        FROM indications_fts f
        JOIN labels l ON l.id = f.rowid
        WHERE indications_fts MATCH ?
        """,
        (q,),
    ).fetchall()
    fts_secs = time.time() - t0
    print(f"FTS 命中说明书记录: {len(rows)} 条 (耗时 {fts_secs:.2f}s)")

    # 2) 按 application_number 去重，取 effective_time 最新
    best = {}
    for r in rows:
        appno = r[2]
        if not appno:
            continue
        et = r[5] or ""
        if appno not in best or et > (best[appno][5] or ""):
            best[appno] = r
    print(f"按 application_number 去重后: {len(best)} 个申请（丢弃无申请号 {len(rows) - len(best) - (len(rows) - len([r for r in rows if r[2]]))} 条不计）")

    # 3) 关联 fda_drugs.db 获批信息
    drugs = []
    matched = 0
    for appno, r in sorted(best.items()):
        overview = conn.execute(
            """
            SELECT drug_name, active_ingredient, sponsor_name, appl_type,
                   MIN(approval_date) AS first_approval
            FROM drugs.v_drug_overview
            WHERE application_number = ?
            GROUP BY application_number
            """,
            (appno,),
        ).fetchone()
        if not overview:
            continue
        matched += 1
        # 最新产品线的上市状态（按获批日期最新者）
        status = conn.execute(
            """
            SELECT marketing_status FROM drugs.v_drug_overview
            WHERE application_number = ?
            ORDER BY (approval_date IS NULL), approval_date DESC
            LIMIT 1
            """,
            (appno,),
        ).fetchone()
        drug_name, ingredient, sponsor, appl_type, first_approval = overview
        # 首次获批：同一商品名下所有申请中的最早日期
        # （避免多申请品牌显示新剂型的较晚日期，如 ZYKADIA 片剂 2019 vs 胶囊 2014）
        brand_min = conn.execute(
            "SELECT MIN(approval_date) FROM drugs.v_drug_overview WHERE UPPER(drug_name) = UPPER(?)",
            (drug_name or r[3] or "",),
        ).fetchone()
        if brand_min and brand_min[0]:
            first_approval = brand_min[0]
        drugs.append({
            "appno": appno,
            "set_id": r[1],
            "drug_name": drug_name or r[3] or "",
            "ingredient": ingredient or r[4] or "",
            "sponsor": sponsor or "",
            "appl_type": appl_type or "",
            "first_approval": first_approval or "",
            "status": (status[0] if status else "") or "",
            "boxed": bool(r[6]),
        })

    print(f"获批药匹配: {matched}/{len(best)} ({matched/max(len(best),1)*100:.1f}%)")

    # 4) label_deep 提取有效性片段
    for d in drugs:
        deep = conn.execute(
            "SELECT clinical_studies FROM label_deep WHERE set_id = ?",
            (d["set_id"],),
        ).fetchone()
        d["snippet"] = efficacy_snippet(unpack(deep[0]) if deep else "", keywords)

    # 5) 输出文件
    out_csv = args.out + "_药物全景表.csv"
    out_md = args.out + "_药物全景表.md"
    os.makedirs(os.path.dirname(out_csv) or ".", exist_ok=True)

    headers = ["药物名", "活性成分", "持证商", "类型", "首次获批", "上市状态", "黑框警告", "有效性片段（节选）"]
    with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(headers)
        for d in drugs:
            w.writerow([
                d["drug_name"], d["ingredient"], d["sponsor"], d["appl_type"],
                d["first_approval"], d["status"],
                "是" if d["boxed"] else "否", d["snippet"],
            ])

    lines = [
        f"# {args.disease} 药物全景表",
        "",
        f"数据来源：openFDA 说明书（indications 全文检索）+ Drugs@FDA 获批记录 · 共 {len(drugs)} 个药物申请",
        "",
        "| " + " | ".join(headers) + " |",
        "|" + "---|" * len(headers),
    ]
    for d in drugs:
        cells = [
            d["drug_name"], d["ingredient"], d["sponsor"], d["appl_type"],
            d["first_approval"], d["status"],
            "⚠️ 是" if d["boxed"] else "否",
            d["snippet"].replace("|", "\\|"),
        ]
        lines.append("| " + " | ".join(cells) + " |")
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    # 6) 终端汇总
    print("\n===== 汇总 =====")
    print(f"命中说明书记录数: {len(rows)}")
    print(f"去重后申请数: {len(best)}")
    print(f"关联到获批药: {len(drugs)} (匹配率 {matched/max(len(best),1)*100:.1f}%)")
    dist = {}
    for d in drugs:
        dist[decade(d["first_approval"])] = dist.get(decade(d["first_approval"]), 0) + 1
    print("获批年代分布:", dict(sorted(dist.items())))
    print(f"黑框警告药物: {sum(1 for d in drugs if d['boxed'])} 个")
    print(f"输出: {out_csv}")
    print(f"      {out_md}")
    conn.close()


if __name__ == "__main__":
    main()
