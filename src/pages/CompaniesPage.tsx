import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Building2, Search, Award, Pill, Stethoscope, TrendingUp, FlaskConical, FileText,
  Map as MapIcon, List, Globe,
} from 'lucide-react'
import type { EChartsOption } from 'echarts'
import * as echarts from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EChart from '@/components/EChart'
import CompanyReport from '@/components/CompanyReport'
import {
  loadCompanyIndex, loadCompanyShard, companyShardLetter, loadEntityMap, loadCompaniesMap,
  type CompanyIndexEntry, type CompanyDetail, type EntityMap, type CompaniesMap,
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

/** 国家英文规范名 → 中文展示标签（常见国家；未收录者原样显示英文） */
const COUNTRY_ZH: Record<string, string> = {
  China: '中国', 'United States': '美国', Germany: '德国', 'United Kingdom': '英国',
  Japan: '日本', 'South Korea': '韩国', France: '法国', Switzerland: '瑞士',
  Canada: '加拿大', Australia: '澳大利亚', Italy: '意大利', Sweden: '瑞典',
  Belgium: '比利时', Netherlands: '荷兰', Ireland: '爱尔兰', Singapore: '新加坡',
  Denmark: '丹麦', Russia: '俄罗斯', Spain: '西班牙', Austria: '奥地利',
  Israel: '以色列', India: '印度', Poland: '波兰', Norway: '挪威', Finland: '芬兰',
  'Czech Republic': '捷克', Hungary: '匈牙利', Lithuania: '立陶宛', Portugal: '葡萄牙',
  Greece: '希腊', Turkey: '土耳其', 'New Zealand': '新西兰', Brazil: '巴西',
  Argentina: '阿根廷', Mexico: '墨西哥', Chile: '智利', 'South Africa': '南非',
  Ukraine: '乌克兰', Estonia: '爱沙尼亚', Latvia: '拉脱维亚', Slovenia: '斯洛文尼亚',
  Slovakia: '斯洛伐克', Croatia: '克罗地亚', Romania: '罗马尼亚', Bulgaria: '保加利亚',
  Taiwan: '中国台湾', 'Hong Kong': '中国香港', 'Cayman Islands': '开曼群岛',
  Bermuda: '百慕大', Luxembourg: '卢森堡', Iceland: '冰岛', Malta: '马耳他',
  Serbia: '塞尔维亚', Jordan: '约旦', Kuwait: '科威特', Oman: '阿曼',
  'Saudi Arabia': '沙特阿拉伯', Thailand: '泰国', 'United Arab Emirates': '阿联酋',
  Andorra: '安道尔', Monaco: '摩纳哥', Liechtenstein: '列支敦士登', Cyprus: '塞浦路斯',
  Jersey: '泽西岛', Egypt: '埃及', 'North Korea': '朝鲜',
}
const countryLabel = (c: string) => COUNTRY_ZH[c] ?? c

/** 数据国家名 → 世界 GeoJSON 国家名（johan/world.geo.json 口径差异） */
const GEO_NAME_ALIAS: Record<string, string> = {
  'United States': 'United States of America',
  Serbia: 'Republic of Serbia',
}
const GEO_TO_DATA: Record<string, string> = Object.fromEntries(
  Object.entries(GEO_NAME_ALIAS).map(([k, v]) => [v, k]),
)

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
  const [reportMode, setReportMode] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const [entityMap, setEntityMap] = useState<EntityMap | null>(null)

  // 企业地图模式
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [mapData, setMapData] = useState<CompaniesMap | null>(null)
  const [mapCountry, setMapCountry] = useState<string | null>(null)
  const [mapQuery, setMapQuery] = useState('')
  const [mapShown, setMapShown] = useState(200)
  const [worldReady, setWorldReady] = useState(false)

  useEffect(() => {
    loadCompanyIndex()
      .then(setIndex)
      .catch((e: Error) => setError(e.message))
    loadEntityMap()
      .then(setEntityMap)
      .catch(() => setEntityMap(null))
    loadCompaniesMap()
      .then(setMapData)
      .catch(() => setMapData(null))
    // 世界地图 GeoJSON（本地 vendor，一次性注册）
    fetch(`${import.meta.env.BASE_URL}data/world.geo.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((geo) => {
        echarts.registerMap('world', geo)
        setWorldReady(true)
      })
      .catch(() => setWorldReady(false))
  }, [])

  // FDA 企业索引反查（slug + 大写名兜底）
  const fdaEntryBySlug = useMemo(() => {
    const m = new Map<string, CompanyIndexEntry>()
    for (const c of index ?? []) m.set(c.slug, c)
    return m
  }, [index])
  const fdaSlugByName = useMemo(() => {
    const m = new Map<string, CompanyIndexEntry>()
    for (const c of index ?? []) m.set(c.name.toUpperCase(), c)
    return m
  }, [index])

  // 地图：国家聚合（按企业数降序）
  const countryAgg = useMemo(() => {
    if (!mapData) return []
    const counts = new Map<string, number>()
    for (const c of mapData.companies) {
      const k = c.country || '未知'
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [mapData])

  // 地图：过滤后的企业列表
  const mapFiltered = useMemo(() => {
    if (!mapData) return []
    const q = mapQuery.trim().toLowerCase()
    return mapData.companies.filter((c) => {
      if (mapCountry && (c.country || '未知') !== mapCountry) return false
      if (q && !c.name.toLowerCase().includes(q) && !c.city.toLowerCase().includes(q)) return false
      return true
    })
  }, [mapData, mapCountry, mapQuery])

  // 世界地图热力 option（数据国家名 → GeoJSON 国家名经 GEO_NAME_ALIAS 转换）
  const worldOption = useMemo((): EChartsOption | null => {
    if (!worldReady || countryAgg.length === 0) return null
    const max = Math.max(...countryAgg.map(([, n]) => n))
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: unknown) => {
          const { name, value } = p as { name: string; value?: number }
          const dataName = GEO_TO_DATA[name] ?? name
          return `${countryLabel(dataName)}（${dataName}）<br/>企业数：${(value ?? 0).toLocaleString()}`
        },
      },
      visualMap: {
        min: 0,
        max,
        left: 8,
        bottom: 8,
        text: [`${max.toLocaleString()}`, '0'],
        calculable: false,
        inRange: { color: ['#f1f5f9', '#cbd5e1', '#93c5fd', '#3b82f6', '#1d4ed8'] },
        textStyle: { color: '#64748b', fontSize: 10 },
      },
      series: [{
        type: 'map',
        map: 'world',
        roam: true,
        emphasis: { label: { show: false }, itemStyle: { areaColor: '#60a5fa' } },
        itemStyle: { borderColor: '#e2e8f0', borderWidth: 0.5 },
        data: countryAgg.map(([country, n]) => ({
          name: GEO_NAME_ALIAS[country] ?? country,
          value: n,
          ...(mapCountry === country
            ? { itemStyle: { areaColor: '#1e40af', borderColor: '#1e3a8a', borderWidth: 1.5 } }
            : {}),
        })),
      }],
    }
  }, [worldReady, countryAgg, mapCountry])

  // 地图点击 = 国家筛选（与 chips 双向同步）
  const worldEvents = useMemo(() => ({
    click: (params: unknown) => {
      const name = (params as { name?: string }).name
      if (!name) return
      const country = GEO_TO_DATA[name] ?? name
      if (!countryAgg.some(([c]) => c === country)) return
      setMapCountry((prev) => (prev === country ? null : country))
      setMapShown(200)
    },
  }), [countryAgg])

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
    setReportMode(false) // 切换企业时自动退出报告视图
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
      {/* 视图切换：企业列表 | 企业地图 */}
      <div className="flex">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {([
            { key: 'list', label: '企业列表', icon: List },
            { key: 'map', label: '🗺 企业地图', icon: MapIcon },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                viewMode === key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'map' && (
        !mapData ? (
          <div className="flex items-center justify-center gap-2 py-20 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <p className="text-sm">正在加载企业地图…</p>
          </div>
        ) : (
          <>
            {/* 概要 tiles */}
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                label="企业总数"
                value={mapData.stats.total.toLocaleString()}
                sub={mapData.stats.fda_linked != null ? `FDA 画像直配 ${mapData.stats.fda_linked}` : undefined}
              />
              <StatCard label="国家 / 地区数" value={String(mapData.stats.countries)} />
              <StatCard
                label="有官网"
                value={mapData.stats.with_website.toLocaleString()}
                sub={`覆盖 ${Math.round((mapData.stats.with_website / Math.max(1, mapData.stats.total)) * 100)}%`}
              />
            </div>

            {/* 世界地图热力 */}
            {worldOption && (
              <Card>
                <CardContent className="pt-5">
                  <p className="mb-1 text-xs text-slate-400">
                    全球企业分布热力（点击国家 = 筛选，与下方国家标签联动）
                    {mapCountry && (
                      <button
                        onClick={() => setMapCountry(null)}
                        className="ml-2 text-blue-600 hover:underline"
                      >
                        清除筛选：{countryLabel(mapCountry)}
                      </button>
                    )}
                  </p>
                  <EChart option={worldOption} height={400} onEvents={worldEvents} />
                  <p className="mt-1 text-xs text-slate-400">
                    注：Singapore / Hong Kong 等 7 个小型国家或地区在世界底图中无独立区块，不在图上着色，仍可通过下方标签筛选。
                  </p>
                </CardContent>
              </Card>
            )}

            {/* 国家聚合表 */}
            <Card>
              <CardContent className="pt-5">
                <p className="mb-2 text-xs text-slate-400">按国家 / 地区聚合（点击筛选，再次点击取消）</p>
                <div className="flex flex-wrap gap-2">
                  {countryAgg.map(([country, n]) => (
                    <button
                      key={country}
                      onClick={() => { setMapCountry(mapCountry === country ? null : country); setMapShown(200) }}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        mapCountry === country
                          ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                          : 'border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700'
                      }`}
                    >
                      {countryLabel(country)}
                      <span className="ml-1 font-semibold">{n.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 搜索 + 企业清单 */}
            <Card>
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:border-blue-400">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    value={mapQuery}
                    onChange={(e) => { setMapQuery(e.target.value); setMapShown(200) }}
                    placeholder="按企业名称或城市筛选…"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  {mapCountry ? `${countryLabel(mapCountry)} · ` : ''}共 {mapFiltered.length.toLocaleString()} 家企业
                  {mapFiltered.length > mapShown && `，显示前 ${mapShown}`}
                </p>
                <div className="max-h-[560px] overflow-auto rounded-md border border-slate-100">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        <th className={thCls}>企业名称</th>
                        <th className={thCls}>城市 / 地区</th>
                        <th className={thCls}>国家</th>
                        <th className={`${thCls} w-14`}>官网</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapFiltered.slice(0, mapShown).map((c, i) => {
                        const fdaEntry = (c.fda_slug ? fdaEntryBySlug.get(c.fda_slug) : undefined)
                          ?? fdaSlugByName.get(c.name.toUpperCase())
                        return (
                          <tr key={`${c.name}-${i}`} className="border-t border-slate-100">
                            <td className={`${tdCls} max-w-[320px] truncate`}>
                              {fdaEntry ? (
                                <button
                                  onClick={() => { setViewMode('list'); selectCompany(fdaEntry) }}
                                  className="font-medium text-blue-700 hover:underline"
                                  title="查看 FDA 企业画像"
                                >
                                  {c.name}
                                </button>
                              ) : (
                                <span className="font-medium text-slate-800">{c.name}</span>
                              )}
                            </td>
                            <td className={`${tdCls} text-slate-500`}>{c.city || '—'}</td>
                            <td className={`${tdCls} whitespace-nowrap text-slate-500`}>{c.country ? countryLabel(c.country) : '—'}</td>
                            <td className={tdCls}>
                              {c.website ? (
                                <a
                                  href={c.website}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                                  title={c.website}
                                >
                                  <Globe className="h-3.5 w-3.5" />
                                  官网
                                </a>
                              ) : (
                                <span className="text-xs text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      {mapFiltered.length === 0 && (
                        <tr><td colSpan={4} className="py-8 text-center text-sm text-slate-400">无匹配企业</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {mapFiltered.length > mapShown && (
                  <button
                    onClick={() => setMapShown((n) => n + 200)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    显示更多（剩余 {(mapFiltered.length - mapShown).toLocaleString()} 家）
                  </button>
                )}
              </CardContent>
            </Card>

            <p className="text-center text-xs text-slate-400">
              {mapData.scope_note} · 数据生成于 {mapData.generated_at}
            </p>
          </>
        )
      )}

      {viewMode === 'list' && (
      <>
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

      {!loadingDetail && detail && reportMode && (
        <CompanyReport
          detail={detail}
          onBack={() => setReportMode(false)}
          onSelectIngredient={onSelectIngredient}
        />
      )}

      {!loadingDetail && detail && !reportMode && (
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
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                    {compositionLine(detail)}
                  </span>
                  <button
                    onClick={() => setReportMode(true)}
                    className="no-print flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                  >
                    <FileText className="h-4 w-4" />
                    报告视图
                  </button>
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
      </>
      )}
    </div>
  )
}
