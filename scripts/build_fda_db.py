#!/usr/bin/env python3
"""
build_fda_db.py — 将 FDA 官方 Drugs@FDA 数据文件导入本地 SQLite 数据库。

数据源: https://www.fda.gov/media/89850/download (Drugs@FDA Download File, 每周更新)
输入目录: data/drugsatfda_raw/*.txt (制表符分隔, 含表头)
输出:     fda_drugs.db (SQLite)

表结构:
  applications        申请主表 (NDA/ANDA/BLA + 持证商 + 首次获批日期)
  products            产品表 (药名/成分/剂型/规格/TE代码/上市状态)
  submissions         审评提交历史 (含原始获批记录)
  application_docs    审评文档链接 (批准函/说明书 PDF)
  marketing_status_lookup / submission_class_lookup  字典表
  products_fts        药名+成分 FTS5 全文索引
  v_drug_overview     常用查询视图 (产品 + 申请 + 获批日期 + 状态)
"""
import csv
import sqlite3
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
RAW = BASE / "data" / "drugsatfda_raw"
DB_PATH = BASE / "fda_drugs.db"


def read_tsv(name):
    """读取制表符分隔文件, 返回 dict 列表 (字段去首尾空白)。"""
    path = RAW / name
    with open(path, encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        header = [h.strip() for h in next(reader)]
        rows = []
        for line in reader:
            if not line or all(not c.strip() for c in line):
                continue
            # 字段数不足时补空, 过多时截断
            line = (line + [""] * len(header))[: len(header)]
            rows.append({h: (c.strip() if c else "") for h, c in zip(header, line)})
    return rows


def norm_date(s):
    """'1969-07-16 00:00:00' -> '1969-07-16'; 空值 -> None"""
    s = (s or "").strip()
    return s[:10] if s and s != "0" else None


def main():
    if not RAW.exists():
        sys.exit(f"找不到数据目录 {RAW}, 请先下载解压 Drugs@FDA 数据文件。")

    if DB_PATH.exists():
        DB_PATH.unlink()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.executescript("""
    PRAGMA journal_mode = MEMORY;
    PRAGMA synchronous = OFF;

    CREATE TABLE applications (
        appl_no        TEXT PRIMARY KEY,      -- 6位申请号, 如 '021514'
        appl_type      TEXT NOT NULL,         -- NDA / ANDA / BLA
        sponsor_name   TEXT,                  -- 持证商
        public_notes   TEXT,
        approval_date  TEXT                   -- 首次获批日期 (ORIG + AP 最早日期)
    );

    CREATE TABLE products (
        id                 INTEGER PRIMARY KEY,
        appl_no            TEXT NOT NULL REFERENCES applications(appl_no),
        product_no         TEXT NOT NULL,
        drug_name          TEXT,              -- 商品名
        active_ingredient  TEXT,              -- 活性成分
        form               TEXT,              -- 剂型+给药途径
        strength           TEXT,              -- 规格
        reference_drug     INTEGER,           -- 1=参比制剂(RLD)
        reference_standard INTEGER,           -- 1=标准制剂(RS)
        marketing_status_id INTEGER,
        te_code            TEXT,              -- 治疗等效性代码
        UNIQUE(appl_no, product_no)
    );
    CREATE INDEX idx_products_name ON products(drug_name);
    CREATE INDEX idx_products_ingredient ON products(active_ingredient);

    CREATE TABLE marketing_status_lookup (
        id INTEGER PRIMARY KEY,
        description TEXT
    );

    CREATE TABLE submission_class_lookup (
        id INTEGER PRIMARY KEY,
        code TEXT,
        description TEXT
    );

    CREATE TABLE submissions (
        id INTEGER PRIMARY KEY,
        appl_no TEXT NOT NULL REFERENCES applications(appl_no),
        submission_type TEXT,                 -- ORIG / SUPPL
        submission_no TEXT,
        submission_status TEXT,               -- AP=批准, TA=暂定批准...
        status_date TEXT,
        submission_class TEXT,                -- TYPE 1=新分子实体...
        review_priority TEXT,                 -- PRIORITY / STANDARD
        public_notes TEXT
    );
    CREATE INDEX idx_submissions_appl ON submissions(appl_no);

    CREATE TABLE application_docs (
        id INTEGER PRIMARY KEY,
        appl_no TEXT NOT NULL,
        submission_type TEXT,
        submission_no TEXT,
        doc_type_id INTEGER,
        doc_title TEXT,
        doc_url TEXT,
        doc_date TEXT
    );
    CREATE INDEX idx_docs_appl ON application_docs(appl_no);

    CREATE TABLE submission_property (
        id INTEGER PRIMARY KEY,
        appl_no TEXT NOT NULL,
        submission_type TEXT,
        submission_no TEXT,
        code TEXT                        -- 目前源数据仅 Orphan
    );
    CREATE INDEX idx_subprop_appl ON submission_property(appl_no);
    """)

    # ---------- 字典表 ----------
    for r in read_tsv("MarketingStatus_Lookup.txt"):
        cur.execute("INSERT INTO marketing_status_lookup VALUES (?,?)",
                    (int(r["MarketingStatusID"]), r["MarketingStatusDescription"]))
    for r in read_tsv("SubmissionClass_Lookup.txt"):
        cur.execute("INSERT INTO submission_class_lookup VALUES (?,?,?)",
                    (int(r["SubmissionClassCodeID"]), r["SubmissionClassCode"],
                     r["SubmissionClassCodeDescription"]))

    # ---------- 申请主表 ----------
    apps = read_tsv("Applications.txt")
    for r in apps:
        cur.execute(
            "INSERT INTO applications (appl_no, appl_type, sponsor_name, public_notes) VALUES (?,?,?,?)",
            (r["ApplNo"], r["ApplType"], r["SponsorName"], r["ApplPublicNotes"]))

    # ---------- 提交历史 -> 同时计算首次获批日期 ----------
    class_map = {str(i): (c or d) for i, c, d in cur.execute("SELECT id, code, description FROM submission_class_lookup")}
    first_ap = {}   # appl_no -> 最早 ORIG+AP 日期
    n_sub = 0
    for r in read_tsv("Submissions.txt"):
        appl = r["ApplNo"]
        stype = r["SubmissionType"].strip()
        status = r["SubmissionStatus"].strip()
        sdate = norm_date(r["SubmissionStatusDate"])
        cur.execute(
            """INSERT INTO submissions
               (appl_no, submission_type, submission_no, submission_status, status_date,
                submission_class, review_priority, public_notes)
               VALUES (?,?,?,?,?,?,?,?)""",
            (appl, stype, r["SubmissionNo"], status, sdate,
             class_map.get(r["SubmissionClassCodeID"], ""), r["ReviewPriority"],
             r["SubmissionsPublicNotes"]))
        n_sub += 1
        if stype == "ORIG" and status == "AP" and sdate:
            if appl not in first_ap or sdate < first_ap[appl]:
                first_ap[appl] = sdate
    cur.executemany("UPDATE applications SET approval_date=? WHERE appl_no=?",
                    [(d, a) for a, d in first_ap.items()])

    # ---------- 上市状态 & TE 代码 ----------
    mstatus = {}  # (appl, prod) -> status_id
    for r in read_tsv("MarketingStatus.txt"):
        mstatus[(r["ApplNo"], r["ProductNo"])] = int(r["MarketingStatusID"])
    te = {}       # (appl, prod) -> te_code
    for r in read_tsv("TE.txt"):
        te[(r["ApplNo"], r["ProductNo"])] = r["TECode"]

    # ---------- 产品表 ----------
    n_prod = 0
    for r in read_tsv("Products.txt"):
        key = (r["ApplNo"], r["ProductNo"])
        cur.execute(
            """INSERT OR REPLACE INTO products
               (appl_no, product_no, drug_name, active_ingredient, form, strength,
                reference_drug, reference_standard, marketing_status_id, te_code)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (r["ApplNo"], r["ProductNo"], r["DrugName"], r["ActiveIngredient"],
             r["Form"], r["Strength"],
             1 if r["ReferenceDrug"] == "1" else 0,
             1 if r["ReferenceStandard"] == "1" else 0,
             mstatus.get(key), te.get(key)))
        n_prod += 1

    # ---------- 审评文档 ----------
    n_docs = 0
    for r in read_tsv("ApplicationDocs.txt"):
        if not r["ApplicationDocsURL"]:
            continue
        title = r["ApplicationDocsTitle"]
        title = "" if title in ("0",) else title   # 源文件用 '0' 占位
        cur.execute(
            """INSERT INTO application_docs
               (appl_no, submission_type, submission_no, doc_type_id, doc_title, doc_url, doc_date)
               VALUES (?,?,?,?,?,?,?)""",
            (r["ApplNo"], r["SubmissionType"].strip(), r["SubmissionNo"],
             int(r["ApplicationDocsTypeID"] or 0), title,
             r["ApplicationDocsURL"], norm_date(r["ApplicationDocsDate"])))
        n_docs += 1

    # ---------- 孤儿药等资格认定（非 Null 行） ----------
    n_prop = 0
    for r in read_tsv("SubmissionPropertyType.txt"):
        code = r["SubmissionPropertyTypeCode"]
        if not code or code == "Null":
            continue
        cur.execute(
            "INSERT INTO submission_property (appl_no, submission_type, submission_no, code) VALUES (?,?,?,?)",
            (r["ApplNo"], r["SubmissionType"].strip(), r["SubmissionNo"], code))
        n_prop += 1

    # ---------- FTS5 全文索引 ----------
    cur.execute("CREATE VIRTUAL TABLE products_fts USING fts5(drug_name, active_ingredient, content='')")
    cur.execute("INSERT INTO products_fts(rowid, drug_name, active_ingredient) "
                "SELECT id, drug_name, active_ingredient FROM products")

    # ---------- 查询视图 ----------
    cur.executescript("""
    CREATE VIEW v_drug_overview AS
    SELECT
        a.appl_type || a.appl_no            AS application_number,  -- 如 NDA021514
        a.appl_type                          AS appl_type,
        p.drug_name,
        p.active_ingredient,
        p.form,
        p.strength,
        a.sponsor_name,
        a.approval_date,
        m.description                        AS marketing_status,
        p.te_code,
        CASE p.reference_drug WHEN 1 THEN 'RLD' ELSE '' END AS reference_drug
    FROM products p
    JOIN applications a ON a.appl_no = p.appl_no
    LEFT JOIN marketing_status_lookup m ON m.id = p.marketing_status_id;
    """)

    conn.commit()

    # ---------- 元信息 ----------
    cur.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    cur.execute("INSERT OR REPLACE INTO meta VALUES ('source', 'Drugs@FDA Download File (fda.gov/media/89850)')")
    cur.execute("INSERT OR REPLACE INTO meta VALUES ('built_at', datetime('now'))")
    conn.commit()

    stats = {
        "applications": cur.execute("SELECT COUNT(*) FROM applications").fetchone()[0],
        "products": cur.execute("SELECT COUNT(*) FROM products").fetchone()[0],
        "submissions": n_sub,
        "application_docs": n_docs,
    }
    conn.close()
    print("导入完成:", stats)
    print("数据库:", DB_PATH)


if __name__ == "__main__":
    main()
