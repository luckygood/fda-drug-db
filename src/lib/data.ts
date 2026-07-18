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
