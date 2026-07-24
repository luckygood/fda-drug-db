import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, ShieldAlert, Skull, Timer, Dna,
} from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EChart from '@/components/EChart'
import AlertCenter from '@/components/AlertCenter'
import {
  loadSafetyBoxed, loadWithdrawn, loadGenericLag, loadBiologics,
  type SafetyBoxed, type Withdrawn, type GenericLag, type Biologics,
} from '@/lib/data'

const COLORS = {
  blue: '#2563eb',
  teal: '#0d9488',
  violet: '#7c3aed',
  amber: '#f59e0b',
  red: '#dc2626',
  slate: '#64748b',
  palette: ['#2563eb', '#0d9488', '#7c3aed', '#f59e0b', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0f766e'],
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

export default function SafetyMarketPage({ onSelectDrug, onSelectIngredient }: {
  onSelectDrug: (applicationNumber: string) => void
  /** 点击榜单成分跳转成分透视详情 */
  onSelectIngredient?: (ingredient: string) => void
}) {
  const [safety, setSafety] = useState<SafetyBoxed | null>(null)
  const [withdrawn, setWithdrawn] = useState<Withdrawn | null>(null)
  const [lag, setLag] = useState<GenericLag | null>(null)
  const [bio, setBio] = useState<Biologics | null>(null)

  useEffect(() => {
    loadSafetyBoxed().then(setSafety).catch(() => setSafety(null))
    loadWithdrawn().then(setWithdrawn).catch(() => setWithdrawn(null))
    loadGenericLag().then(setLag).catch(() => setLag(null))
    loadBiologics().then(setBio).catch(() => setBio(null))
  }, [])

  // ---- 1. 黑框警告 ----
  const eraOption = useMemo((): EChartsOption | null => {
    if (!safety) return null
    const e = safety.era_rates
    return {
      color: [COLORS.red],
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const items = params as { dataIndex: number }[]
          const r = e[items[0].dataIndex]
          return `${r.era}<br/>携带率：${r.rate}%（${r.boxed} / ${r.apps} 个有说明书申请）`
        },
      },
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: e.map((r) => r.era), ...BASE_AXIS },
      yAxis: { type: 'value', name: '携带率（%）', ...BASE_AXIS },
      series: [{ type: 'bar', data: e.map((r) => r.rate), barWidth: 34, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
    }
  }, [safety])

  const themeOption = useMemo((): EChartsOption | null => {
    if (!safety) return null
    const rows = [...safety.themes].reverse()
    return {
      color: [COLORS.violet],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const items = params as { dataIndex: number }[]
          const t = rows[items[0].dataIndex]
          return `${t.name_zh}：${t.count} 个申请<br/>示例：${t.examples.slice(0, 3).join('、')}`
        },
      },
      grid: { left: 8, right: 44, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category', data: rows.map((t) => t.name_zh),
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 90 },
      },
      series: [{
        type: 'bar', data: rows.map((t) => t.count), barWidth: 13,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [safety])

  // ---- 2. 撤市 ----
  const decadeOption = useMemo((): EChartsOption | null => {
    if (!withdrawn) return null
    const d = withdrawn.by_decade
    return {
      color: [COLORS.slate],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: d.map((r) => r.decade), ...BASE_AXIS },
      yAxis: { type: 'value', name: '撤市产品数', ...BASE_AXIS },
      series: [{ type: 'bar', data: d.map((r) => r.n), barWidth: 30, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
    }
  }, [withdrawn])

  const wIngOption = useMemo((): EChartsOption | null => {
    if (!withdrawn) return null
    const rows = [...withdrawn.top_ingredients.slice(0, 15)].reverse()
    return {
      color: [COLORS.amber],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 44, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category', data: rows.map((r) => r.ingredient),
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 230, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', data: rows.map((r) => r.n), barWidth: 12,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [withdrawn])

  const formOption = useMemo((): EChartsOption | null => {
    if (!withdrawn) return null
    const f = withdrawn.top_forms.slice(0, 8)
    return {
      color: COLORS.palette,
      tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 个产品（{d}%）' },
      legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: '#475569', fontSize: 11 } },
      series: [{
        type: 'pie', radius: ['40%', '66%'], center: ['36%', '50%'],
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: f.map((r) => ({ name: r.form, value: r.n })),
      }],
    }
  }, [withdrawn])

  // ---- 3. 首仿时滞 ----
  const lagHistOption = useMemo((): EChartsOption | null => {
    if (!lag) return null
    const h = lag.lag_hist
    return {
      color: [COLORS.teal],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: h.map((r) => r.bucket), name: '时滞（年）', ...BASE_AXIS },
      yAxis: { type: 'value', name: '成分数', ...BASE_AXIS },
      series: [{ type: 'bar', data: h.map((r) => r.n), barWidth: 14, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
    }
  }, [lag])

  const compOption = useMemo((): EChartsOption | null => {
    if (!lag) return null
    const rows = [...lag.top_competition].reverse()
    return {
      color: [COLORS.blue],
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const items = params as { dataIndex: number }[]
          const r = rows[items[0].dataIndex]
          return `${r.ingredient}<br/>ANDA 持证商：${r.holders} 家<br/>ANDA 申请：${r.anda_apps} 个`
        },
      },
      grid: { left: 8, right: 44, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category', data: rows.map((r) => r.ingredient),
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 220, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', data: rows.map((r) => r.holders), barWidth: 12,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [lag])

  // ---- 4. 生物制剂 ----
  const bioOption = useMemo((): EChartsOption | null => {
    if (!bio) return null
    const y = bio.yearly
    return {
      color: [COLORS.violet, COLORS.amber],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['BLA 获批数', 'BLA 占 NDA+BLA 比例'], top: 0 },
      grid: { left: 45, right: 55, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: y.map((r) => r.yr), ...BASE_AXIS },
      yAxis: [
        { type: 'value', name: 'BLA 获批数', ...BASE_AXIS },
        {
          type: 'value', name: '占比', max: 60, ...BASE_AXIS,
          splitLine: { show: false },
          axisLabel: { color: '#b45309', formatter: '{value}%' },
        },
      ],
      series: [
        { name: 'BLA 获批数', type: 'bar', data: y.map((r) => r.bla), itemStyle: { borderRadius: [3, 3, 0, 0] } },
        { name: 'BLA 占 NDA+BLA 比例', type: 'line', yAxisIndex: 1, smooth: true, data: y.map((r) => r.share), symbolSize: 5, lineStyle: { width: 2.5 } },
      ],
    }
  }, [bio])

  const bioSponsorOption = useMemo((): EChartsOption | null => {
    if (!bio) return null
    const rows = [...bio.top_sponsors].reverse()
    return {
      color: [COLORS.violet],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 44, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', ...BASE_AXIS },
      yAxis: {
        type: 'category',
        data: rows.map((r) => (r.name_zh ? `${r.name_zh} ${r.name}` : r.name)),
        ...BASE_AXIS, splitLine: { show: false },
        axisLabel: { color: '#475569', width: 220, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', data: rows.map((r) => r.n), barWidth: 12,
        label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }
  }, [bio])

  return (
    <div className="space-y-6">
      {/* ===== 0. 预警中心（四榜单） ===== */}
      <AlertCenter onSelectIngredient={onSelectIngredient} />

      {/* ===== 1. 安全性图谱 · 黑框警告 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="h-5 w-5 text-red-500" />
            安全性图谱 · 黑框警告挖掘
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!safety ? (
            <SectionLoading text="正在加载黑框警告数据…" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard label="说明书文档" value={safety.coverage.label_docs.toLocaleString()} sub={`深度文本 ${safety.coverage.deep_texts.toLocaleString()} 条`} />
                <StatCard label="有说明书申请" value={safety.coverage.labeled_apps.toLocaleString()} sub="现行公开版本快照" />
                <StatCard label="带黑框警告" value={safety.coverage.boxed_apps.toLocaleString()} sub={`携带率 ${safety.coverage.boxed_rate}%`} tone="text-red-600" />
                <StatCard label="带黑框 NME" value={String(safety.nme_boxed.length)} sub="创新药安全警示" tone="text-violet-700" />
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">按获批年代的黑框携带率</p>
                  {eraOption && <EChart option={eraOption} height={280} />}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">警示主题分布（关键词归类）</p>
                  {themeOption && <EChart option={themeOption} height={280} />}
                </div>
              </div>
              <div className="mt-4 max-h-[440px] overflow-auto rounded-md border border-slate-100">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className={thCls}>药物</th>
                      <th className={thCls}>持证商</th>
                      <th className={thCls}>NME 获批</th>
                      <th className={thCls}>警示主题</th>
                      <th className={thCls}>黑框原文（节选）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {safety.nme_boxed.map((n) => (
                      <tr
                        key={n.application_number}
                        onClick={() => onSelectDrug(n.application_number)}
                        className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                      >
                        <td className={`${tdCls} font-medium text-blue-700`}>{n.drug_name}</td>
                        <td className={`${tdCls} max-w-[150px] truncate text-slate-500`}>{n.sponsor}</td>
                        <td className={`${tdCls} whitespace-nowrap`}>{n.ap_date}</td>
                        <td className={tdCls}>
                          <div className="flex max-w-[180px] flex-wrap gap-1">
                            {n.themes.map((t) => (
                              <span key={t} className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">{t}</span>
                            ))}
                          </div>
                        </td>
                        <td className={`${tdCls} max-w-[320px] text-xs leading-relaxed text-slate-500`}>
                          <span className="line-clamp-3">{n.snippet || '—'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SectionNote>
                口径偏倚提示：说明书为 FDA <strong>现行公开版本快照</strong>——撤市药与部分老药已无现行说明书，
                样本偏向仍在监管视野内的产品；携带率分母为"有说明书的申请"（{safety.coverage.labeled_apps.toLocaleString()} 个），
                非全部获批申请。主题由英文关键词归类，一药可中多主题；原文节选自动截断。点击行查看药品详情。
              </SectionNote>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== 2. 撤市全景 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Skull className="h-5 w-5 text-slate-500" />
            撤市全景（{withdrawn ? withdrawn.total.toLocaleString() : '…'} 个产品）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!withdrawn ? (
            <SectionLoading text="正在加载撤市数据…" />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {withdrawn.anchors.map((a) => (
                  <span
                    key={a.name}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      a.found
                        ? 'border-red-200 bg-red-50/60 text-red-700'
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    {a.name}：{a.found ? `${a.approval_date?.slice(0, 4)} 获批 · 最后监管活动 ${a.last_action?.slice(0, 4)}` : '不在当前数据集'}
                  </span>
                ))}
              </div>
              <div className="grid gap-6 lg:grid-cols-3">
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">按原获批年代分布</p>
                  {decadeOption && <EChart option={decadeOption} height={260} />}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">剂型分布（Top 8）</p>
                  {formOption && <EChart option={formOption} height={260} />}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">撤市最多成分（Top 15）</p>
                  {wIngOption && <EChart option={wIngOption} height={260} />}
                </div>
              </div>
              <div className="mt-4 max-h-[360px] overflow-auto rounded-md border border-slate-100">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className={thCls}>药物</th>
                      <th className={thCls}>成分</th>
                      <th className={`${thCls} text-right`}>原获批</th>
                      <th className={`${thCls} text-right`}>最后监管活动</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawn.recent.map((w, i) => (
                      <tr
                        key={`${w.application_number}-${i}`}
                        onClick={() => onSelectDrug(w.application_number)}
                        className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                      >
                        <td className={`${tdCls} max-w-[220px] truncate font-medium text-blue-700`}>{w.drug_name}</td>
                        <td className={`${tdCls} max-w-[240px] truncate text-slate-500`}>{w.ingredient}</td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>{w.approval_date || '—'}</td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>{w.last_action || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SectionNote>
                口径：撤市时间无直接字段，表中"最后监管活动"= 该申请所有提交的最晚状态日期，作为撤市时点的<strong>代理</strong>
                （如 VIOXX 2004 年撤市，其后仍有标签修订等监管动作）。按产品计数（同一申请多规格重复计）。点击行查看药品详情。
              </SectionNote>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== 3. 首仿时滞 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Timer className="h-5 w-5 text-teal-600" />
            首仿时滞（原研 → 首个 ANDA）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!lag ? (
            <SectionLoading text="正在加载首仿时滞数据…" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard label="匹配成分" value={lag.n_matched.toLocaleString()} sub="原研与 ANDA 均存在" />
                <StatCard label="中位时滞" value={`${lag.median_lag} 年`} sub="NDA/BLA 首批 → 首个 ANDA" tone="text-teal-700" />
                <StatCard
                  label="锚点校验"
                  value="✓"
                  sub={`ATORVASTATIN 14.9 年 · OMEPRAZOLE 13.2 年`}
                  tone="text-emerald-600"
                />
                <StatCard label="无仿制药老药" value={String(lag.no_generic_old.length)} sub="≥10 年在售且无 ANDA（前 20）" tone="text-amber-600" />
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">时滞分布直方图</p>
                  {lagHistOption && <EChart option={lagHistOption} height={280} />}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">竞争最激烈成分（ANDA 持证商数 Top 15）</p>
                  {compOption && <EChart option={compOption} height={280} />}
                </div>
              </div>
              <div className="mt-4 max-h-[360px] overflow-auto rounded-md border border-slate-100">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className={thCls}>成分</th>
                      <th className={thCls}>示例药物</th>
                      <th className={`${thCls} text-right`}>原研首批</th>
                      <th className={`${thCls} text-right`}>在售产品数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lag.no_generic_old.map((g) => (
                      <tr
                        key={g.ingredient}
                        onClick={() => onSelectDrug(g.application_number)}
                        className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                      >
                        <td className={`${tdCls} max-w-[260px] truncate font-medium text-blue-700`}>{g.ingredient}</td>
                        <td className={`${tdCls} text-slate-500`}>{g.example_drug}</td>
                        <td className={`${tdCls} text-right`}>{g.first_year}</td>
                        <td className={`${tdCls} text-right font-semibold text-amber-600`}>{g.active_products}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SectionNote>
                口径：按标准化活性成分（大写/空白归一、仅单成分）匹配原研与 ANDA；时滞 = 首个 ANDA 获批年 − 原研最早获批年。
                未含专利诉讼/独占期和解等法律细节，ANDA 获批 ≠ 实际上架；生物制品走 BPCIA 路径，无 ANDA 不代表无竞争。点击行查看药品详情。
              </SectionNote>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== 4. 生物制剂崛起 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Dna className="h-5 w-5 text-violet-600" />
            生物制剂崛起（1985 至今）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!bio ? (
            <SectionLoading text="正在加载生物制剂数据…" />
          ) : (
            <>
              {bioOption && <EChart option={bioOption} height={340} />}
              <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">BLA 持证机构 Top 15</p>
                  {bioSponsorOption && <EChart option={bioSponsorOption} height={380} />}
                </div>
                <div className="flex flex-col justify-center gap-4">
                  <StatCard
                    label="最新年份 BLA 占比"
                    value={`${bio.latest_share}%`}
                    sub="BLA / (NDA + BLA) 年度获批"
                    tone="text-violet-700"
                  />
                  <StatCard
                    label="BLA 类 NME（最近年份）"
                    value={String(bio.yearly[bio.yearly.length - 1]?.bla_nme ?? 0)}
                    sub="Type 1 创新生物制品"
                    tone="text-blue-700"
                  />
                </div>
              </div>
              <SectionNote>
                口径：按申请首个获批日期分年统计 BLA 获批数及其占 NDA+BLA 的比例；BLA 类 NME 为申报分类 Type 1 的原始获批。
                生物类似药（351(k)）与原研 BLA 合并计数。
              </SectionNote>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-slate-400">
        数据来源：Drugs@FDA + openFDA 说明书 · 安全性与市场化指标由标签文本与注册数据预计算生成
      </p>
    </div>
  )
}
