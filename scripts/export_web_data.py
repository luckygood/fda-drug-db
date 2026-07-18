#!/usr/bin/env python3
"""Export FDA drug data from fda_drugs.db to JSON for the static web app."""
import json
import os
import sqlite3

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "fda_drugs.db")
OUT_DIR = os.path.join(BASE, "fda-drug-web", "public", "data")
os.makedirs(OUT_DIR, exist_ok=True)

PRODUCT_FIELDS = [
    "application_number", "appl_type", "drug_name", "active_ingredient",
    "form", "strength", "sponsor_name", "approval_date", "marketing_status",
    "te_code",
]

SUB_FIELDS = ["submission_type", "submission_no", "submission_status",
              "status_date", "submission_class", "review_priority"]
DOC_FIELDS = ["doc_title", "doc_url", "doc_date"]

TARGET_MAX = 12 * 1024 * 1024  # 12 MB budget for details.json


def fetch_products(conn):
    cols = ", ".join(PRODUCT_FIELDS)
    cur = conn.execute(f"SELECT {cols} FROM v_drug_overview")
    rows = [list(r) for r in cur.fetchall()]
    return rows


def build_details(conn, sub_limit, doc_limit):
    """Build details dict keyed by application_number.

    Product rows are NOT duplicated here: the detail view filters them from
    products.json (always loaded before the detail view is reachable), which
    keeps details.json within the 12 MB budget at 25 submissions / 25 docs.
    """
    details = {}

    # Ensure every application_number has an entry
    for (app_no,) in conn.execute("SELECT DISTINCT application_number FROM v_drug_overview"):
        details[app_no] = {"submissions": [], "docs": []}

    # Submissions: latest N per appl_no, ordered by status_date DESC
    sub_cols = ", ".join(SUB_FIELDS)
    sub_sql = f"""
        SELECT appl_no, appl_type, {sub_cols} FROM (
            SELECT a.appl_no, a.appl_type, s.*,
                   ROW_NUMBER() OVER (PARTITION BY s.appl_no ORDER BY s.status_date DESC) rn
            FROM submissions s
            JOIN (SELECT DISTINCT substr(application_number, 1, 3) AS appl_type,
                         substr(application_number, 4) AS appl_no
                  FROM v_drug_overview) a
              ON a.appl_no = s.appl_no
        ) WHERE rn <= ?
        ORDER BY status_date DESC
    """
    for r in conn.execute(sub_sql, (sub_limit,)):
        appl_no, appl_type = r[0], r[1]
        app_no = f"{appl_type}{appl_no}"
        d = details.get(app_no)
        if d is not None:
            d["submissions"].append(list(r[2:]))

    # Docs: latest N per appl_no, ordered by doc_date DESC
    doc_cols = ", ".join(DOC_FIELDS)
    doc_sql = f"""
        SELECT appl_no, appl_type, {doc_cols} FROM (
            SELECT a.appl_no, a.appl_type, d.*,
                   ROW_NUMBER() OVER (PARTITION BY d.appl_no ORDER BY d.doc_date DESC) rn
            FROM application_docs d
            JOIN (SELECT DISTINCT substr(application_number, 1, 3) AS appl_type,
                         substr(application_number, 4) AS appl_no
                  FROM v_drug_overview) a
              ON a.appl_no = d.appl_no
        ) WHERE rn <= ?
        ORDER BY doc_date DESC
    """
    for r in conn.execute(doc_sql, (doc_limit,)):
        appl_no, appl_type = r[0], r[1]
        app_no = f"{appl_type}{appl_no}"
        d = details.get(app_no)
        if d is not None:
            d["docs"].append(list(r[2:]))

    return details


def write_json(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(path)


def main():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    # Check available columns in submissions/application_docs for appl_type join
    # (submissions may not have appl_type; verify)
    sub_cols = [r[1] for r in conn.execute("PRAGMA table_info(submissions)")]
    doc_cols = [r[1] for r in conn.execute("PRAGMA table_info(application_docs)")]
    print("submissions columns:", sub_cols)
    print("application_docs columns:", doc_cols)

    # 1) products.json
    rows = fetch_products(conn)
    products = {"fields": PRODUCT_FIELDS, "rows": rows}
    p_path = os.path.join(OUT_DIR, "products.json")
    p_size = write_json(products, p_path)
    print(f"products.json: {p_size/1024/1024:.2f} MB ({len(rows)} rows)")

    # 2) details.json — try 25/25, shrink if over budget
    d_path = os.path.join(OUT_DIR, "details.json")
    for sub_limit, doc_limit in [(25, 25), (20, 20), (15, 15)]:
        details = build_details(conn, sub_limit, doc_limit)
        payload = {
            "submission_fields": SUB_FIELDS,
            "doc_fields": DOC_FIELDS,
            "records": details,
        }
        d_size = write_json(payload, d_path)
        print(f"details.json (sub={sub_limit}, doc={doc_limit}): "
              f"{d_size/1024/1024:.2f} MB ({len(details)} applications)")
        if d_size <= TARGET_MAX:
            break
        print("  over budget, retrying with fewer rows...")

    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
