#!/usr/bin/env python3
"""Download openFDA drug label partitions and build fda_labels.db.

- labels: all records (FTS5 on indications)
- label_deep: only records whose application_number matches an approved
  application in fda_drugs.db; long text fields zlib-compressed as BLOBs
- meta: partition import progress (resumable)
"""
import json
import os
import sqlite3
import subprocess
import sys
import time
import zlib
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
PART_DIR = os.path.join(BASE, "data", "label_partitions")
URLS_FILE = os.path.join(PART_DIR, "urls.json")
DB_OUT = os.path.join(BASE, "fda_labels.db")
DB_DRUGS = os.path.join(BASE, "fda_drugs.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id TEXT UNIQUE,
    application_number TEXT,
    brand_name TEXT,
    generic_name TEXT,
    effective_time TEXT,
    has_boxed_warning INTEGER DEFAULT 0,
    indications TEXT
);
CREATE TABLE IF NOT EXISTS label_deep (
    set_id TEXT PRIMARY KEY,
    boxed_warning BLOB,
    warnings BLOB,
    adverse_reactions BLOB,
    clinical_studies BLOB
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def pack(text):
    if not text:
        return None
    return zlib.compress(text.encode("utf-8"), 6)


def first(arr):
    if isinstance(arr, list) and arr:
        return str(arr[0])
    return None


def load_approved_appnos():
    conn = sqlite3.connect(DB_DRUGS)
    rows = conn.execute(
        "SELECT appl_type || appl_no FROM applications"
    ).fetchall()
    conn.close()
    return {r[0] for r in rows}


def download(url, dest, tries=3):
    for attempt in range(1, tries + 1):
        r = subprocess.run(
            ["curl", "-sL", "--fail", "--max-time", "1800", "-o", dest, url],
            capture_output=True, text=True,
        )
        if r.returncode == 0 and os.path.getsize(dest) > 1024:
            return True
        print(f"    download attempt {attempt} failed: {r.stderr.strip()[:200]}")
        time.sleep(3 * attempt)
    return False


def init_db():
    conn = sqlite3.connect(DB_OUT)
    conn.executescript(SCHEMA)
    # FTS5 内容无关表，rowid 对应 labels.id
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS indications_fts "
        "USING fts5(indications, content='')"
    )
    conn.commit()
    return conn


def done_partitions(conn):
    rows = conn.execute(
        "SELECT value FROM meta WHERE key LIKE 'partition:%'"
    ).fetchall()
    return {r[0] for r in rows}


def import_partition(conn, path, approved, stats):
    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if n.endswith(".json")]
        if not names:
            raise RuntimeError("no json in zip")
        with zf.open(names[0]) as f:
            payload = json.load(f)
    results = payload.get("results", [])

    ins_label = (
        "INSERT OR IGNORE INTO labels "
        "(set_id, application_number, brand_name, generic_name, "
        "effective_time, has_boxed_warning, indications) "
        "VALUES (?,?,?,?,?,?,?)"
    )
    ins_fts = "INSERT INTO indications_fts (rowid, indications) VALUES (?,?)"
    ins_deep = (
        "INSERT OR IGNORE INTO label_deep "
        "(set_id, boxed_warning, warnings, adverse_reactions, clinical_studies) "
        "VALUES (?,?,?,?,?)"
    )

    n_labels = n_deep = 0
    cur = conn.cursor()
    cur.execute("BEGIN")
    for rec in results:
        set_id = rec.get("set_id")
        if not set_id:
            continue
        openfda = rec.get("openfda", {}) or {}
        appnos = openfda.get("application_number") or []
        indications = first(rec.get("indications_and_usage"))
        boxed = first(rec.get("boxed_warning"))
        warnings = first(rec.get("warnings_and_cautions")) or first(rec.get("warnings"))
        adverse = first(rec.get("adverse_reactions"))
        studies = first(rec.get("clinical_studies"))

        cur.execute(
            ins_label,
            (
                set_id,
                first(appnos),
                first(openfda.get("brand_name")),
                first(openfda.get("generic_name")),
                rec.get("effective_time"),
                1 if boxed else 0,
                indications,
            ),
        )
        if cur.rowcount == 0:
            continue  # set_id 已存在（重复记录）
        rowid = cur.lastrowid
        if indications:
            cur.execute(ins_fts, (rowid, indications))
        n_labels += 1

        # 命中获批申请（数组中任一申请号匹配即算）
        if any(a in approved for a in appnos):
            ub = sum(len(t or "") for t in (boxed, warnings, adverse, studies))
            blobs = [pack(boxed), pack(warnings), pack(adverse), pack(studies)]
            cb = sum(len(b or b"") for b in blobs)
            stats["uncompressed"] += ub
            stats["compressed"] += cb
            cur.execute(ins_deep, (set_id, *blobs))
            n_deep += 1
    conn.commit()
    return n_labels, n_deep, len(results)


def main():
    urls = json.load(open(URLS_FILE))
    approved = load_approved_appnos()
    print(f"approved application_numbers in fda_drugs.db: {len(approved)}")

    conn = init_db()
    done = done_partitions(conn)
    stats = {"uncompressed": 0, "compressed": 0}
    failed = []

    # 已压缩字节数从 meta 恢复（断点续跑时统计口径一致）
    prev = conn.execute("SELECT value FROM meta WHERE key='byte_stats'").fetchone()
    if prev:
        stats = json.loads(prev[0])

    t_all = time.time()
    for i, url in enumerate(urls, 1):
        tag = f"part{i:02d}"
        if tag in done:
            print(f"[{tag}] already imported, skip")
            continue
        dest = os.path.join(PART_DIR, f"{tag}.zip")
        print(f"[{tag}] downloading ...")
        t0 = time.time()
        if not download(url, dest):
            failed.append(tag)
            print(f"[{tag}] DOWNLOAD FAILED, skipping")
            continue
        mb = os.path.getsize(dest) / 1024 / 1024
        print(f"[{tag}] downloaded {mb:.0f} MB in {time.time()-t0:.0f}s, importing ...")
        t0 = time.time()
        try:
            n_labels, n_deep, n_raw = import_partition(conn, dest, approved, stats)
        except Exception as e:  # noqa: BLE001
            failed.append(tag)
            print(f"[{tag}] IMPORT ERROR: {e}, skipping")
            conn.rollback()
            continue
        finally:
            if os.path.exists(dest):
                os.remove(dest)  # 处理完即删 zip
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)",
            (f"partition:{tag}", tag),
        )
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('byte_stats', ?)",
            (json.dumps(stats),),
        )
        conn.commit()
        print(
            f"[{tag}] raw={n_raw} imported labels={n_labels} deep={n_deep} "
            f"in {time.time()-t0:.0f}s"
        )

    total_labels = conn.execute("SELECT COUNT(*) FROM labels").fetchone()[0]
    total_deep = conn.execute("SELECT COUNT(*) FROM label_deep").fetchone()[0]
    fts_count = conn.execute("SELECT COUNT(*) FROM indications_fts").fetchone()[0]
    db_size = os.path.getsize(DB_OUT) / 1024 / 1024 / 1024
    print("\n===== SUMMARY =====")
    print(f"labels: {total_labels}  (fts rows: {fts_count})")
    print(f"label_deep: {total_deep}")
    print(
        f"deep text bytes: {stats['uncompressed']/1e9:.2f} GB uncompressed -> "
        f"{stats['compressed']/1e9:.2f} GB compressed"
    )
    print(f"db file size: {db_size:.2f} GB")
    print(f"failed partitions: {failed or 'none'}")
    print(f"total elapsed: {(time.time()-t_all)/60:.1f} min")
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
