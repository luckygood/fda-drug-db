// 数据加载与领域模型（纯静态 JSON，无后端）

export interface Product {
  application_number: string
  appl_type: string
  drug_name: string
  active_ingredient: string
  form: string
  strength: string
  sponsor_name: string
  approval_date: string | null
  marketing_status: string
  te_code: string
}

export interface Submission {
  submission_type: string
  submission_no: string
  submission_status: string
  status_date: string
  submission_class: string
  review_priority: string
}

export interface AppDoc {
  doc_title: string
  doc_url: string
  doc_date: string
}

export interface AppDetail {
  submissions: Submission[]
  docs: AppDoc[]
}

interface ProductsPayload {
  fields: string[]
  rows: (string | null)[][]
}

interface DetailsPayload {
  submission_fields: string[]
  doc_fields: string[]
  records: Record<
    string,
    { submissions: (string | null)[][]; docs: (string | null)[][] }
  >
}

function rowsToObjects<T>(fields: string[], rows: (string | null)[][]): T[] {
  return rows.map((row) => {
    const obj: Record<string, string | null> = {}
    fields.forEach((f, i) => {
      obj[f] = row[i] ?? null
    })
    return obj as unknown as T
  })
}

let productsPromise: Promise<Product[]> | null = null
let detailsPromise: Promise<Map<string, AppDetail>> | null = null

export function loadProducts(): Promise<Product[]> {
  if (!productsPromise) {
    productsPromise = fetch(`${import.meta.env.BASE_URL}data/products.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`products.json 加载失败: HTTP ${r.status}`)
        return r.json() as Promise<ProductsPayload>
      })
      .then((p) => rowsToObjects<Product>(p.fields, p.rows))
  }
  return productsPromise
}

export function loadDetails(): Promise<Map<string, AppDetail>> {
  if (!detailsPromise) {
    detailsPromise = fetch(`${import.meta.env.BASE_URL}data/details.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`details.json 加载失败: HTTP ${r.status}`)
        return r.json() as Promise<DetailsPayload>
      })
      .then((p) => {
        const map = new Map<string, AppDetail>()
        for (const [appNo, rec] of Object.entries(p.records)) {
          map.set(appNo, {
            submissions: rowsToObjects<Submission>(p.submission_fields, rec.submissions),
            docs: rowsToObjects<AppDoc>(p.doc_fields, rec.docs),
          })
        }
        return map
      })
  }
  return detailsPromise
}

// ---- 洞察页统计数据 ----

export interface Stats {
  yearly_by_type: {
    years: string[]
    NDA: number[]
    ANDA: number[]
    BLA: number[]
    incomplete_year: string
  }
  nme_by_year: { years: string[]; counts: number[] }
  priority_by_year: {
    years: string[]
    total: number[]
    priority: number[]
    ratio: number[]
  }
  top_sponsors: { names: string[]; counts: number[] }
  top_ingredients: { names: string[]; counts: number[] }
  dosage_forms: { names: string[]; counts: number[] }
  headline: {
    total_applications: number
    active_products: number
    discontinued_products: number
    tentative_applications: number
    nme_2025: number
    total_sponsors: number
  }
}

let statsPromise: Promise<Stats> | null = null

export function loadStats(): Promise<Stats> {
  if (!statsPromise) {
    statsPromise = fetch(`${import.meta.env.BASE_URL}data/stats.json`).then((r) => {
      if (!r.ok) throw new Error(`stats.json 加载失败: HTTP ${r.status}`)
      return r.json() as Promise<Stats>
    })
  }
  return statsPromise
}

// ---- 疾病视角数据 ----

export interface DiseaseIndexEntry {
  slug: string
  name_zh: string
  name_en: string
  area: string
  synonyms?: string[]
  drug_count: number
  newest_approval: string
  newest_drug: string
  boxed_count: number
}

export interface EfficacyCard {
  trials: string[]
  key_results: string[]
  source_section: string
}

export interface SafetyCard {
  boxed_warning: string | null
  warnings: string[]
  common_adverse_reactions: string | null
}

export interface DiseaseDrug {
  application_number: string
  drug_name: string
  active_ingredient: string
  sponsor_name: string
  appl_type: string
  approval_date: string
  marketing_status: string
  has_boxed_warning: boolean
  efficacy_snippet: string
  efficacy_card: EfficacyCard | null
  safety_card: SafetyCard | null
}

export interface DiseaseDetail {
  slug: string
  name_zh: string
  name_en: string
  synonyms: string[]
  area: string
  approvals_by_year: Record<string, number>
  cards_truncated?: boolean
  drugs: DiseaseDrug[]
}

export interface DiseaseIndex {
  areas: string[]
  diseases: DiseaseIndexEntry[]
}

let diseaseIndexPromise: Promise<DiseaseIndex> | null = null
const diseaseDetailCache = new Map<string, Promise<DiseaseDetail>>()

export function loadDiseaseIndex(): Promise<DiseaseIndex> {
  if (!diseaseIndexPromise) {
    diseaseIndexPromise = fetch(`${import.meta.env.BASE_URL}data/diseases/index.json`).then(
      (r) => {
        if (!r.ok) throw new Error(`疾病索引加载失败: HTTP ${r.status}`)
        return r.json() as Promise<DiseaseIndex>
      },
    )
  }
  return diseaseIndexPromise
}

export function loadDisease(slug: string): Promise<DiseaseDetail> {
  let p = diseaseDetailCache.get(slug)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/diseases/${slug}.json`).then((r) => {
      if (!r.ok) throw new Error(`疾病数据加载失败: HTTP ${r.status}`)
      return r.json() as Promise<DiseaseDetail>
    })
    diseaseDetailCache.set(slug, p)
  }
  return p
}

// ---- 申请号语境的通用摘要卡（分片） ----

export interface AppCard {
  efficacy_card: EfficacyCard | null
  safety_card: SafetyCard | null
}

interface CardsIndex {
  shard_rule: string
  shards: string[]
}

let cardsIndexPromise: Promise<Set<string>> | null = null
const shardCache = new Map<string, Promise<Record<string, AppCard>>>()

function loadCardsIndex(): Promise<Set<string>> {
  if (!cardsIndexPromise) {
    cardsIndexPromise = fetch(`${import.meta.env.BASE_URL}data/cards/index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`cards/index.json 加载失败: HTTP ${r.status}`)
        return r.json() as Promise<CardsIndex>
      })
      .then((d) => new Set(d.shards))
  }
  return cardsIndexPromise
}

function loadShard(name: string): Promise<Record<string, AppCard>> {
  let p = shardCache.get(name)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/cards/${name}`).then((r) => {
      if (!r.ok) throw new Error(`${name} 加载失败: HTTP ${r.status}`)
      return r.json() as Promise<Record<string, AppCard>>
    })
    shardCache.set(name, p)
  }
  return p
}

/** 按 application_number（如 NDA021514 / BLA125514）定位分片并取卡片 */
export async function getAppCard(applicationNumber: string): Promise<AppCard | null> {
  const m = /^([A-Z]+)(\d+)$/.exec(applicationNumber)
  if (!m) return null
  const [, type, digits] = m
  const shards = await loadCardsIndex()
  const candidates = [
    `${type}-${digits.slice(0, 3)}.json`,
    `${type}-${digits.slice(0, 2)}.json`,
    `${type}.json`,
  ]
  for (const name of candidates) {
    if (shards.has(name)) {
      const data = await loadShard(name)
      return data[applicationNumber] ?? null
    }
  }
  return null
}

// ---- 深度挖掘数据 ----

export interface MiningData {
  disease_heatmap: {
    slug: string
    name_zh: string
    area: string
    drug_count: number
    recent5: number
    boxed_pct: number
  }[]
  broad_spectrum: {
    application_number: string
    drug_name: string
    active_ingredient: string
    disease_count: number
    sample_diseases: string[]
  }[]
  nme: {
    yearly: { yr: string; nda: number; bla: number; orphan_pct: number; pri_pct: number }[]
    top_companies: { sponsor: string; n: number }[]
    latest: {
      application_number: string
      drug_name: string
      sponsor: string
      ap_date: string
      orphan: number
      priority: number
    }[]
  }
  generic_cliff: {
    stats: { nme_total: number; with_anda: number; avg_lag_years: number }
    top_genericized: { drug: string; nme_yr: number; anda_yr: number; lag: number; anda_n: number }[]
    tentative_top: { ingredient: string; n: number }[]
    tentative_total_appls: number
  }
  supply_risk: {
    single_source_count: number
    single_source_examples: { ingredient: string; appl_no: string; approval_date: string }[]
    discontinued_by_year: { yr: string; n: number }[]
  }
  lifecycle: {
    top_maintained: {
      application_number: string
      drug_name: string
      sponsor: string
      first_ap: string
      last_action: string
      span_years: number
      supplements: number
    }[]
    span_hist: { bucket: string; n: number }[]
    median_by_era: { era: string; median_span: number; n: number }[]
  }
}

let miningPromise: Promise<MiningData> | null = null

export function loadMining(): Promise<MiningData> {
  if (!miningPromise) {
    miningPromise = fetch(`${import.meta.env.BASE_URL}data/mining.json`).then((r) => {
      if (!r.ok) throw new Error(`mining.json 加载失败: HTTP ${r.status}`)
      return r.json() as Promise<MiningData>
    })
  }
  return miningPromise
}

let appIndexPromise: Promise<Record<string, { slug: string; name_zh: string }[]>> | null = null

/** 药品→疾病反向索引（application_number → 疾病列表），惰性加载、会话内缓存 */
export function loadAppIndex(): Promise<Record<string, { slug: string; name_zh: string }[]>> {
  if (!appIndexPromise) {
    appIndexPromise = fetch(`${import.meta.env.BASE_URL}data/diseases/app_index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`app_index.json 加载失败: HTTP ${r.status}`)
        return r.json() as Promise<Record<string, { slug: string; name_zh: string }[]>>
      })
  }
  return appIndexPromise
}

// ---- 安全与市场（第二梯队）数据 ----

export interface SafetyBoxed {
  coverage: {
    label_docs: number
    deep_texts: number
    boxed_texts: number
    labeled_apps: number
    boxed_apps: number
    boxed_rate: number
  }
  era_rates: { era: string; apps: number; boxed: number; rate: number }[]
  themes: { key: string; name_zh: string; count: number; examples: string[] }[]
  nme_boxed: {
    application_number: string
    drug_name: string
    sponsor: string
    ap_date: string
    themes: string[]
    snippet: string
  }[]
}

export interface Withdrawn {
  total: number
  by_decade: { decade: string; n: number }[]
  top_ingredients: { ingredient: string; n: number }[]
  top_forms: { form: string; n: number }[]
  anchors: { name: string; found: boolean; approval_date: string | null; last_action: string | null }[]
  recent: {
    application_number: string
    drug_name: string
    ingredient: string
    approval_date: string
    last_action: string
  }[]
}

export interface GenericLag {
  n_matched: number
  median_lag: number
  lag_hist: { bucket: string; n: number }[]
  no_generic_old: {
    ingredient: string
    first_year: number
    active_products: number
    example_drug: string
    application_number: string
  }[]
  top_competition: { ingredient: string; holders: number; anda_apps: number }[]
  anchors: Record<string, [string, string] | null>
}

export interface Biologics {
  yearly: { yr: string; bla: number; nda: number; share: number; bla_nme: number }[]
  top_sponsors: { name: string; name_zh: string | null; n: number }[]
  latest_share: number
}

function makeLoader<T>(file: string, desc: string): () => Promise<T> {
  let promise: Promise<T> | null = null
  return () => {
    if (!promise) {
      promise = fetch(`${import.meta.env.BASE_URL}data/${file}`).then((r) => {
        if (!r.ok) throw new Error(`${desc} 加载失败: HTTP ${r.status}`)
        return r.json() as Promise<T>
      })
    }
    return promise
  }
}

export const loadSafetyBoxed = makeLoader<SafetyBoxed>('safety_boxed.json', 'safety_boxed.json')
export const loadWithdrawn = makeLoader<Withdrawn>('withdrawn.json', 'withdrawn.json')
export const loadGenericLag = makeLoader<GenericLag>('generic_lag.json', 'generic_lag.json')
export const loadBiologics = makeLoader<Biologics>('biologics.json', 'biologics.json')

// ---- 专利与供应（第三梯队：橙皮书 / 短缺 / 紫皮书）数据 ----

export interface PatentCliff {
  generated_at: string
  ob_version: string
  source: string
  window: { start: string; end: string; months: number }
  kpis: {
    cliff_ingredients: number
    cliff_patents: number
    cliff_onmarket_products: number
    excl_rows: number
    tentative_total_appls: number
  }
  patent_cliff: {
    ingredient: string
    brands: string[]
    applicants: string[]
    n_appls: number
    earliest_expiry: string
    latest_expiry: string
    n_patents_window: number
    n_patents_total: number
    ds_latest: string | null
    onmarket_products: number
    onmarket_appls: number
    tentative_andas: number
    appl_nos: string[]
  }[]
  exclusivity_cliff: {
    ingredient: string
    brand: string
    code: string
    expiry: string
    appl_no: string
    tentative_andas: number
  }[]
  tentative_top: { ingredient: string; n: number; onmarket_products: number }[]
  timelines: Record<
    string,
    {
      label: string
      appl_no: string
      brand: string
      patents: {
        product_no: string
        patent_no: string
        expiry: string
        ds: boolean
        dp: boolean
        use_code: string
      }[]
      exclusivity: { code: string; expiry: string }[]
    }
  >
}

export interface SupplyRisk {
  generated_at: string
  shortages_version: string
  fetch_date: string
  source: string
  kpis: {
    shortage_records: number
    current_records: number
    current_ingredients: number
    high_risk: number
    medium_risk: number
    watch: number
    shortage_multi: number
    single_source_count: number
    unmatched_records: number
  }
  high: {
    ingredient: string
    n_presentations: number
    companies: string[]
    n_companies: number
    dosage_forms: string[]
    therapeutic_category: string[]
    since: string
    latest_update: string
    onmarket_products: number
    single_source: boolean
  }[]
  medium: {
    ingredient: string
    last_status: string
    latest_update: string
    n_records: number
    single_source: boolean
    onmarket_products: number
  }[]
  watch: { ingredient: string; appl_no: string; brand: string; onmarket_products: number }[]
  shortage_multi: {
    ingredient: string
    n_presentations: number
    companies: string[]
    n_companies: number
    dosage_forms: string[]
    therapeutic_category: string[]
    since: string
    latest_update: string
    onmarket_products: number
    single_source: boolean
  }[]
  current_details: {
    generic_name: string
    company_name: string
    dosage_form: string
    availability: string
    therapeutic_category: string[]
    initial_posting_date: string
    update_date: string
    matched_ingredient: string
    single_source: boolean
  }[]
}

export interface Biosimilars {
  generated_at: string
  pb_version: string
  fetch_date: string
  source: string
  window: { start: string; end: string; months: number }
  kpis: {
    pb_products: number
    pb_blas: number
    products_351a: number
    products_biosimilar: number
    products_interchangeable: number
    blas_biosimilar: number
    blas_interchangeable: number
    rp_with_biosimilars: number
    rp_excl_in_window: number
    crosscheck_db_bla: number
    crosscheck_db_bla_761: number
  }
  reference_products: {
    ref_proper_name: string
    ref_brands: string[]
    ref_applicants: string[]
    ref_bla_numbers: string[]
    center: string[]
    marketing_status: string[]
    date_of_first_licensure: string | null
    ref_exclusivity_exp: string | null
    orphan_exclusivity_exp: string | null
    patent_list_provided: boolean
    n_biosimilar_blas: number
    n_interchangeable_blas: number
    n_products: number
    first_biosimilar_approval: string | null
    first_interchangeable_exclusivity_exp: string | null
    biosimilars: {
      brand: string
      proper_name: string
      applicant: string
      bla_number: string
      license_type: string
      marketing_status: string
      approval_date: string | null
    }[]
  }[]
  exclusivity_window: {
    ref_proper_name: string
    ref_brands: string[]
    kind: string
    expiry: string
    n_biosimilar_blas: number
    n_interchangeable_blas: number
  }[]
}

export const loadPatentCliff = makeLoader<PatentCliff>('patent_cliff.json', 'patent_cliff.json')
export const loadSupplyRisk = makeLoader<SupplyRisk>('supply_risk.json', 'supply_risk.json')
export const loadBiosimilars = makeLoader<Biosimilars>('biosimilars.json', 'biosimilars.json')

// ---- 中国药企出海数据 ----

export interface ChinaPharma {
  summary: {
    company_count: number
    applications: number
    nda: number
    anda: number
    bla: number
    active_products: number
    nme_count: number
    tentative_count: number
  }
  timeline: Record<string, { nda: number; anda: number; bla: number }>
  companies: {
    slug: string
    name: string
    name_zh: string | null
    applications: number
    active: number
    nda: number
    anda: number
    bla: number
    nme_count: number
    tentative_count: number
    first_year: string | null
  }[]
  innovation: {
    application_number: string
    drug_name: string
    sponsor: string
    sponsor_zh: string | null
    ap_date: string
    orphan: number
    priority: number
  }[]
  pipeline: { ingredient: string; n: number; sponsors: string[] }[]
}

let chinaPromise: Promise<ChinaPharma> | null = null

export function loadChinaPharma(): Promise<ChinaPharma> {
  if (!chinaPromise) {
    chinaPromise = fetch(`${import.meta.env.BASE_URL}data/china_pharma.json`).then((r) => {
      if (!r.ok) throw new Error(`china_pharma.json 加载失败: HTTP ${r.status}`)
      return r.json() as Promise<ChinaPharma>
    })
  }
  return chinaPromise
}

// ---- 疾病相似性网络 ----

export interface DiseaseNetwork {
  nodes: { slug: string; name_zh: string; area: string; drug_count: number }[]
  edges: { source: string; target: string; weight: number; shared: number; examples: string[] }[]
}

let diseaseNetworkPromise: Promise<DiseaseNetwork> | null = null

export function loadDiseaseNetwork(): Promise<DiseaseNetwork> {
  if (!diseaseNetworkPromise) {
    diseaseNetworkPromise = fetch(`${import.meta.env.BASE_URL}data/disease_network.json`).then((r) => {
      if (!r.ok) throw new Error(`disease_network.json 加载失败: HTTP ${r.status}`)
      return r.json() as Promise<DiseaseNetwork>
    })
  }
  return diseaseNetworkPromise
}

// ---- 企业画像数据 ----

export interface CompanyIndexEntry {
  slug: string
  name: string
  name_zh: string | null
  variants: number
  applications: number
  active_products: number
  nme_count: number
  first_year: string | null
  latest_year: string | null
}

export interface CompanyDetail {
  slug: string
  name: string
  name_zh: string | null
  variants: string[]
  stats: {
    nda: number
    anda: number
    bla: number
    other: number
    active: number
    discontinued: number
    tentative: number
  }
  timeline: Record<string, { nda: number; anda: number; bla: number }>
  nme_list: {
    application_number: string
    drug_name: string
    ap_date: string
    orphan: number
    priority: number
  }[]
  top_products: {
    application_number: string
    drug_name: string
    active_ingredient: string
    approval_date: string
    marketing_status: string
  }[]
  diseases: { slug: string; name_zh: string; drug_count: number }[]
}

let companyIndexPromise: Promise<CompanyIndexEntry[]> | null = null
const companyShardCache = new Map<string, Promise<CompanyDetail[]>>()

export function loadCompanyIndex(): Promise<CompanyIndexEntry[]> {
  if (!companyIndexPromise) {
    companyIndexPromise = fetch(`${import.meta.env.BASE_URL}data/companies/index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`企业索引加载失败: HTTP ${r.status}`)
        return r.json() as Promise<{ companies: CompanyIndexEntry[] }>
      })
      .then((d) => d.companies)
  }
  return companyIndexPromise
}

export function loadCompanyShard(letter: string): Promise<CompanyDetail[]> {
  const key = /^[A-Z]$/.test(letter) ? letter : 'OTHER'
  let p = companyShardCache.get(key)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/companies/${key}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`企业分片 ${key} 加载失败: HTTP ${r.status}`)
        return r.json() as Promise<{ companies: CompanyDetail[] }>
      })
      .then((d) => d.companies)
    companyShardCache.set(key, p)
  }
  return p
}

let sponsorMapPromise: Promise<Record<string, string>> | null = null

/** 原始 sponsor 名（大写）→ 企业 slug；含归一名回退键 */
export function loadSponsorMap(): Promise<Record<string, string>> {
  if (!sponsorMapPromise) {
    sponsorMapPromise = fetch(`${import.meta.env.BASE_URL}data/companies/sponsor_map.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`sponsor_map.json 加载失败: HTTP ${r.status}`)
        return r.json() as Promise<Record<string, string>>
      })
  }
  return sponsorMapPromise
}

const COMPANY_SUFFIXES = new Set([
  'LTD', 'LIMITED', 'INC', 'LLC', 'CORP', 'CORPORATION', 'COMPANY', 'CO',
  'USA', 'US', 'PHARMS', 'GMBH', 'AG', 'SA', 'BV', 'SRL', 'SPA', 'PLC',
  'APS', 'AS', 'KK', 'LP', 'LLP', 'NV', 'PTY', 'PTE', 'SAS', 'SARL',
])

/** 与导出脚本一致的企业名归一化（用于 sponsor_map 回退查找） */
export function normalizeSponsor(name: string): string {
  const s = name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
  if (!s) return ''
  const toks = s.split(' ')
  while (toks.length && COMPANY_SUFFIXES.has(toks[toks.length - 1])) toks.pop()
  while (toks.length && toks[toks.length - 1] === 'AND') toks.pop()
  return toks.join(' ')
}

/** 原始 sponsor 名 → 企业 slug（先精确命中，再归一化回退） */
export function resolveCompanySlug(
  map: Record<string, string>,
  sponsorName: string | null | undefined,
): string | null {
  if (!sponsorName) return null
  const raw = sponsorName.trim().toUpperCase()
  if (map[raw]) return map[raw]
  const norm = normalizeSponsor(raw)
  return norm ? (map[norm] ?? null) : null
}

/** 由 slug 首字符定位分片字母 */
export function companyShardLetter(slug: string): string {
  const c = (slug[0] || '').toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : 'OTHER'
}

// ---- 状态与显示辅助 ----

export type StatusKey = 'rx' | 'otc' | 'discontinued' | 'tentative' | 'other'

export function statusKey(status: string | null | undefined): StatusKey {
  const s = (status ?? '').toLowerCase()
  if (s.includes('prescription')) return 'rx'
  if (s.includes('over-the-counter')) return 'otc'
  if (s.includes('discontinued')) return 'discontinued'
  if (s.includes('tentative')) return 'tentative'
  return 'other'
}

export const STATUS_LABEL: Record<StatusKey, string> = {
  rx: '处方药',
  otc: 'OTC',
  discontinued: '已撤市',
  tentative: '暂定批准',
  other: '其他',
}
