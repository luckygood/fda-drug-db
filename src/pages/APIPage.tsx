import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search, Pill, Stethoscope, FlaskConical, TrendingUp, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EChart from '@/components/EChart'
import {
  loadAPIIndex, loadAPIShard, apiShardLetter,
  type APIIndexEntry, type APIDetail,
} from '@/lib/data'
import { StatusBadge, TypeBadge } from '@/components/StatusBadge'

const COLORS: Record<string, string> = {
  pioneer: '#2563eb',
  growth: '#0d9488',
  mature: '#7c3aed',
  commoditized: '#94a3b8',
}

const STAGE_LABEL: Record<string, string> = {
  pioneer: '原研独占',
  growth: '早期竞争',
  mature: '充分竞争',
  commoditized: ' commoditized',
}

const STAGES = ['pioneer', 'growth', 'mature', 'commoditized'] as const
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const PAGE_SIZE = 60

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

interface APIPageProps {
  onSelectDrug: (applicationNumber: string) => void
  onSelectDisease?: (slug: string) => void
  pendingAPI?: string | null
  onConsumePendingAPI?: () => void
}

export default function APIPage({ onSelectDrug, onSelectDisease, pendingAPI, onConsumePendingAPI }: APIPageProps) {
  const [index, setIndex] = useState<APIIndexEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showSugg, setShowSugg] = useState(false)
  const [detail, setDetail] = useState<APIDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  // 全面浏览状态
  const [activeLetter, setActiveLetter] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [viewMode, setViewMode] = useState<'browse' | 'search'>('browse')

  // 排序状态
  const [sortField, setSortField] = useState<'name' | 'products' | 'lag' | 'approval'>('products')
  const [sortDesc, setSortDesc] = useState(true)

  useEffect(() => {
    loadAPIIndex()
      .then(setIndex)
      .catch((e: Error) => setError(e.message))
  }, [])

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
    return index.filter((a) => a.api_name.includes(q)).slice(0, 8)
  }, [index, query])

  // 按字母分布统计（用于索引条高亮）
  const letterCounts = useMemo(() => {
    if (!index) return new Map<string, number>()
    const map = new Map<string, number>()
    for (const a of index) {
      const c = apiShardLetter(a.api_slug)
      map.set(c, (map.get(c) || 0) + 1)
    }
    return map
  }, [index])

  // 生命周期分布统计
  const stageCounts = useMemo(() => {
    if (!index) return new Map<string, number>()
    const map = new Map<string, number>()
    for (const a of index) {
      map.set(a.lifecycle_stage, (map.get(a.lifecycle_stage) || 0) + 1)
    }
    return map
  }, [index])

  // 筛选 + 排序后的列表
  const sortedList = useMemo(() => {
    if (!index) return []
    let list = index
    if (activeLetter) {
      list = list.filter((a) => apiShardLetter(a.api_slug) === activeLetter)
    }
    if (activeStage) {
      list = list.filter((a) => a.lifecycle_stage === activeStage)
    }
    // 排序
    list = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.api_name.localeCompare(b.api_name)
          break
        case 'products':
          cmp = a.stats.total - b.stats.total
          break
        case 'lag':
          cmp = (a.generic_lag_years ?? -1) - (b.generic_lag_years ?? -1)
          break
        case 'approval':
          cmp = (a.first_approval || '').localeCompare(b.first_approval || '')
          break
      }
      return sortDesc ? -cmp : cmp
    })
    return list
  }, [index, activeLetter, activeStage, sortField, sortDesc])

  // 分页
  const totalPages = Math.ceil(sortedList.length / PAGE_SIZE)
  const pagedList = useMemo(() => {
    const start = page * PAGE_SIZE
    return sortedList.slice(start, start + PAGE_SIZE)
  }, [sortedList, page])

  // 切换筛选或排序条件时重置页码
  useEffect(() => {
    setPage(0)
  }, [activeLetter, activeStage, sortField, sortDesc])

  // 消费跨页传入的 API 选择（需等索引加载完成）
  useEffect(() => {
    if (pendingAPI && index) {
      const entry = index.find((a) => a.api_slug === pendingAPI)
      if (entry) selectAPI(entry)
      onConsumePendingAPI?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAPI, index])

  const selectAPI = (entry: APIIndexEntry) => {
    setShowSugg(false)
    setQuery(entry.api_name)
    setViewMode('search')
    setLoadingDetail(true)
    setDetailError(null)
    loadAPIShard(apiShardLetter(entry.api_slug))
      .then((apis) => {
        const d = apis.find((a) => a.api_slug === entry.api_slug)
        if (d) setDetail(d)
        else setDetailError('未找到 API 详情')
      })
      .catch((e: Error) => setDetailError(e.message))
      .finally(() => setLoadingDetail(false))
  }

  const handleSearchSelect = (entry: APIIndexEntry) => {
    selectAPI(entry)
  }

  const clearFilters = () => {
    setActiveLetter(null)
    setActiveStage(null)
    setPage(0)
    setQuery('')
    setViewMode('browse')
    setDetail(null)
    setDetailError(null)
    setSortField('products')
    setSortDesc(true)
  }

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDesc((d) => !d)
    } else {
      setSortField(field)
      setSortDesc(field === 'products' || field === 'approval')
    }
  }

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 text-slate-300" />
    return sortDesc ? <ArrowDown className="h-3 w-3 text-blue-600" /> : <ArrowUp className="h-3 w-3 text-blue-600" />
  }

  const productTypeOption = useMemo((): EChartsOption | null => {
    if (!detail) return null
    const s = detail.stats
    const data = [
      { value: s.nda, name: 'NDA' },
      { value: s.anda, name: 'ANDA' },
      { value: s.bla, name: 'BLA' },
    ].filter((d) => d.value > 0)
    if (data.length === 0) return null
    return {
      color: ['#2563eb', '#0d9488', '#7c3aed'],
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['45%', '75%'],
          center: ['50%', '50%'],
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: { show: true, formatter: '{b}\n{c}' },
          data,
        },
      ],
    }
  }, [detail])

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-600">API 数据加载失败：{error}</p>
      </div>
    )
  }

  if (!index) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p>正在加载 API 索引…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 搜索 */}
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
                  if (e.target.value.trim()) setViewMode('search')
                }}
                onFocus={() => setShowSugg(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && suggestions.length > 0) handleSearchSelect(suggestions[0])
                }}
                placeholder="搜索活性成分（如 IBUPROFEN、Pembrolizumab）…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
              {query && (
                <button onClick={clearFilters} className="text-xs text-slate-400 hover:text-slate-600">
                  清除
                </button>
              )}
            </div>
            {showSugg && suggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {suggestions.map((a) => (
                  <li key={a.api_slug}>
                    <button
                      onClick={() => handleSearchSelect(a)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50/60"
                    >
                      <span className="truncate font-medium text-slate-800">{a.api_name}</span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {a.stats.total} 产品 · {STAGE_LABEL[a.lifecycle_stage] || a.lifecycle_stage}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 字母索引 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs text-slate-400">按首字母浏览</p>
              {(activeLetter || activeStage) && (
                <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline">
                  重置筛选
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {LETTERS.map((letter) => {
                const count = letterCounts.get(letter) || 0
                const active = activeLetter === letter
                return (
                  <button
                    key={letter}
                    onClick={() => {
                      setActiveLetter(active ? null : letter)
                      setViewMode('browse')
                      setDetail(null)
                      setDetailError(null)
                    }}
                    disabled={count === 0}
                    className={`relative min-w-[28px] rounded px-1.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : count > 0
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          : 'cursor-not-allowed bg-slate-50 text-slate-300'
                    }`}
                    title={`${letter}: ${count} 个 API`}
                  >
                    {letter}
                    {count > 0 && !active && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-slate-300 text-[8px] text-white">
                        {count > 99 ? '∞' : count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 生命周期阶段筛选 */}
          <div>
            <p className="mb-1.5 text-xs text-slate-400">按生命周期阶段筛选</p>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((stage) => {
                const count = stageCounts.get(stage) || 0
                const active = activeStage === stage
                return (
                  <button
                    key={stage}
                    onClick={() => {
                      setActiveStage(active ? null : stage)
                      setViewMode('browse')
                      setDetail(null)
                      setDetailError(null)
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700'
                    }`}
                  >
                    {STAGE_LABEL[stage] || stage}
                    <span className="ml-1 text-slate-400">{count.toLocaleString()}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 浏览模式：分页列表 */}
      {viewMode === 'browse' && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FlaskConical className="h-5 w-5 text-blue-600" />
                活性成分列表
                {activeLetter && <span className="text-sm font-normal text-slate-400">· 字母 {activeLetter}</span>}
                {activeStage && (
                  <span className="text-sm font-normal text-slate-400">
                    · {STAGE_LABEL[activeStage] || activeStage}
                  </span>
                )}
              </CardTitle>
              <span className="text-xs text-slate-400">
                共 {sortedList.length.toLocaleString()} 个 · 第 {page + 1}/{Math.max(1, totalPages)} 页
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {sortedList.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
                <FlaskConical className="h-10 w-10" />
                <p className="text-sm">暂无符合条件的 API</p>
                <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline">
                  清除筛选
                </button>
              </div>
            ) : (
              <>
                {/* 排序栏 */}
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className="text-xs text-slate-400">排序：</span>
                  {[
                    { key: 'products' as const, label: '产品数' },
                    { key: 'lag' as const, label: '首仿时滞' },
                    { key: 'name' as const, label: '名称' },
                    { key: 'approval' as const, label: '首获批年份' },
                  ].map((s) => (
                    <button
                      key={s.key}
                      onClick={() => toggleSort(s.key)}
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        sortField === s.key
                          ? 'border-blue-300 bg-blue-50 text-blue-700'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                      }`}
                    >
                      {s.label}
                      <SortIcon field={s.key} />
                    </button>
                  ))}
                </div>

                <div className="max-h-[520px] overflow-auto rounded-md border border-slate-100">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                          <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-blue-600">
                            活性成分 <SortIcon field="name" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                          <button onClick={() => toggleSort('products')} className="flex items-center gap-1 hover:text-blue-600">
                            产品数 <SortIcon field="products" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">生命周期</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                          <button onClick={() => toggleSort('lag')} className="flex items-center gap-1 hover:text-blue-600">
                            首仿时滞 <SortIcon field="lag" />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">原研企业</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedList.map((a) => (
                        <tr
                          key={a.api_slug}
                          onClick={() => selectAPI(a)}
                          className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                        >
                          <td className="px-3 py-2 text-sm font-medium text-blue-700">{a.api_name}</td>
                          <td className="px-3 py-2 text-sm text-slate-600">{a.stats.total}</td>
                          <td className="px-3 py-2">
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${COLORS[a.lifecycle_stage] || '#94a3b8'}15`,
                                color: COLORS[a.lifecycle_stage] || '#94a3b8',
                              }}
                            >
                              {STAGE_LABEL[a.lifecycle_stage] || a.lifecycle_stage}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-600">
                            {a.generic_lag_years != null ? `${a.generic_lag_years} 年` : '—'}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-600 max-w-[200px] truncate">
                            {a.originator || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 分页控件 */}
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> 上一页
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(10, totalPages) }, (_, i) => {
                        let p: number
                        if (totalPages <= 10) {
                          p = i
                        } else if (page < 5) {
                          p = i
                        } else if (page > totalPages - 6) {
                          p = totalPages - 10 + i
                        } else {
                          p = page - 4 + i
                        }
                        return (
                          <button
                            key={p}
                            onClick={() => setPage(p)}
                            className={`min-w-[28px] rounded px-2 py-1 text-xs ${
                              p === page ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {p + 1}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一页 <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {loadingDetail && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <p className="text-sm">正在加载 API 档案…</p>
        </div>
      )}
      {detailError && <p className="py-10 text-center text-red-600">API 详情加载失败：{detailError}</p>}

      {viewMode === 'search' && !loadingDetail && !detailError && !detail && query.trim() && (
        <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
          <Search className="h-10 w-10" />
          <p className="text-sm">搜索「{query}」无结果，请尝试其他关键词</p>
          <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline">
            返回浏览全部
          </button>
        </div>
      )}

      {!loadingDetail && detail && (
        <>
          {/* 头部档案 */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                  <FlaskConical className="h-5 w-5 text-blue-600" />
                  {detail.api_name}
                </CardTitle>
                <span
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: `${COLORS[detail.lifecycle_stage] || '#94a3b8'}15`,
                    color: COLORS[detail.lifecycle_stage] || '#94a3b8',
                  }}
                >
                  {STAGE_LABEL[detail.lifecycle_stage] || detail.lifecycle_stage}
                </span>
              </div>
              {detail.api_type === 'combo' && (
                <p className="mt-1 text-xs text-slate-400">复方成分</p>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard label="总产品" value={detail.stats.total.toLocaleString()} sub={`NDA ${detail.stats.nda} · ANDA ${detail.stats.anda} · BLA ${detail.stats.bla}`} />
                <StatCard label="在售" value={detail.stats.active.toLocaleString()} sub={`撤市 ${detail.stats.discontinued} · 暂定 ${detail.stats.tentative}`} />
                <StatCard
                  label="首仿时滞"
                  value={detail.generic_lag_years != null ? `${detail.generic_lag_years} 年` : '—'}
                  sub={detail.first_approval ? `首个获批 ${detail.first_approval.slice(0, 4)}` : ''}
                />
                <StatCard label="治疗疾病" value={String(detail.diseases.length)} sub="102 病种矩阵中" />
              </div>
              {detail.originator && (
                <p className="mt-3 text-xs text-slate-400">
                  原研：{detail.originator}
                  {detail.originator_appl && ` · ${detail.originator_appl}`}
                </p>
              )}
            </CardContent>
          </Card>

          {/* 申请类型分布 + 疾病关联 */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  申请类型分布
                </CardTitle>
              </CardHeader>
              <CardContent>
                {productTypeOption && <EChart option={productTypeOption} height={260} />}
                <p className="mt-2 text-xs text-slate-400">口径：该 API 下所有产品的申请类型统计。</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Stethoscope className="h-5 w-5 text-teal-600" />
                  治疗疾病（前 {detail.diseases.length} 种）
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
                        className="rounded-full border border-teal-200 bg-teal-50/60 px-3 py-1.5 text-xs text-teal-800 transition-colors hover:border-teal-400 hover:bg-teal-100"
                      >
                        {d.name_zh}
                        <span className="ml-1 font-semibold">{d.drug_count}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-slate-400">
                  口径：该 API 在疾病视角 102 病种矩阵中的命中情况，数字为覆盖药物数。
                </p>
              </CardContent>
            </Card>
          </div>

          {/* 产品列表 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Pill className="h-5 w-5 text-blue-600" />
                产品清单（{detail.products.length} 个）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[480px] overflow-auto rounded-md border border-slate-100">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">药名</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">规格 / 剂型</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">持证商</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">获批日期</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.products.map((p, i) => (
                      <tr
                        key={`${p.application_number}-${i}`}
                        onClick={() => onSelectDrug(p.application_number)}
                        className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                      >
                        <td className="px-3 py-2 text-sm font-medium text-blue-700">
                          <div className="flex items-center gap-1.5">
                            <TypeBadge type={p.appl_type} />
                            {p.drug_name || p.application_number}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-600">
                          {[p.strength, p.form].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-600 max-w-[200px] truncate">
                          {p.sponsor_name || '—'}
                        </td>
                        <td className="px-3 py-2 text-sm whitespace-nowrap text-slate-600">
                          {p.approval_date || '—'}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={p.marketing_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-400">点击行查看药品详情。</p>
            </CardContent>
          </Card>

          <div className="flex justify-center">
            <button
              onClick={clearFilters}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
            >
              ← 返回浏览全部 API
            </button>
          </div>
        </>
      )}

      <p className="text-center text-xs text-slate-400">
        数据来源：Drugs@FDA · 活性成分已标准化归一化 · 共 {index.length.toLocaleString()} 个 API
      </p>
    </div>
  )
}
