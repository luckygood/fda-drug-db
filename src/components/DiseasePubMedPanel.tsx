import { useEffect, useMemo, useState } from 'react'
import { Loader2, BookOpen, ExternalLink, AlertCircle } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import EChart from '@/components/EChart'

// ---- Supabase 数据源（与 FeedPage 相同的常量） ----
const SUPABASE_URL = 'https://xtwqcjxtekoxuntpdsiq.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_E5YZTMxNds-Lh5BxjzK3nA_IaY_gd6s'

async function supabaseGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })
  if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`)
  return res.json() as Promise<T>
}

// ---- 数据类型 ----
interface PubmedStat {
  id: number
  disease_slug: string
  year: number
  total: number
  clinical: number
  rct: number
  review: number
  meta: number
  updated_at: string
}

interface PubmedRecent {
  id: number
  disease_slug: string
  pmid: string
  title: string
  journal: string | null
  pubdate: string | null
  pubtype: string[] | null
  created_at: string
}

interface DiseasePubMedPanelProps {
  slug: string
  /** 疾病静态 JSON 中的 FDA 获批数（用于文献量 vs 获批数对照） */
  approvalsByYear?: Record<string, number>
}

/** pubtype 徽章配色：Clinical Trial/RCT 蓝、Meta/系统评价 紫、Review 绿 */
function pubtypeBadgeCls(t: string): string {
  if (/meta-analysis|systematic review/i.test(t)) return 'bg-violet-50 text-violet-700 border-violet-200'
  if (/randomized|controlled trial|clinical trial/i.test(t)) return 'bg-blue-50 text-blue-700 border-blue-200'
  if (/review/i.test(t)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-slate-100 text-slate-600 border-slate-200'
}

export default function DiseasePubMedPanel({ slug, approvalsByYear }: DiseasePubMedPanelProps) {
  const [stats, setStats] = useState<PubmedStat[] | null>(null)
  const [recent, setRecent] = useState<PubmedRecent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)

  useEffect(() => {
    // slug 由父组件固定（试点期仅 iga-nephropathy），无需同步重置状态
    let cancelled = false
    Promise.all([
      supabaseGet<PubmedStat[]>(
        `disease_pubmed_stats?disease_slug=eq.${encodeURIComponent(slug)}&order=year.asc`,
      ),
      supabaseGet<PubmedRecent[]>(
        `disease_pubmed_recent?disease_slug=eq.${encodeURIComponent(slug)}&order=pubdate.desc&limit=50`,
      ),
    ])
      .then(([s, r]) => {
        if (cancelled) return
        setStats(s)
        setRecent(r)
        setFetchedAt(Date.now())
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // 研究热度趋势（2024–2026，与 FDA 获批数对照）
  const trendOption = useMemo((): EChartsOption | null => {
    if (!stats || stats.length === 0) return null
    const rows = stats // 已按 year.asc 排序
    const years = rows.map((r) => String(r.year))
    const bar = (name: string, data: number[]) => ({
      name,
      type: 'bar' as const,
      barMaxWidth: 22,
      itemStyle: { borderRadius: [3, 3, 0, 0] as [number, number, number, number] },
      label: { show: true, position: 'top' as const, fontSize: 10, color: '#64748b' },
      data,
    })
    const series: NonNullable<EChartsOption['series']> = [
      bar('临床研究', rows.map((r) => r.clinical)),
      bar('RCT', rows.map((r) => r.rct)),
      bar('综述', rows.map((r) => r.review)),
      bar('Meta 分析', rows.map((r) => r.meta)),
    ]
    const hasApprovals = !!approvalsByYear && Object.keys(approvalsByYear).length > 0
    if (hasApprovals) {
      series.push({
        name: 'FDA 获批数',
        type: 'line',
        yAxisIndex: 1,
        symbolSize: 7,
        lineStyle: { color: '#94a3b8', width: 2, type: 'dashed' },
        itemStyle: { color: '#94a3b8' },
        data: years.map((y) => approvalsByYear![y] ?? 0),
      })
    }
    return {
      color: ['#2563eb', '#d97706', '#059669', '#7c3aed', '#94a3b8'],
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: '#475569' } },
      grid: { left: 44, right: hasApprovals ? 44 : 20, top: 36, bottom: 26 },
      xAxis: {
        type: 'category', data: years,
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#475569' },
      },
      yAxis: [
        {
          type: 'value', name: '文献数',
          axisLabel: { color: '#475569' },
          splitLine: { lineStyle: { color: '#e2e8f0' } },
        },
        ...(hasApprovals
          ? [{
              type: 'value' as const, name: '获批数', max: 5,
              axisLabel: { color: '#94a3b8' },
              splitLine: { show: false },
            }]
          : []),
      ],
      series,
    }
  }, [stats, approvalsByYear])

  // 最新一年文献总量（标题区小字说明）
  const latestTotal = useMemo(() => {
    if (!stats || stats.length === 0) return null
    return stats[stats.length - 1]
  }, [stats])

  // 证据结构：近三年累计 临床研究 / 综述+Meta / 其他
  const evidence = useMemo(() => {
    if (!stats || stats.length === 0) return null
    const clinical = stats.reduce((a, s) => a + (s.clinical || 0), 0)
    const reviewMeta = stats.reduce((a, s) => a + (s.review || 0) + (s.meta || 0), 0)
    const total = stats.reduce((a, s) => a + (s.total || 0), 0)
    if (total === 0) return null
    const other = Math.max(total - clinical - reviewMeta, 0)
    const pct = (n: number) => Math.round((n / total) * 1000) / 10
    return {
      total, clinical, reviewMeta, other,
      clinicalPct: pct(clinical), reviewMetaPct: pct(reviewMeta), otherPct: pct(other),
    }
  }, [stats])

  // 近 90 天文献（以数据拉取时刻为基准；库中仅临床研究+综述类）
  const recent90 = useMemo(() => {
    if (!recent || fetchedAt === null) return []
    const cutoff = fetchedAt - 90 * 24 * 3600 * 1000
    const within = recent.filter((r) => {
      if (!r.pubdate) return true
      const t = Date.parse(r.pubdate)
      return Number.isNaN(t) || t >= cutoff
    })
    return within.slice(0, 20)
  }, [recent, fetchedAt])

  const loading = stats === null && recent === null && !error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="h-5 w-5 text-blue-600" />
          PubMed 研究洞察
        </CardTitle>
        <p className="text-xs text-slate-400">
          数据来源：PubMed（NCBI）· 按疾病主题词检索 · 聚焦临床研究与综述证据 · 试点疾病
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            正在加载 PubMed 研究数据…
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-red-600">PubMed 数据加载失败：{error}</p>
          </div>
        )}

        {!loading && !error && stats !== null && stats.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <BookOpen className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">研究洞察数据建设中</p>
            <p className="max-w-md text-xs text-slate-400">
              该疾病的 PubMed 文献统计尚未入库，接入后即可在此查看研究热度趋势、证据结构与最新文献。
            </p>
          </div>
        )}

        {!loading && !error && stats !== null && stats.length > 0 && (
          <>
            {/* 研究热度趋势 */}
            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-600">研究热度趋势（2024–2026）</h3>
                {latestTotal && (
                  <p className="text-xs text-slate-400">
                    {latestTotal.year} 年该疾病全部 PubMed 文献 {latestTotal.total.toLocaleString()} 篇
                  </p>
                )}
              </div>
              {trendOption && <EChart option={trendOption} height={280} />}
            </div>

            {/* 证据结构 */}
            {evidence && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-slate-600">
                  证据结构（近三年累计 {evidence.total.toLocaleString()} 篇）
                </h3>
                <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="bg-blue-600" style={{ width: `${evidence.clinicalPct}%` }} title={`临床研究 ${evidence.clinicalPct}%`} />
                  <div className="bg-violet-600" style={{ width: `${evidence.reviewMetaPct}%` }} title={`综述/Meta ${evidence.reviewMetaPct}%`} />
                  <div className="bg-slate-300" style={{ width: `${evidence.otherPct}%` }} title={`其他 ${evidence.otherPct}%`} />
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" />
                    临床研究 {evidence.clinical.toLocaleString()}（{evidence.clinicalPct}%）
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-600" />
                    综述 / Meta {evidence.reviewMeta.toLocaleString()}（{evidence.reviewMetaPct}%）
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" />
                    其他 {evidence.other.toLocaleString()}（{evidence.otherPct}%）
                  </span>
                </div>
              </div>
            )}

            {/* 最新文献 */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-600">
                最新文献（近 90 天 · 仅临床研究与综述{recent90.length > 0 ? ` · ${recent90.length} 篇` : ''}）
              </h3>
              {recent90.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">近 90 天暂无收录文献</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recent90.map((r) => (
                    <li key={r.pmid} className="py-3">
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex items-start gap-1.5 text-sm font-medium leading-snug text-blue-700 hover:text-blue-900 hover:underline"
                      >
                        <span className="flex-1">{r.title}</span>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-blue-500" />
                      </a>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-400">
                          {[r.journal, r.pubdate].filter(Boolean).join(' · ')}
                        </span>
                        {(r.pubtype ?? []).map((t) => (
                          <Badge
                            key={t}
                            variant="outline"
                            className={`px-1.5 py-0 text-[11px] font-normal ${pubtypeBadgeCls(t)}`}
                          >
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
