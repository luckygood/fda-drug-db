import { Fragment, useEffect, useMemo, useState } from 'react'
import { Loader2, Search, ChevronDown, ChevronRight, ArrowUpDown, Hourglass, ArrowRight, GitCompareArrows, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import PubMedEvidence from '@/components/PubMedEvidence'
import IngredientCompare from '@/components/IngredientCompare'
import {
  loadLifecycleIndex, loadIngredientPubMed, loadEntityMap, loadDiseaseIndex, loadGlobalAccess,
  type LifecycleIndex, type LifecycleRecord, type IngredientPubMedIndex, type EntityMap, type GlobalAccessRecord,
} from '@/lib/data'
import { cn } from '@/lib/utils'

const TODAY = new Date() // 运行时当前日期（Fix 4：不再硬编码）
const PAGE_SIZE = 200

type StageKey = '引入期' | '成长期' | '成熟期' | '衰退期' | '仿制成熟期'

const STAGES: { key: StageKey; label: string; def: string; tone: string; activeTone: string }[] = [
  { key: '引入期', label: '引入期', def: '首获批 <2 年 · 认知建立期', tone: 'text-blue-600', activeTone: 'border-blue-500 bg-blue-50/70' },
  { key: '成长期', label: '成长期', def: '上市 2–7 年 · 快速放量', tone: 'text-emerald-600', activeTone: 'border-emerald-500 bg-emerald-50/70' },
  { key: '成熟期', label: '成熟期', def: '上市 7–15 年 · 独占红利', tone: 'text-violet-600', activeTone: 'border-violet-500 bg-violet-50/70' },
  { key: '衰退期', label: '衰退期', def: '>15 年或专利悬崖逼近', tone: 'text-amber-600', activeTone: 'border-amber-500 bg-amber-50/70' },
  { key: '仿制成熟期', label: '仿制药', def: '专利已到期 · 仿制竞争', tone: 'text-slate-500', activeTone: 'border-slate-400 bg-slate-100/70' },
]

const SHORTAGE_LABEL: Record<string, { text: string; cls: string }> = {
  high: { text: '短缺·高', cls: 'bg-red-100 text-red-700' },
  medium: { text: '短缺·中', cls: 'bg-amber-100 text-amber-700' },
  watch: { text: '短缺·观察', cls: 'bg-sky-100 text-sky-700' },
}

const PLCM_TONE: Record<string, string> = {
  新适应症: 'bg-blue-100 text-blue-700',
  新剂型: 'bg-emerald-100 text-emerald-700',
  新规格: 'bg-violet-100 text-violet-700',
}

const thCls = 'px-4 py-2.5 text-left text-xs font-medium text-slate-500 whitespace-nowrap'
const tdCls = 'px-4 py-3 text-sm text-slate-700 align-top'

function monthsSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, (TODAY.getFullYear() - d.getFullYear()) * 12 + (TODAY.getMonth() - d.getMonth()))
}

/** 自动生成"观察要点"一句话 */
function observation(r: LifecycleRecord): string {
  const m = monthsSince(r.first_approval)
  const mText = m == null ? '上市时间未知' : `上市 ${m} 个月`
  if (r.stage === '引入期') {
    const comp = r.n_anda > 0 ? `已有 ${r.n_anda} 个仿制药申报` : '尚无仿制药申报'
    return `${mText}，${comp}，处于市场导入期，关注放量节奏与适应症拓展。`
  }
  if (r.stage === '成长期') {
    return `${mText}，暂无 ANDA 竞争，处于快速放量窗口，关注原研 PLCM 动作与专利布局。`
  }
  if (r.stage === '成熟期') {
    const exp = r.months_to_expiry != null
      ? r.months_to_expiry >= 0 ? `专利剩 ${r.months_to_expiry} 个月到期` : '核心专利已到期'
      : '未见近窗口专利到期'
    return `${mText}，${exp}，独占红利期，关注悬崖前的生命周期管理。`
  }
  if (r.stage === '衰退期') {
    return r.withdrawn
      ? `${mText}，已撤市或全面停产，退出市场。`
      : `${mText}，专利过期且已有 ${r.n_anda} 个 ANDA（${r.n_anda_companies} 家）竞争，进入衰退通道。`
  }
  return `无原研 NDA/BLA 记录，${r.n_anda} 个 ANDA（${r.n_anda_companies} 家）的成熟仿制市场。`
}

type SortKey = 'first_approval' | 'originator' | 'n_anda'

const SORT_VALS: Record<SortKey, (r: LifecycleRecord) => number | string> = {
  first_approval: (r) => r.first_approval ?? '',
  originator: (r) => r.originator ?? '',
  n_anda: (r) => r.n_anda,
}

/** 竞争格局单元格：NDA/ANDA 合并展示，按阶段附加上下文 */
function CompetitionCell({ r, stage }: { r: LifecycleRecord; stage: StageKey }) {
  const main = r.n_anda === 0
    ? <span className="text-slate-400">暂无仿制</span>
    : <span>{r.n_nda} NDA · <span className="font-medium text-slate-900">{r.n_anda}</span> ANDA</span>

  let sub: React.ReactNode = null
  if (stage === '成熟期' && r.months_to_expiry != null) {
    sub = r.months_to_expiry < 0
      ? <span className="text-amber-600">核心专利已过期</span>
      : <span className={r.months_to_expiry <= 24 ? 'font-medium text-amber-600' : 'text-slate-400'}>
          专利剩 {r.months_to_expiry} 个月
        </span>
  } else if ((stage === '衰退期' || stage === '仿制成熟期') && r.n_anda_companies > 0) {
    sub = <span className="font-medium text-slate-600">{r.n_anda_companies} 家仿制厂家</span>
  }

  return (
    <div>
      <div className="whitespace-nowrap">{main}</div>
      {sub && <div className="mt-0.5 text-xs">{sub}</div>}
    </div>
  )
}

/** 成分实体关系块：疾病 / 企业 / 临床试验链接 */
function EntityLinksBlock({ r, entityMap, diseaseNames, onSelectDisease, onSelectCompany }: {
  r: LifecycleRecord
  entityMap: EntityMap | null
  diseaseNames: Record<string, string>
  onSelectDisease?: (slug: string) => void
  onSelectCompany?: (slug: string) => void
}) {
  const links = entityMap?.ingredients[r.ingredient]
  if (!links) return null
  const hasAny = (links.diseases?.length ?? 0) > 0 || (links.companies?.length ?? 0) > 0 || (links.trials?.length ?? 0) > 0
  if (!hasAny) return null
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-slate-500">实体关系</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {links.diseases?.map((slug) => (
          <button
            key={slug}
            onClick={(e) => { e.stopPropagation(); onSelectDisease?.(slug) }}
            title={`疾病视角：${slug}`}
            className="rounded-full bg-rose-50 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-100"
          >
            {diseaseNames[slug] ?? slug}
          </button>
        ))}
        {links.companies?.slice(0, 5).map((slug) => (
          <button
            key={slug}
            onClick={(e) => { e.stopPropagation(); onSelectCompany?.(slug) }}
            title={entityMap?.companies[slug]?.name ?? slug}
            className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
          >
            {entityMap?.companies[slug]?.name ?? slug}
          </button>
        ))}
        {(links.companies?.length ?? 0) > 5 && (
          <span className="text-xs text-slate-400">等 {links.companies!.length} 家企业</span>
        )}
        {(links.trials?.length ?? 0) > 0 && (
          <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs text-teal-700">
            关联临床试验 {links.trials!.length} 项
          </span>
        )}
      </div>
    </div>
  )
}

interface LifecyclePageProps {
  /** 跨页传入的成分名（疾病页/企业页成分 chips），待本页消费：切到对应阶段并展开 */
  pendingIngredient?: string | null
  onConsumePendingIngredient?: () => void
  /** 跨页传入的对比清单（成分透视页"送去对比"），待本页消费：直接进入对比模式 */
  pendingCompare?: string[] | null
  onConsumePendingCompare?: () => void
  /** 点击疾病 chip 跳转疾病视角页 */
  onSelectDisease?: (slug: string) => void
  /** 点击企业 chip 跳转企业画像页 */
  onSelectCompany?: (slug: string) => void
  /** 跳转成分透视页的完整实体页 */
  onOpenEntityPage?: (ingredient: string) => void
}

export default function LifecyclePage({
  pendingIngredient,
  onConsumePendingIngredient,
  pendingCompare,
  onConsumePendingCompare,
  onSelectDisease,
  onSelectCompany,
  onOpenEntityPage,
}: LifecyclePageProps) {
  const [data, setData] = useState<LifecycleIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pubmed, setPubmed] = useState<IngredientPubMedIndex | null>(null)
  const [entityMap, setEntityMap] = useState<EntityMap | null>(null)
  const [diseaseNames, setDiseaseNames] = useState<Record<string, string>>({})
  const [globalAccess, setGlobalAccess] = useState<Record<string, GlobalAccessRecord> | null>(null)
  const [stage, setStage] = useState<StageKey>('引入期')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('first_approval')
  const [sortAsc, setSortAsc] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE_SIZE)
  // 对比模式
  const [compareMode, setCompareMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)

  const toggleCompareMode = () => {
    setCompareMode((v) => !v)
    setSelected([])
    setComparing(false)
    setExpanded(null)
  }

  const toggleSelect = (ing: string) => {
    setSelected((prev) => {
      if (prev.includes(ing)) return prev.filter((x) => x !== ing)
      if (prev.length >= 4) return prev
      return [...prev, ing]
    })
  }

  useEffect(() => {
    loadLifecycleIndex()
      .then(setData)
      .catch((e: Error) => setError(e.message))
    loadEntityMap()
      .then(setEntityMap)
      .catch(() => setEntityMap(null))
    loadDiseaseIndex()
      .then((d) => setDiseaseNames(Object.fromEntries(d.diseases.map((x) => [x.slug, x.name_zh]))))
      .catch(() => setDiseaseNames({}))
    loadGlobalAccess()
      .then((d) => setGlobalAccess(d.records))
      .catch(() => setGlobalAccess(null))
  }, [])

  // 消费跨页传入的成分：切到其所在阶段、检索并展开
  useEffect(() => {
    if (!pendingIngredient || !data) return
    const rec = data.records[pendingIngredient.toUpperCase()]
    if (rec) {
      const target = rec.stage as StageKey
      if (STAGES.some((s) => s.key === target)) setStage(target)
      setQuery(rec.ingredient)
      setExpanded(rec.ingredient)
      setShown(PAGE_SIZE)
    }
    onConsumePendingIngredient?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIngredient, data])

  // 消费跨页传入的对比清单：直接进入对比模式并展开对比视图
  useEffect(() => {
    if (!pendingCompare || !data) return
    const valid = pendingCompare.map((n) => n.toUpperCase()).filter((n) => data.records[n])
    if (valid.length > 0) {
      setCompareMode(true)
      setSelected(valid.slice(0, 4))
      setComparing(valid.length >= 2)
      setExpanded(null)
    }
    onConsumePendingCompare?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCompare, data])

  // 仅在引入期视图加载 PubMed 证据（约 72 KB，带缓存）
  useEffect(() => {
    if (stage !== '引入期' || pubmed) return
    let alive = true
    loadIngredientPubMed()
      .then((d) => { if (alive) setPubmed(d) })
      .catch(() => { /* 证据缺失时静默降级 */ })
    return () => { alive = false }
  }, [stage, pubmed])

  // 切换阶段时重置排序/展开/分页
  const selectStage = (s: StageKey) => {
    if (s === stage) return
    setStage(s)
    setSortKey('first_approval')
    setSortAsc(false)
    setExpanded(null)
    setShown(PAGE_SIZE)
  }

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toUpperCase()
    const list = Object.values(data.records).filter((r) => {
      if (r.stage !== stage) return false
      if (!q) return true
      return r.ingredient.includes(q) || (r.originator ?? '').toUpperCase().includes(q)
    })
    const sv = SORT_VALS[sortKey]
    list.sort((a, b) => {
      const va = sv(a)
      const vb = sv(b)
      const cmp = typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number)
      return sortAsc ? cmp : -cmp
    })
    return list
  }, [data, stage, query, sortKey, sortAsc])

  const visible = rows.slice(0, shown)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  if (error) {
    return (
      <Card><CardContent className="py-12 text-center text-sm text-red-600">生命周期数据加载失败：{error}</CardContent></Card>
    )
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <p className="text-sm">正在加载生命周期索引（约 1.8 MB）…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="flex items-center gap-2">
        <Hourglass className="h-5 w-5 text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">药品生命周期</h2>
        <span className="text-xs text-slate-400">
          共 {data.total_ingredients.toLocaleString()} 个活性成分 · 数据生成于 {data.generated_at}
        </span>
        <button
          onClick={toggleCompareMode}
          className={cn(
            'ml-auto flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
            compareMode
              ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-700'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50',
          )}
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          {compareMode ? '退出对比模式' : '对比模式'}
        </button>
      </div>

      {comparing ? (
        <IngredientCompare ingredients={selected} onBack={() => setComparing(false)} />
      ) : (
      <>
      {/* 1. 阶段汇总卡片 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {STAGES.map((s) => {
          const active = stage === s.key
          return (
            <button key={s.key} onClick={() => selectStage(s.key)} className="text-left">
              <Card className={cn('h-full border-2 transition-colors', active ? s.activeTone : 'border-transparent hover:border-slate-200')}>
                <CardContent className="px-3 pt-3 pb-3">
                  <p className="text-xs font-medium text-slate-500">{s.label}</p>
                  <p className={cn('mt-0.5 text-xl font-bold', s.tone)}>
                    {(data.stage_counts[s.key] ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-slate-400">{s.def}</p>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      {/* 2. 阶段明细表 */}
      <Card>
        <CardContent className="pt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {STAGES.find((s) => s.key === stage)?.label}成分明细
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                {rows.length.toLocaleString()} 个成分{rows.length > shown ? ` · 显示前 ${shown}` : ''} · 点击行展开 PLCM 时间线与观察要点
              </p>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShown(PAGE_SIZE) }}
                placeholder="搜索成分 / 原研公司…"
                className="w-64 rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {compareMode && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2">
              <span className="text-xs text-slate-500">点击行选择成分（最多 4 个，可跨阶段）：</span>
              {selected.map((ing) => (
                <span key={ing} className="flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-medium text-white">
                  {ing}
                  <button onClick={() => toggleSelect(ing)} title="移除"><X className="h-3 w-3" /></button>
                </span>
              ))}
              <button
                onClick={() => setComparing(true)}
                disabled={selected.length < 2}
                className="ml-auto flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <GitCompareArrows className="h-3.5 w-3.5" />
                开始对比（{selected.length}/4）
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={cn(thCls, 'w-8')}></th>
                  <th className={cn(thCls, 'w-[34%]')}>成分</th>
                  {([
                    { key: 'first_approval' as SortKey, label: '首获批', cls: 'w-[18%]' },
                    { key: 'originator' as SortKey, label: '原研公司', cls: 'w-[24%]' },
                    { key: 'n_anda' as SortKey, label: '竞争格局', cls: 'w-[24%]' },
                  ]).map((c) => (
                    <th key={c.key} className={cn(thCls, c.cls)}>
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={cn('inline-flex items-center gap-1 hover:text-slate-800', sortKey === c.key && 'text-blue-600')}
                      >
                        {c.label}
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const open = expanded === r.ingredient
                  const risk = r.shortage_risk ? SHORTAGE_LABEL[r.shortage_risk] : null
                  const m = monthsSince(r.first_approval)
                  return (
                    <Fragment key={r.ingredient}>
                      <tr
                        onClick={() => (compareMode ? toggleSelect(r.ingredient) : setExpanded(open ? null : r.ingredient))}
                        className={cn(
                          'cursor-pointer border-b border-slate-100 hover:bg-slate-50',
                          open && !compareMode && 'bg-blue-50/40',
                          compareMode && selected.includes(r.ingredient) && 'bg-blue-50/70',
                        )}
                      >
                        <td className={tdCls}>
                          {compareMode ? (
                            <input
                              type="checkbox"
                              readOnly
                              checked={selected.includes(r.ingredient)}
                              disabled={!selected.includes(r.ingredient) && selected.length >= 4}
                              className="h-4 w-4 accent-blue-600"
                            />
                          ) : open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        </td>
                        {/* 成分：名称 + PLCM 徽标 + 风险小标签 */}
                        <td className={tdCls}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-slate-900">{r.ingredient}</span>
                            {r.plcm_actions.length > 0 && (
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
                                PLCM ×{r.plcm_actions.length}
                              </span>
                            )}
                          </div>
                          {(r.withdrawn || risk) && (
                            <div className="mt-1 flex gap-1">
                              {r.withdrawn && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">已撤市</span>}
                              {risk && <span className={cn('rounded px-1.5 py-0.5 text-xs', risk.cls)}>{risk.text}</span>}
                            </div>
                          )}
                        </td>
                        {/* 首获批：日期 + 上市月数 */}
                        <td className={tdCls}>
                          <div className="whitespace-nowrap">{r.first_approval ?? '—'}</div>
                          {m != null && <div className="mt-0.5 text-xs text-slate-400">上市 {m} 个月</div>}
                        </td>
                        {/* 原研公司：超长截断 */}
                        <td className={tdCls}>
                          <span className="block truncate text-slate-600" title={r.originator ?? undefined}>
                            {r.originator ?? '—'}
                          </span>
                        </td>
                        {/* 竞争格局：NDA/ANDA 合并 + 阶段上下文 */}
                        <td className={tdCls}>
                          <CompetitionCell r={r} stage={stage} />
                        </td>
                      </tr>
                      {open && !compareMode && (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td colSpan={5} className="px-6 py-4">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm text-slate-700">
                                  <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">观察要点</span>
                                  {observation(r)}
                                </p>
                                {(() => {
                                  const ga = globalAccess?.[r.ingredient]
                                  if (!ga) return null
                                  if (ga.match_type === 'unmatched' || !ga.ema_status) {
                                    return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">🇪🇺 EMA 集中审批未检索到</span>
                                  }
                                  if (ga.ema_status === 'authorised') {
                                    return (
                                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700" title={ga.ema_product ?? undefined}>
                                        🇪🇺 EMA 已授权{ga.ema_first_date ? ` ${ga.ema_first_date.slice(0, 4)}` : ''}
                                      </span>
                                    )
                                  }
                                  if (ga.ema_status === 'withdrawn') {
                                    return <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">🇪🇺 EMA 已撤市</span>
                                  }
                                  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">🇪🇺 EMA {ga.ema_status === 'refused' ? '已拒绝' : '其他状态'}</span>
                                })()}
                              </div>
                              {r.plcm_actions.length > 0 ? (
                                <div>
                                  <p className="mb-2 text-xs font-medium text-slate-500">PLCM 生命周期管理动作</p>
                                  <div className="flex flex-wrap gap-2">
                                    {r.plcm_actions.map((a, i) => (
                                      <span
                                        key={i}
                                        title={a.note}
                                        className={cn('rounded-full px-2.5 py-1 text-xs', PLCM_TONE[a.type] ?? 'bg-slate-100 text-slate-600')}
                                      >
                                        {a.year} · {a.type}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400">暂无识别到的 PLCM 动作。</p>
                              )}
                              {stage === '引入期' && (
                                <PubMedEvidence entry={pubmed?.ingredients[r.ingredient]} compact />
                              )}
                              <EntityLinksBlock
                                r={r}
                                entityMap={entityMap}
                                diseaseNames={diseaseNames}
                                onSelectDisease={onSelectDisease}
                                onSelectCompany={onSelectCompany}
                              />
                              {onOpenEntityPage && (
                                <div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onOpenEntityPage(r.ingredient) }}
                                    className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                                  >
                                    查看完整实体页
                                    <ArrowRight className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {visible.length === 0 && (
                  <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">无匹配成分</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {rows.length > shown && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShown((n) => n + PAGE_SIZE)}
                className="rounded-md border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                显示更多（剩余 {(rows.length - shown).toLocaleString()} 条）
              </button>
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}
    </div>
  )
}
