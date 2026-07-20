import { useEffect, useMemo, useState } from 'react'
import { Loader2, Landmark, PackageSearch, FlaskConical } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EChart from '@/components/EChart'
import {
  loadPatentCliff, loadSupplyRisk, loadBiosimilars,
  type PatentCliff, type SupplyRisk, type Biosimilars,
} from '@/lib/data'

const COLORS = {
  blue: '#2563eb',
  teal: '#0d9488',
  violet: '#7c3aed',
  amber: '#f59e0b',
  red: '#dc2626',
  emerald: '#059669',
  slate: '#64748b',
}

const BASE_AXIS = {
  axisLine: { lineStyle: { color: '#cbd5e1' } },
  axisLabel: { color: '#475569' },
  splitLine: { lineStyle: { color: '#e2e8f0' } },
} as const

const thCls = 'px-3 py-2 text-left text-xs font-medium text-slate-500'
const tdCls = 'px-3 py-2 text-sm text-slate-700'

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

function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-slate-400">{children}</p>
}

function SectionLoading({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
      <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

export default function PatentSupplyPage({ onSelectDrug }: { onSelectDrug: (applicationNumber: string) => void }) {
  const [cliff, setCliff] = useState<PatentCliff | null>(null)
  const [supply, setSupply] = useState<SupplyRisk | null>(null)
  const [bio, setBio] = useState<Biosimilars | null>(null)

  useEffect(() => {
    loadPatentCliff().then(setCliff).catch(() => setCliff(null))
    loadSupplyRisk().then(setSupply).catch(() => setSupply(null))
    loadBiosimilars().then(setBio).catch(() => setBio(null))
  }, [])

  // ---- 1. 专利悬崖：到期成分年度分布 ----
  const cliffYearOption = useMemo((): EChartsOption | null => {
    if (!cliff) return null
    const byYear = new Map<string, { ingredients: number; patents: number }>()
    for (const r of cliff.patent_cliff) {
      const y = r.earliest_expiry.slice(0, 4)
      const cur = byYear.get(y) ?? { ingredients: 0, patents: 0 }
      cur.ingredients += 1
      cur.patents += r.n_patents_window
      byYear.set(y, cur)
    }
    const years = [...byYear.keys()].sort()
    return {
      color: [COLORS.blue, COLORS.amber],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['最早到期成分数', '窗口内专利件数'], top: 0 },
      grid: { left: 45, right: 50, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: years, ...BASE_AXIS },
      yAxis: [
        { type: 'value', name: '成分数', ...BASE_AXIS },
        { type: 'value', name: '专利件数', ...BASE_AXIS, splitLine: { show: false } },
      ],
      series: [
        { name: '最早到期成分数', type: 'bar', data: years.map((y) => byYear.get(y)!.ingredients), barWidth: 34, itemStyle: { borderRadius: [3, 3, 0, 0] } },
        { name: '窗口内专利件数', type: 'line', yAxisIndex: 1, smooth: true, symbolSize: 6, lineStyle: { width: 2.5 }, data: years.map((y) => byYear.get(y)!.patents) },
      ],
    }
  }, [cliff])

  // ---- 明星药物专利时间线（ELIQUIS / IBRANCE，按 patent_no+expiry 去重）----
  const timelineOption = useMemo((): EChartsOption | null => {
    if (!cliff) return null
    const keys = Object.keys(cliff.timelines)
    if (!keys.length) return null
    const cats: string[] = []
    const points: { value: [string, number]; name: string; useCode: string; flags: string; itemStyle: { color: string } }[] = []
    keys.forEach((k, row) => {
      const tl = cliff.timelines[k]
      cats.push(tl.label)
      const seen = new Set<string>()
      for (const p of tl.patents) {
        const key = `${p.patent_no}|${p.expiry}`
        if (seen.has(key)) continue
        seen.add(key)
        const flags = [p.ds ? 'DS' : '', p.dp ? 'DP' : ''].filter(Boolean).join('+') || '—'
        points.push({
          value: [p.expiry, row],
          name: p.patent_no,
          useCode: p.use_code || '—',
          flags,
          itemStyle: { color: p.patent_no.includes('PED') ? COLORS.amber : COLORS.teal },
        })
      }
      for (const e of tl.exclusivity) {
        points.push({
          value: [e.expiry, row],
          name: e.code,
          useCode: '独占期',
          flags: 'EXCL',
          itemStyle: { color: COLORS.violet },
        })
      }
    })
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const d = (p as unknown as { data: { value: [string, number]; name: string; useCode: string; flags: string } }).data
          return `${cats[d.value[1]]}<br/>${d.name}<br/>到期：${d.value[0]}<br/>类型：${d.flags} · 用途码 ${d.useCode}`
        },
      },
      grid: { left: 8, right: 30, top: 30, bottom: 30, containLabel: true },
      xAxis: { type: 'time', ...BASE_AXIS, splitLine: { show: true } },
      yAxis: { type: 'category', data: cats, ...BASE_AXIS, splitLine: { show: false } },
      series: [{
        type: 'scatter',
        symbolSize: 14,
        data: points,
        label: {
          show: true, position: 'top', fontSize: 10, color: '#64748b',
          formatter: (p) => (p as { data: { name: string } }).data.name.replace('*PED', 'ᵖ'),
        },
      }],
    }
  }, [cliff])

  // ---- 2. 短缺：高风险剂型分布 ----
  const shortageFormOption = useMemo((): EChartsOption | null => {
    if (!supply) return null
    const byForm = new Map<string, number>()
    for (const r of [...supply.high, ...supply.shortage_multi]) {
      for (const f of r.dosage_forms) byForm.set(f, (byForm.get(f) ?? 0) + 1)
    }
    const rows = [...byForm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).reverse()
    return {
      color: [COLORS.red],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 44, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: { type: 'category', data: rows.map(([f]) => f), ...BASE_AXIS, splitLine: { show: false } },
      series: [{
        type: 'bar', data: rows.map(([, n]) => n), barWidth: 13,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [supply])

  // ---- 3. 生物类似药：竞争最激烈参比制剂 ----
  const bioOption = useMemo((): EChartsOption | null => {
    if (!bio) return null
    const rows = [...bio.reference_products]
      .sort((a, b) => b.n_biosimilar_blas - a.n_biosimilar_blas)
      .slice(0, 15)
      .reverse()
    return {
      color: [COLORS.violet, COLORS.emerald],
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const items = params as { dataIndex: number }[]
          const r = rows[items[0].dataIndex]
          return `${r.ref_proper_name}（${r.ref_brands.join(' / ')}）<br/>类似药 BLA：${r.n_biosimilar_blas} · 其中可互换：${r.n_interchangeable_blas}<br/>首个类似药获批：${r.first_biosimilar_approval ?? '—'}`
        },
      },
      legend: { data: ['351(k) BLA 数', '其中可互换'], top: 0 },
      grid: { left: 8, right: 44, top: 34, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category', data: rows.map((r) => r.ref_proper_name),
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 130, overflow: 'truncate' },
      },
      series: [
        { name: '351(k) BLA 数', type: 'bar', data: rows.map((r) => r.n_biosimilar_blas), barWidth: 12, itemStyle: { borderRadius: [0, 3, 3, 0] } },
        { name: '其中可互换', type: 'bar', data: rows.map((r) => r.n_interchangeable_blas), barWidth: 12, itemStyle: { borderRadius: [0, 3, 3, 0] } },
      ],
    }
  }, [bio])

  return (
    <div className="space-y-6">
      {/* ===== 1. 专利悬崖 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-5 w-5 text-blue-600" />
            专利悬崖 · 未来 {cliff?.window.months ?? 36} 个月到期榜
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!cliff ? (
            <SectionLoading text="正在加载橙皮书专利数据…" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                  label="窗口内到期成分"
                  value={cliff.kpis.cliff_ingredients.toLocaleString()}
                  sub={`${cliff.window.start} ~ ${cliff.window.end}`}
                  tone="text-blue-700"
                />
                <StatCard label="窗口内到期专利" value={cliff.kpis.cliff_patents.toLocaleString()} sub="按产品×专利×用途码计数" />
                <StatCard label="涉及在售产品" value={cliff.kpis.cliff_onmarket_products.toLocaleString()} sub="Drugs@FDA 在售口径" />
                <StatCard
                  label="全库暂定批准 ANDA"
                  value={cliff.kpis.tentative_total_appls.toLocaleString()}
                  sub="等待专利/独占期解除"
                  tone="text-amber-600"
                />
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">到期节奏（按最早到期日分年）</p>
                  {cliffYearOption && <EChart option={cliffYearOption} height={280} />}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">明星药物专利时间线（去重后）</p>
                  {timelineOption && <EChart option={timelineOption} height={280} />}
                </div>
              </div>
              <div className="mt-4 max-h-[420px] overflow-auto rounded-md border border-slate-100">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className={thCls}>成分</th>
                      <th className={thCls}>代表品牌</th>
                      <th className={`${thCls} text-right`}>最早到期</th>
                      <th className={`${thCls} text-right`}>最晚到期</th>
                      <th className={`${thCls} text-right`}>窗口专利</th>
                      <th className={`${thCls} text-right`}>在售产品</th>
                      <th className={`${thCls} text-right`}>暂定 ANDA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cliff.patent_cliff.slice(0, 120).map((r) => (
                      <tr
                        key={r.ingredient}
                        onClick={() => r.appl_nos[0] && onSelectDrug(`NDA${r.appl_nos[0]}`)}
                        className={`border-t border-slate-100 ${r.appl_nos[0] ? 'cursor-pointer hover:bg-blue-50/50' : ''} ${
                          ['APIXABAN', 'PALBOCICLIB'].includes(r.ingredient) ? 'bg-amber-50/60' : ''
                        }`}
                      >
                        <td className={`${tdCls} max-w-[220px] truncate font-medium text-blue-700`}>
                          {r.ingredient}
                          {['APIXABAN', 'PALBOCICLIB'].includes(r.ingredient) && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">锚点</span>
                          )}
                        </td>
                        <td className={`${tdCls} max-w-[160px] truncate text-slate-500`}>{r.brands.slice(0, 2).join(' / ')}</td>
                        <td className={`${tdCls} text-right whitespace-nowrap font-medium text-red-600`}>{r.earliest_expiry}</td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>{r.latest_expiry}</td>
                        <td className={`${tdCls} text-right`}>{r.n_patents_window}</td>
                        <td className={`${tdCls} text-right`}>{r.onmarket_products}</td>
                        <td className={`${tdCls} text-right ${r.tentative_andas ? 'font-semibold text-amber-600' : 'text-slate-400'}`}>
                          {r.tentative_andas || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">独占期到期榜（前 40 条）</p>
                  <div className="max-h-[300px] overflow-auto rounded-md border border-slate-100">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className={thCls}>成分 / 品牌</th>
                          <th className={thCls}>独占期代码</th>
                          <th className={`${thCls} text-right`}>到期日</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cliff.exclusivity_cliff.slice(0, 40).map((e, i) => (
                          <tr key={`${e.appl_no}-${e.code}-${i}`} className="border-t border-slate-100">
                            <td className={tdCls}>
                              <span className="font-medium">{e.brand}</span>
                              <span className="ml-1.5 text-xs text-slate-400">{e.ingredient}</span>
                            </td>
                            <td className={tdCls}>
                              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">{e.code}</span>
                            </td>
                            <td className={`${tdCls} text-right whitespace-nowrap`}>{e.expiry}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">暂定批准积压榜（Top 30，等待专利解除的 ANDA 数）</p>
                  <div className="max-h-[300px] overflow-auto rounded-md border border-slate-100">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className={thCls}>成分</th>
                          <th className={`${thCls} text-right`}>暂定 ANDA 数</th>
                          <th className={`${thCls} text-right`}>在售产品</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cliff.tentative_top.map((t) => (
                          <tr
                            key={t.ingredient}
                            className={`border-t border-slate-100 ${['APIXABAN', 'PALBOCICLIB'].includes(t.ingredient) ? 'bg-amber-50/60' : ''}`}
                          >
                            <td className={`${tdCls} max-w-[260px] truncate font-medium`}>
                              {t.ingredient}
                              {['APIXABAN', 'PALBOCICLIB'].includes(t.ingredient) && (
                                <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                                  锚点 {t.n} 件 ✓
                                </span>
                              )}
                            </td>
                            <td className={`${tdCls} text-right font-semibold text-amber-600`}>{t.n}</td>
                            <td className={`${tdCls} text-right`}>{t.onmarket_products}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <SectionNote>
                数据来源：openFDA drug/orangebook 端点（字段与 FDA 橙皮书月度数据一一对应），数据版本 <strong>{cliff.ob_version}</strong>。
                口径：窗口 {cliff.window.start} ~ {cliff.window.end}（{cliff.window.months} 个月），按标准化活性成分归并；
                "窗口专利"按 产品×专利×用途码 计数，同一专利挂载多产品时重复计；*PED 为儿科延长期（+6 个月）。
                <strong>专利到期 ≠ 仿制药上市</strong>：实际竞争还受诉讼和解、独占期（NCE/ODE 等）、REMS 与产能约束。
                锚点校验：APIXABAN = 9 件、PALBOCICLIB = 9 件暂定 ANDA ✓。点击成分行查看该 NDA 详情。
              </SectionNote>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== 2. 短缺 × 单一来源 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <PackageSearch className="h-5 w-5 text-red-500" />
            供应风险 · 短缺 × 单一来源交叉
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!supply ? (
            <SectionLoading text="正在加载药品短缺数据…" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                  label="当前短缺记录"
                  value={supply.kpis.current_records.toLocaleString()}
                  sub={`涉及 ${supply.kpis.current_ingredients} 个成分`}
                  tone="text-red-600"
                />
                <StatCard
                  label="高风险（短缺中×单一来源）"
                  value={String(supply.kpis.high_risk)}
                  sub="在售仅 1 家持证"
                  tone="text-red-600"
                />
                <StatCard
                  label="中风险（曾短缺/将停产）"
                  value={String(supply.kpis.medium_risk)}
                  sub="历史短缺或 To Be Discontinued"
                  tone="text-amber-600"
                />
                <StatCard
                  label="单一来源观察池"
                  value={supply.kpis.watch.toLocaleString()}
                  sub={`全库单一来源成分 ${supply.kpis.single_source_count.toLocaleString()} 个`}
                />
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_3fr]">
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">当前短缺成分的剂型分布（高/多源榜）</p>
                  {shortageFormOption && <EChart option={shortageFormOption} height={260} />}
                  <div className="mt-4 space-y-2 text-xs text-slate-500">
                    <p>
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-red-500 align-middle" />
                      多源短缺成分 {supply.kpis.shortage_multi} 个：多家持证仍整体短缺，属产能/原料药层面问题。
                    </p>
                    <p>
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-slate-300 align-middle" />
                      未匹配记录 {supply.kpis.unmatched_records} 条：openfda 字段缺失且通用名无法回退匹配，已剔除出分层。
                    </p>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">高风险榜：短缺中且在售仅单一来源（{supply.high.length} 个）</p>
                  <div className="max-h-[380px] overflow-auto rounded-md border border-slate-100">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className={thCls}>成分</th>
                          <th className={`${thCls} text-right`}>短缺起始</th>
                          <th className={`${thCls} text-right`}>短缺公司数</th>
                          <th className={thCls}>剂型</th>
                          <th className={`${thCls} text-right`}>在售产品</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supply.high.map((r) => (
                          <tr key={r.ingredient} className="border-t border-slate-100 hover:bg-red-50/40">
                            <td className={`${tdCls} max-w-[200px] truncate font-medium text-red-700`}>{r.ingredient}</td>
                            <td className={`${tdCls} text-right whitespace-nowrap`}>{r.since}</td>
                            <td className={`${tdCls} text-right`}>{r.n_companies}</td>
                            <td className={`${tdCls} text-slate-500`}>{r.dosage_forms.slice(0, 2).join('、')}</td>
                            <td className={`${tdCls} text-right font-semibold text-amber-600`}>{r.onmarket_products}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <p className="mb-1 mt-6 text-sm font-medium text-slate-600">
                当前短缺明细（前 {supply.current_details.length} 条，按最近更新排序）
              </p>
              <div className="max-h-[340px] overflow-auto rounded-md border border-slate-100">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className={thCls}>通用名</th>
                      <th className={thCls}>公司</th>
                      <th className={thCls}>供应状态</th>
                      <th className={`${thCls} text-right`}>首次发布</th>
                      <th className={`${thCls} text-right`}>最近更新</th>
                      <th className={thCls}>单一来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supply.current_details.map((d, i) => (
                      <tr key={`${d.generic_name}-${d.company_name}-${i}`} className="border-t border-slate-100">
                        <td className={`${tdCls} max-w-[220px] truncate font-medium`}>{d.generic_name}</td>
                        <td className={`${tdCls} max-w-[180px] truncate text-slate-500`}>{d.company_name}</td>
                        <td className={tdCls}>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${
                            d.availability.toLowerCase().includes('available')
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-red-50 text-red-700'
                          }`}>
                            {d.availability}
                          </span>
                        </td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>{d.initial_posting_date}</td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>{d.update_date}</td>
                        <td className={tdCls}>{d.single_source ? <span className="text-red-600">●</span> : <span className="text-slate-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SectionNote>
                数据来源：openFDA drug/shortages 端点（字段与 FDA 短缺数据库一一对应），数据版本 <strong>{supply.shortages_version}</strong>。
                匹配口径：短缺记录经 openfda.substance_name 精确匹配 + 复方成分回退 + 通用名去剂型词回退（命中率约 93.6%）；
                "单一来源"= 该标准化成分在 Drugs@FDA 在售产品仅涉及 1 个申请号（与深度挖掘页 {supply.kpis.single_source_count.toLocaleString()} 个同口径）。
                短缺状态以 FDA 网站公司自报为准，"Available" 表示公司层面尚有供应但市场可能仍然紧张。
              </SectionNote>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== 3. 生物类似药 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FlaskConical className="h-5 w-5 text-violet-600" />
            生物类似药竞争格局（紫皮书）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!bio ? (
            <SectionLoading text="正在加载紫皮书数据…" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                  label="有类似药的参比制剂"
                  value={String(bio.kpis.rp_with_biosimilars)}
                  sub="按参比分子归并"
                  tone="text-violet-700"
                />
                <StatCard
                  label="351(k) 类似药 BLA"
                  value={String(bio.kpis.blas_biosimilar + bio.kpis.blas_interchangeable)}
                  sub={`可互换 ${bio.kpis.blas_interchangeable} 个`}
                />
                <StatCard
                  label="紫皮书产品行"
                  value={bio.kpis.pb_products.toLocaleString()}
                  sub={`351(a) 原研 ${bio.kpis.products_351a.toLocaleString()}`}
                />
                <StatCard
                  label="36 月内独占期到期"
                  value={String(bio.kpis.rp_excl_in_window)}
                  sub="参比/可互换独占期事件"
                  tone="text-amber-600"
                />
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">竞争最激烈的参比分子（按类似药 BLA 数）</p>
                  {bioOption && <EChart option={bioOption} height={420} />}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">参比制剂全景（{bio.reference_products.length} 个分子）</p>
                  <div className="max-h-[420px] overflow-auto rounded-md border border-slate-100">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className={thCls}>分子 / 参比品牌</th>
                          <th className={`${thCls} text-right`}>类似药 BLA</th>
                          <th className={`${thCls} text-right`}>可互换</th>
                          <th className={`${thCls} text-right`}>首个类似药</th>
                          <th className={`${thCls} text-right`}>参比独占期</th>
                          <th className={thCls}>专利清单</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bio.reference_products.map((r) => (
                          <tr key={r.ref_proper_name} className="border-t border-slate-100">
                            <td className={tdCls}>
                              <span className="font-medium text-violet-700">{r.ref_proper_name}</span>
                              <span className="ml-1.5 text-xs text-slate-400">{r.ref_brands.slice(0, 2).join(' / ')}</span>
                            </td>
                            <td className={`${tdCls} text-right font-semibold`}>{r.n_biosimilar_blas}</td>
                            <td className={`${tdCls} text-right ${r.n_interchangeable_blas ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                              {r.n_interchangeable_blas || '—'}
                            </td>
                            <td className={`${tdCls} text-right whitespace-nowrap`}>{r.first_biosimilar_approval ?? '—'}</td>
                            <td className={`${tdCls} text-right whitespace-nowrap`}>{r.ref_exclusivity_exp ?? '—'}</td>
                            <td className={tdCls}>
                              {r.patent_list_provided
                                ? <span className="text-emerald-600">✓</span>
                                : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              {bio.exclusivity_window.length > 0 && (
                <>
                  <p className="mb-1 mt-6 text-sm font-medium text-slate-600">
                    未来 {bio.window.months} 个月生物药独占期事件（{bio.exclusivity_window.length} 条）
                  </p>
                  <div className="max-h-[240px] overflow-auto rounded-md border border-slate-100">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className={thCls}>参比分子</th>
                          <th className={thCls}>事件类型</th>
                          <th className={`${thCls} text-right`}>到期日</th>
                          <th className={`${thCls} text-right`}>类似药 BLA</th>
                          <th className={`${thCls} text-right`}>可互换</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bio.exclusivity_window.map((e, i) => (
                          <tr key={`${e.ref_proper_name}-${e.kind}-${i}`} className="border-t border-slate-100">
                            <td className={tdCls}>
                              <span className="font-medium">{e.ref_proper_name}</span>
                              <span className="ml-1.5 text-xs text-slate-400">{e.ref_brands.join(' / ')}</span>
                            </td>
                            <td className={tdCls}>
                              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">{e.kind}</span>
                            </td>
                            <td className={`${tdCls} text-right whitespace-nowrap font-medium text-amber-600`}>{e.expiry}</td>
                            <td className={`${tdCls} text-right`}>{e.n_biosimilar_blas}</td>
                            <td className={`${tdCls} text-right`}>{e.n_interchangeable_blas}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <SectionNote>
                数据来源：FDA 紫皮书月度 CSV（{bio.pb_version} 版，{bio.fetch_date} 抓取），共 {bio.kpis.pb_products.toLocaleString()} 个产品行、
                {bio.kpis.pb_blas} 个 BLA。口径：按参比分子（Ref. Product Proper Name）归并 351(k) 类似药与可互换产品，BLA 按申请号去重。
                交叉校验：本库 Drugs@FDA 收录 BLA {bio.kpis.crosscheck_db_bla} 个（761xxx 系列 {bio.kpis.crosscheck_db_bla_761} 个）——
                数量低于紫皮书，因 Drugs@FDA 仅收 CDER 管辖部分，CBER 及部分胰岛素/过渡期产品不在其列，属两库覆盖范围差异而非数据缺失。
                参比独占期到期列在官方 CSV 中覆盖率本身较低，空值属源数据特征。
              </SectionNote>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-slate-400">
        数据来源：openFDA 橙皮书（{cliff?.ob_version ?? '…'}）· openFDA 短缺库（{supply?.shortages_version ?? '…'}）· FDA 紫皮书 {bio?.pb_version ?? '…'} 月度版
      </p>
    </div>
  )
}
