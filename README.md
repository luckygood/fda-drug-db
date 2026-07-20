# FDA 获批药品数据库 · 多维分析平台

一个基于 FDA 公开数据的纯静态网站：收录 **29,219 个药品申请、51,537 个产品、260,717 份说明书**，提供药品检索、疾病视角、行业统计、深度挖掘与企业画像五个分析视角，以及药品 / 疾病 / 企业一站式全局搜索。

- **线上地址**：https://luckygood.github.io/fda-drug-db/
- **数据源**：
  - [Drugs@FDA Download File](https://www.fda.gov/media/89850/download)（FDA 官方周更数据包，申请 / 产品 / 提交 / 文档等 TSV 表）
  - [openFDA drug label API](https://open.fda.gov/)（药品说明书全文，CC0）
- **数据快照日期**：2026-07-16
- **架构特点**：纯静态、零后端、零成本——数据经 Python 管道离线预聚合为 JSON，前端直接托管于 GitHub Pages

---

## 功能总览

| 页签 | 内容 |
|---|---|
| **药品查询** | 按药名 / 成分 / 申请号搜索 29,219 个申请、51,526 条产品记录；详情页含产品规格、审评历史（提交类型 / 分类 / 优先审评）、FDA 官方文档链接、有效性 / 安全性摘要卡、持证商与相关疾病链接 |
| **疾病视角** | 102 个病种（12 个治疗领域）的药物全景表：每个疾病的获批药物、获批时间线、黑框警告标记，以及摘自说明书原文的有效性 / 安全性摘要卡 |
| **数据洞察** | 行业层统计：年度获批趋势（NDA / ANDA / BLA 堆叠）、NME 年度数、优先审评占比、Top 持证商 / 成分、剂型分布 |
| **深度挖掘** | 六个专题：治疗领域创新热度（102 疾病气泡图）、疾病相似性网络（Jaccard 共享药）、广谱药物 Top 20、NME 专题、仿制药悬崖与可及性、注册生命周期曲线 |
| **企业画像** | 2,037 家归一化企业的档案：申请构成、获批时间线、NME 列表、疾病覆盖、在售产品；支持名称变体合并与中文别名检索 |
| **出海观察** | 中国药企 FDA 获批全景：62 个识别实体的申请构成与时间线、创新药（NME）专栏、企业排行、在途管线（暂定批准聚合） |
| **安全与市场** | 四个专题：黑框警告挖掘（年代携带率 / 主题分类 / 带黑框 NME）、撤市全景（23,389 产品）、首仿时滞（中位 14.5 年）、生物制剂崛起（BLA 份额曲线） |
| **专利与供应** | 三个外部数据源专题：专利悬崖（橙皮书 36 个月到期榜：504 成分 / 1,455 专利 / 独占期到期 / 暂定批准积压 Top 30 / ELIQUIS·IBRANCE 时间线）、供应风险（短缺 × 单一来源交叉：高风险 32 / 中 189 / 观察 936 / 当前短缺明细）、生物类似药（紫皮书：20 个参比分子覆盖 90 个 351(k) BLA、可互换格局、独占期事件） |
| **全局搜索** | 页头统一搜索框，一站式匹配药品（药名 / 成分）、疾病（中文 / 英文 / 同义词）、企业（归一名 / 中文别名 / 原始变体名） |

## 实体互链网络

三个核心实体（药品 / 疾病 / 企业）在所有页面间互相可达，任意入口都能走入数据网络：

```
                ┌─────────────┐  持证商链接   ┌─────────────┐
                │  药品详情页  │ ───────────► │  企业画像页  │
                │             │ ◄─────────── │  NME/产品表  │
                └──────┬──────┘              └──────┬──────┘
                       │                            │
           相关疾病 chips│                            │疾病覆盖 chips
                       ▼                            ▼
                ┌─────────────────────────────────────┐
                │            疾病视角页                │
                │  药物行→药品详情 · sponsor 列→企业   │
                └─────────────────────────────────────┘

全局搜索框 ──► 药品 / 疾病 / 企业 三类实体直达
深度挖掘页 ──► 药物行 → 药品详情
```

- 药品 → 企业：详情页头部持证商（经 `sponsor_map.json` 解析为归一化企业）
- 药品 → 疾病：详情页"相关疾病"区（经 `app_index.json` 反查）
- 疾病 → 企业：疾病页药物表 sponsor 列
- 企业 → 疾病：企业页疾病覆盖 chips
- 返回均回到来源页（前端路由记录 from 页）

## 技术架构

**前端**（本目录）：React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui（Radix 组件）+ ECharts 6。无路由库——页签与详情视图由 `App.tsx` 状态机驱动；所有数据经 `fetch` 读取 `public/data/` 下的静态 JSON，按 `import.meta.env.BASE_URL` 相对寻址。

**`base: './'` 相对路径设计**：`vite.config.ts` 中 `base` 设为 `'./'`，使构建产物可部署在任意子路径（如 `https://luckygood.github.io/fda-drug-db/`）而无需硬编码路径前缀；代价是 dev server 下数据文件挂在根路径（`/data/...`）而非 `/fda-drug-db/data/...`。

**数据管道**（`scripts/`，Python 3，标准库 + sqlite3）：Drugs@FDA TSV → SQLite（`fda_drugs.db`）；openFDA 说明书 JSON → SQLite + FTS5 全文索引（`fda_labels.db`，长文本 zlib 压缩为 BLOB）；再从两个库离线聚合出前端 JSON。

**托管**：GitHub Pages，发布 `gh-pages` 分支（仅含构建产物）。

## 数据集文档

所有文件位于 `public/data/`，前端构建时原样复制到产物。体积为当前快照值。

### products.json（7.4 MB，51,526 条）

- **生成**：`export_web_data.py`（源：`fda_drugs.db`）
- **结构**：`{fields: [...], rows: [[...], ...]}` 列式压缩，字段：`application_number, appl_type, drug_name, active_ingredient, form, strength, sponsor_name, approval_date, marketing_status, te_code`
- **用途**：药品查询页与详情页的主数据
- **口径**：`application_number = appl_type + appl_no`（如 `NDA021514`）；库内产品总数 51,537，11 条无药名等残缺记录未导出

### details.json（10.5 MB，28,865 个申请）

- **生成**：`export_web_data.py`
- **结构**：`{submission_fields, doc_fields, records: {application_number: {submissions, docs}}}`
- **用途**：详情页审评历史与 FDA 官方文档链接
- **口径**：仅收录有提交记录的申请（29,219 中的 28,865 个）；`submission_class` 为 FDA 申报分类（Type 1/2/…），`review_priority` 标记优先审评

### stats.json（数据洞察页）

- **生成**：`export_stats.py`
- **结构**：`yearly_by_type`（1995 起按年 NDA/ANDA/BLA）、`nme_by_year`、`priority_by_year`、`top_sponsors`、`top_ingredients`、`dosage_forms`、`headline`
- **口径**：`headline` = 申请 29,219 / 在售产品 26,708 / 撤市 23,389 / 暂定批准 724 / 2025 年 NME 50 / 原始持证商名 2,264；当年为不完整年度（图内注明）

### diseases/（102 个病种，共 18.9 MB）

- **生成**：`export_diseases.py`（源：`fda_labels.db` FTS 检索 + `fda_drugs.db`；断点续跑，已导出的疾病自动跳过）
- **index.json**：12 个治疗领域 + 102 疾病条目（`slug, name_zh, name_en, synonyms, area, drug_count, newest_approval, newest_drug, boxed_count`）
- **`<slug>.json`**（每疾病一个）：`approvals_by_year` + `drugs[]`（`application_number, drug_name, active_ingredient, sponsor_name, appl_type, approval_date, marketing_status, has_boxed_warning, efficacy_snippet, efficacy_card, safety_card`）；药物数 > 200 的疾病仅最近 200 个带摘要卡（`cards_truncated` 标记）
- **app_index.json**（0.75 MB，7,163 键）：药品→疾病反向索引 `{application_number: [{slug, name_zh}]}`，详情页"相关疾病"区数据源
- **摘要卡口径**：**提取式**（非生成式）——`efficacy_card`（`trials` 关键试验识别 + `key_results` 疗效关键词句抽取 + `source_section` 出处小节）、`safety_card`（`boxed_warning` / `warnings` / `common_adverse_reactions`），全部摘自 FDA 说明书原文；14,115 / 14,116 条疾病×药物记录带卡（覆盖率 100%）

### cards/（11.1 MB，37 个分片，12,083 个申请号）

- **生成**：`export_app_cards.py`（复用 `disease_drugs.py` 的提取逻辑；同一申请多版本说明书取 `effective_time` 最新）
- **结构**：`index.json`（分片规则说明 + 分片清单）+ 按申请号前缀分片的 `<TYPE>-<数字>.json`，每键为 `{efficacy_card, safety_card}`
- **用途**：详情页"有效性 / 安全性摘要"区（申请号语境，与疾病无关）；前端按 `<type>-前三位 > 前两位 > 整类` 的顺序定位分片

### companies/（3.5 MB，2,037 家企业）

- **生成**：`export_companies.py`
- **index.json**（329 KB）：全企业摘要，按在售产品数降序（`slug, name, name_zh, variants, applications, active_products, nme_count, first_year, latest_year`）
- **`<A-Z>.json / OTHER.json`**（27 个字母分片）：企业详情（`stats` 各类申请数 / 在售 / 撤市 / 暂定，`timeline` 逐年 NDA/ANDA/BLA，`nme_list` 含孤儿药与优先审评标记，`top_products` 在售前 30，`diseases` 疾病覆盖前 20，`variants` 原始名列表）
- **sponsor_map.json**（85 KB，2,857 键）：原始 sponsor 名（大写）→ 企业 slug，含归一名回退键；详情页 / 疾病页持证商链接的解析依据

### mining.json（35 KB，深度挖掘页）

- **生成**：`export_mining.py`
- **六块**：`disease_heatmap`（102 疾病 × 覆盖药物数 / 近 5 年获批 / 黑框占比）、`broad_spectrum`（广谱药物 Top 20）、`nme`（yearly 2010 起 / top_companies 2016 起 / latest 2025 起明细）、`generic_cliff`（仿制药悬崖）、`supply_risk`（单一来源与撤市趋势）、`lifecycle`（注册生命周期：`top_maintained` 按获批补充次数排序的维护榜、`span_hist` 跨度分布、`median_by_era` 年代中位跨度）

### china_pharma.json（15 KB，出海观察页）

- **生成**：`export_china.py`
- **结构**：`summary`（实体数 / 申请分列 / 在售 / NME / 暂定）、`timeline`（逐年 NDA/ANDA/BLA）、`companies`（62 实体明细按在售排序）、`innovation`（中国实体 NME 明细，含中文别名）、`pipeline`（暂定批准按成分聚合）
- **口径**：中国实体按归一化 sponsor 名做词边界关键词匹配（避免子串误报），人工排除非中资误报（如 HARMONY=美国公司）；部分中国原研由海外合作方持证（如 FRUZAQLA→TAKEDA），不计入

### disease_network.json（46 KB，深度挖掘页网络图）

- **生成**：`export_china.py`
- **结构**：`nodes`（102 疾病：slug / name_zh / area / drug_count）、`edges`（274 条：source / target / weight / shared / examples）
- **口径**：两疾病相似度 = 共享药物集合（药名+成分去重）的 Jaccard 系数；保留 weight≥0.15 或每节点 Top 3 强边（并集）

### safety_boxed.json（135 KB，安全与市场页）

- **生成**：`export_safety_market.py`（源：`fda_labels.db` 深度文本 + `fda_drugs.db`）
- **结构**：`coverage`（说明书文档 / 深度文本 / 带黑框申请数与携带率）、`era_rates`（按获批年代携带率）、`themes`（10 类警示主题计数与示例）、`nme_boxed`（370 个带黑框 NME：主题 + 原文节选 220 字符）
- **口径**：现行说明书快照，撤市药与部分老药无现行版本（分母偏倚，页面已注明）；主题为英文关键词归类，一药可中多主题

### withdrawn.json（6.5 KB，安全与市场页）

- **生成**：`export_safety_market.py`
- **结构**：`total`（23,389 撤市产品）、`by_decade`（原获批年代）、`top_ingredients` / `top_forms`（集中度）、`anchors`（知名安全撤市药校验）、`recent`（最后监管活动倒序前 30）
- **口径**：撤市时点用"该申请所有提交的最晚状态日期"代理；按产品计数

### generic_lag.json（4.2 KB，安全与市场页）

- **生成**：`export_safety_market.py`
- **结构**：`n_matched`（1,089 匹配成分）、`median_lag`（中位 14.5 年）、`lag_hist`（年度桶分布）、`no_generic_old`（获批 ≥10 年、有在售、无 ANDA 的成分前 20）、`top_competition`（ANDA 持证数 Top 15）、`anchors`（ATORVASTATIN 14.9 年 / OMEPRAZOLE 13.2 年校验值）
- **口径**：仅单成分、大小写/空白归一；ANDA 获批 ≠ 实际上架，未含专利和解等法律细节

### biologics.json（3.1 KB，安全与市场页）

- **生成**：`export_safety_market.py`
- **结构**：`yearly`（1985 起 BLA 获批数 / 占 NDA+BLA 比例 / BLA 类 NME 数）、`top_sponsors`（BLA 持证机构 Top 15，含中文别名）、`latest_share`（最新年份份额 28.3%）

### patent_cliff.json（332 KB，专利与供应页）

- **生成**：`export_orangebook.py`（读 openFDA `drug/orangebook` 端点全量数据，48,502 条，字段与 FDA 橙皮书月度数据一一对应；数据版本 **2026-07-18**，下载于 2026-07-19）
- **结构**：`window`（2026-07-19 ~ 2029-07-19，36 个月）、`kpis`（504 个到期成分 / 1,455 件窗口专利 / 涉及在售产品 7,267 个 / 全库暂定批准 ANDA 724 个）、`patent_cliff`（504 行，按最早到期日升序：成分 / 品牌 / 申请号 / 最早与最晚专利到期 / 窗口专利数 / 在售产品数 / 暂定 ANDA 数）、`exclusivity_cliff`（1,292 行独占期到期：NCE / ODE 等代码 + 到期日）、`tentative_top`（暂定批准积压 Top 30）、`timelines`（ELIQUIS / IBRANCE 明星药物专利时间线，含 *PED 儿科延长与独占期）
- **口径**：专利按 产品×专利×用途码 计数（同一专利挂多产品时重复计）；`*PED` 后缀 = 儿科独占延长期（+6 个月）；`ds_latest` = 最晚到期的药物物质（compound）专利。**专利到期 ≠ 仿制药上市**（还受诉讼和解、独占期、REMS 约束）
- **锚点校验**：APIXABAN（ELIQUIS）暂定 ANDA = 9 件、PALBOCICLIB（IBRANCE）= 9 件 ✓；ELIQUIS 专利 6967208 → 2026-11-21、9326945 → 2031-02-24 ✓

### supply_risk.json（245 KB，专利与供应页）

- **生成**：`export_supply.py`（读 openFDA `drug/shortages` 端点全量数据，1,614 条，字段与 FDA 短缺数据库一一对应；数据版本 **2026-07-18**）
- **结构**：`kpis`（当前短缺 1,158 条记录 / 138 成分；高风险 32 / 中风险 189 / 多源短缺 106 / 单一来源观察池 936；全库单一来源成分 1,005 个与深度挖掘页同口径；未匹配记录 131 条）、`high`（当前短缺 × 在售仅单一来源）、`medium`（历史短缺或 To Be Discontinued）、`shortage_multi`（当前短缺但多源持证）、`watch`（936 个单一来源成分观察池）、`current_details`（当前短缺明细前 120 条）
- **匹配口径**：短缺记录 → Drugs@FDA 成分，经 openfda.substance_name 精确匹配 + 复方成分回退 + 通用名去剂型词回退（命中率约 93.6%）；"单一来源"= 标准化成分在售产品仅涉及 1 个申请号
- **风险分层**：高 = 短缺中且单一来源（断供即断药）；中 = 曾短缺/将停产；观察 = 单一来源但当前无短缺记录

### biosimilars.json（46 KB，专利与供应页）

- **生成**：`export_purplebook.py`（读 FDA 紫皮书月度 CSV 官方下载，**2026-06** 版，2,205 个产品行 / 847 个 BLA）
- **结构**：`kpis`（351(a) 原研 1,977 行 / 351(k) 类似药 100 行 / 可互换 128 行；去重后 351(k) BLA 90 个：类似药 49 + 可互换 45，含同 BLA 双列名；有类似药的参比分子 20 个）、`reference_products`（20 个参比分子全景：参比品牌 / BLA / 类似药与可互换 BLA 数 / 首个类似药获批日 / 参比独占期到期 / BPCIA 专利清单提供标记 / 各类似药明细）、`exclusivity_window`（36 个月内生物药独占期事件）
- **口径**：按参比分子（Ref. Product Proper Name）归并，BLA 按申请号去重；DENOSUMAB 11 个类似药 BLA 居首，ADALIMUMAB / USTEKINUMAB 各 10 个
- **交叉校验**：本库 Drugs@FDA 收 BLA 478 个（761xxx 系列 269 个）少于紫皮书 847 个——Drugs@FDA 仅收 CDER 管辖部分，CBER 及过渡期产品不在其列，属覆盖范围差异

## 关键数据口径

- **NME（新分子实体）**：`submissions` 表中 `submission_type='ORIG' AND submission_status='AP' AND submission_class LIKE 'Type 1%'` 的申请；获批日 = 该申请最早的 ORIG+AP 日期（`MIN(status_date)` 按 appl_no 去重）。全库共 1,873 个
- **孤儿药**：`submission_property` 表存在 `code='Orphan'` 记录；**优先审评**：ORIG+AP 提交 `review_priority='PRIORITY'`
- **上市状态四类**（`products.marketing_status_id`）：1 Prescription（25,911）/ 2 Over-the-counter（797）/ 3 Discontinued（23,389）/ 4 Tentative Approval（1,440）。Drugs@FDA 数据中的"None"状态即暂定批准
- **企业归一化**：sponsor_name 大写 → 非字母数字转空格 → 循环剔除 28 种尾部公司后缀（LTD / INC / LLC / CORP / CO / USA / PHARMS / GMBH / AG / PLC 等）→ 尾部孤立 AND 清理；2,264 个原始变体合并为 2,037 组（182 组发生合并，如 AUROBINDO PHARMA 合并 4 个变体）；内置 27 个知名企业中文别名（前缀匹配）
- **疾病匹配**：说明书 `indications_and_usage` 全文 FTS5 检索 + 人工维护同义词表（中文病名 / 英文名 / 常见别名）；**短缩写已人工剔除**（如 AS、RA 等会造成大量误命中的缩写污染），匹配后按申请号去重
- **仿制药悬崖**：2005–2016 年获批的单成分 NDA 类 NME（240 个），按成分文本精确匹配同成分 ANDA；`with_anda`（156）= 存在同成分 ANDA 记录（含暂定批准）；滞后年数仅用有获批日期的 ANDA 计算，平均 10.4 年；**未覆盖复方与 BLA**
- **广谱药物**：按药名 + 成分去重统计跨疾病覆盖数，代表申请号按 BLA > NDA > ANDA 优先级选取（避免多申请号重复计数）
- **暂定批准（Tentative Approval）**：已满足 FDA 技术要求但因专利 / 独占期未到而未正式上市的仿制药，是观察专利悬崖的先行指标（当前 724 个申请）

## 本地开发

```bash
npm install
npm run dev    # 开发服务器（数据文件挂在 /data/... 根路径）
npm run build  # 产物输出 dist/（base 为相对路径，可部署任意子路径）
```

## 数据再生成全流程

`scripts/` 内为管道脚本存档。多数脚本以**自身所在目录**为基准定位 `fda_drugs.db` / `fda_labels.db` 与 `fda-drug-web/` 子目录（`export_companies.py` 以当前工作目录为基准），因此再生成时需把脚本复制到**数据工作区根**（两个 .db 与 `fda-drug-web/` 同级处）运行：

```bash
# 0. 下载 Drugs@FDA 数据包（TSV zip）并解压到 data/drugsatfda_raw/
# 1. 构建药品库
python build_fda_db.py          # TSV → fda_drugs.db
# 2. 下载 openFDA 说明书并构建标签库（含 FTS5 索引，耗时较长）
python import_labels.py         # openFDA → fda_labels.db
# 3. 导出前端数据（顺序无关，可断点续跑）
python export_web_data.py       # products.json / details.json
python export_stats.py          # stats.json
python export_diseases.py       # diseases/*.json / index.json / app_index.json
python export_app_cards.py      # cards/*.json（详情页摘要卡分片）
python export_mining.py         # mining.json（含注册生命周期）
python export_companies.py      # companies/*.json / sponsor_map.json
python export_china.py          # china_pharma.json / disease_network.json
python export_safety_market.py  # safety_boxed/withdrawn/generic_lag/biologics.json
# 3b. 外部数据源（橙皮书 / 短缺 / 紫皮书 → fda_aux.db + 三个 JSON）
#     需先下载原始数据到 data_lake/（见 data_lake/MANIFEST.md）：
#     openFDA drug/orangebook 与 drug/shortages 全量 zip（api.fda.gov/download.json 清单内），
#     紫皮书月度 CSV（accessdata.fda.gov/drugsatfda_docs/PurpleBook/...）
python export_orangebook.py     # patent_cliff.json（36 月专利悬崖 + 独占期 + 暂定批准）
python export_supply.py         # supply_risk.json（短缺 × 单一来源风险分层）
python export_purplebook.py     # biosimilars.json（参比制剂 × 351(k) 竞争格局）
# 4. 构建与部署
cd fda-drug-web && npm run build
```

`disease_drugs.py` 为共享库（FTS 检索 / 去重 / 关联 / 摘要提取），被 `export_diseases.py` 与 `export_app_cards.py` 引用，不单独运行。

## 月度刷新（三源自动管线）

橙皮书 / 短缺库 / 紫皮书三个外部源的"抓取 → 导出 → 摘要 → 构建 → 部署 gh-pages"已固化为幂等脚本：

```bash
bash fda-drug-web/scripts/monthly_refresh.sh    # 任意 cwd 可跑；退出码 0 全成功 / 2 部分失败 / 1 全失败
```

- **抓取**（`scripts/fetch_sources.py`）：openFDA 橙皮书与短缺全量 zip 直连 `download.open.fda.gov`；紫皮书月度 CSV 经 allorigins 代理重试（fda.gov 主站有 Akamai 反爬），依次尝试当月→上月→上上月，校验 `BLA Number` 表头后才落盘。单源失败保留 `data_lake/` 旧文件并记入 `fetch_report.json`
- **导出**：抓取失败的源自动跳过；导出失败自动回滚该 JSON 为旧版（备份在 `data_lake/.backup-json/`）
- **监控摘要**（`scripts/build_monitor_summary.py`）：生成 `public/data/monitor_summary.json`——三源版本日期、专利悬崖 Top 8（含 days_left）、高风险短缺 Top 8（含 sole_supplier）、生物类似药 Top 8、failures 列表与一句话中文摘要，供看板 Widget 消费
- **部署**：gh-pages 孤儿分支，显式 `git add index.html assets data`（严禁 `-A`），push 走 6 个 GitHub IP 轮换
- 日志：`data_lake/monthly_refresh.log`；执行手册与故障处置见 `scripts/RUNBOOK.md`

建议每月 5 日运行一次（紫皮书月度版月初后数日发布）。窗口指标（专利悬崖 36 个月）随运行日滚动，跨月数字小幅变化属预期。

## 部署

GitHub Pages 发布 `gh-pages` 分支，内容为 `dist/` 产物平铺到分支根：

```bash
git checkout --orphan gh-pages-tmp && git rm -rf .
cp -R dist/* .
git add index.html assets data        # 显式列举，勿用 git add -A
git commit -m "deploy"
git push -f origin gh-pages-tmp:gh-pages
git checkout -f main && git branch -D gh-pages-tmp
```

**为什么必须显式 `git add index.html assets data`**：孤儿分支无父提交，若用 `git add -A` 会把 `node_modules/`、`dist/` 等未跟踪目录一并纳入该分支索引；切回 main 时这些文件会被当作"已跟踪但被删除"处理，可能污染甚至清空 main 工作区的 `node_modules`。显式列举可确保只有构建产物进入发布分支。

## 免责声明

- 本项目数据仅供研究参考，**不构成任何医疗建议**；权威信息以 FDA 官网（accessdata.fda.gov）为准
- 说明书文本归属 FDA / NLM（美国国立医学图书馆），经 openFDA（CC0）获取
- 疾病匹配与企业归一化为启发式算法结果，可能存在误配或漏配；引用前请与原始数据核对
