import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Building2, Search, Award, Pill, Stethoscope, TrendingUp, FlaskConical,
} from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EChart from '@/components/EChart'
import {
  loadCompanyIndex, loadCompanyShard, companyShardLetter, loadEntityMap,
  type CompanyIndexEntry, type CompanyDetail, type EntityMap,
} from '@/lib/data'

const COLORS = {
  blue: '#2563eb',
  teal: '#0d9488',
  violet: '#7c3aed',
}

const BASE_AXIS = {
  axisLine: { lineStyle: { color: '#cbd5e1' } },
  axisLabel: { color: '#475569' },
  splitLine: { lineStyle: { color: '#e2e8f0' } },
} as const

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
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

function Badge({ text, color }: { text: string; color: 'violet' | 'amber' }) {
  const cls = color === 'violet' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{text}</span>
}

const thCls = 'px-3 py-2 text-left text-xs font-medium text-slate-500'
const tdCls = 'px-3 py-2 text-sm text-slate-700'

/** 一句话定性企业构成 */
function compositionLine(d: CompanyDetail): string {
  const s = d.stats
  const total = s.nda + s.anda + s.bla
  if (total === 0) return '暂无获批申请记录'
  const andaPct = Math.round((s.anda / total) * 100)
  const nme = d.nme_list.length
  if (andaPct >= 60) return `以仿制药为主（ANDA 占 ${andaPct}%）`
  if (nme >= 10) return `创新驱动（累计 NME ${nme} 个）`
  if (nme > 0) return `仿制药与创新药并行（NME ${nme} 个，ANDA 占 ${andaPct}%）`
  return `以成熟产品为主（ANDA 占 ${andaPct}%）`
}

export default function CompaniesPage({
  onSelectDrug,
  onSelectDisease,
  onSelectIngredient,
  pendingCompany,
  onConsumePendingCompany,
}: {
  onSelectDrug: (applicationNumber: string) => void
  /** 点击疾病 chip 跳转疾病视角页 */
  onSelectDisease?: (slug: string) => void
  /** 点击成分 chip 跳转生命周期页 */
  onSelectIngredient?: (ingredient: string) => void
  /** 跨页传入的企业 slug（全局搜索 / 详情页 / 疾病页持证商），待本页消费 */
  pendingCompany?: string | null
  onConsumePendingCompany?: () => void
}) {
  const [index, setIndex] = useState<CompanyIndexEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showSugg, setShowSugg] = useState(false)
  const [detail, setDetail] = useState<CompanyDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const [entityMap, setEntityMap] = useState<EntityMap | null>(null)

  useEffect(() => {
    loadCompanyIndex()
      .then(setIndex)
      .catch((e: Error) => setError(e.message))
    loadEntityMap()
      .then(setEntityMap)
      .catch(() => setEntityMap(null))
  }, [])

  // 点击搜索框外部时收起建议
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSugg(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const suggestions = useMemo(() => {
    if (!index || !query.trim()) return []
    const q = query.trim().toUpperCase()
    const raw = query.trim()
    return index
      .filter((c) => c.name.includes(q) || (c.name_zh && c.name_zh.includes(raw)))
      .slice(0, 8)
  }, [index, query])

  const hotCompanies = useMemo(() => (index ? index.slice(0, 12) : []), [index])

  // 消费跨页传入的企业选择（需等企业索引加载完成，按 slug 定位）
  useEffect(() => {
    if (pendingCompany && index) {
      const entry = index.find((c) => c.slug === pendingCompany)
      if (entry) selectCompany(entry)
      onConsumePendingCompany?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCompany, index])

  const selectCompany = (entry: CompanyIndexEntry) => {
    setShowSugg(false)
    setQuery(entry.name_zh ? `${entry.name_zh} · ${entry.name}` : entry.name)
    setLoadingDetail(true)
    setDetailError(null)
    loadCompanyShard(companyShardLetter(entry.slug))
      .then((companies) => {
        const d = companies.find((c) => c.slug === entry.slug)
        if (d) setDetail(d)
        else setDetailError('未找到企业详情')
      })
      .catch((e: Error) => setDetailError(e.message))
      .finally(() => setLoadingDetail(false))
  }

  const timelineOption = useMemo((): EChartsOption | null => {
    if (!detail) return null
    const years = Object.keys(detail.timeline).sort()
    const t = detail.timeline
    return {
      color: [COLORS.blue, COLORS.teal, COLORS.violet],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['NDA（新药）', 'ANDA（仿制药）', 'BLA（生物制品）'], top: 0 },
      grid: { left: 50, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: years, ...BASE_AXIS },
      yAxis: { type: 'value', name: '获批申请数', ...BASE_AXIS },
      series: [
        { name: 'NDA（新药）', type: 'bar', stack: 'total', data: years.map((y) => t[y].nda) },
        { name: 'ANDA（仿制药）', type: 'bar', stack: 'total', data: years.map((y) => t[y].anda) },
        { name: 'BLA（生物制品）', type: 'bar', stack: 'total', data: years.map((y) => t[y].bla) },
      ],
    }
  }, [detail])

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-600">企业数据加载失败:{error}</p>
      </div>
    )
  }

  if (!index) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p>正在加载企业索引…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 搜索 + 热门企业 */}
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div ref={searchRef} className="relative">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 focus-within:border-blue-400">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setShowSugg(true)
                }}
                onFocus={() => setShowSugg(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && suggestions.length > 0) selectCompany(suggestions[0])
                }}
                placeholder="搜索企业英文名或中文别名（如 NOVARTIS、恒瑞、默沙东）…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            {showSugg && suggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {suggestions.map((c) => (
                  <li key={c.slug}>
                    <button
                      onClick={() => selectCompany(c)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50/60"
                    >
                      <span className="truncate">
                        <span className="font-medium text-slate-800">{c.name}</span>
                        {c.name_zh && <span className="ml-2 text-slate-500">{c.name_zh}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        在售 {c.active_products} · NME {c.nme_count}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-400">热门企业（按在售产品数）</p>
            <div className="flex flex-wrap gap-2">
              {hotCompanies.map((c) => (
                <button
                  key={c.slug}
                  onClick={() => selectCompany(c)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    detail?.slug === c.slug
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700'
                  }`}
                >
                  {c.name_zh ? `${c.name_zh} ` : ''}{c.name}
                  <span className="ml-1 text-slate-400">{c.active_products}</span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {loadingDetail && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <p className="text-sm">正在加载企业档案…</p>
        </div>
      )}
      {detailError && <p className="py-10 text-center text-red-600">企业详情加载失败：{detailError}</p>}

      {!loadingDetail && !detailError && !detail && (
        <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
          <Building2 className="h-10 w-10" />
          <p className="text-sm">搜索或点击上方热门企业，查看企业画像</p>
        </div>
      )}

      {!loadingDetail && detail && (
        <>
          {/* 头部档案 */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                  <Building2 className="h-5 w-5 text-blue-600" />
                  {detail.name_zh && <span>{detail.name_zh}</span>}
                  <span className={detail.name_zh ? 'text-base font-normal text-slate-500' : ''}>
                    {detail.name}
                  </span>
                </CardTitle>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                  {compositionLine(detail)}
                </span>
              </div>
              {detail.variants.length > 1 && (
                <p className="mt-1 text-xs text-slate-400">
                  已合并 {detail.variants.length} 个名称变体：{detail.variants.join('、')}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <StatCard
                  label="申请总数"
                  value={(detail.stats.nda + detail.stats.anda + detail.stats.bla + detail.stats.other).toLocaleString()}
                  sub={`NDA ${detail.stats.nda} · ANDA ${detail.stats.anda} · BLA ${detail.stats.bla}`}
                />
                <StatCard label="在售产品" value={detail.stats.active.toLocaleString()} sub={`撤市 ${detail.stats.discontinued} · 暂定 ${detail.stats.tentative}`} />
                <StatCard label="NME（新分子实体）" value={String(detail.nme_list.length)} sub="Type 1 原始获批" />
                <StatCard label="覆盖疾病" value={String(detail.diseases.length)} sub="102 病种矩阵中" />
                <StatCard
                  label="首获年份"
                  value={Object.keys(detail.timeline).sort()[0] ?? '—'}
                  sub={`最新 ${Object.keys(detail.timeline).sort().slice(-1)[0] ?? '—'}`}
                />
              </div>
            </CardContent>
          </Card>

          {/* 获批时间线 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                获批时间线
              </CardTitle>
            </CardHeader>
            <CardContent>
              {timelineOption && <EChart option={timelineOption} height={320} />}
              <p className="mt-2 text-xs text-slate-400">口径：按申请首个获批日期分年统计，堆叠显示 NDA / ANDA / BLA。</p>
            </CardContent>
          </Card>

          {/* NME + 疾病覆盖 */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Award className="h-5 w-5 text-violet-600" />
                  NME 列表（{detail.nme_list.length} 个）
                </CardTitle>
              </CardHeader>
              <CardContent>
                {detail.nme_list.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">无 NME 记录</p>
                ) : (
                  <div className="max-h-[420px] overflow-auto rounded-md border border-slate-100">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className={thCls}>药物</th>
                          <th className={thCls}>获批日期</th>
                          <th className={thCls}>资格</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.nme_list.map((n) => (
                          <tr
                            key={n.application_number}
                            onClick={() => onSelectDrug(n.application_number)}
                            className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                          >
                            <td className={`${tdCls} font-medium text-blue-700`}>{n.drug_name || n.application_number}</td>
                            <td className={`${tdCls} whitespace-nowrap`}>{n.ap_date}</td>
                            <td className={`${tdCls} space-x-1 whitespace-nowrap`}>
                              {n.orphan === 1 && <Badge text="孤儿药" color="violet" />}
                              {n.priority === 1 && <Badge text="优先审评" color="amber" />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-400">点击行查看药品详情。</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Stethoscope className="h-5 w-5 text-teal-600" />
                  疾病覆盖（前 {detail.diseases.length} 种）
                </CardTitle>
              </CardHeader>
              <CardContent>
                {detail.diseases.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">未在 102 病种矩阵中命中</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {detail.diseases.map((d) => (
                      <button
                        key={d.slug}
                        onClick={() => onSelectDisease?.(d.slug)}
                        title="查看疾病视角"
                        className="rounded-full border border-teal-200 bg-teal-50/60 px-3 py-1.5 text-xs text-teal-800 transition-colors hover:border-teal-400 hover:bg-teal-100"
                      >
                        {d.name_zh}
                        <span className="ml-1 font-semibold">{d.drug_count}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-slate-400">
                  口径：该企业产品在疾病视角 102 病种矩阵中的命中情况，数字为覆盖药物数；点击 chip 跳转对应疾病页。
                </p>
              </CardContent>
            </Card>

            {/* 成分 / 管线（实体关系层） */}
            {(() => {
              const ings = entityMap?.companies[detail.slug]?.ingredients ?? []
              if (ings.length === 0) return null
              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <FlaskConical className="h-5 w-5 text-violet-600" />
                      成分 / 管线（{ings.length} 个）
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {ings.map((ing) => (
                        <button
                          key={ing}
                          onClick={() => onSelectIngredient?.(ing)}
                          title="在生命周期页查看该成分"
                          className="rounded-full border border-violet-200 bg-violet-50/60 px-3 py-1.5 text-xs text-violet-800 transition-colors hover:border-violet-400 hover:bg-violet-100"
                        >
                          {ing}
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-slate-400">
                      口径：该企业作为持证商（原研或 ANDA 申请者）覆盖的活性成分；点击 chip 跳转生命周期页。
                    </p>
                  </CardContent>
                </Card>
              )
            })()}
          </div>

          {/* 在售产品 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Pill className="h-5 w-5 text-blue-600" />
                在售产品（最新获批前 {detail.top_products.length} 个）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[480px] overflow-auto rounded-md border border-slate-100">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className={thCls}>药名</th>
                      <th className={thCls}>成分</th>
                      <th className={thCls}>获批日期</th>
                      <th className={thCls}>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.top_products.map((p, i) => (
                      <tr
                        key={`${p.application_number}-${i}`}
                        onClick={() => onSelectDrug(p.application_number)}
                        className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                      >
                        <td className={`${tdCls} font-medium text-blue-700`}>{p.drug_name}</td>
                        <td className={`${tdCls} max-w-[240px] truncate text-slate-500`}>{p.active_ingredient}</td>
                        <td className={`${tdCls} whitespace-nowrap`}>{p.approval_date || '—'}</td>
                        <td className={tdCls}>
                          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            p.marketing_status === '处方药' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {p.marketing_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-400">点击行查看药品详情。</p>
            </CardContent>
          </Card>
        </>
      )}

      <p className="text-center text-xs text-slate-400">
        数据来源：Drugs@FDA · 企业名已归一化合并（去标点与公司后缀），共 {index.length.toLocaleString()} 个企业组
      </p>
    </div>
  )
}
