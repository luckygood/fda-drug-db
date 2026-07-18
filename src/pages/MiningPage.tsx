import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Flame, Crosshair, Award, Pill, AlertTriangle, Table2, ScatterChart,
  Share2, Hourglass,
} from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EChart from '@/components/EChart'
import { loadMining, loadDiseaseNetwork, type MiningData, type DiseaseNetwork } from '@/lib/data'

const COLORS = {
  blue: '#2563eb',
  teal: '#0d9488',
  violet: '#7c3aed',
  amber: '#f59e0b',
  red: '#dc2626',
  slate: '#64748b',
  palette: ['#2563eb', '#0d9488', '#7c3aed', '#f59e0b', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0f766e', '#b45309', '#475569'],
}

const BASE_AXIS = {
  axisLine: { lineStyle: { color: '#cbd5e1' } },
  axisLabel: { color: '#475569' },
  splitLine: { lineStyle: { color: '#e2e8f0' } },
} as const

function StatCard({ label, value, sub, tone = 'text-slate-900' }: {
  label: string; value: string; sub?: string; tone?: string
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-slate-400">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${tone}`}>{value}</p>
        {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function Badge({ text, color }: { text: string; color: 'violet' | 'amber' }) {
  const cls = color === 'violet'
    ? 'bg-violet-100 text-violet-700'
    : 'bg-amber-100 text-amber-700'
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{text}</span>
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-slate-400">{children}</p>
}

const thCls = 'px-3 py-2 text-left text-xs font-medium text-slate-500'
const tdCls = 'px-3 py-2 text-sm text-slate-700'

export default function MiningPage({
  onSelectDrug,
  onSelectDisease,
}: {
  onSelectDrug: (applicationNumber: string) => void
  /** 点击网络图疾病节点跳转疾病视角页 */
  onSelectDisease?: (slug: string) => void
}) {
  const [data, setData] = useState<MiningData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [heatTable, setHeatTable] = useState(false)
  const [network, setNetwork] = useState<DiseaseNetwork | null>(null)

  useEffect(() => {
    loadMining()
      .then(setData)
      .catch((e: Error) => setError(e.message))
    loadDiseaseNetwork()
      .then(setNetwork)
      .catch(() => setNetwork(null))
  }, [])

  // ---- 1. 治疗领域创新热度：气泡散点 ----
  const areas = useMemo(
    () => (data ? [...new Set(data.disease_heatmap.map((d) => d.area))].sort() : []),
    [data],
  )

  const heatOption = useMemo((): EChartsOption | null => {
    if (!data) return null
    return {
      color: COLORS.palette,
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const cp = p as { name: string; value: number[] }
          const v = cp.value
          return `${cp.name}<br/>覆盖药物：${v[0]} 个<br/>近 5 年获批：${v[1]} 个<br/>黑框警告占比：${v[2]}%`
        },
      },
      legend: { data: areas, top: 0, textStyle: { color: '#475569', fontSize: 11 } },
      grid: { left: 60, right: 30, top: 55, bottom: 45 },
      xAxis: { type: 'value', name: '覆盖药物数', ...BASE_AXIS },
      yAxis: { type: 'value', name: '近 5 年获批数', ...BASE_AXIS },
      series: areas.map((area) => ({
        name: area,
        type: 'scatter',
        data: data.disease_heatmap
          .filter((d) => d.area === area)
          .map((d) => ({
            name: d.name_zh,
            value: [d.drug_count, d.recent5, d.boxed_pct],
            symbolSize: Math.max(8, Math.min(46, d.boxed_pct * 1.4)),
          })),
        itemStyle: { opacity: 0.75 },
      })),
    }
  }, [data, areas])

  const heatRows = useMemo(
    () => (data ? [...data.disease_heatmap].sort((a, b) => b.recent5 - a.recent5) : []),
    [data],
  )

  // ---- 2. 广谱药物 Top 20 ----
  const broadOption = useMemo((): EChartsOption | null => {
    if (!data) return null
    const rows = [...data.broad_spectrum].reverse()
    return {
      color: [COLORS.teal],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const items = params as { dataIndex: number }[]
          const d = rows[items[0].dataIndex]
          return `${d.drug_name}<br/>${d.active_ingredient}<br/>覆盖疾病：${d.disease_count} 种<br/>示例：${d.sample_diseases.join('、')}`
        },
      },
      grid: { left: 8, right: 46, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category', data: rows.map((d) => d.drug_name),
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 220, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', data: rows.map((d) => d.disease_count), barWidth: 12,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [data])

  // ---- 3. NME：双轴组合图 + 企业 + 最新明细 ----
  const nmeOption = useMemo((): EChartsOption | null => {
    if (!data) return null
    const y = data.nme.yearly
    return {
      color: [COLORS.blue, COLORS.violet, COLORS.amber],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['NDA（小分子）', 'BLA（生物制品）', '孤儿药占比'], top: 0 },
      grid: { left: 45, right: 55, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: y.map((r) => r.yr), ...BASE_AXIS },
      yAxis: [
        { type: 'value', name: 'NME 数量', ...BASE_AXIS },
        {
          type: 'value', name: '孤儿药占比', max: 100, ...BASE_AXIS,
          splitLine: { show: false },
          axisLabel: { color: '#b45309', formatter: '{value}%' },
        },
      ],
      series: [
        { name: 'NDA（小分子）', type: 'bar', stack: 'nme', data: y.map((r) => r.nda), itemStyle: { borderRadius: [0, 0, 0, 0] } },
        { name: 'BLA（生物制品）', type: 'bar', stack: 'nme', data: y.map((r) => r.bla), itemStyle: { borderRadius: [3, 3, 0, 0] } },
        {
          name: '孤儿药占比', type: 'line', yAxisIndex: 1, smooth: true,
          data: y.map((r) => r.orphan_pct), symbolSize: 6, lineStyle: { width: 2.5 },
        },
      ],
    }
  }, [data])

  const companyOption = useMemo((): EChartsOption | null => {
    if (!data) return null
    const rows = [...data.nme.top_companies].reverse()
    return {
      color: [COLORS.blue],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 40, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category', data: rows.map((d) => d.sponsor),
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 200, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', data: rows.map((d) => d.n), barWidth: 13,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [data])

  // ---- 4. 仿制药与可及性 ----
  const tentativeOption = useMemo((): EChartsOption | null => {
    if (!data) return null
    const rows = [...data.generic_cliff.tentative_top].reverse()
    return {
      color: [COLORS.amber],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 40, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category', data: rows.map((d) => d.ingredient),
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 210, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', data: rows.map((d) => d.n), barWidth: 12,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [data])

  const discOption = useMemo((): EChartsOption | null => {
    if (!data) return null
    const d = data.supply_risk.discontinued_by_year
    return {
      color: [COLORS.slate],
      tooltip: { trigger: 'axis' },
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: d.map((r) => r.yr), ...BASE_AXIS },
      yAxis: { type: 'value', name: '退市产品数', ...BASE_AXIS },
      series: [{
        type: 'bar', data: d.map((r) => r.n), barWidth: 16,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      }],
    }
  }, [data])

  // ---- 5. 疾病相似性网络 ----
  const netAreas = useMemo(
    () => (network ? [...new Set(network.nodes.map((n) => n.area))].sort() : []),
    [network],
  )

  const networkOption = useMemo((): EChartsOption | null => {
    if (!network) return null
    return {
      color: COLORS.palette,
      tooltip: {
        formatter: (p) => {
          const cp = p as { dataType: string; data: { name?: string; source?: string; target?: string; weight?: number; shared?: number; examples?: string[]; drug_count?: number; area?: string } }
          if (cp.dataType === 'edge') {
            const d = cp.data
            return `${d.source} ↔ ${d.target}<br/>相似度（Jaccard）：${d.weight}<br/>共享药物：${d.shared} 个<br/>示例：${(d.examples ?? []).join('、')}`
          }
          const d = cp.data
          return `${d.name}<br/>治疗领域：${d.area}<br/>覆盖药物：${d.drug_count} 个<br/><span style="color:#94a3b8">点击跳转疾病页</span>`
        },
      },
      legend: { data: netAreas, top: 0, textStyle: { color: '#475569', fontSize: 11 } },
      series: [{
        type: 'graph',
        layout: 'force',
        top: 40,
        roam: true,
        draggable: true,
        categories: netAreas.map((a) => ({ name: a })),
        force: { repulsion: 260, edgeLength: [40, 140], gravity: 0.08 },
        label: { show: true, fontSize: 10, color: '#334155' },
        lineStyle: { color: 'source', opacity: 0.35 },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.8 } },
        data: network.nodes.map((n) => ({
          name: n.slug,
          value: n.drug_count,
          slug: n.slug,
          area: n.area,
          drug_count: n.drug_count,
          category: netAreas.indexOf(n.area),
          symbolSize: Math.max(10, Math.min(46, Math.sqrt(n.drug_count) * 2.4)),
          label: { show: n.drug_count >= 60 },
        })),
        links: network.edges.map((e) => ({
          source: e.source,
          target: e.target,
          weight: e.weight,
          shared: e.shared,
          examples: e.examples,
          lineStyle: { width: Math.max(0.6, e.weight * 4) },
        })),
      }],
    }
  }, [network, netAreas])

  const networkEvents = useMemo(
    () => ({
      click: (p: unknown) => {
        const cp = p as { dataType?: string; data?: { slug?: string } }
        if (cp.dataType === 'node' && cp.data?.slug) onSelectDisease?.(cp.data.slug)
      },
    }),
    [onSelectDisease],
  )

  // ---- 6. 注册生命周期 ----
  const histOption = useMemo((): EChartsOption | null => {
    if (!data) return null
    const h = data.lifecycle.span_hist
    return {
      color: [COLORS.blue],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: h.map((r) => r.bucket), name: '维护跨度（年）', ...BASE_AXIS },
      yAxis: { type: 'value', name: '申请数', ...BASE_AXIS },
      series: [{ type: 'bar', data: h.map((r) => r.n), barWidth: 22, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
    }
  }, [data])

  const eraOption = useMemo((): EChartsOption | null => {
    if (!data) return null
    const e = data.lifecycle.median_by_era.filter((r) => r.era >= '1970')
    return {
      color: [COLORS.amber],
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const items = params as { dataIndex: number }[]
          const r = e[items[0].dataIndex]
          return `${r.era} 年获批<br/>中位维护跨度：${r.median_span} 年<br/>样本：${r.n.toLocaleString()} 个申请`
        },
      },
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: e.map((r) => r.era), ...BASE_AXIS },
      yAxis: { type: 'value', name: '中位跨度（年）', ...BASE_AXIS },
      series: [{ type: 'line', smooth: true, data: e.map((r) => r.median_span), symbolSize: 6, lineStyle: { width: 2.5 }, areaStyle: { opacity: 0.1 } }],
    }
  }, [data])

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-600">挖掘数据加载失败：{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p>正在加载挖掘数据…</p>
      </div>
    )
  }

  const gc = data.generic_cliff
  const gcPct = Math.round((gc.stats.with_anda / gc.stats.nme_total) * 100)

  return (
    <div className="space-y-6">
      {/* ===== 1. 治疗领域创新热度 ===== */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Flame className="h-5 w-5 text-orange-500" />
              治疗领域创新热度（{data.disease_heatmap.length} 种疾病）
            </CardTitle>
            <button
              onClick={() => setHeatTable((v) => !v)}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              {heatTable ? <ScatterChart className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
              {heatTable ? '切换气泡图' : '切换表格视图'}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {heatTable ? (
            <div className="max-h-[480px] overflow-auto rounded-md border border-slate-100">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className={thCls}>疾病</th>
                    <th className={thCls}>治疗领域</th>
                    <th className={`${thCls} text-right`}>覆盖药物</th>
                    <th className={`${thCls} text-right`}>近 5 年获批</th>
                    <th className={`${thCls} text-right`}>黑框警告占比</th>
                  </tr>
                </thead>
                <tbody>
                  {heatRows.map((d) => (
                    <tr key={d.slug} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className={tdCls}>{d.name_zh}</td>
                      <td className={`${tdCls} text-slate-500`}>{d.area}</td>
                      <td className={`${tdCls} text-right`}>{d.drug_count}</td>
                      <td className={`${tdCls} text-right font-medium text-blue-700`}>{d.recent5}</td>
                      <td className={`${tdCls} text-right`}>{d.boxed_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            heatOption && <EChart option={heatOption} height={480} />
          )}
          <SectionNote>
            口径：横轴为该疾病在库中覆盖的获批药物数，纵轴为近 5 年（2021 起）新获批数——纵轴越高说明该领域创新越活跃；
            气泡大小为该领域药物的黑框警告占比（安全风险参考）。数据基于疾病视角页的适应症映射预聚合。
          </SectionNote>
        </CardContent>
      </Card>

      {/* ===== 2. 疾病相似性网络 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Share2 className="h-5 w-5 text-blue-600" />
            疾病相似性网络（{network ? `${network.nodes.length} 节点 · ${network.edges.length} 边` : '加载中'}）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {networkOption ? (
            <EChart option={networkOption} height={560} onEvents={networkEvents} />
          ) : (
            <div className="flex h-[560px] items-center justify-center text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-600" />
              正在加载网络数据…
            </div>
          )}
          <SectionNote>
            口径：两疾病的相似度 = 共享药物集合的 Jaccard 系数（按药名+成分去重，≥0.15 或每节点 Top 3 强边保留）；
            节点大小 = 覆盖药物数，边宽 = 相似度；可拖拽/缩放，悬停边查看共享药名，点击节点跳转疾病页。
          </SectionNote>
        </CardContent>
      </Card>

      {/* ===== 3. 广谱药物 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crosshair className="h-5 w-5 text-teal-600" />
            广谱药物 Top {data.broad_spectrum.length}（跨疾病覆盖）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {broadOption && <EChart option={broadOption} height={520} />}
          <div className="mt-4 max-h-[420px] overflow-auto rounded-md border border-slate-100">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={thCls}>#</th>
                  <th className={thCls}>药物</th>
                  <th className={thCls}>成分</th>
                  <th className={`${thCls} text-right`}>覆盖疾病数</th>
                  <th className={thCls}>疾病示例</th>
                </tr>
              </thead>
              <tbody>
                {data.broad_spectrum.map((d, i) => (
                  <tr
                    key={d.application_number}
                    onClick={() => onSelectDrug(d.application_number)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                  >
                    <td className={`${tdCls} text-slate-400`}>{i + 1}</td>
                    <td className={`${tdCls} font-medium text-blue-700`}>{d.drug_name}</td>
                    <td className={`${tdCls} max-w-[220px] truncate text-slate-500`}>{d.active_ingredient}</td>
                    <td className={`${tdCls} text-right font-semibold text-teal-700`}>{d.disease_count}</td>
                    <td className={`${tdCls} max-w-[260px] truncate text-xs text-slate-400`}>
                      {d.sample_diseases.join('、')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SectionNote>
            口径：按同一申请号在疾病映射中出现的不同疾病数排序。跨疾病覆盖广通常意味着多适应症获批或具备药物重定位（老药新用）潜力
            （如糖皮质激素类广泛适应症药物）。点击行可查看药品详情。
          </SectionNote>
        </CardContent>
      </Card>

      {/* ===== 3. NME 创新动态 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Award className="h-5 w-5 text-blue-600" />
            新分子实体（NME）创新动态（2010 至今）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nmeOption && <EChart option={nmeOption} height={360} />}
          <SectionNote>
            口径：NME 指 FDA 申报分类为 Type 1（New Molecular Entity）的原始获批申请，按申请号去重取首个获批日期；
            孤儿药依据 submission_property 中的 Orphan 认定。孤儿药占比走高反映研发向罕见病/小人群倾斜。
          </SectionNote>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Award className="h-5 w-5 text-violet-600" />
              NME 数量 Top {data.nme.top_companies.length} 企业
            </CardTitle>
          </CardHeader>
          <CardContent>{companyOption && <EChart option={companyOption} height={400} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Award className="h-5 w-5 text-amber-500" />
              最新获批 NME（2025 至今，{data.nme.latest.length} 个）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-auto rounded-md border border-slate-100">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className={thCls}>药物</th>
                    <th className={thCls}>企业</th>
                    <th className={thCls}>获批日期</th>
                    <th className={thCls}>资格</th>
                  </tr>
                </thead>
                <tbody>
                  {data.nme.latest.map((d) => (
                    <tr
                      key={d.application_number}
                      onClick={() => onSelectDrug(d.application_number)}
                      className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                    >
                      <td className={`${tdCls} font-medium text-blue-700`}>{d.drug_name}</td>
                      <td className={`${tdCls} max-w-[160px] truncate text-slate-500`}>{d.sponsor}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>{d.ap_date}</td>
                      <td className={`${tdCls} space-x-1 whitespace-nowrap`}>
                        {d.orphan === 1 && <Badge text="孤儿药" color="violet" />}
                        {d.priority === 1 && <Badge text="优先审评" color="amber" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SectionNote>点击行查看药品详情。</SectionNote>
          </CardContent>
        </Card>
      </div>

      {/* ===== 4. 仿制药与可及性 ===== */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="单成分 NME（2005–2016）" value={String(gc.stats.nme_total)} sub="专利悬崖观察样本" />
        <StatCard
          label="已出现同成分仿制药" value={`${gc.stats.with_anda}（${gcPct}%）`}
          sub="存在同成分 ANDA 记录" tone="text-teal-700"
        />
        <StatCard
          label="平均仿制滞后" value={`${gc.stats.avg_lag_years} 年`}
          sub="NME 获批 → 首个 ANDA 获批" tone="text-blue-700"
        />
        <StatCard
          label="单一来源在售成分" value={data.supply_risk.single_source_count.toLocaleString()}
          sub="仅 1 个申请在售 · 供应中断风险" tone="text-red-600"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Pill className="h-5 w-5 text-teal-600" />
              仿制药竞争最激烈的 NME
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[420px] overflow-auto rounded-md border border-slate-100">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className={thCls}>药物</th>
                    <th className={`${thCls} text-right`}>NME 获批</th>
                    <th className={`${thCls} text-right`}>首个 ANDA</th>
                    <th className={`${thCls} text-right`}>滞后（年）</th>
                    <th className={`${thCls} text-right`}>ANDA 数</th>
                  </tr>
                </thead>
                <tbody>
                  {gc.top_genericized.map((d) => (
                    <tr key={d.drug} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{d.drug}</td>
                      <td className={`${tdCls} text-right`}>{d.nme_yr}</td>
                      <td className={`${tdCls} text-right`}>{d.anda_yr}</td>
                      <td className={`${tdCls} text-right`}>{d.lag}</td>
                      <td className={`${tdCls} text-right font-semibold text-teal-700`}>{d.anda_n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SectionNote>
              口径：2005–2016 年获批的单成分 NDA 类 NME，匹配同成分 ANDA 申请（含暂定批准）；
              "首个 ANDA"取有获批日期的最早记录，滞后年数 = 首个 ANDA 获批年 − NME 获批年，可近似理解为专利/独占期保护时长。
            </SectionNote>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Pill className="h-5 w-5 text-amber-500" />
              暂定批准（Tentative Approval）Top 成分
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tentativeOption && <EChart option={tentativeOption} height={420} />}
            <SectionNote>
              口径：库中共 {gc.tentative_total_appls.toLocaleString()} 个暂定批准申请。
              暂定批准意味着仿制药已满足 FDA 技术要求，但因专利/独占期未到期尚未正式上市——是观察"专利悬崖"后方竞争蓄水的先行指标。
            </SectionNote>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            供应风险：年度退市产品数与单一来源成分
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {discOption && <EChart option={discOption} height={300} />}
            <div className="rounded-lg border border-red-100 bg-red-50/50 p-4">
              <p className="text-sm font-medium text-red-700">
                {data.supply_risk.single_source_count.toLocaleString()} 个在售成分仅由 1 个申请供应
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                单一来源意味着一旦该持证商停产或出现质量问题，该成分将面临短缺风险。近期获批的单一来源成分示例：
              </p>
              <ul className="mt-2 space-y-1">
                {data.supply_risk.single_source_examples.slice(0, 6).map((e) => (
                  <li key={e.appl_no} className="text-xs text-slate-600">
                    <button
                      onClick={() => onSelectDrug(e.appl_no)}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {e.ingredient}
                    </button>
                    <span className="ml-1 text-slate-400">（{e.approval_date.slice(0, 4)} 获批）</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <SectionNote>
            口径：在售 = 营销状态为处方药或 OTC 的产品；按成分聚合后仅含 1 个申请号的计为单一来源（同一持证商的多个申请不重复计）。
            退市数按 FDA 记录的撤市日期分年统计。
          </SectionNote>
        </CardContent>
      </Card>

      {/* ===== 注册生命周期曲线 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Hourglass className="h-5 w-5 text-blue-600" />
            注册生命周期曲线
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-2">
            {histOption && (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-600">维护跨度分布（5 年桶）</p>
                <EChart option={histOption} height={280} />
              </div>
            )}
            {eraOption && (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-600">各获批年代的中位维护跨度</p>
                <EChart option={eraOption} height={280} />
              </div>
            )}
          </div>
          <div className="mt-4 max-h-[420px] overflow-auto rounded-md border border-slate-100">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={thCls}>#</th>
                  <th className={thCls}>药物</th>
                  <th className={thCls}>持证商</th>
                  <th className={`${thCls} text-right`}>首次获批</th>
                  <th className={`${thCls} text-right`}>最近获批活动</th>
                  <th className={`${thCls} text-right`}>跨度（年）</th>
                  <th className={`${thCls} text-right`}>获批补充</th>
                </tr>
              </thead>
              <tbody>
                {data.lifecycle.top_maintained.map((t, i) => (
                  <tr
                    key={t.application_number}
                    onClick={() => onSelectDrug(t.application_number)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                  >
                    <td className={`${tdCls} text-slate-400`}>{i + 1}</td>
                    <td className={`${tdCls} max-w-[200px] truncate font-medium text-blue-700`}>{t.drug_name}</td>
                    <td className={`${tdCls} max-w-[160px] truncate text-slate-500`}>{t.sponsor}</td>
                    <td className={`${tdCls} text-right whitespace-nowrap`}>{t.first_ap}</td>
                    <td className={`${tdCls} text-right whitespace-nowrap`}>{t.last_action}</td>
                    <td className={`${tdCls} text-right`}>{t.span_years}</td>
                    <td className={`${tdCls} text-right font-semibold text-blue-700`}>{t.supplements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SectionNote>
            口径：首次获批 = 申请首个获批日期；最近获批活动 = 该申请所有 AP 状态提交的最晚日期；获批补充 = SUPPL+AP 提交次数，
            反映企业的持续注册投入（榜单按补充次数排序）。跨度为月份差折算年数。点击行查看药品详情。
          </SectionNote>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-slate-400">
        数据来源：Drugs@FDA · 深度挖掘指标由申请/产品/提交分类数据预计算生成
      </p>
    </div>
  )
}
