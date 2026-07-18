import { AlertTriangle, FlaskConical, ShieldAlert, FileText } from 'lucide-react'
import type { EfficacyCard, SafetyCard } from '@/lib/data'

interface DrugSummaryCardsProps {
  efficacyCard: EfficacyCard | null
  safetyCard: SafetyCard | null
}

/** 有效性/安全性摘要卡（摘自 FDA 说明书原文，提取式摘要） */
export default function DrugSummaryCards({ efficacyCard: ec, safetyCard: sc }: DrugSummaryCardsProps) {
  if (!ec && !sc) {
    return <p className="py-4 text-center text-sm text-slate-400">暂无说明书深度数据</p>
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 有效性卡 */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <FlaskConical className="h-4 w-4 text-blue-600" />
          有效性（临床研究）
        </h4>
        {ec ? (
          <div className="mt-2.5 space-y-2.5">
            {ec.trials.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ec.trials.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            {ec.key_results.length > 0 && (
              <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-slate-600">
                {ec.key_results.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
            {ec.source_section && (
              <p className="flex items-center gap-1 text-xs text-slate-400">
                <FileText className="h-3 w-3" />
                来源：{ec.source_section}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2.5 text-xs text-slate-400">暂无该疾病相关临床研究摘录</p>
        )}
      </div>

      {/* 安全性卡 */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          安全性（警示与不良反应）
        </h4>
        {sc ? (
          <div className="mt-2.5 space-y-2.5">
            {sc.boxed_warning ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5">
                <p className="flex items-center gap-1 text-xs font-semibold text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  黑框警告
                </p>
                <p className="mt-1 text-xs leading-relaxed text-red-700">{sc.boxed_warning}</p>
              </div>
            ) : (
              <p className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-400">
                无黑框警告
              </p>
            )}
            {sc.warnings.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500">主要警示</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                  {sc.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {sc.common_adverse_reactions && (
              <div>
                <p className="text-xs font-medium text-slate-500">常见不良反应</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {sc.common_adverse_reactions}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2.5 text-xs text-slate-400">暂无安全性摘录</p>
        )}
      </div>

      <p className="text-xs text-slate-400 lg:col-span-2">
        以上内容摘自 FDA 说明书原文（提取式摘要，未经改写），仅供研究参考，不构成医疗建议。
      </p>
    </div>
  )
}
