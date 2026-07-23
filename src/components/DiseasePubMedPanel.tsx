import { useEffect, useState } from 'react'
import { Loader2, BookOpen, ExternalLink, AlertCircle, FlaskConical, FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { loadDiseasePubMed, type DiseasePubMedEntry } from '@/lib/data'

/** pubtype 徽章配色：Clinical Trial/RCT 蓝、Meta/系统评价 紫、Review 绿 */
function pubtypeBadgeCls(t: string): string {
  if (/meta-analysis|systematic review/i.test(t)) return 'bg-violet-50 text-violet-700 border-violet-200'
  if (/randomized|controlled trial|clinical trial/i.test(t)) return 'bg-blue-50 text-blue-700 border-blue-200'
  if (/review/i.test(t)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-slate-100 text-slate-600 border-slate-200'
}

/**
 * 疾病级 PubMed 研究洞察（静态 JSON，覆盖 Top 疾病 + 试点）。
 * 该疾病不在数据文件中时不渲染任何内容。
 */
export default function DiseasePubMedPanel({ slug }: { slug: string }) {
  const [entry, setEntry] = useState<DiseasePubMedEntry | null | undefined>(undefined)
  const [window_, setWindow_] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadDiseasePubMed()
      .then((d) => {
        if (!cancelled) { setEntry(d.diseases[slug] ?? null); setWindow_(d.window?.replace(':', '–') ?? null) }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // 无数据疾病：不渲染
  if (entry === null) return null

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-red-500">
          <AlertCircle className="h-4 w-4" />
          PubMed 数据加载失败：{error}
        </CardContent>
      </Card>
    )
  }

  if (entry === undefined) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <span className="text-sm">正在加载 PubMed 研究数据…</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="h-5 w-5 text-blue-600" />
          PubMed 研究洞察
        </CardTitle>
        <p className="text-xs text-slate-400">
          数据来源：PubMed（NCBI）· 按疾病主题词检索 · {window_ ? `${window_} 年文献` : '近三年文献'} · 聚焦临床研究与综述证据
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 证据规模 chips */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
            <div className="flex items-center gap-1.5 text-xs text-blue-700">
              <FlaskConical className="h-3.5 w-3.5" />
              临床研究（含 RCT）· 近三年
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {entry.clinical_count != null ? entry.clinical_count.toLocaleString() : '—'}
              <span className="ml-1 text-sm font-normal text-slate-400">篇</span>
            </p>
          </div>
          <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-4">
            <div className="flex items-center gap-1.5 text-xs text-violet-700">
              <FileText className="h-3.5 w-3.5" />
              综述 / Meta 分析 · 近三年
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {entry.review_count != null ? entry.review_count.toLocaleString() : '—'}
              <span className="ml-1 text-sm font-normal text-slate-400">篇</span>
            </p>
          </div>
        </div>

        {/* 最新文献 */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-600">
            最新文献（临床研究与综述 · {entry.recent.length} 篇）
          </h3>
          {entry.recent.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">暂无收录文献</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {entry.recent.map((r) => (
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
      </CardContent>
    </Card>
  )
}
