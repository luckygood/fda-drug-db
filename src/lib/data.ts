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
