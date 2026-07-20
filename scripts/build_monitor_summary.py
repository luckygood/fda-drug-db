#!/usr/bin/env python3
"""生成 public/data/monitor_summary.json（看板 Widget 消费的月更监控摘要）

从三个成品 JSON（patent_cliff / supply_risk / biosimilars）提取 KPI 与榜单，
合并 fetch_report.json 的抓取失败列表，外加 CLI 传入的额外失败（导出/构建/部署）。

site_deployed 语义：线上 Pages 服务到的这份文件本身即证明部署成功，故恒为 true；
仅当本运部署失败时 monthly_refresh.sh 会以 --site-deployed false 重跑本脚本
（该副本只留在本地，不会推送），如实反映"新数据未上线"。

运行（从工作区根目录）：
  python3 fda-drug-web/scripts/build_monitor_summary.py \
      [--site-deployed false] [--extra-failure "export_supply: 退出码 1"] ...
"""
import argparse
import json
import sqlite3
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "fda-drug-web/public/data"
DRUGS_DB = ROOT / "fda_drugs.db"
FETCH_REPORT = ROOT / "data_lake/fetch_report.json"
OUT = DATA / "monitor_summary.json"

TOP_N = 8


def load(name):
    with open(DATA / name, encoding="utf-8") as f:
        return json.load(f)


def sole_supplier_map(drugs_db, ingredients):
    """高风险成分 → 在售唯一持证商：直接在 fda_drugs.db 按成分精确匹配在售产品，
    取涉及申请的 sponsor_name（单一来源时恰为 1 家）。"""
    out = {i: "" for i in ingredients}
    if not ingredients or not Path(drugs_db).exists():
        return out
    con = sqlite3.connect(f"file:{drugs_db}?mode=ro", uri=True)
    q = ",".join("?" * len(ingredients))
    rows = con.execute(
        f"""SELECT p.active_ingredient, a.sponsor_name
            FROM products p JOIN applications a ON a.appl_no = p.appl_no
            WHERE p.active_ingredient IN ({q}) AND p.marketing_status_id IN (1, 2)""",
        tuple(ingredients),
    ).fetchall()
    con.close()
    by_ing = {}
    for ing, sp in rows:
        by_ing.setdefault(ing, set()).add(sp)
    for ing, sps in by_ing.items():
        if len(sps) == 1:
            out[ing] = next(iter(sps))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-deployed", default="true", choices=["true", "false"])
    ap.add_argument("--extra-failure", action="append", default=[])
    args = ap.parse_args()
    today = date.today()

    pc = load("patent_cliff.json")
    sr = load("supply_risk.json")
    bs = load("biosimilars.json")

    # ---- patent.top：最早到期升序前 8 ----
    p_top = []
    for r in pc["patent_cliff"][:TOP_N]:
        try:
            exp = date.fromisoformat(r["earliest_expiry"])
            days_left = (exp - today).days
        except Exception:  # noqa: BLE001
            days_left = None
        p_top.append({
            "ingredient": r["ingredient"],
            "brand": r["brands"][0] if r.get("brands") else "",
            "earliest_expiry": r["earliest_expiry"],
            "days_left": days_left,
            "n_patents": r["n_patents_window"],
            "tentative": r["tentative_andas"],
        })

    # ---- supply.top_high：最近更新降序前 8 ----
    highs = sorted(sr["high"], key=lambda r: r.get("latest_update") or "", reverse=True)[:TOP_N]
    sup_map = sole_supplier_map(DRUGS_DB, [h["ingredient"] for h in highs])
    s_top = [{
        "ingredient": h["ingredient"],
        "status": "Currently in Shortage",
        "update_date": h.get("latest_update") or "",
        "sole_supplier": sup_map.get(h["ingredient"], ""),
    } for h in highs]

    # ---- bio.top：类似药 BLA 数降序前 8 ----
    b_refs = sorted(bs["reference_products"], key=lambda r: r["n_biosimilar_blas"], reverse=True)[:TOP_N]
    b_top = [{
        "ref": r["ref_proper_name"].upper(),
        "brands": "/".join(r["ref_brands"][:2]),
        "n_biosim": r["n_biosimilar_blas"],
        "n_interch": r["n_interchangeable_blas"],
    } for r in b_refs]
    # 去重 351(k) BLA 总数（并集口径：同一 BLA 可能同时出现在 biosimilar/interchangeable 两侧）
    blas_union = {b["bla_number"] for rp in bs["reference_products"] for b in rp["biosimilars"]}

    # ---- failures：抓取报告 + CLI 追加 ----
    failures = []
    if FETCH_REPORT.exists():
        try:
            fr = json.loads(FETCH_REPORT.read_text(encoding="utf-8"))
            for f in fr.get("failures", []):
                failures.append(f"fetch_{f['source']}: {f['error']}"
                                + ("（沿用旧数据）" if f.get("stale_data_kept") else ""))
        except Exception:  # noqa: BLE001
            failures.append("fetch_report.json 解析失败")
    failures.extend(args.extra_failure)

    out = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "ob_version": pc.get("ob_version", ""),
        "shortages_version": sr.get("shortages_version", ""),
        "pb_version": bs.get("pb_version", ""),
        "site_deployed": args.site_deployed == "true",
        "patent": {
            "window_months": pc["window"]["months"],
            "ingredients": pc["kpis"]["cliff_ingredients"],
            "patents": pc["kpis"]["cliff_patents"],
            "tentative_andas": pc["kpis"]["tentative_total_appls"],
            "top": p_top,
        },
        "supply": {
            "high_risk": sr["kpis"]["high_risk"],
            "medium_risk": sr["kpis"]["medium_risk"],
            "watch": sr["kpis"]["watch"],
            "top_high": s_top,
        },
        "bio": {
            "ref_products": bs["kpis"]["rp_with_biosimilars"],
            "biosimilar_blas": len(blas_union),
            "interchangeable": bs["kpis"]["blas_interchangeable"],
            "top": b_top,
        },
        "failures": failures,
        "summary": (
            f"橙皮书 {pc.get('ob_version','?')}：未来 {pc['window']['months']} 个月 "
            f"{pc['kpis']['cliff_ingredients']} 个成分、{pc['kpis']['cliff_patents']} 件专利到期；"
            f"短缺高风险 {sr['kpis']['high_risk']} 个（单一来源）；"
            f"紫皮书 {bs.get('pb_version','?')}：{bs['kpis']['rp_with_biosimilars']} 个参比制剂、"
            f"{len(blas_union)} 个 351(k) BLA。"
            + (f"本次 {len(failures)} 个环节失败。" if failures else "全部环节正常。")
        ),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"monitor_summary.json 已生成：failures={len(failures)} site_deployed={out['site_deployed']}")


if __name__ == "__main__":
    main()
