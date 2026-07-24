# DATA_DICTIONARY · fda-drug-db 数据字典

全部数据为静态 JSON（`public/data/`），GitHub Pages 托管，CORS 开放，免密钥无速率限制。
在线目录与逐字段说明见站点「开放数据」页；本文件为仓库侧完整版。

通用约定：

- 成分键统一为 **大写活性成分名**（FDA 原文，复方以 `; ` 分隔），跨数据集可直接 join。
- 多数构建脚本经 `scripts/build_common.py:write_dataset()` 写入，自动附加
  `generated_at`（ISO 日期）+ `method_version`（当前 1.1），并在 `scripts/snapshots/` 保留最近 3 份快照。
- `public/data/manifest.json`（`scripts/build_manifest.py` 生成）汇总全部顶层文件的 generated_at / method_version / 字节数，站点「开放数据」页据此展示鲜度。
- 许可：公开数据整理，免费使用，引用请注明 fda-drug-db。数据仅供研究参考，不构成医疗或投资建议。

---

## 核心实体

### products.json — FDA 产品主表
Drugs@FDA 全量产品行（NDA/ANDA/BLA，含撤市）。
`fields`（列名）+ `rows`（行）：application_number / appl_type / drug_name / active_ingredient / form / strength / sponsor / approval_date / marketing_status。
口径：appl_type ∈ NDA（新药）/ ANDA（仿制药）/ BLA（生物制品）；approval_date 为该产品首个获批日。

### details.json — 申请提交与审评文档
`submission_fields` / `doc_fields` / `records`（键 = 申请号 → { submissions, docs }）；文档链接指向 FDA 官方 PDF。

### stats.json — 站点总览统计
`yearly_by_type`（分年 NDA/ANDA/BLA，incomplete_year 标记不完整年）、`nme_by_year`、`priority_by_year`、`top_sponsors`、`top_ingredients`、`dosage_forms`、`headline`。由 products.json 聚合。

### lifecycle_index.json — 成分生命周期索引
`records`（成分 → 档案）：stage / first_approval / originator / n_anda / n_anda_companies / months_to_expiry / shortage_risk(high|medium|null) / withdrawn。
阶段口径：引入期 = 首获批 <2 年；仿制成熟期 = 已有 ANDA 竞争；其余按上市年限与竞争状态划分。

### entity_map.json — 实体关系层
`ingredients`（成分 → { diseases≤20, companies≤30, trials≤20, *_total }）、
`diseases`（slug → { ingredients≤50, ingredients_total, trial_count, trials_coverage: covered|not_covered }）、
`companies`（slug → { name, ingredients≤50, ingredients_total }）。
注意：not_covered ≠ 0 项试验。

### companies/ — 企业画像分片
`index.json`（slug / name / name_zh / active_products / nme_count）+ `A-Z.json`（stats / timeline / nme_list / diseases / top_products / variants）+ `sponsor_map.json`（名称变体 → slug）。企业名已归一合并；name_zh 为手工别名（部分有）。

### diseases/ — 疾病视角分片
`index.json`（diseases[{slug, name_zh, name_en, area, drug_count, newest_drug}] + areas）+ `<slug>.json`（单病种药物清单）+ `app_index.json`（申请号 → slug 反查）。102 病种矩阵，自动映射可能少量错配。

### api/ — 成分透视分片
`<首字母>.json`，键 = 成分名，成分级详情（products / 概要）。

### cards/ — 药品概要卡分片
`index.json`（申请号 → 分片映射）+ 分片文件（申请号 → 概要卡）。为搜索性能预生成；权威数据以 products/details 为准。

### biologics.json — 生物制品年度统计
`yearly[{yr, bla, nda, share, bla_nme}]`、`top_sponsors`、`latest_share`。

### china_pharma.json — 中国药企出海专题
`summary`、`companies[{slug, name, name_zh, applications, active, nda, anda, bla}]`、`timeline`、`innovation`、`pipeline`。
口径：「中国背景企业」为手工策展名单，非官方口径。

### mining.json — 深度挖掘聚合
`disease_heatmap[{slug, name_zh, area, drug_count, recent5, boxed_pct}]`、`broad_spectrum`、`nme`、`generic_cliff`、`supply_risk`、`lifecycle`。

### disease_network.json — 疾病共病网络
`nodes[{slug, name_zh, area, drug_count}]`、`edges[{source, target, weight, shared, examples}]`；边权重 = 共享药物比例，仅 102 病种矩阵内。

---

## 可及性

### global_access.json — FDA×EMA×PMDA 批准对齐
范围：2020-01-01 起 FDA 首次获批 NDA/BLA 成分（708 个）。
`records`：ema_status（authorised/withdrawn/refused/other/null）、ema_first_date、ema_product、match_type（exact/normalized/unmatched）、pmda_status（approved/not_found）、pmda_first_date；`lag_stats` 三地时滞统计。
EMA unmatched ≠ 未批（含非集中审批路径）；PMDA 清单 2004 年起。

### cn_access.json — NMPA（中国）批准状态（正向确认版）
`records`：cn_status（approved / unknown，**本版无 not_found**）、cn_first_year、cn_product_count、match_type（curated_seed / no_positive_evidence）、source（出处 URL）。
**口径警告**：CDE 直连被反爬拦截，approved 仅来自公开文献正向确认（种子 `scripts/cn_approved_seed.json`，6 个出处）；unknown ≠ 未批；2021/2022 覆盖薄弱。决策前必须人工核实 CDE。

### rxnorm_map.json — RxNorm 归一映射
`ingredients`：rxcui（598/708 命中；复方 null + note=combo_skipped）、synonyms（含 SBD 剂型噪音）。

### nme_annual.json — 年度 NME 全景
年度 → ingredients[{name, date, company, mol_type, diseases, global_status}]；NME 为 FDA 定义；当年数据不完整。

### biosimilars.json — 生物类似药（紫皮书）
`reference_products`、`exclusivity_window`、`kpis`；`pb_version` 为紫皮书版本戳。

---

## 证据

### ingredient_pubmed.json — 成分 PubMed 证据
`ingredients` → { clinical_count, review_count, recent[{pmid, title, journal, pubdate}] }；`window` 计量窗口。仅覆盖重点成分。

### disease_pubmed.json — 疾病 PubMed 证据
同构，仅 22 个高数据量疾病；未覆盖疾病不得显示为 0。

### ct_disease.json / ct_ingredient.json — ClinicalTrials.gov 索引
`diseases`/`ingredients` → { total, by_status, by_phase, top[{nct, title, phase, status, start_date}] }。
API v2 检索口径（疾病含同义词扩展，计数偏宽）；查询失败以 error 字段区分（失败 ≠ 0 项）。

### label_summary.json — 说明书要点摘要
`ingredients` → { drug_name, application_number, efficacy.key_results[], safety.boxed_warning }。
摘自最早原始 NDA/BLA 首批准说明书，自动摘录；当前覆盖率约 46%（优先近年新分子）。

---

## 安全

### label_safety.json — 标签安全信号索引
`ingredients` → { boxed_warning, bw_excerpt, label_effective_date }；openFDA 现行标签口径。

### safety_boxed.json — 黑框警告专题统计
`coverage`（label_docs / boxed_texts / boxed_rate）、`era_rates[{era, apps, boxed, rate}]`、`themes[{key, name_zh, count, examples}]`（规则归类，可多主题）、`nme_boxed`。

### withdrawn.json — 撤市产品专题
`total`、`by_decade`、`top_ingredients`、`recent`；撤市 = marketing_status Discontinued（含主动撤市，非全是安全原因）。

### supply_risk.json — 供应短缺风险
`kpis`、`high / medium / watch`、`shortage_multi`、`current_details`；`shortages_version` 版本戳。来源 FDA Drug Shortages。

---

## 指标

### report_metrics.json — 报告衍生指标
`diseases`（crowded_bucket / top_company 等）、`ingredients`（erosion / exclusivity_pct / evidence / global_score / mol_type）。规则模板衍生，供叙事解读。

### patent_cliff.json — 专利悬崖（橙皮书）
`patent_cliff`、`exclusivity_cliff`、`tentative_top`、`timelines`、`kpis`；`ob_version` 版本戳。

### generic_lag.json — 仿制药上市时滞
`n_matched`、`median_lag`、`lag_hist[{bucket, n}]`、`no_generic_old`、`top_competition`。

### monitor_summary.json — 数据管道监控摘要
`ob_version / shortages_version / pb_version`、`failures[]`（采集失败诚实披露）、`site_deployed`、`summary`。

---

## 管道地图（脚本 → 数据集 → 刷新顺序）

上游：`build_fda_db.py`（SQLite 主库）→ 导出层 → 专题构建层 → manifest。

| 脚本 | 产出 |
|---|---|
| `fetch_sources.py` | 橙皮书/短缺库/紫皮书原始落盘（data_lake） |
| `export_orangebook.py` | patent_cliff.json |
| `export_supply.py` | supply_risk.json |
| `export_purplebook.py` | biosimilars.json |
| `export_stats.py` / `export_web_data.py` | stats.json / products.json / details.json / biologics.json |
| `export_app_cards.py` | cards/ |
| `export_companies.py` | companies/ |
| `export_diseases.py` | diseases/ |
| `export_mining.py` | mining.json / disease_network.json / generic_lag.json / withdrawn.json |
| `export_safety_market.py` | safety_boxed.json / withdrawn.json |
| `export_china.py` | china_pharma.json |
| `build_lifecycle_index.py` | lifecycle_index.json |
| `build_entity_map.py` | entity_map.json |
| `build_global_access.py` | global_access.json |
| `build_rxnorm_map.py` | rxnorm_map.json |
| `build_cn_access.py`（+ `cn_approved_seed.json`） | cn_access.json |
| `build_nme_annual.py` | nme_annual.json |
| `build_ingredient_pubmed.py` | ingredient_pubmed.json |
| `build_disease_pubmed.py` | disease_pubmed.json |
| `build_ct_trials.py` | ct_disease.json / ct_ingredient.json |
| `build_label_summary.py` | label_summary.json |
| `build_label_safety.py` | label_safety.json |
| `build_report_metrics.py` / `build_ingredient_types.py` | report_metrics.json |
| `build_monitor_summary.py` | monitor_summary.json |
| `build_manifest.py` | manifest.json（**最后运行**） |

月度主线见 `scripts/RUNBOOK.md` 与 `scripts/monthly_refresh.sh`；
本目录专题脚本在其后按上表依赖序追加运行，`build_manifest.py` 永远最后。
