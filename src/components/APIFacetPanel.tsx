// 成分透视页左侧筛选面板（方案A）：手风琴分组 + 计数徽标 + 已撤市开关 + 疾病搜索式多选。
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import {
  STAGE_OPTIONS, YEAR_OPTIONS, EROSION_OPTIONS, CLIFF_OPTIONS, MOLTYPE_OPTIONS,
  type FacetState,
} from '@/lib/apiFacets'
import { cn } from '@/lib/utils'

export interface FacetCounts {
  stages: Record<string, number>
  yearBuckets: Record<string, number>
  applType: Record<string, number>
  molTypes: Record<string, number>
  erosion: Record<string, number>
  cliff: Record<string, number>
  shortage: Record<string, number>
  global: Record<string, number>
  evidence: Record<string, number>
  withdrawnHidden: number
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

function Option({ label, count, active, onClick }: {
  label: string; count?: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors',
        active ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-50',
      )}
    >
      <span>{label}</span>
      {count != null && <span className="ml-2 shrink-0 text-slate-400">{count.toLocaleString()}</span>}
    </button>
  )
}

function Group({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="border-b border-slate-100 py-1.5 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-1 py-1 text-xs font-semibold text-slate-700 hover:text-blue-700"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
      </button>
      {open && <div className="mt-0.5 space-y-0.5 pl-4">{children}</div>}
    </div>
  )
}

export default function APIFacetPanel({ facets, counts, diseaseNames, onChange, onClear }: {
  facets: FacetState
  counts: FacetCounts | null
  diseaseNames: Record<string, string>
  onChange: (f: FacetState) => void
  onClear: () => void
}) {
  const [disQuery, setDisQuery] = useState('')
  const set = (patch: Partial<FacetState>) => onChange({ ...facets, ...patch })

  const diseaseMatches = useMemo(() => {
    const q = disQuery.trim().toLowerCase()
    if (!q) return []
    return Object.entries(diseaseNames)
      .filter(([slug, zh]) => !facets.diseases.includes(slug) && (zh.toLowerCase().includes(q) || slug.includes(q)))
      .slice(0, 8)
  }, [disQuery, diseaseNames, facets.diseases])

  return (
    <div className="w-56 shrink-0 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="mb-1 flex items-center justify-between px-1">
        <p className="text-xs font-bold text-slate-800">筛选面板</p>
        <button onClick={onClear} className="text-xs text-blue-600 hover:underline">清空</button>
      </div>

      <Group title="基础" defaultOpen>
        <p className="px-2 pt-0.5 text-[10px] font-medium text-slate-400">生命周期阶段</p>
        {STAGE_OPTIONS.map((s) => (
          <Option key={s} label={s === '仿制成熟期' ? '仿制药' : s} count={counts?.stages[s]} active={facets.stages.includes(s)} onClick={() => set({ stages: toggle(facets.stages, s) })} />
        ))}
        <p className="px-2 pt-1 text-[10px] font-medium text-slate-400">首获批年份</p>
        {YEAR_OPTIONS.map((b) => (
          <Option key={b} label={b} count={counts?.yearBuckets[b]} active={facets.yearBuckets.includes(b)} onClick={() => set({ yearBuckets: toggle(facets.yearBuckets, b) })} />
        ))}
        <p className="px-2 pt-1 text-[10px] font-medium text-slate-400">申请类型</p>
        <Option label="含原研（NDA/BLA）" count={counts?.applType.originator} active={facets.applType.includes('originator')} onClick={() => set({ applType: toggle(facets.applType, 'originator') })} />
        <Option label="含仿制（ANDA）" count={counts?.applType.generic} active={facets.applType.includes('generic')} onClick={() => set({ applType: toggle(facets.applType, 'generic') })} />
        <p className="px-2 pt-1 text-[10px] font-medium text-slate-400">分子类型</p>
        {MOLTYPE_OPTIONS.map((t) => (
          <Option key={t} label={t} count={counts?.molTypes[t]} active={facets.molTypes.includes(t)} onClick={() => set({ molTypes: toggle(facets.molTypes, t) })} />
        ))}
      </Group>

      <Group title="竞争与专利">
        <p className="px-2 pt-0.5 text-[10px] font-medium text-slate-400">竞争烈度</p>
        {EROSION_OPTIONS.map((e) => (
          <Option key={e} label={e} count={counts?.erosion[e]} active={facets.erosion.includes(e)} onClick={() => set({ erosion: toggle(facets.erosion, e) })} />
        ))}
        <p className="px-2 pt-1 text-[10px] font-medium text-slate-400">专利悬崖</p>
        {CLIFF_OPTIONS.map((c) => (
          <Option key={c} label={c} count={counts?.cliff[c]} active={facets.cliff.includes(c)} onClick={() => set({ cliff: toggle(facets.cliff, c) })} />
        ))}
        <p className="px-2 pt-1 text-[10px] font-medium text-slate-400">短缺风险</p>
        <Option label="高" count={counts?.shortage.high} active={facets.shortage.includes('high')} onClick={() => set({ shortage: toggle(facets.shortage, 'high') })} />
        <Option label="中" count={counts?.shortage.medium} active={facets.shortage.includes('medium')} onClick={() => set({ shortage: toggle(facets.shortage, 'medium') })} />
        <label className="flex cursor-pointer items-center gap-1.5 px-2 pt-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={facets.hideWithdrawn}
            onChange={(e) => set({ hideWithdrawn: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          隐藏已撤市
          {counts != null && <span className="text-slate-400">（隐藏 {counts.withdrawnHidden.toLocaleString()}）</span>}
        </label>
      </Group>

      <Group title="全球与证据">
        <p className="px-2 pt-0.5 text-[10px] font-medium text-slate-400">全球可及（2020+ 专题）</p>
        <Option label="EMA 已授权" count={counts?.global.ema} active={facets.global.includes('ema')} onClick={() => set({ global: toggle(facets.global, 'ema') })} />
        <Option label="PMDA 已批" count={counts?.global.pmda} active={facets.global.includes('pmda')} onClick={() => set({ global: toggle(facets.global, 'pmda') })} />
        <Option label="仅美国" count={counts?.global.us_only} active={facets.global.includes('us_only')} onClick={() => set({ global: toggle(facets.global, 'us_only') })} />
        <p className="px-2 pt-1 text-[10px] font-medium text-slate-400">治疗领域（疾病多选）</p>
        {facets.diseases.map((slug) => (
          <span key={slug} className="mx-1 inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">
            {diseaseNames[slug] ?? slug}
            <button onClick={() => set({ diseases: facets.diseases.filter((d) => d !== slug) })}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <div className="relative px-1 pt-0.5">
          <input
            value={disQuery}
            onChange={(e) => setDisQuery(e.target.value)}
            placeholder="搜索疾病…"
            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-blue-400"
          />
          {diseaseMatches.length > 0 && (
            <ul className="absolute z-20 mt-0.5 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {diseaseMatches.map(([slug, zh]) => (
                <li key={slug}>
                  <button
                    onClick={() => { set({ diseases: [...facets.diseases, slug] }); setDisQuery('') }}
                    className="w-full px-2 py-1 text-left text-xs text-slate-700 hover:bg-blue-50"
                  >
                    {zh} <span className="text-slate-400">{slug}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="px-2 pt-1 text-[10px] font-medium text-slate-400">证据</p>
        <Option label="有 PubMed 数据" count={counts?.evidence.pubmed} active={facets.evidence.includes('pubmed')} onClick={() => set({ evidence: toggle(facets.evidence, 'pubmed') })} />
        <Option label="有临床试验" count={counts?.evidence.ct} active={facets.evidence.includes('ct')} onClick={() => set({ evidence: toggle(facets.evidence, 'ct') })} />
      </Group>
    </div>
  )
}
