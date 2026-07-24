// 成分透视页多面筛选（方案A）+ 场景预设（方案B）核心逻辑。
// 筛选宇宙 = lifecycle_index 3,324 个成分；跨面 AND、面内 OR；计数徽标为全集口径。
import type {
  LifecycleRecord, ReportMetrics, GlobalAccessRecord, EntityMap, CtIngredientIndex,
} from './data'

export interface FacetState {
  stages: string[]      // 生命周期阶段：引入期/成长期/成熟期/衰退期/仿制成熟期
  yearBuckets: string[] // '≤1999' | '2000-09' | '2010-19' | '2020+'
  applType: string[]    // 'originator' 含原研(NDA/BLA) | 'generic' 含仿制(ANDA)
  molTypes: string[]    // 分子类型（report_metrics.mol_type）
  erosion: string[]     // 无仿制 / 早期仿制（1-2 家） / 多家竞争 / 充分竞争
  cliff: string[]       // '≤12月' | '≤24月' | '≤36月' | '已过期'
  shortage: string[]    // 'high' | 'medium'
  hideWithdrawn: boolean
  global: string[]      // 'ema' | 'pmda' | 'us_only'
  diseases: string[]    // 疾病 slug
  evidence: string[]    // 'pubmed' | 'ct'
}

export const EMPTY_FACETS: FacetState = {
  stages: [], yearBuckets: [], applType: [], molTypes: [], erosion: [],
  cliff: [], shortage: [], hideWithdrawn: true, global: [], diseases: [], evidence: [],
}

export const STAGE_OPTIONS = ['引入期', '成长期', '成熟期', '衰退期', '仿制成熟期'] as const
export const YEAR_OPTIONS = ['≤1999', '2000-09', '2010-19', '2020+'] as const
export const EROSION_OPTIONS = ['无仿制', '早期仿制（1-2 家）', '多家竞争', '充分竞争'] as const
export const CLIFF_OPTIONS = ['≤12月', '≤24月', '≤36月', '已过期'] as const
export const MOLTYPE_OPTIONS = [
  '小分子', '单克隆抗体', '多肽', '融合蛋白', '酶', '核酸类', '抗体偶联药物（ADC）', '细胞/基因疗法', '疫苗', '其他生物药',
] as const

export function isFacetActive(f: FacetState): boolean {
  return f.stages.length > 0 || f.yearBuckets.length > 0 || f.applType.length > 0 ||
    f.molTypes.length > 0 || f.erosion.length > 0 || f.cliff.length > 0 ||
    f.shortage.length > 0 || f.global.length > 0 || f.diseases.length > 0 || f.evidence.length > 0
}

function yearOf(rec: LifecycleRecord): number | null {
  if (!rec.first_approval) return null
  const y = parseInt(rec.first_approval.slice(0, 4))
  return Number.isFinite(y) ? y : null
}

export function inYearBucket(rec: LifecycleRecord, bucket: string): boolean {
  const y = yearOf(rec)
  if (y == null) return false
  if (bucket === '≤1999') return y <= 1999
  if (bucket === '2000-09') return y >= 2000 && y <= 2009
  if (bucket === '2010-19') return y >= 2010 && y <= 2019
  return y >= 2020
}

export function inCliff(rec: LifecycleRecord, bucket: string): boolean {
  const m = rec.months_to_expiry
  if (m == null) return false
  if (bucket === '已过期') return m < 0
  if (bucket === '≤12月') return m >= 0 && m <= 12
  if (bucket === '≤24月') return m >= 0 && m <= 24
  return m >= 0 && m <= 36
}

export interface FacetContext {
  records: Record<string, LifecycleRecord>
  metrics: ReportMetrics | null
  globalAccess: Record<string, GlobalAccessRecord> | null
  entityMap: EntityMap | null
  ct: CtIngredientIndex | null
}

export function erosionStageOf(ctx: FacetContext, name: string): string | null {
  const m = ctx.metrics?.ingredients[name]
  if (m?.erosion) return m.erosion.stage
  // 兜底：无 metrics 时按 lifecycle ANDA 数推断"无仿制"
  const rec = ctx.records[name]
  if (rec && (rec.n_anda ?? 0) === 0) return '无仿制'
  return null
}

function matchOne(ctx: FacetContext, name: string, f: FacetState): boolean {
  const rec = ctx.records[name]
  if (!rec) return false
  if (f.hideWithdrawn && rec.withdrawn) return false
  if (f.stages.length > 0 && !f.stages.includes(rec.stage)) return false
  if (f.yearBuckets.length > 0 && !f.yearBuckets.some((b) => inYearBucket(rec, b))) return false
  if (f.applType.length > 0) {
    const ok = f.applType.some((t) =>
      t === 'originator' ? (rec.n_nda ?? 0) > 0 : (rec.n_anda ?? 0) > 0)
    if (!ok) return false
  }
  if (f.molTypes.length > 0) {
    const t = ctx.metrics?.ingredients[name]?.mol_type
    if (!t || !f.molTypes.includes(t)) return false
  }
  if (f.erosion.length > 0) {
    const e = erosionStageOf(ctx, name)
    if (!e || !f.erosion.includes(e)) return false
  }
  if (f.cliff.length > 0 && !f.cliff.some((b) => inCliff(rec, b))) return false
  if (f.shortage.length > 0) {
    const r = rec.shortage_risk
    if (!r || !f.shortage.includes(r)) return false
  }
  if (f.global.length > 0) {
    const g = ctx.globalAccess?.[name]
    if (!g) return false
    const ok = f.global.some((t) =>
      t === 'ema' ? g.ema_status === 'authorised'
        : t === 'pmda' ? g.pmda_status === 'approved'
          : g.ema_status !== 'authorised' && g.pmda_status !== 'approved')
    if (!ok) return false
  }
  if (f.diseases.length > 0) {
    const ds = ctx.entityMap?.ingredients[name]?.diseases ?? []
    if (!f.diseases.some((d) => ds.includes(d))) return false
  }
  if (f.evidence.length > 0) {
    const ok = f.evidence.some((t) =>
      t === 'pubmed'
        ? !!ctx.metrics?.ingredients[name]?.evidence
        : (ctx.ct?.ingredients[name]?.total ?? 0) > 0)
    if (!ok) return false
  }
  return true
}

/** 返回命中成分名集合（大写）。hideWithdrawn 默认生效（隐藏撤市）。 */
export function filterIngredientNames(ctx: FacetContext, f: FacetState): Set<string> {
  const out = new Set<string>()
  for (const name of Object.keys(ctx.records)) {
    if (matchOne(ctx, name, f)) out.add(name)
  }
  return out
}

// ---------- URL hash 持久化（#api?stage=intro,mat&cliff=24） ----------

const STAGE_CODE: Record<string, string> = { 引入期: 'intro', 成长期: 'growth', 成熟期: 'mat', 衰退期: 'decl', 仿制成熟期: 'gen' }
const EROSION_CODE: Record<string, string> = { 无仿制: 'none', '早期仿制（1-2 家）': 'early', 多家竞争: 'multi', 充分竞争: 'full' }
const CLIFF_CODE: Record<string, string> = { '≤12月': '12', '≤24月': '24', '≤36月': '36', 已过期: 'exp' }
const YEAR_CODE: Record<string, string> = { '≤1999': 'y1', '2000-09': 'y2', '2010-19': 'y3', '2020+': 'y4' }
const MOL_CODE: Record<string, string> = {
  小分子: 'sm', 单克隆抗体: 'mab', 多肽: 'pep', 融合蛋白: 'fus', 酶: 'enz',
  核酸类: 'na', '抗体偶联药物（ADC）': 'adc', '细胞/基因疗法': 'cgt', 疫苗: 'vac', 其他生物药: 'bio',
}

function encode(map: Record<string, string>, vals: string[]): string {
  return vals.map((v) => map[v] ?? v).join(',')
}
function decode(map: Record<string, string>, s: string, valid: readonly string[]): string[] {
  const inv = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]))
  return s.split(',').filter(Boolean).map((c) => inv[c] ?? c).filter((v) => valid.includes(v))
}

export function facetsToHash(f: FacetState): string {
  const p = new URLSearchParams()
  if (f.stages.length) p.set('stage', encode(STAGE_CODE, f.stages))
  if (f.yearBuckets.length) p.set('yr', encode(YEAR_CODE, f.yearBuckets))
  if (f.applType.length) p.set('appl', f.applType.join(','))
  if (f.molTypes.length) p.set('mol', encode(MOL_CODE, f.molTypes))
  if (f.erosion.length) p.set('ero', encode(EROSION_CODE, f.erosion))
  if (f.cliff.length) p.set('cliff', encode(CLIFF_CODE, f.cliff))
  if (f.shortage.length) p.set('short', f.shortage.join(','))
  if (!f.hideWithdrawn) p.set('wd', '1')
  if (f.global.length) p.set('glob', f.global.join(','))
  if (f.diseases.length) p.set('dis', f.diseases.join(','))
  if (f.evidence.length) p.set('evi', f.evidence.join(','))
  const s = p.toString()
  return s ? `#api?${s}` : ''
}

export function facetsFromHash(hash: string): FacetState | null {
  if (!hash.startsWith('#api?')) return null
  const p = new URLSearchParams(hash.slice(5))
  const f: FacetState = { ...EMPTY_FACETS, stages: [], yearBuckets: [], applType: [], molTypes: [], erosion: [], cliff: [], shortage: [], global: [], diseases: [], evidence: [] }
  if (p.get('stage')) f.stages = decode(STAGE_CODE, p.get('stage')!, STAGE_OPTIONS)
  if (p.get('yr')) f.yearBuckets = decode(YEAR_CODE, p.get('yr')!, YEAR_OPTIONS)
  if (p.get('appl')) f.applType = p.get('appl')!.split(',').filter((v) => ['originator', 'generic'].includes(v))
  if (p.get('mol')) f.molTypes = decode(MOL_CODE, p.get('mol')!, MOLTYPE_OPTIONS)
  if (p.get('ero')) f.erosion = decode(EROSION_CODE, p.get('ero')!, EROSION_OPTIONS)
  if (p.get('cliff')) f.cliff = decode(CLIFF_CODE, p.get('cliff')!, CLIFF_OPTIONS)
  if (p.get('short')) f.shortage = p.get('short')!.split(',').filter((v) => ['high', 'medium'].includes(v))
  if (p.get('wd') === '1') f.hideWithdrawn = false
  if (p.get('glob')) f.global = p.get('glob')!.split(',').filter((v) => ['ema', 'pmda', 'us_only'].includes(v))
  if (p.get('dis')) f.diseases = p.get('dis')!.split(',').filter(Boolean)
  if (p.get('evi')) f.evidence = p.get('evi')!.split(',').filter((v) => ['pubmed', 'ct'].includes(v))
  return f
}

// ---------- 场景预设（方案B） ----------

export interface Preset {
  key: string
  label: string
  tip: string
  apply: Partial<FacetState>
}

export const PRESETS: Preset[] = [
  { key: 'radar', label: '🆕 新品种雷达', tip: '生命周期 = 引入期', apply: { stages: ['引入期'] } },
  { key: 'cliff', label: '⏳ 专利悬崖', tip: '成熟期 + 核心专利 ≤24 个月到期', apply: { stages: ['成熟期'], cliff: ['≤24月'] } },
  { key: 'us', label: '🌍 出海标的', tip: '全球可及专题内仅美国获批（EMA/PMDA 均未检索到）', apply: { global: ['us_only'] } },
  { key: 'modality', label: '🧬 新 Modality', tip: '分子类型 = ADC / 核酸类 / 细胞基因疗法', apply: { molTypes: ['抗体偶联药物（ADC）', '核酸类', '细胞/基因疗法'] } },
  { key: 'shortage', label: '⚠️ 短缺风险', tip: 'FDA 短缺风险 = 高 / 中', apply: { shortage: ['high', 'medium'] } },
  { key: 'evidence', label: '🔬 证据热点', tip: '有 PubMed 证据数据（引入期口径，年均 ≥10 篇）', apply: { evidence: ['pubmed'] } },
]

export function presetMatches(f: FacetState, p: Preset): boolean {
  return Object.entries(p.apply).every(([k, v]) => {
    const cur = f[k as keyof FacetState]
    if (Array.isArray(v)) return Array.isArray(cur) && v.length === cur.length && v.every((x) => cur.includes(x as never))
    return cur === v
  }) && isFacetActive(f) &&
    // 预设激活 = 除预设字段外其余均为空
    Object.entries(EMPTY_FACETS).every(([k, v]) => {
      if (k in p.apply || k === 'hideWithdrawn') return true
      const cur = f[k as keyof FacetState]
      return Array.isArray(v) ? (cur as string[]).length === 0 : true
    })
}
