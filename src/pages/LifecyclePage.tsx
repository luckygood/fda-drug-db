import { Fragment, useEffect, useMemo, useState } from 'react'
import { Loader2, Search, ChevronDown, ChevronRight, ArrowUpDown, Hourglass } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { loadLifecycleIndex, type LifecycleIndex, type LifecycleRecord } from '@/lib/data'
import { cn } from '@/lib/utils'

const TODAY = new Date('2026-07-22T00:00:00')
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

const thCls = 'px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap'
const tdCls = 'px-3 py-2 text-sm text-slate-700 whitespace-nowrap'

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

type SortKey = 'first_approval' | 'originator' | 'months' | 'n_nda' | 'n_anda' | 'n_plcm' | 'months_to_expiry' | 'n_anda_companies'

interface ColDef {
  key: SortKey | 'ingredient'
  label: string
  sortable?: boolean
  render: (r: LifecycleRecord) => React.ReactNode
  sortVal?: (r: LifecycleRecord) => number | string
}

function columnsFor(stage: StageKey): ColDef[] {
  const base: ColDef[] = [
    {
      key: 'first_approval', label: '首获批日期', sortable: true,
      render: (r) => r.first_approval ?? '—',
      sortVal: (r) => r.first_approval ?? '',
    },
    {
      key: 'originator', label: '原研公司', sortable: true,
      render: (r) => <span className="text-slate-600">{r.originator ?? '—'}</span>,
      sortVal: (r) => r.originator ?? '',
    },
    {
      key: 'months', label: '上市月数', sortable: true,
      render: (r) => {
        const m = monthsSince(r.first_approval)
        return m == null ? '—' : `${m}`
      },
      sortVal: (r) => monthsSince(r.first_approval) ?? -1,
    },
    {
      key: 'n_nda', label: 'NDA/BLA 数', sortable: true,
      render: (r) => r.n_nda,
      sortVal: (r) => r.n_nda,
    },
    {
      key: 'n_anda', label: 'ANDA 竞争数', sortable: true,
      render: (r) => r.n_anda,
      sortVal: (r) => r.n_anda,
    },
    {
      key: 'n_plcm', label: 'PLCM 动作数', sortable: true,
      render: (r) => r.plcm_actions.length,
      sortVal: (r) => r.plcm_actions.length,
    },
  ]
  if (stage === '成熟期') {
    base.splice(4, 1, {
      key: 'months_to_expiry', label: '专利到期(月)', sortable: true,
      render: (r) => {
        if (r.months_to_expiry == null) return '—'
        if (r.months_to_expiry < 0) return <span className="text-amber-600">已过期</span>
        return <span className={r.months_to_expiry <= 24 ? 'font-medium text-amber-600' : ''}>{r.months_to_expiry}</span>
      },
      sortVal: (r) => r.months_to_expiry ?? 9999,
    })
  }
  if (stage === '衰退期' || stage === '仿制成熟期') {
    base.splice(4, 1, {
      key: 'n_anda_companies', label: '仿制厂家数', sortable: true,
      render: (r) => r.n_anda_companies,
      sortVal: (r) => r.n_anda_companies,
    })
  }
  return base
}

export default function LifecyclePage() {
  const [data, setData] = useState<LifecycleIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<StageKey>('引入期')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('first_approval')
  const [sortAsc, setSortAsc] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE_SIZE)

  useEffect(() => {
    loadLifecycleIndex()
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  // 切换阶段时重置排序/展开/分页
  const selectStage = (s: StageKey) => {
    if (s === stage) return
    setStage(s)
    setSortKey('first_approval')
    setSortAsc(false)
    setExpanded(null)
    setShown(PAGE_SIZE)
  }

  const cols = useMemo(() => columnsFor(stage), [stage])

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toUpperCase()
    const list = Object.values(data.records).filter((r) => {
      if (r.stage !== stage) return false
      if (!q) return true
      return r.ingredient.includes(q) || (r.originator ?? '').toUpperCase().includes(q)
    })
    const col = cols.find((c) => c.key === sortKey)
    if (col?.sortVal) {
      const sv = col.sortVal
      list.sort((a, b) => {
        const va = sv(a)
        const vb = sv(b)
        const cmp = typeof va === 'string' || typeof vb === 'string'
          ? String(va).localeCompare(String(vb))
          : (va as number) - (vb as number)
        return sortAsc ? cmp : -cmp
      })
    }
    return list
  }, [data, stage, query, sortKey, sortAsc, cols])

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
      </div>

      {/* 1. 阶段汇总卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STAGES.map((s) => {
          const active = stage === s.key
          return (
            <button key={s.key} onClick={() => selectStage(s.key)} className="text-left">
              <Card className={cn('h-full border-2 transition-colors', active ? s.activeTone : 'border-transparent hover:border-slate-200')}>
                <CardContent className="pt-4 pb-4">
                  <p className="text-sm font-medium text-slate-500">{s.label}</p>
                  <p className={cn('mt-1 text-2xl font-bold', s.tone)}>
                    {(data.stage_counts[s.key] ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{s.def}</p>
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

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={thCls}></th>
                  <th className={thCls}>成分名</th>
                  {cols.map((c) => (
                    <th key={c.key} className={thCls}>
                      {c.sortable ? (
                        <button
                          onClick={() => toggleSort(c.key as SortKey)}
                          className={cn('inline-flex items-center gap-1 hover:text-slate-800', sortKey === c.key && 'text-blue-600')}
                        >
                          {c.label}
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                  <th className={thCls}>风险</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const open = expanded === r.ingredient
                  const risk = r.shortage_risk ? SHORTAGE_LABEL[r.shortage_risk] : null
                  return (
                    <Fragment key={r.ingredient}>
                      <tr
                        onClick={() => setExpanded(open ? null : r.ingredient)}
                        className={cn('cursor-pointer border-b border-slate-100 hover:bg-slate-50', open && 'bg-blue-50/40')}
                      >
                        <td className={tdCls}>
                          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        </td>
                        <td className={cn(tdCls, 'font-medium text-slate-900')}>{r.ingredient}</td>
                        {cols.map((c) => <td key={c.key} className={tdCls}>{c.render(r)}</td>)}
                        <td className={tdCls}>
                          <div className="flex gap-1">
                            {r.withdrawn && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">已撤市</span>}
                            {risk && <span className={cn('rounded px-1.5 py-0.5 text-xs', risk.cls)}>{risk.text}</span>}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td colSpan={cols.length + 3} className="px-6 py-4">
                            <div className="space-y-3">
                              <p className="text-sm text-slate-700">
                                <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">观察要点</span>
                                {observation(r)}
                              </p>
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
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {visible.length === 0 && (
                  <tr><td colSpan={cols.length + 3} className="py-10 text-center text-sm text-slate-400">无匹配成分</td></tr>
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
    </div>
  )
}
