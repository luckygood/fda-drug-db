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
| **深度挖掘** | 四个专题：治疗领域创新热度（102 疾病气泡图）、广谱药物 Top 20（跨疾病覆盖）、NME 专题（年度趋势 / Top 企业 / 最新明细）、仿制药悬崖与可及性（仿制滞后、暂定批准、单一来源成分） |
| **企业画像** | 2,037 家归一化企业的档案：申请构成、获批时间线、NME 列表、疾病覆盖、在售产品；支持名称变体合并与中文别名检索 |
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

### mining.json（30 KB，深度挖掘页）

- **生成**：`export_mining.py`
- **五块**：`disease_heatmap`（102 疾病 × 覆盖药物数 / 近 5 年获批 / 黑框占比）、`broad_spectrum`（广谱药物 Top 20）、`nme`（yearly 2010 起 / top_companies 2016 起 / latest 2025 起明细）、`generic_cliff`（仿制药悬崖）、`supply_risk`（单一来源与撤市趋势）

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
python export_mining.py         # mining.json
python export_companies.py      # companies/*.json / sponsor_map.json
# 4. 构建与部署
cd fda-drug-web && npm run build
```

`disease_drugs.py` 为共享库（FTS 检索 / 去重 / 关联 / 摘要提取），被 `export_diseases.py` 与 `export_app_cards.py` 引用，不单独运行。

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
