// 开放数据底座：数据集目录元数据（手工策展）。
// generated_at / 文件大小不在此硬编码 —— 运行时从 public/data/manifest.json 读取
// （manifest 由 scripts/build_manifest.py 在构建期扫描真实数据文件生成）。

export type DatasetCategory = '核心实体' | '证据' | '可及性' | '安全' | '指标'

export interface DatasetField {
  name: string
  type: string
  desc: string
}

export interface DatasetSpec {
  id: string
  /** 相对 public/data/ 的文件名；分片数据集为目录说明 */
  file: string
  nameZh: string
  desc: string
  category: DatasetCategory
  fields: DatasetField[]
  /** 口径与范围限制 */
  scopeNote: string
  cadence: string
  /** 分片数据集：无单一文件，下载入口为 null */
  sharded?: string
}

export const LICENSE_NOTE = '公开数据整理，免费使用，引用请注明 fda-drug-db'

export const DATASETS: DatasetSpec[] = [
  // ---------- 核心实体 ----------
  {
    id: 'products',
    file: 'products.json',
    nameZh: 'FDA 产品主表',
    desc: 'Drugs@FDA 全量产品行（NDA/ANDA/BLA），全部页面的基础数据。',
    category: '核心实体',
    fields: [
      { name: 'fields', type: 'string[]', desc: '列名定义（application_number / appl_type / drug_name / active_ingredient / form / strength / sponsor / approval_date / marketing_status 等）' },
      { name: 'rows', type: 'string[][]', desc: '产品行，按 fields 顺序取值' },
      { name: 'appl_type', type: 'enum', desc: 'NDA（新药）/ ANDA（仿制药）/ BLA（生物制品）' },
      { name: 'approval_date', type: 'date', desc: '该产品首个获批日期（ISO）' },
      { name: 'active_ingredient', type: 'string', desc: '活性成分（大写，复方以 ; 分隔）' },
    ],
    scopeNote: '全量 Drugs@FDA（含撤市产品）；申请级历史见 details.json。',
    cadence: '手动月度',
  },
  {
    id: 'details',
    file: 'details.json',
    nameZh: '申请提交与审评文档',
    desc: '每个申请的提交历史（submission）与审评文档（label/review）链接。',
    category: '核心实体',
    fields: [
      { name: 'submission_fields', type: 'string[]', desc: '提交记录列名（submission_type / submission_no / status_date 等）' },
      { name: 'doc_fields', type: 'string[]', desc: '文档列名（doc_title / doc_type / url 等）' },
      { name: 'records', type: 'object', desc: '键 = 申请号，值 = { submissions, docs }' },
    ],
    scopeNote: '与 products.json 同源；文档链接指向 FDA 官方 PDF。',
    cadence: '手动月度',
  },
  {
    id: 'stats',
    file: 'stats.json',
    nameZh: '站点总览统计',
    desc: '首页用的年度获批趋势、NME 计数、优先审评比例、头部企业/成分等。',
    category: '指标',
    fields: [
      { name: 'yearly_by_type', type: 'object', desc: '分年 NDA/ANDA/BLA 获批数（incomplete_year 标记当年不完整）' },
      { name: 'nme_by_year', type: 'object', desc: '分年 NME 计数' },
      { name: 'top_sponsors', type: 'array', desc: '持证企业排行' },
      { name: 'headline', type: 'object', desc: '头条指标（总产品数等）' },
    ],
    scopeNote: '由 products.json 聚合生成，口径同主表。',
    cadence: '手动月度',
  },
  {
    id: 'lifecycle_index',
    file: 'lifecycle_index.json',
    nameZh: '成分生命周期索引',
    desc: '每个活性成分的 stage（引入期/成长期/成熟期/衰退期/仿制成熟期）、首获批、ANDA 竞争、专利到期、短缺风险。',
    category: '核心实体',
    fields: [
      { name: 'records', type: 'object', desc: '键 = 成分名（大写），值 = 生命周期档案' },
      { name: 'stage', type: 'enum', desc: '生命周期阶段（口径见下）' },
      { name: 'first_approval', type: 'date', desc: '该成分 FDA 首个 NDA/BLA 获批日' },
      { name: 'originator', type: 'string', desc: '原研公司（最早 NDA/BLA 持证商）' },
      { name: 'n_anda / n_anda_companies', type: 'number', desc: 'ANDA 申请数 / 持证企业数' },
      { name: 'months_to_expiry', type: 'number|null', desc: '核心专利/独占期剩余月数（负值 = 已过期）' },
      { name: 'shortage_risk', type: 'enum|null', desc: 'high / medium / null（FDA 短缺库）' },
      { name: 'withdrawn', type: 'boolean', desc: '是否已撤市' },
    ],
    scopeNote: '阶段口径：引入期 = 首获批 <2 年；仿制成熟期 = 已有 ANDA 竞争；其余按上市年限与竞争状态划分。方法版本见 method_version。',
    cadence: '手动月度',
  },
  {
    id: 'entity_map',
    file: 'entity_map.json',
    nameZh: '实体关系层（成分↔企业↔疾病↔试验）',
    desc: '三类实体的双向链接索引，企业/疾病/成分页的关系数据底座。',
    category: '核心实体',
    fields: [
      { name: 'ingredients', type: 'object', desc: '成分 → { diseases, companies, trials }（均截断展示，全量计数见 *_total）' },
      { name: 'diseases', type: 'object', desc: '疾病 slug → { ingredients, ingredients_total, trial_count, trials_coverage }' },
      { name: 'companies', type: 'object', desc: '企业 slug → { name, ingredients（≤50 截断）, ingredients_total }' },
    ],
    scopeNote: '展示列表截断（成分-疾病 ≤20、成分-企业 ≤30、企业-成分 ≤50）；trials_coverage=not_covered 表示未接入试验索引（不得读作 0）。',
    cadence: '手动月度',
  },
  {
    id: 'companies',
    file: 'companies/index.json + A-Z 分片',
    nameZh: '企业画像分片',
    desc: '企业索引 + 按首字母分片的企业详情（申请统计、NME 列表、疾病覆盖、在售产品）。',
    category: '核心实体',
    fields: [
      { name: 'index.json', type: 'array', desc: '企业索引：slug / name / name_zh / active_products / nme_count' },
      { name: '<字母>.json', type: 'array', desc: '分片详情：stats（NDA/ANDA/BLA/active）、timeline、nme_list、diseases、top_products、variants' },
      { name: 'sponsor_map.json', type: 'object', desc: '原始企业名变体 → 归一 slug' },
    ],
    scopeNote: '企业名已归一合并（去标点与公司后缀）；name_zh 为手工维护的中文别名（仅部分企业有）。',
    cadence: '手动月度',
    sharded: '分片目录：companies/index.json 为入口，A-Z.json 按企业 slug 首字母分片',
  },
  {
    id: 'diseases',
    file: 'diseases/index.json + slug 分片',
    nameZh: '疾病视角分片',
    desc: '102 病种矩阵：疾病索引 + 单病种的药物清单与统计。',
    category: '核心实体',
    fields: [
      { name: 'index.json', type: 'object', desc: '{ diseases: [{slug, name_zh, name_en, area, drug_count, newest_drug}], areas }' },
      { name: '<slug>.json', type: 'object', desc: '单病种详情：drugs 列表（药名/成分/获批/状态/企业）' },
      { name: 'app_index.json', type: 'object', desc: '申请号 → 疾病 slug 反查' },
    ],
    scopeNote: '102 个高数据量病种，按疾病领域（area）分组；药品-疾病映射为自动归一，可能少量错配。',
    cadence: '手动月度',
    sharded: '分片目录：diseases/index.json 为入口，每病种一个 <slug>.json',
  },
  {
    id: 'api_shard',
    file: 'api/A-Z.json',
    nameZh: '成分透视分片',
    desc: '按成分首字母分片的成分级详情（产品、生命周期、关联实体）。',
    category: '核心实体',
    fields: [
      { name: '<字母>.json', type: 'object', desc: '键 = 成分名，值 = 成分详情（products / 概要字段）' },
    ],
    scopeNote: '与 lifecycle_index 同成分键空间（大写成分名）。',
    cadence: '手动月度',
    sharded: '分片目录：api/<首字母>.json',
  },
  {
    id: 'cards',
    file: 'cards/index.json + 分片',
    nameZh: '药品概要卡分片',
    desc: '药品查询页的预生成概要卡（按申请号段分片）。',
    category: '核心实体',
    fields: [
      { name: 'index.json', type: 'object', desc: '申请号 → 分片文件名映射' },
      { name: '<分片>.json', type: 'object', desc: '键 = 申请号，值 = 概要卡（药名/成分/企业/状态/日期）' },
    ],
    scopeNote: '为搜索性能预生成的轻量卡；权威数据以 products/details 为准。',
    cadence: '手动月度',
    sharded: '分片目录：cards/index.json 为入口',
  },
  {
    id: 'biologics',
    file: 'biologics.json',
    nameZh: '生物制品年度统计',
    desc: 'BLA 占比年度趋势与头部生物制品企业。',
    category: '指标',
    fields: [
      { name: 'yearly', type: 'array', desc: '{ yr, bla, nda, share, bla_nme }' },
      { name: 'top_sponsors', type: 'array', desc: 'BLA 持证企业排行（含中文别名）' },
      { name: 'latest_share', type: 'number', desc: '近年 BLA 占比' },
    ],
    scopeNote: '由 products.json 聚合，口径同主表。',
    cadence: '手动月度',
  },
  {
    id: 'china_pharma',
    file: 'china_pharma.json',
    nameZh: '中国药企出海专题',
    desc: '中国背景企业在 FDA 的申请、NME、在售产品与管线统计（出海观察页）。',
    category: '指标',
    fields: [
      { name: 'summary', type: 'object', desc: '企业数 / 申请数 / NDA/ANDA/BLA / 在售 / NME 汇总' },
      { name: 'companies', type: 'array', desc: '{ slug, name, name_zh, applications, active, nda, anda, bla }' },
      { name: 'timeline', type: 'object', desc: '分年获批计数' },
      { name: 'innovation / pipeline', type: 'array', desc: 'NME 清单与在研信号' },
    ],
    scopeNote: '「中国背景企业」为手工策展名单（含名称变体归一），非官方口径，可能遗漏。',
    cadence: '手动月度',
  },
  {
    id: 'mining',
    file: 'mining.json',
    nameZh: '深度挖掘聚合',
    desc: '疾病热力、广谱药、NME 透视、仿制悬崖、供应风险等挖掘页聚合数据。',
    category: '指标',
    fields: [
      { name: 'disease_heatmap', type: 'array', desc: '{ slug, name_zh, area, drug_count, recent5, boxed_pct }' },
      { name: 'broad_spectrum', type: 'array', desc: '跨病种命中数最多的产品' },
      { name: 'nme / generic_cliff / supply_risk / lifecycle', type: 'object', desc: '各专题聚合块' },
    ],
    scopeNote: '二级聚合数据，统计口径详见各专题源数据集。',
    cadence: '手动月度',
  },
  {
    id: 'disease_network',
    file: 'disease_network.json',
    nameZh: '疾病共病网络',
    desc: '病种间共享药物加权网络图数据。',
    category: '指标',
    fields: [
      { name: 'nodes', type: 'array', desc: '{ slug, name_zh, area, drug_count }' },
      { name: 'edges', type: 'array', desc: '{ source, target, weight, shared, examples }（共享药物数加权）' },
    ],
    scopeNote: '边权重 = 两病种共享药物比例，仅 102 病种矩阵内计算。',
    cadence: '手动月度',
  },

  // ---------- 证据 ----------
  {
    id: 'ingredient_pubmed',
    file: 'ingredient_pubmed.json',
    nameZh: '成分 PubMed 证据',
    desc: '重点成分的近三年 PubMed 文献计量（临床研究/综述计数与代表文献）。',
    category: '证据',
    fields: [
      { name: 'ingredients', type: 'object', desc: '成分 → { clinical_count, review_count, recent }' },
      { name: 'recent', type: 'array', desc: '代表文献：{ pmid, title, journal, pubdate }' },
      { name: 'window', type: 'string', desc: '计量窗口（如 2023:2026）' },
    ],
    scopeNote: '仅覆盖重点成分（切片采集）；临床研究含 RCT 过滤器，计数为 PubMed 检索口径。',
    cadence: '手动月度',
  },
  {
    id: 'disease_pubmed',
    file: 'disease_pubmed.json',
    nameZh: '疾病 PubMed 证据',
    desc: '22 个高数据量疾病的近三年文献计量与代表文献。',
    category: '证据',
    fields: [
      { name: 'diseases', type: 'object', desc: '疾病 slug → { clinical_count, review_count, recent }' },
      { name: 'window', type: 'string', desc: '计量窗口' },
    ],
    scopeNote: '仅覆盖 22 个高数据量疾病；其余疾病显示"未纳入覆盖"而非 0。',
    cadence: '手动月度',
  },
  {
    id: 'ct_disease',
    file: 'ct_disease.json',
    nameZh: '疾病临床试验索引',
    desc: 'ClinicalTrials.gov 疾病维度全库计量（状态/阶段分布与代表研究）。',
    category: '证据',
    fields: [
      { name: 'diseases', type: 'object', desc: '疾病 slug → { total, by_status, by_phase, top }' },
      { name: 'top', type: 'array', desc: '代表研究：{ nct, title, phase, status, start_date }' },
    ],
    scopeNote: 'API v2 ConditionSearch 含同义词扩展，计数偏宽；查询失败 ≠ 0 项（以 error 字段区分）。',
    cadence: '手动月度',
  },
  {
    id: 'ct_ingredient',
    file: 'ct_ingredient.json',
    nameZh: '成分临床试验索引',
    desc: 'ClinicalTrials.gov 成分维度计量与代表研究。',
    category: '证据',
    fields: [
      { name: 'ingredients', type: 'object', desc: '成分 → { total, by_status, by_phase, top }' },
    ],
    scopeNote: '口径同 ct_disease；成分名为检索词归一。',
    cadence: '手动月度',
  },
  {
    id: 'label_summary',
    file: 'label_summary.json',
    nameZh: '说明书要点摘要',
    desc: '成分最早原始 NDA/BLA 首批准说明书的疗效/安全要点自动摘录。',
    category: '证据',
    fields: [
      { name: 'ingredients', type: 'object', desc: '成分 → { drug_name, application_number, efficacy, safety }' },
      { name: 'efficacy.key_results', type: 'string[]', desc: '疗效关键结果摘录' },
      { name: 'safety.boxed_warning', type: 'string', desc: '黑框警告全文摘录（如有）' },
    ],
    scopeNote: '当前成分级覆盖率约 46%（优先近年新分子）；自动摘录不构成完整标签。',
    cadence: '手动月度',
  },

  // ---------- 可及性 ----------
  {
    id: 'global_access',
    file: 'global_access.json',
    nameZh: '全球可及性（FDA×EMA×PMDA）',
    desc: '2020+ FDA NDA/BLA 成分在 EMA 集中审批与 PMDA 新药清单中的批准对齐 + 三地时滞。',
    category: '可及性',
    fields: [
      { name: 'records', type: 'object', desc: '成分 → { ema_status, ema_first_date, ema_product, match_type, pmda_status, pmda_first_date }' },
      { name: 'ema_status', type: 'enum', desc: 'authorised / withdrawn / refused / other / null（unmatched）' },
      { name: 'lag_stats', type: 'object', desc: '三地批准时滞统计（中位/分位/直方图/典型滞后案例）' },
      { name: 'match_type', type: 'enum', desc: 'exact / normalized / unmatched（归一化口径见脚本）' },
    ],
    scopeNote: '范围 = 2020-01-01 起 FDA 首次获批的 NDA/BLA 成分（708 个）；PMDA 清单 2004 年起；EMA unmatched ≠ 未批（含非集中审批路径）。',
    cadence: '手动月度',
  },
  {
    id: 'cn_access',
    file: 'cn_access.json',
    nameZh: 'NMPA（中国）批准状态',
    desc: '708 个 2020+ FDA 成分的中国批准状态——公开文献正向确认版（三态诚实）。',
    category: '可及性',
    fields: [
      { name: 'records', type: 'object', desc: '成分 → { cn_status, cn_first_year, cn_product_count, match_type, source }' },
      { name: 'cn_status', type: 'enum', desc: 'approved（有出处确认）/ unknown（未检索到）——本版无 not_found' },
      { name: 'source', type: 'url|null', desc: '确认出处（STTT/DIA/Insight 等公开盘点）' },
      { name: 'coverage_note', type: 'string', desc: '覆盖限制说明（必读）' },
    ],
    scopeNote: 'CDE 直连被反爬拦截，本版仅为公开文献正向确认：unknown ≠ 未批；2021/2022 覆盖薄弱；决策前需人工核实 CDE。',
    cadence: '手动月度',
  },
  {
    id: 'rxnorm_map',
    file: 'rxnorm_map.json',
    nameZh: 'RxNorm 成分归一映射',
    desc: '708 成分的 RxCUI 与同义名索引（跨库匹配基础设施）。',
    category: '可及性',
    fields: [
      { name: 'ingredients', type: 'object', desc: '成分 → { rxcui, synonyms, note? }' },
      { name: 'rxcui', type: 'string|null', desc: 'RxNorm 概念 ID（复方跳过为 null + note=combo_skipped）' },
      { name: 'synonyms', type: 'string[]', desc: 'RxNorm 同义名（含 SBD 剂型噪音）' },
    ],
    scopeNote: '598/708 成分命中 RxCUI；同义名含剂型条目，直接展示前需过滤。',
    cadence: '手动（一次性 + 增量）',
  },
  {
    id: 'nme_annual',
    file: 'nme_annual.json',
    nameZh: '年度 NME 全景',
    desc: '2020-2026 各年度 FDA 新分子实体清单与统计（审批节奏/分子类型/企业/全球同步率）。',
    category: '可及性',
    fields: [
      { name: 'years', type: 'object', desc: '年度 → { ingredients: [{name, date, company, mol_type, diseases, global_status}] }' },
      { name: 'ingredients', type: 'array', desc: 'NME 条目（含 EMA/PMDA 同步状态）' },
    ],
    scopeNote: 'NME = FDA 定义的新分子实体/新生物制品；当年数据不完整。',
    cadence: '手动月度',
  },
  {
    id: 'biosimilars',
    file: 'biosimilars.json',
    nameZh: '生物类似药（紫皮书）',
    desc: 'FDA 紫皮书生物类似药与参比制剂、独占期窗口。',
    category: '可及性',
    fields: [
      { name: 'reference_products', type: 'array', desc: '参比制剂及其生物类似药清单' },
      { name: 'exclusivity_window', type: 'array', desc: '独占期到期窗口' },
      { name: 'kpis', type: 'object', desc: '汇总指标' },
    ],
    scopeNote: '来源 FDA Purple Book（pb_version 为数据版本戳）。',
    cadence: '手动月度',
  },

  // ---------- 安全 ----------
  {
    id: 'label_safety',
    file: 'label_safety.json',
    nameZh: '标签安全信号索引',
    desc: 'openFDA 现行说明书黑框警告成分索引（含警告摘录与标签修订日期）。',
    category: '安全',
    fields: [
      { name: 'ingredients', type: 'object', desc: '成分 → { boxed_warning, bw_excerpt, label_effective_date }' },
      { name: 'bw_excerpt', type: 'string', desc: '黑框警告自动摘录（截断）' },
    ],
    scopeNote: '基于 openFDA 标签全文；现行标签口径（历史版本见 details.json 文档链接）。',
    cadence: '手动月度',
  },
  {
    id: 'safety_boxed',
    file: 'safety_boxed.json',
    nameZh: '黑框警告专题统计',
    desc: '黑框警告的年代分布、主题聚类与 NME 命中情况（安全与市场页）。',
    category: '安全',
    fields: [
      { name: 'coverage', type: 'object', desc: '标签文档覆盖率（label_docs / boxed_texts / boxed_rate）' },
      { name: 'era_rates', type: 'array', desc: '{ era, apps, boxed, rate }' },
      { name: 'themes', type: 'array', desc: '主题聚类：{ key, name_zh, count, examples }' },
      { name: 'nme_boxed', type: 'array', desc: 'NME 黑框命中清单' },
    ],
    scopeNote: '主题聚类为关键词规则归类，一个警告可命中多个主题。',
    cadence: '手动月度',
  },
  {
    id: 'withdrawn',
    file: 'withdrawn.json',
    nameZh: '撤市产品专题',
    desc: 'FDA 撤市产品的年代分布、高频成分与近期撤市清单。',
    category: '安全',
    fields: [
      { name: 'total', type: 'number', desc: '撤市产品总数' },
      { name: 'by_decade', type: 'array', desc: '{ decade, n }' },
      { name: 'top_ingredients', type: 'array', desc: '撤市次数最多的成分' },
      { name: 'recent', type: 'array', desc: '近期撤市案例' },
    ],
    scopeNote: '撤市 = marketing_status 为 Discontinued；含企业主动撤市（非全是安全原因）。',
    cadence: '手动月度',
  },

  // ---------- 指标 ----------
  {
    id: 'report_metrics',
    file: 'report_metrics.json',
    nameZh: '报告衍生指标',
    desc: '报告中心用的疾病/成分级衍生指标（拥挤度、证据强度、分子类型、全球得分）。',
    category: '指标',
    fields: [
      { name: 'diseases', type: 'object', desc: '疾病 → { crowded_bucket, top_company, hhi 等 }' },
      { name: 'ingredients', type: 'object', desc: '成分 → { erosion, exclusivity_pct, evidence, global_score, mol_type }' },
      { name: 'mol_type', type: 'string', desc: '分子类型规则推断（小分子/单抗/多肽等）' },
    ],
    scopeNote: '衍生指标为规则模板计算，供叙事解读，精度不及原始统计。',
    cadence: '手动月度',
  },
  {
    id: 'patent_cliff',
    file: 'patent_cliff.json',
    nameZh: '专利悬崖（橙皮书）',
    desc: '橙皮书专利/独占期到期窗口、暂定批准（tentative）排队与 KPI。',
    category: '指标',
    fields: [
      { name: 'patent_cliff', type: 'array', desc: '专利到期窗口清单（成分/产品/到期日）' },
      { name: 'exclusivity_cliff', type: 'array', desc: '独占期到期窗口' },
      { name: 'tentative_top', type: 'array', desc: '暂定批准排队最多的产品' },
      { name: 'ob_version', type: 'string', desc: '橙皮书数据版本戳' },
    ],
    scopeNote: '来源 FDA Orange Book；窗口口径见 window 字段。',
    cadence: '手动月度',
  },
  {
    id: 'supply_risk',
    file: 'supply_risk.json',
    nameZh: '供应短缺风险',
    desc: 'FDA 药物短缺数据库风险分级（高/中/观察）与多源短缺交叉。',
    category: '安全',
    fields: [
      { name: 'kpis', type: 'object', desc: '短缺汇总指标' },
      { name: 'high / medium / watch', type: 'array', desc: '分级短缺清单' },
      { name: 'shortage_multi', type: 'array', desc: '多厂家同时短缺的成分' },
      { name: 'shortages_version', type: 'string', desc: '短缺库数据版本戳' },
    ],
    scopeNote: '来源 FDA Drug Shortages 数据库（fetch_date 为采集日）；风险分级为规则推断。',
    cadence: '手动月度',
  },
  {
    id: 'generic_lag',
    file: 'generic_lag.json',
    nameZh: '仿制药上市时滞',
    desc: '专利到期 → 首个 ANDA 获批的时滞分布与竞争热度。',
    category: '指标',
    fields: [
      { name: 'median_lag', type: 'number', desc: '中位时滞（月）' },
      { name: 'lag_hist', type: 'array', desc: '{ bucket, n } 时滞直方图' },
      { name: 'top_competition', type: 'array', desc: '仿制竞争最激烈的成分' },
      { name: 'no_generic_old', type: 'array', desc: '到期多年仍无仿制的成分' },
    ],
    scopeNote: '仅统计可匹配专利到期日的成分（n_matched）。',
    cadence: '手动月度',
  },
  {
    id: 'monitor_summary',
    file: 'monitor_summary.json',
    nameZh: '数据管道监控摘要',
    desc: '月度采集管道的版本戳、采集失败记录与站点部署状态。',
    category: '指标',
    fields: [
      { name: 'ob_version / shortages_version / pb_version', type: 'string', desc: '橙皮书/短缺库/紫皮书数据版本戳' },
      { name: 'failures', type: 'array', desc: '本轮采集失败项（诚实披露）' },
      { name: 'summary', type: 'object', desc: '专利/供应/生物类似药三块汇总' },
    ],
    scopeNote: '管道自监控数据，用于数据新鲜度与失败透明化。',
    cadence: '手动月度',
  },
]

/** 下载链接（GitHub Pages 静态托管，CORS 开放） */
export function datasetUrl(spec: DatasetSpec): string | null {
  if (spec.sharded) return null
  return `${import.meta.env.BASE_URL}data/${spec.file}`
}

/** 引用格式行（可复制） */
export function citationLine(spec: DatasetSpec, generatedAt?: string): string {
  const file = spec.sharded ? spec.file : spec.file
  return `FDA Drug DB · ${spec.id} · ${generatedAt ?? 'unknown'} · https://luckygood.github.io/fda-drug-db/data/${file}`
}

// ---------- manifest（各数据集真实 generated_at，构建期生成） ----------

export interface ManifestEntry {
  generated_at?: string
  method_version?: string
  size_bytes?: number
}

export interface Manifest {
  scope: string
  count: number
  datasets: Record<string, ManifestEntry>
}

let manifestPromise: Promise<Manifest> | null = null

export function loadManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${import.meta.env.BASE_URL}data/manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`manifest.json 加载失败: HTTP ${r.status}`)
        return r.json() as Promise<Manifest>
      })
  }
  return manifestPromise
}
