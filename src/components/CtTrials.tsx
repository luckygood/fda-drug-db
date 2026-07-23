// ClinicalTrials.gov 在研管线共享 UI：阶段迷你条 / 状态摘要 / 试验列表。
import { ExternalLink } from 'lucide-react'
import type { CtTrial } from '@/lib/data'
import { cn } from '@/lib/utils'

const PHASE_LABEL: Record<string, string> = {
  EARLY_PHASE1: '早期I期',
  PHASE1: 'I期',
  PHASE2: 'II期',
  PHASE3: 'III期',
  PHASE4: 'IV期',
}

const STATUS_LABEL: Record<string, string> = {
  RECRUITING: '招募中',
  NOT_YET_RECRUITING: '尚未招募',
  ACTIVE_NOT_RECRUITING: '进行中（不招募）',
  COMPLETED: '已完成',
  TERMINATED: '已终止',
  WITHDRAWN: '已撤回',
  ENROLLING_BY_INVITATION: '邀请入组',
  SUSPENDED: '已暂停',
  UNKNOWN: '未知',
}

const PHASE_ORDER = ['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4']
const PHASE_COLOR: Record<string, string> = {
  EARLY_PHASE1: 'bg-sky-300',
  PHASE1: 'bg-sky-400',
  PHASE2: 'bg-blue-500',
  PHASE3: 'bg-indigo-500',
  PHASE4: 'bg-violet-400',
}

/** 阶段分布迷你条（纯 CSS，堆叠横条 + 图例） */
export function CtPhaseBar({ byPhase, className }: { byPhase: Record<string, number>; className?: string }) {
  const total = PHASE_ORDER.reduce((s, p) => s + (byPhase[p] ?? 0), 0)
  if (total === 0) return <p className="text-xs text-slate-400">无阶段标注的试验记录。</p>
  return (
    <div className={className}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {PHASE_ORDER.map((p) => {
          const n = byPhase[p] ?? 0
          if (!n) return null
          return (
            <div
              key={p}
              className={cn('h-full', PHASE_COLOR[p])}
              style={{ width: `${(n / total) * 100}%` }}
              title={`${PHASE_LABEL[p]} ${n} 项`}
            />
          )
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {PHASE_ORDER.map((p) => {
          const n = byPhase[p] ?? 0
          if (!n) return null
          return (
            <span key={p} className="flex items-center gap-1 text-xs text-slate-500">
              <span className={cn('inline-block h-2 w-2 rounded-sm', PHASE_COLOR[p])} />
              {PHASE_LABEL[p]} {n}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** 状态摘要一行：招募中 N · 已完成 N · 终止/撤回 N */
export function CtStatusLine({ byStatus }: { byStatus: Record<string, number> }) {
  const parts: string[] = []
  const pick = (keys: string[], label: string) => {
    const n = keys.reduce((s, k) => s + (byStatus[k] ?? 0), 0)
    if (n) parts.push(`${label} ${n}`)
  }
  pick(['RECRUITING'], '招募中')
  pick(['NOT_YET_RECRUITING'], '尚未招募')
  pick(['ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION'], '进行中')
  pick(['COMPLETED'], '已完成')
  pick(['TERMINATED', 'WITHDRAWN'], '终止/撤回')
  return <p className="text-sm text-slate-700">{parts.join(' · ')}</p>
}

/** 试验列表（NCT 链接 → clinicaltrials.gov/study/NCT） */
export function CtTrialList({ trials, max }: { trials: CtTrial[]; max: number }) {
  return (
    <ol className="list-decimal space-y-2 pl-5">
      {trials.slice(0, max).map((t) => (
        <li key={t.nctId} className="text-sm leading-snug text-slate-700">
          <a
            href={`https://clinicaltrials.gov/study/${t.nctId}`}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 hover:underline"
          >
            {t.title || t.nctId}
            <ExternalLink className="mb-0.5 ml-1 inline h-3 w-3 text-slate-300" />
          </a>
          <span className="mt-0.5 block text-xs text-slate-400">
            {[
              t.nctId,
              t.phase ? (PHASE_LABEL[t.phase] ?? t.phase) : null,
              t.status ? (STATUS_LABEL[t.status] ?? t.status) : null,
              t.sponsor,
              t.startDate ? `启动 ${t.startDate}` : null,
              t.enrollment != null ? `N=${t.enrollment}` : null,
            ].filter(Boolean).join(' · ')}
          </span>
        </li>
      ))}
    </ol>
  )
}
