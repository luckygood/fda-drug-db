#!/usr/bin/env python3
"""月更抓取：三个外部数据源 → data_lake/（幂等，单源失败不拖垮整体）

源 1：openFDA 橙皮书全量 zip   download.open.fda.gov/drug/orangebook/...
源 2：openFDA 短缺库全量 zip   download.open.fda.gov/drug/shortages/...
源 3：紫皮书月度 CSV           accessdata.fda.gov/.../PurpleBook/<年>/purplebook-search-<月份>-data-download.csv
      （fda.gov 主站对本机有 Akamai 反爬，经 allorigins 公共代理中转，多重试）

每个源独立 try/except：成功则覆盖 data_lake 对应文件并记录版本；失败则保留旧文件，
在报告 JSON 的 failures 里记录原因。退出码：全部成功 0 / 部分失败 2 / 全部失败 1。

产出报告：data_lake/fetch_report.json
  { "generated_at", "sources": { "<name>": {"ok", "version", "path", "records", "skipped"} }, "failures": [] }

运行：从工作区根目录  python3 fda-drug-web/scripts/fetch_sources.py
"""
import json
import re
import subprocess
import sys
import time
import urllib.parse
import zipfile
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LAKE = ROOT / "data_lake"
REPORT = LAKE / "fetch_report.json"

OB_DIR = LAKE / "orangebook"
SH_DIR = LAKE / "shortages"
PB_DIR = LAKE / "purplebook"

OB_ZIP_URL = "https://download.open.fda.gov/drug/orangebook/drug-orangebook-0001-of-0001.json.zip"
SH_ZIP_URL = "https://download.open.fda.gov/drug/shortages/drug-shortages-0001-of-0001.json.zip"
OB_JSON = OB_DIR / "drug-orangebook-0001-of-0001.json"
SH_JSON = SH_DIR / "drug-shortages-0001-of-0001.json"

# fda.gov 主站 Akamai 拦截 → allorigins 代理（间歇可用，需多重试）
PROXY = "https://api.allorigins.win/raw?url="

_MONTHS = ["January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"]

TODAY = date.today()


def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def curl_get(url, out_path, retries=4, timeout=300, head_ok=False):
    """curl 下载到文件，带重试。返回 (ok, err)。"""
    for attempt in range(1, retries + 1):
        try:
            r = subprocess.run(
                ["curl", "-sS", "-L", "--fail", "--max-time", str(timeout),
                 "-o", str(out_path), url],
                capture_output=True, text=True, timeout=timeout + 30,
            )
            if r.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
                return True, ""
            err = f"rc={r.returncode} {r.stderr.strip()[:200]}"
        except Exception as e:  # noqa: BLE001
            err = repr(e)[:200]
        log(f"  第 {attempt}/{retries} 次下载失败：{err}")
        if attempt < retries:
            time.sleep(8)
    return False, err


def read_version_from_openfda_json(json_path):
    """openFDA 全量 JSON 的 meta.last_updated -> 'YYYY-MM-DD'"""
    try:
        with open(json_path, encoding="utf-8") as f:
            head = f.read(4096)
        m = re.search(r'"last_updated"\s*:\s*"(\d{4})-?(\d{2})-?(\d{2})"', head)
        if m:
            return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    except Exception:  # noqa: BLE001
        pass
    return None


def count_records_openfda(json_path):
    try:
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)
        return len(data.get("results", []))
    except Exception:  # noqa: BLE001
        return None


def fetch_openfda_zip(name, zip_url, target_json, dest_dir):
    """下载 openFDA 全量 zip 并解压出 0001-of-0001.json。成功才覆盖旧文件。"""
    log(f"[{name}] 下载 {zip_url}")
    tmp_zip = dest_dir / f".tmp-{name}.zip"
    ok, err = curl_get(zip_url, tmp_zip, retries=4)
    if not ok:
        return {"ok": False, "error": f"下载失败：{err}"}
    try:
        with zipfile.ZipFile(tmp_zip) as z:
            member = target_json.name
            if member not in z.namelist():
                member = [n for n in z.namelist() if n.endswith(".json")][0]
            tmp_json = dest_dir / f".tmp-{target_json.name}"
            with z.open(member) as src, open(tmp_json, "wb") as dst:
                dst.write(src.read())
        # 校验 JSON 可解析且非空
        with open(tmp_json, encoding="utf-8") as f:
            probe = json.load(f)
        n = len(probe.get("results", []))
        if n == 0:
            raise ValueError("results 为空")
        version = probe.get("meta", {}).get("last_updated", "")
        if len(version) == 8 and version.isdigit():
            version = f"{version[:4]}-{version[4:6]}-{version[6:]}"
        tmp_json.replace(target_json)
        # 保留原始 zip 存档（以版本命名）
        if version:
            tmp_zip.replace(dest_dir / f"{target_json.stem.replace('-0001-of-0001', '')}-{version.replace('-', '')}.json.zip")
        else:
            tmp_zip.unlink(missing_ok=True)
        log(f"[{name}] 成功：version={version} records={n}")
        return {"ok": True, "version": version, "records": n, "path": str(target_json.relative_to(ROOT))}
    except Exception as e:  # noqa: BLE001
        tmp_zip.unlink(missing_ok=True)
        return {"ok": False, "error": f"解压/校验失败：{repr(e)[:200]}"}


def pb_candidate_urls(today):
    """紫皮书月度 CSV 候选：当月 → 上月 → 上上月（月初发布可能滞后）。"""
    cands = []
    y, m = today.year, today.month
    for _ in range(3):
        month_name = _MONTHS[m - 1]
        url = (f"https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/{y}/"
               f"purplebook-search-{month_name}-data-download.csv")
        cands.append((y, m, month_name, url))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return cands


def existing_pb_versions():
    """已落盘的紫皮书 CSV -> {(year, month): path}"""
    out = {}
    for p in PB_DIR.glob("purplebook-search-*-data-download.csv"):
        mm = re.search(r"purplebook-search-([A-Za-z]+)(?:-(\d{4}))?-data-download", p.name)
        if not mm:
            continue
        mon = _MONTHS.index(mm.group(1).capitalize()) + 1 if mm.group(1).capitalize() in _MONTHS else None
        if mon:
            out[(int(mm.group(2)) if mm.group(2) else TODAY.year, mon)] = p
    return out


def fetch_purplebook():
    """紫皮书 CSV：优先抓当月/近月新版；新版不可得时若本地已有同月文件则视为成功（幂等）。"""
    have = existing_pb_versions()
    last_err = ""
    for y, m, month_name, url in pb_candidate_urls(TODAY):
        version = f"{y}-{m:02d}"
        if (y, m) in have:
            log(f"[purplebook] 本地已有 {version} 版（{have[(y, m)].name}），跳过下载")
            return {"ok": True, "version": version, "records": None,
                    "path": str(have[(y, m)].relative_to(ROOT)), "skipped": True}
        fname = f"purplebook-search-{month_name}-{y}-data-download.csv"
        tmp = PB_DIR / f".tmp-{fname}"
        proxied = PROXY + urllib.parse.quote(url, safe="")
        log(f"[purplebook] 尝试 {version}：{url}（经 allorigins，最多 6 次重试）")
        ok, err = curl_get(proxied, tmp, retries=6, timeout=180)
        if not ok:
            last_err = f"{version}: {err}"
            tmp.unlink(missing_ok=True)
            continue
        # 校验：CSV 且含 BLA Number 表头（代理故障时会返回 HTML/空）
        try:
            head = tmp.read_text(encoding="utf-8-sig", errors="replace")[:8192]
        except Exception as e:  # noqa: BLE001
            head = ""
            last_err = f"{version}: 读取失败 {repr(e)[:120]}"
        if "BLA Number" not in head and "BLA Number" not in tmp.read_text(encoding="utf-8-sig", errors="replace")[:200000]:
            last_err = f"{version}: 内容校验失败（无 BLA Number 表头，疑似代理错误页）"
            log(f"[purplebook] {last_err}")
            tmp.unlink(missing_ok=True)
            continue
        dest = PB_DIR / fname
        tmp.replace(dest)
        log(f"[purplebook] 成功：version={version} -> {fname}")
        return {"ok": True, "version": version, "records": None,
                "path": str(dest.relative_to(ROOT))}
    return {"ok": False, "error": f"近 3 个月候选均失败。最后错误：{last_err}"}


def main():
    LAKE.mkdir(exist_ok=True)
    for d in (OB_DIR, SH_DIR, PB_DIR):
        d.mkdir(exist_ok=True)

    sources = {}
    failures = []

    jobs = [
        ("orangebook", lambda: fetch_openfda_zip("orangebook", OB_ZIP_URL, OB_JSON, OB_DIR), OB_JSON),
        ("shortages", lambda: fetch_openfda_zip("shortages", SH_ZIP_URL, SH_JSON, SH_DIR), SH_JSON),
        ("purplebook", fetch_purplebook, None),
    ]
    for name, fn, fallback in jobs:
        try:
            res = fn()
        except Exception as e:  # noqa: BLE001
            res = {"ok": False, "error": f"未捕获异常：{repr(e)[:200]}"}
        if not res.get("ok"):
            # 旧文件仍在则降级可用
            stale = fallback is not None and fallback.exists()
            if stale:
                res["stale_fallback"] = True
                old_ver = read_version_from_openfda_json(fallback)
                if old_ver:
                    res["stale_version"] = old_ver
            failures.append({"source": name, "error": res.get("error", "未知错误"),
                             "stale_data_kept": bool(stale)})
        sources[name] = res

    n_fail = len(failures)
    report = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "sources": sources,
        "failures": failures,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"抓取完成：{3 - n_fail}/3 成功。报告 -> {REPORT.relative_to(ROOT)}")
    for f in failures:
        log(f"  失败源 {f['source']}: {f['error']}（保留旧数据={f['stale_data_kept']}）")

    sys.exit(0 if n_fail == 0 else (2 if n_fail < 3 else 1))


if __name__ == "__main__":
    main()
