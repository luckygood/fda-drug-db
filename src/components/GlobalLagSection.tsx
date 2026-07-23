import { useEffect, useMemo, useState } from 'react'
import { Globe2, Loader2 } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EChart from '@/components/EChart'
import { loadGlobalAccess, type GlobalAccess, type LagBlock, type LagNotableRow } from '@/lib/data'

const BASE_AXIS = {
  axisLine: { lineStyle: { color: '#cbd5e1' } },
  axisLabel: { color: '#475569' },
  splitLine: { lineStyle: { color: '#e2e8f0' } },
} as const

/** 滞后分布直方图：负滞后（先于 FDA 获批）用青绿色，正滞后用蓝色 */
function histogramOption(block: LagBlock, title: string): EChartsOption {
  return {
    color: ['#2563eb'],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = (params as { name: string; value: number }[])[0]
        return `${title} · ${p.name}<br/>${p.value} 个成分`
      },
    },
    grid: { left: 40, right: 16, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: block.histogram.map((h) => h.bin), ...BASE_AXIS },
    yAxis: { type: 'value', name: '成分数', ...BASE_AXIS },
    series: [{
      type: 'bar',
      barWidth: 30,
      itemStyle: {
        borderRadius: [3, 3, 0, 0],
        color: (p) => (p.dataIndex < 2 ? '#0d9488' : '#2563eb'),
      },
      data: block.histogram.map((h) => h.count),
    }],
  }
}

function LagTable({ title, rows, onSelectIngredient }: {
  title: string
  rows: LagNotableRow[]
  onSelectIngredient?: (ing: string) => void
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-slate-500">{title}</p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">成分</th>
            <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">FDA</th>
            <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">他地</th>
            <th className="px-2 py-1.5 text-right text-xs font-medium text-slate-500">滞后(月)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ing} className="border-b border-slate-100">
              <td className="max-w-44 truncate px-2 py-1.5 text-sm">
                <button
                  onClick={() => onSelectIngredient?.(r.ing)}
                  title="在生命周期页查看该成分"
                  className="truncate font-medium text-blue-700 hover:underline"
                >
                  {r.ing}
                </button>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-500">{r.fda.slice(0, 7)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-500">{r.other.slice(0, 7)}</td>
              <td className="px-2 py-1.5 text-right text-sm font-medium text-amber-600">{r.months}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function GlobalLagSection({ onSelectIngredient }: {
  onSelectIngredient?: (ing: string) => void
}) {
  const [data, setData] = useState<GlobalAccess | null>(null)

  useEffect(() => {
    loadGlobalAccess().then(setData).catch(() => setData(null))
  }, [])

  const lag = data?.lag_stats
  const emaOption = useMemo(
    () => (lag?.ema ? histogramOption(lag.ema, 'EMA 滞后（月）') : null),
    [lag],
  )
  const pmdaOption = useMemo(
    () => (lag?.pmda ? histogramOption(lag.pmda, 'PMDA 滞后（月）') : null),
    [lag],
  )

  if (!data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-12 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <p className="text-sm">正在加载全球批准时滞数据…</p>
        </CardContent>
      </Card>
    )
  }
  if (!lag?.ema || !lag?.pmda) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Globe2 className="h-5 w-5 text-blue-600" />
          全球批准时滞 · Drug Lag（2020+ FDA NDA/BLA 新成分）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 统计磁贴 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
            <p className="text-xs text-slate-400">🇪🇺 EMA 中位滞后</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{lag.ema.median} 个月</p>
            <p className="mt-0.5 text-xs text-slate-400">
              n={lag.ema.n} · P25 {lag.ema.p25} / P75 {lag.ema.p75} · 极值 {lag.ema.min}~{lag.ema.max} 月
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
            <p className="text-xs text-slate-400">🇯🇵 PMDA 中位滞后</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{lag.pmda.median} 个月</p>
            <p className="mt-0.5 text-xs text-slate-400">
              n={lag.pmda.n} · P25 {lag.pmda.p25} / P75 {lag.pmda.p75} · 极值 {lag.pmda.min}~{lag.pmda.max} 月
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
            <p className="text-xs text-slate-400">🌐 三地日期齐备</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{lag.both.n}</p>
            <p className="mt-0.5 text-xs text-slate-400">FDA × EMA × PMDA 均有获批日期</p>
          </div>
        </div>

        {/* 直方图 */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">EMA 滞后分布（月）</p>
            {emaOption && <EChart option={emaOption} height={260} />}
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">PMDA 滞后分布（月）</p>
            {pmdaOption && <EChart option={pmdaOption} height={260} />}
          </div>
        </div>
        <p className="-mt-3 text-xs text-slate-400">
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-teal-600" />负值区间 = 先于 FDA 获批；
          <span className="ml-2 mr-1 inline-block h-2 w-2 rounded-sm bg-blue-600" />正值区间 = 晚于 FDA。
        </p>

        {/* 滞后榜 */}
        <div className="grid gap-6 lg:grid-cols-2">
          <LagTable title="EMA 最长滞后 Top 10" rows={lag.notable.ema_top10} onSelectIngredient={onSelectIngredient} />
          <LagTable title="PMDA 最长滞后 Top 10" rows={lag.notable.pmda_top10} onSelectIngredient={onSelectIngredient} />
        </div>

        <p className="text-xs leading-relaxed text-slate-400">
          统计口径：2020 年起 FDA 史上首次获批（NME 口径）的 NDA/BLA 成分；EMA 取集中审批最早授权日；PMDA 取官方新药清单（2004 年起）最早获批日；滞后 = 他地日期 − FDA 日期（月），负值 = 先于 FDA 获批；美版生物类似药（-XXXX 后缀）不参与时滞统计。极端负值（远早于 FDA 获批）通常反映该成分早年在其他市场以其他名称/盐型上市，属匹配口径内的正常长尾，不代表数据错误。
        </p>
      </CardContent>
    </Card>
  )
}
