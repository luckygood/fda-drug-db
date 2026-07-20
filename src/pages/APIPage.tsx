import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search, Pill, Stethoscope, FlaskConical, TrendingUp } from 'lucide-react'
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

  const hotAPIs = useMemo(() => (index ? index.slice(0, 12) : []), [index])

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
      {/* 搜索 + 热门 API */}
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
                  if (e.key === 'Enter' && suggestions.length > 0) selectAPI(suggestions[0])
                }}
                placeholder="搜索活性成分（如 IBUPROFEN、Pembrolizumab）…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            {showSugg && suggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {suggestions.map((a) => (
                  <li key={a.api_slug}>
                    <button
                      onClick={() => selectAPI(a)}
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
          <div>
            <p className="mb-2 text-xs text-slate-400">热门 API（按产品数）</p>
            <div className="flex flex-wrap gap-2">
              {hotAPIs.map((a) => (
                <button
                  key={a.api_slug}
                  onClick={() => selectAPI(a)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    detail?.api_slug === a.api_slug
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700'
                  }`}
                >
                  {a.api_name}
                  <span className="ml-1 text-slate-400">{a.stats.total}</span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {loadingDetail && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <p className="text-sm">正在加载 API 档案…</p>
        </div>
      )}
      {detailError && <p className="py-10 text-center text-red-600">API 详情加载失败：{detailError}</p>}

      {!loadingDetail && !detailError && !detail && (
        <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
          <FlaskConical className="h-10 w-10" />
          <p className="text-sm">搜索或点击上方热门 API，查看成分透视</p>
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
        </>
      )}

      <p className="text-center text-xs text-slate-400">
        数据来源：Drugs@FDA · 活性成分已标准化归一化 · 共 {index.length.toLocaleString()} 个 API
      </p>
    </div>
  )
}
