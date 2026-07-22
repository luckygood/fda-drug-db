import { BookOpen } from 'lucide-react'
import type { IngredientPubMed } from '@/lib/data'

/** 成分 PubMed 证据块（2023-2026）：统计胶囊 + 最新文献列表 */
export default function PubMedEvidence({ entry, compact = false }: {
  entry: IngredientPubMed | null | undefined
  /** compact 模式仅显示统计胶囊，不列文献 */
  compact?: boolean
}) {
  const empty = !entry || (!(entry.clinical_count ?? 0) && !(entry.review_count ?? 0) && entry.recent.length === 0)
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <BookOpen className="h-3.5 w-3.5" />
        PubMed 证据（2023-2026）
      </p>
      {empty ? (
        <p className="text-xs text-slate-400">近3年暂无论文收录</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
              临床研究与随机对照 <b>{entry.clinical_count ?? 0}</b>
            </span>
            <span className="rounded bg-sky-50 px-2 py-1 text-xs text-sky-700">
              综述与Meta <b>{entry.review_count ?? 0}</b>
            </span>
          </div>
          {!compact && entry.recent.length > 0 && (
            <ul className="space-y-1">
              {entry.recent.slice(0, 5).map((a) => (
                <li key={a.pmid} className="text-xs leading-relaxed">
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {a.title}
                  </a>
                  <span className="ml-1.5 text-slate-400">{a.journal} · {a.pubdate.slice(0, 4)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
