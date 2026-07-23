import { useEffect, useState } from 'react'
import { ChevronLeft, Download, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  loadLifecycleIndex, loadEntityMap, loadIngredientPubMed,
  type LifecycleRecord, type EntityMap, type IngredientPubMedIndex,
} from '@/lib/data'
import { cn } from '@/lib/utils'

const TODAY = new Date() // 运行时当前日期（Fix 4：不再硬编码）

const STAGE_STYLE: Record<string, string> = {
  引入期: 'bg-blue-100 text-blue-700',
  成长期: 'bg-emerald-100 text-emerald-700',
  成熟期: 'bg-violet-100 text-violet-700',
  衰退期: 'bg-amber-100 text-amber-700',
  仿制成熟期: 'bg-slate-200 text-slate-600',
}

const SHORTAGE_LABEL: Record<string, string> = {
  high: '短缺·高',
  medium: '短缺·中',
  watch: '短缺·观察',
}

function monthsSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, (TODAY.getFullYear() - d.getFullYear()) * 12 + (TODAY.getMonth() - d.getMonth()))
}

interface Cell {
  text: string
  node?: React.ReactNode
  tint?: 'red' | 'orange'
}

interface MetricRow {
  label: string
  cells: Cell[]
  /** CSV 导出用的纯文本（默认同 cells.text） */
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function IngredientCompare({ ingredients, onBack }: {
  ingredients: string[]
  onBack: () => void
}) {
  const [records, setRecords] = useState<Record<string, LifecycleRecord> | null>(null)
  const [entityMap, setEntityMap] = useState<EntityMap | null>(null)
  const [pubmed, setPubmed] = useState<IngredientPubMedIndex | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadLifecycleIndex()
      .then((d) => setRecords(d.records))
      .catch((e: Error) => setError(e.message))
    loadEntityMap().then(setEntityMap).catch(() => setEntityMap(null))
    loadIngredientPubMed().then(setPubmed).catch(() => setPubmed(null))
  }, [])

  if (error) {
    return <Card><CardContent className="py-12 text-center text-sm text-red-600">对比数据加载失败：{error}</CardContent></Card>
  }
  if (!records) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <p className="text-sm">正在加载对比数据…</p>
      </div>
    )
  }

  const recs = ingredients.map((ing) => records[ing]).filter(Boolean) as LifecycleRecord[]
  if (recs.length < 2) {
    return (
      <Card><CardContent className="py-12 text-center text-sm text-slate-400">请至少选择 2 个成分进行对比。</CardContent></Card>
    )
  }

  const linkOf = (ing: string) => entityMap?.ingredients[ing]
  const pmOf = (ing: string) => pubmed?.ingredients[ing]

  // 高亮计算：ANDA 竞争最多（红）、专利剩余月数最少且为正（橙）
  const maxAnda = Math.max(...recs.map((r) => r.n_anda))
  const positiveMonths = recs.map((r) => r.months_to_expiry).filter((m): m is number => m != null && m >= 0)
  const minMonths = positiveMonths.length ? Math.min(...positiveMonths) : null

  const metricRows: MetricRow[] = [
    {
      label: '生命周期阶段',
      cells: recs.map((r) => ({
        text: r.stage === '仿制成熟期' ? '仿制药' : r.stage,
        node: <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STAGE_STYLE[r.stage])}>{r.stage === '仿制成熟期' ? '仿制药' : r.stage}</span>,
      })),
    },
    { label: '首获批日期', cells: recs.map((r) => ({ text: r.first_approval ?? '—' })) },
    { label: '上市月数', cells: recs.map((r) => { const m = monthsSince(r.first_approval); return { text: m == null ? '—' : `${m} 个月` } }) },
    { label: '原研公司', cells: recs.map((r) => ({ text: r.originator ?? '—' })) },
    { label: 'NDA/BLA 数', cells: recs.map((r) => ({ text: String(r.n_nda) })) },
    {
      label: 'ANDA 竞争数',
      cells: recs.map((r) => ({ text: String(r.n_anda), tint: r.n_anda === maxAnda && maxAnda > 0 ? 'red' : undefined })),
    },
    { label: '仿制厂家数', cells: recs.map((r) => ({ text: String(r.n_anda_companies) })) },
    {
      label: '专利最晚到期',
      cells: recs.map((r) => {
        if (!r.patent_latest_expiry) return { text: '—' }
        const m = r.months_to_expiry
        const sub = m == null ? '' : m < 0 ? '（已过期）' : `（剩 ${m} 个月）`
        return {
          text: `${r.patent_latest_expiry}${sub}`,
          tint: minMonths != null && m === minMonths ? 'orange' : undefined,
        }
      }),
    },
    {
      label: 'PLCM 动作数',
      cells: recs.map((r) => ({
        text: String(r.plcm_actions.length),
        node: r.plcm_actions.length === 0 ? <span className="text-slate-400">0</span> : (
          <div>
            <span className="font-medium">{r.plcm_actions.length}</span>
            <ul className="mt-1 space-y-0.5 text-xs font-normal text-slate-500">
              {r.plcm_actions.map((a, i) => <li key={i}>{a.year} · {a.type}</li>)}
            </ul>
          </div>
        ),
      })),
    },
    {
      label: '关联疾病',
      cells: recs.map((r) => {
        const ds = linkOf(r.ingredient)?.diseases ?? []
        return {
          text: ds.join('；') || '—',
          node: ds.length === 0 ? <span className="text-slate-400">—</span> : (
            <div className="flex flex-wrap gap-1">
              {ds.slice(0, 6).map((s) => (
                <span key={s} className="rounded-full bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">{s}</span>
              ))}
              {ds.length > 6 && <span className="text-xs text-slate-400">等 {ds.length}</span>}
            </div>
          ),
        }
      }),
    },
    { label: '关联企业数', cells: recs.map((r) => ({ text: String(linkOf(r.ingredient)?.companies?.length ?? 0) })) },
    { label: '关联临床试验数', cells: recs.map((r) => ({ text: String(linkOf(r.ingredient)?.trials?.length ?? 0) })) },
    {
      label: '短缺 / 撤市',
      cells: recs.map((r) => {
        const tags = [
          r.withdrawn ? '已撤市' : null,
          r.shortage_risk ? SHORTAGE_LABEL[r.shortage_risk] : null,
        ].filter(Boolean)
        return { text: tags.join('；') || '—' }
      }),
    },
    {
      label: 'PubMed 临床/综述',
      cells: recs.map((r) => {
        const pm = pmOf(r.ingredient)
        if (!pm || (pm.clinical_count == null && pm.review_count == null)) return { text: '—' }
        return { text: `${pm.clinical_count ?? 0} / ${pm.review_count ?? 0}` }
      }),
    },
  ]

  const exportCsv = () => {
    const header = ['指标', ...recs.map((r) => r.ingredient)]
    const lines = [header, ...metricRows.map((row) => [row.label, ...row.cells.map((c) => c.text)])]
      .map((cols) => cols.map(csvEscape).join(','))
      .join('\r\n')
    const blob = new Blob(['﻿' + lines], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = TODAY.toISOString().slice(0, 10).replace(/-/g, '')
    a.href = url
    a.download = `成分对比-${stamp}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <ChevronLeft className="h-4 w-4" />
              返回
            </button>
            <h3 className="text-base font-semibold text-slate-900">成分对比（{recs.length}）</h3>
          </div>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            <Download className="h-4 w-4" />
            导出 CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="sticky left-0 z-10 w-32 min-w-32 bg-white px-3 py-2 text-left text-xs font-medium text-slate-500">指标</th>
                {recs.map((r) => (
                  <th key={r.ingredient} className="min-w-44 px-3 py-2 text-left text-sm font-semibold text-slate-900">
                    {r.ingredient}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricRows.map((row) => (
                <tr key={row.label} className="border-b border-slate-100">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2.5 text-xs font-medium text-slate-500">{row.label}</td>
                  {row.cells.map((c, i) => (
                    <td
                      key={i}
                      className={cn(
                        'px-3 py-2.5 align-top text-sm text-slate-700',
                        c.tint === 'red' && 'bg-red-50',
                        c.tint === 'orange' && 'bg-orange-50',
                      )}
                    >
                      {c.node ?? c.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          高亮说明：红色 = ANDA 竞争最激烈；橙色 = 专利剩余期最短。PubMed 证据仅覆盖引入期成分，未覆盖显示 —。
        </p>
      </CardContent>
    </Card>
  )
}
