import { useEffect, useMemo, useState } from 'react'
import { Loader2, TrendingUp, Building2, FlaskConical, PieChart as PieIcon, Award } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EChart from '@/components/EChart'
import { loadStats, type Stats } from '@/lib/data'
import GlobalLagSection from '@/components/GlobalLagSection'

// 医药风配色：与整站蓝/青主色一致
const COLORS = {
  blue: '#2563eb',
  teal: '#0d9488',
  violet: '#7c3aed',
  amber: '#f59e0b',
  slate: '#64748b',
  palette: ['#2563eb', '#0d9488', '#7c3aed', '#f59e0b', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0f766e'],
}

const BASE_AXIS = {
  axisLine: { lineStyle: { color: '#cbd5e1' } },
  axisLabel: { color: '#475569' },
  splitLine: { lineStyle: { color: '#e2e8f0' } },
} as const

function HeadlineCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-slate-400">{label}</p>
        <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
        {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export default function InsightsPage({ onSelectIngredient }: { onSelectIngredient?: (ing: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadStats()
      .then(setStats)
      .catch((e: Error) => setError(e.message))
  }, [])

  const yearlyOption = useMemo((): EChartsOption | null => {
    if (!stats) return null
    const y = stats.yearly_by_type
    return {
      color: [COLORS.blue, COLORS.teal, COLORS.violet],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['NDA（新药）', 'ANDA（仿制药）', 'BLA（生物制品）'], top: 0 },
      grid: { left: 50, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: y.years, ...BASE_AXIS },
      yAxis: { type: 'value', name: '获批申请数', ...BASE_AXIS },
      series: [
        { name: 'NDA（新药）', type: 'bar', stack: 'total', data: y.NDA },
        { name: 'ANDA（仿制药）', type: 'bar', stack: 'total', data: y.ANDA },
        { name: 'BLA（生物制品）', type: 'bar', stack: 'total', data: y.BLA },
      ],
      graphic: [{
        type: 'text', right: 30, top: 56,
        style: { text: `注：${y.incomplete_year} 年为不完整年度`, fill: '#94a3b8', fontSize: 12 },
      }],
    }
  }, [stats])

  const nmeOption = useMemo((): EChartsOption | null => {
    if (!stats) return null
    const n = stats.nme_by_year
    return {
      color: [COLORS.blue],
      tooltip: { trigger: 'axis' },
      grid: { left: 45, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: n.years, ...BASE_AXIS },
      yAxis: { type: 'value', name: 'NME 数量', ...BASE_AXIS },
      series: [{
        name: 'NME', type: 'bar', data: n.counts,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      }],
    }
  }, [stats])

  const priorityOption = useMemo((): EChartsOption | null => {
    if (!stats) return null
    const p = stats.priority_by_year
    return {
      color: [COLORS.amber],
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const items = params as { dataIndex: number }[]
          const i = items[0].dataIndex
          return `${p.years[i]} 年<br/>优先审评：${p.priority[i]} / ${p.total[i]} 件（${(p.ratio[i] * 100).toFixed(1)}%）`
        },
      },
      grid: { left: 50, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: p.years, ...BASE_AXIS },
      yAxis: {
        type: 'value', name: '占比', ...BASE_AXIS,
        axisLabel: { color: '#475569', formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
        max: (v: { max: number }) => Math.min(1, Math.ceil(v.max * 10) / 10),
      },
      series: [{
        name: '优先审评占比', type: 'line', smooth: true, data: p.ratio,
        symbolSize: 7, lineStyle: { width: 3 },
        areaStyle: { opacity: 0.12 },
      }],
    }
  }, [stats])

  const sponsorsOption = useMemo((): EChartsOption | null => {
    if (!stats) return null
    const s = stats.top_sponsors
    return {
      color: [COLORS.teal],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 40, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category', inverse: true, data: s.names,
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 170, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', data: s.counts, barWidth: 14,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [stats])

  const ingredientsOption = useMemo((): EChartsOption | null => {
    if (!stats) return null
    const s = stats.top_ingredients
    return {
      color: [COLORS.blue],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 40, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category', inverse: true, data: s.names,
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 210, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', data: s.counts, barWidth: 14,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [stats])

  const formsOption = useMemo((): EChartsOption | null => {
    if (!stats) return null
    const f = stats.dosage_forms
    return {
      color: COLORS.palette,
      tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 个产品（{d}%）' },
      legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: '#475569', fontSize: 11 } },
      series: [{
        type: 'pie', radius: ['42%', '68%'], center: ['38%', '50%'],
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: f.names.map((n, i) => ({ name: n, value: f.counts[i] })),
      }],
    }
  }, [stats])

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-600">统计数据加载失败：{error}</p>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p>正在加载统计数据…</p>
      </div>
    )
  }

  const h = stats.headline

  return (
    <div className="space-y-6">
      {/* 关键数字卡片 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <HeadlineCard label="申请总数" value={h.total_applications.toLocaleString()} sub="NDA / ANDA / BLA" />
        <HeadlineCard label="在售产品" value={h.active_products.toLocaleString()} sub="处方药 + OTC" />
        <HeadlineCard label="已撤市产品" value={h.discontinued_products.toLocaleString()} sub="Discontinued" />
        <HeadlineCard label="暂定批准申请" value={h.tentative_applications.toLocaleString()} sub="Tentative Approval" />
        <HeadlineCard label="2025 年 NME" value={String(h.nme_2025)} sub="新分子实体" />
        <HeadlineCard label="持证商总数" value={h.total_sponsors.toLocaleString()} sub="去重后" />
      </div>

      {/* 年度获批趋势 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            年度获批趋势（1995 至今）
          </CardTitle>
        </CardHeader>
        <CardContent>{yearlyOption && <EChart option={yearlyOption} height={360} />}</CardContent>
      </Card>

      {/* NME + 优先审评 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Award className="h-5 w-5 text-blue-600" />
              新分子实体（NME）年度获批数
            </CardTitle>
          </CardHeader>
          <CardContent>{nmeOption && <EChart option={nmeOption} height={300} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-amber-500" />
              优先审评占比（近 15 年）
            </CardTitle>
          </CardHeader>
          <CardContent>{priorityOption && <EChart option={priorityOption} height={300} />}</CardContent>
        </Card>
      </div>

      {/* 持证商 + 成分 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-teal-600" />
              在售产品数 Top 15 持证商
            </CardTitle>
          </CardHeader>
          <CardContent>{sponsorsOption && <EChart option={sponsorsOption} height={430} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FlaskConical className="h-5 w-5 text-blue-600" />
              仿制药（ANDA）竞争 Top 15 成分
            </CardTitle>
          </CardHeader>
          <CardContent>{ingredientsOption && <EChart option={ingredientsOption} height={430} />}</CardContent>
        </Card>
      </div>

      {/* 全球批准时滞（L2） */}
      <GlobalLagSection onSelectIngredient={onSelectIngredient} />

      {/* 剂型分布 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <PieIcon className="h-5 w-5 text-blue-600" />
            在售产品剂型分布
          </CardTitle>
        </CardHeader>
        <CardContent>{formsOption && <EChart option={formsOption} height={340} />}</CardContent>
      </Card>

      <p className="text-center text-xs text-slate-400">
        数据来源：Drugs@FDA · 基于申请获批日期与产品上市状态预聚合统计
      </p>
    </div>
  )
}
