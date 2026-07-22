import { useEffect, useMemo, useState } from 'react'
import { Loader2, Newspaper, RefreshCw, SearchX, CalendarClock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { supabaseGet, type WeeklyReport } from '@/lib/supabase'


interface FeedItem {
  id: number
  report_id: number
  section: 'top_news' | 'autoimmune' | 'domain' | 'no_news' | 'suggestion'
  company: string | null
  domain: string | null
  type: string | null
  asset: string | null
  summary: string | null
  source: string | null
  item_date: string | null
}


// ---- 事件类型徽章配色 ----
const TYPE_STYLES: { match: RegExp; cls: string }[] = [
  { match: /监管|审批|获批|FDA/i, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { match: /临床|试验|Phase/i, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { match: /并购|合作|交易|授权|BD/i, cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { match: /财报|融资|营收/i, cls: 'bg-slate-100 text-slate-600 border-slate-200' },
]

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null
  const style = TYPE_STYLES.find((s) => s.match.test(type))
  return (
    <Badge variant="outline" className={cn('font-normal', style?.cls)}>
      {type}
    </Badge>
  )
}

const TYPE_FILTERS = ['全部', '监管审批', '临床进展', '并购/合作交易', '财报/融资', '其他'] as const

function matchTypeFilter(itemType: string | null, filter: (typeof TYPE_FILTERS)[number]): boolean {
  if (filter === '全部') return true
  if (filter === '其他') return !TYPE_STYLES.some((s) => itemType && s.match.test(itemType))
  const rule: Record<string, RegExp> = {
    监管审批: TYPE_STYLES[0].match,
    临床进展: TYPE_STYLES[1].match,
    '并购/合作交易': TYPE_STYLES[2].match,
    '财报/融资': TYPE_STYLES[3].match,
  }
  return !!itemType && rule[filter].test(itemType)
}

function SectionLoading({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
      <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

function EmptyState({ message }: { message?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <CalendarClock className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-medium text-slate-600">
          {message ?? '首期周报将于 2026-07-27 生成'}
        </p>
        <p className="max-w-md text-xs leading-relaxed text-slate-400">
          研发情报信息流每周自动汇总跟踪企业的监管审批、临床进展、并购合作与财报融资动态，生成后即可在此查看。
        </p>
      </CardContent>
    </Card>
  )
}

function NewsCard({ item }: { item: FeedItem }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center gap-2">
          {item.company && <span className="text-sm font-bold text-slate-900">{item.company}</span>}
          <TypeBadge type={item.type} />
          {item.asset && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{item.asset}</span>
          )}
        </div>
        {item.summary && (
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{item.summary}</p>
        )}
        <p className="mt-3 text-xs text-slate-400">
          {[item.source, item.item_date].filter(Boolean).join(' · ')}
        </p>
      </CardContent>
    </Card>
  )
}

export default function FeedPage() {
  const [reports, setReports] = useState<WeeklyReport[] | null>(null)
  const [reportsError, setReportsError] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null)
  const [itemsState, setItemsState] = useState<
    { reportId: number; items: FeedItem[] } | { reportId: number; error: string } | null
  >(null)
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>('全部')
  const [companyQuery, setCompanyQuery] = useState('')

  // 拉取周报列表
  useEffect(() => {
    supabaseGet<WeeklyReport[]>('weekly_reports?order=generated_at.desc')
      .then((rows) => {
        setReports(rows)
        if (rows.length > 0) setSelectedReportId(rows[0].id)
      })
      .catch((e: Error) => setReportsError(e.message))
  }, [])

  // 拉取当前周报条目
  useEffect(() => {
    if (selectedReportId == null) return
    const reportId = selectedReportId
    supabaseGet<FeedItem[]>(`feed_items?report_id=eq.${reportId}&order=id.asc`)
      .then((rows) => setItemsState({ reportId, items: rows }))
      .catch((e: Error) => setItemsState({ reportId, error: e.message }))
  }, [selectedReportId])

  const itemsError =
    itemsState && itemsState.reportId === selectedReportId && 'error' in itemsState
      ? itemsState.error
      : null
  const items =
    itemsState && itemsState.reportId === selectedReportId && 'items' in itemsState
      ? itemsState.items
      : null

  const currentReport = useMemo(
    () => reports?.find((r) => r.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  )

  // 前端筛选
  const filtered = useMemo(() => {
    if (!items) return null
    const q = companyQuery.trim().toLowerCase()
    return items.filter(
      (it) =>
        matchTypeFilter(it.type, typeFilter) &&
        (!q || (it.company ?? '').toLowerCase().includes(q)),
    )
  }, [items, typeFilter, companyQuery])

  const bySection = useMemo(() => {
    const map = { top_news: [], autoimmune: [], domain: [], no_news: [], suggestion: [] } as Record<
      string, FeedItem[]
    >
    for (const it of filtered ?? []) map[it.section]?.push(it)
    return map
  }, [filtered])

  const domainGroups = useMemo(() => {
    const g = new Map<string, FeedItem[]>()
    for (const it of bySection.domain) {
      const key = it.domain ?? '未分类'
      g.set(key, [...(g.get(key) ?? []), it])
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [bySection.domain])

  // ---- 渲染 ----
  if (reportsError) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <SearchX className="mx-auto h-10 w-10 text-red-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">研发情报加载失败</p>
          <p className="mt-1 text-xs text-slate-400">{reportsError}</p>
        </CardContent>
      </Card>
    )
  }
  if (!reports) return <SectionLoading text="正在加载研发情报…" />
  if (reports.length === 0) return <EmptyState />

  return (
    <div className="space-y-6">
      {/* 顶部：周报信息与周次切换 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">研发情报周报 · {currentReport?.period}</h2>
            {currentReport?.batch && (
              <Badge className="bg-blue-600 font-normal">{currentReport.batch}</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            生成时间：{currentReport ? new Date(currentReport.generated_at).toLocaleString('zh-CN') : '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">历史周次</span>
          <Select
            value={selectedReportId != null ? String(selectedReportId) : undefined}
            onValueChange={(v) => setSelectedReportId(Number(v))}
          >
            <SelectTrigger className="w-56 bg-white">
              <SelectValue placeholder="选择周报" />
            </SelectTrigger>
            <SelectContent>
              {reports.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.period}{r.batch ? `（${r.batch}）` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 筛选：事件类型 + 公司搜索 */}
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              typeFilter === t
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
            )}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto">
          <Input
            value={companyQuery}
            onChange={(e) => setCompanyQuery(e.target.value)}
            placeholder="搜索公司名…"
            className="w-52 bg-white"
          />
        </div>
      </div>

      {/* 内容区 */}
      {itemsError ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-red-500">
            条目加载失败：{itemsError}
          </CardContent>
        </Card>
      ) : !filtered ? (
        <SectionLoading text="正在加载本期条目…" />
      ) : filtered.length === 0 ? (
        <EmptyState message="本期暂无符合筛选条件的情报条目" />
      ) : (
        <>
          {/* 本周要闻 */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              本周要闻 <span className="ml-1 text-xs font-normal text-slate-400">{bySection.top_news.length} 条</span>
            </h3>
            {bySection.top_news.length === 0 ? (
              <p className="text-xs text-slate-400">本周无要闻。</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {bySection.top_news.map((it) => <NewsCard key={it.id} item={it} />)}
              </div>
            )}
          </section>

          {/* 自免管线跟踪 */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              自免管线跟踪 <span className="ml-1 text-xs font-normal text-slate-400">{bySection.autoimmune.length} 条</span>
            </h3>
            {bySection.autoimmune.length === 0 ? (
              <p className="text-xs text-slate-400">本周自免管线无新动态。</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {bySection.autoimmune.map((it) => <NewsCard key={it.id} item={it} />)}
              </div>
            )}
          </section>

          {/* 分领域动态 */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              分领域动态 <span className="ml-1 text-xs font-normal text-slate-400">{bySection.domain.length} 条</span>
            </h3>
            {domainGroups.length === 0 ? (
              <p className="text-xs text-slate-400">本周各领域无新动态。</p>
            ) : (
              <div className="space-y-5">
                {domainGroups.map(([domain, list]) => (
                  <div key={domain}>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="outline" className="border-violet-200 bg-violet-50 font-normal text-violet-700">
                        {domain}
                      </Badge>
                      <span className="text-xs text-slate-400">{list.length} 条</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {list.map((it) => <NewsCard key={it.id} item={it} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 无新动态公司 & 清单维护建议 */}
          {(bySection.no_news.length > 0 || bySection.suggestion.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              {bySection.no_news.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">无新动态公司</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5 text-sm text-slate-600">
                      {bySection.no_news.map((it) => (
                        <li key={it.id} className="flex items-center gap-2">
                          <span className="h-1 w-1 rounded-full bg-slate-300" />
                          {it.company}
                          {it.summary && <span className="text-xs text-slate-400">{it.summary}</span>}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
              {bySection.suggestion.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">清单维护建议</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5 text-sm text-slate-600">
                      {bySection.suggestion.map((it) => (
                        <li key={it.id} className="flex items-start gap-2">
                          <RefreshCw className="mt-1 h-3 w-3 shrink-0 text-slate-300" />
                          <span>{it.summary ?? it.company}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
