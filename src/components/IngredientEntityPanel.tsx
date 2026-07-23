import { useEffect, useMemo, useState } from 'react'
import {
  Flag, Sparkles, Pill, Layers, Ruler, ShieldAlert, AlertTriangle,
  Building2, Stethoscope, FlaskConical, Hourglass, Ban,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import PubMedEvidence from '@/components/PubMedEvidence'
import {
  loadLifecycleIndex, loadEntityMap, loadDiseaseIndex, loadIngredientPubMed, loadSponsorMap, loadGlobalAccess, resolveCompanySlug,
  type LifecycleRecord, type EntityMap, type IngredientPubMedIndex, type APIProduct, type GlobalAccessRecord,
} from '@/lib/data'
import { cn } from '@/lib/utils'

const STAGE_STYLE: Record<string, { label: string; cls: string }> = {
  引入期: { label: '引入期', cls: 'bg-blue-100 text-blue-700' },
  成长期: { label: '成长期', cls: 'bg-emerald-100 text-emerald-700' },
  成熟期: { label: '成熟期', cls: 'bg-violet-100 text-violet-700' },
  衰退期: { label: '衰退期', cls: 'bg-amber-100 text-amber-700' },
  仿制成熟期: { label: '仿制药', cls: 'bg-slate-200 text-slate-600' },
}

const SHORTAGE_LABEL: Record<string, { text: string; cls: string }> = {
  high: { text: '短缺·高', cls: 'bg-red-100 text-red-700' },
  medium: { text: '短缺·中', cls: 'bg-amber-100 text-amber-700' },
  watch: { text: '短缺·观察', cls: 'bg-sky-100 text-sky-700' },
}

interface TimelineEvent {
  date: string          // YYYY-MM-DD 或 YYYY
  kind: 'approval' | 'plcm_indication' | 'plcm_form' | 'plcm_strength' | 'patent' | 'anda' | 'withdrawn'
  title: string
  note?: string
}

const EVENT_STYLE: Record<TimelineEvent['kind'], { icon: typeof Flag; dot: string; text: string }> = {
  approval: { icon: Flag, dot: 'bg-blue-500', text: '首次批准' },
  plcm_indication: { icon: Sparkles, dot: 'bg-blue-400', text: '新适应症' },
  plcm_form: { icon: Layers, dot: 'bg-emerald-500', text: '新剂型' },
  plcm_strength: { icon: Ruler, dot: 'bg-violet-500', text: '新规格' },
  patent: { icon: ShieldAlert, dot: 'bg-orange-500', text: '专利到期' },
  anda: { icon: Pill, dot: 'bg-green-500', text: '仿制进入' },
  withdrawn: { icon: Ban, dot: 'bg-red-500', text: '撤市' },
}

function plcmKind(type: string): TimelineEvent['kind'] {
  if (type === '新适应症') return 'plcm_indication'
  if (type === '新剂型') return 'plcm_form'
  return 'plcm_strength'
}

function buildTimeline(rec: LifecycleRecord, products: APIProduct[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  if (rec.first_approval) {
    events.push({ date: rec.first_approval, kind: 'approval', title: '首次批准', note: rec.originator ? `原研 ${rec.originator}` : undefined })
  }
  for (const a of rec.plcm_actions) {
    events.push({ date: String(a.year), kind: plcmKind(a.type), title: a.type, note: a.note })
  }
  if (rec.patent_earliest_expiry) {
    events.push({ date: rec.patent_earliest_expiry, kind: 'patent', title: '核心专利最早到期' })
  }
  if (rec.patent_latest_expiry && rec.patent_latest_expiry !== rec.patent_earliest_expiry) {
    events.push({ date: rec.patent_latest_expiry, kind: 'patent', title: '专利最晚到期' })
  }
  // 首个 ANDA 获批日（从产品清单推导）
  const firstAnda = products
    .filter((p) => p.appl_type === 'ANDA' && p.approval_date)
    .map((p) => p.approval_date)
    .sort()[0]
  if (firstAnda) {
    events.push({ date: firstAnda, kind: 'anda', title: '首个 ANDA 获批（仿制进入）' })
  }
  if (rec.withdrawn) {
    events.push({ date: '9999', kind: 'withdrawn', title: '已撤市 / 全面停产' })
  }
  // 最新的在前；无日期（9999 占位）的状态事件排最前
  events.sort((a, b) => b.date.localeCompare(a.date))
  return events
}

function fmtDate(d: string): string {
  return d === '9999' ? '现状' : d
}

export default function IngredientEntityPanel({ apiName, products, onSelectDisease, onSelectCompany, onOpenReport }: {
  apiName: string
  /** 成分透视详情中的产品清单（用于推导首个 ANDA 获批日） */
  products: APIProduct[]
  onSelectDisease?: (slug: string) => void
  onSelectCompany?: (slug: string) => void
  /** 切换到报告视图（报告 B） */
  onOpenReport?: () => void
}) {
  const [rec, setRec] = useState<LifecycleRecord | null>(null)
  const [entityMap, setEntityMap] = useState<EntityMap | null>(null)
  const [diseaseNames, setDiseaseNames] = useState<Record<string, string>>({})
  const [pubmed, setPubmed] = useState<IngredientPubMedIndex | null>(null)
  const [sponsorMap, setSponsorMap] = useState<Record<string, string> | null>(null)
  const [globalRec, setGlobalRec] = useState<GlobalAccessRecord | null>(null)

  useEffect(() => {
    loadLifecycleIndex()
      .then((d) => setRec(d.records[apiName.toUpperCase()] ?? null))
      .catch(() => setRec(null))
    loadEntityMap().then(setEntityMap).catch(() => setEntityMap(null))
    loadDiseaseIndex()
      .then((d) => setDiseaseNames(Object.fromEntries(d.diseases.map((x) => [x.slug, x.name_zh]))))
      .catch(() => setDiseaseNames({}))
    loadIngredientPubMed().then(setPubmed).catch(() => setPubmed(null))
    loadSponsorMap().then(setSponsorMap).catch(() => setSponsorMap(null))
    loadGlobalAccess()
      .then((d) => setGlobalRec(d.records[apiName.toUpperCase()] ?? null))
      .catch(() => setGlobalRec(null))
  }, [apiName])

  const links = entityMap?.ingredients[apiName.toUpperCase()]
  const pubmedEntry = pubmed?.ingredients[apiName.toUpperCase()]
  const timeline = useMemo(() => (rec ? buildTimeline(rec, products) : []), [rec, products])

  if (!rec) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-400">
          该成分暂无生命周期档案（可能为 2026 年数据窗口外成分）。
        </CardContent>
      </Card>
    )
  }

  const stageStyle = STAGE_STYLE[rec.stage] ?? STAGE_STYLE.仿制成熟期
  const originatorSlug = resolveCompanySlug(sponsorMap ?? {}, rec.originator)
  const risk = rec.shortage_risk ? SHORTAGE_LABEL[rec.shortage_risk] : null

  return (
    <>
      {/* 1. 生命周期概要卡 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <Hourglass className="h-5 w-5 text-blue-600" />
            生命周期档案
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', stageStyle.cls)}>
              {stageStyle.label}
            </span>
            {rec.withdrawn && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-600">已撤市</span>}
            {risk && <span className={cn('rounded px-2 py-0.5 text-xs', risk.cls)}>{risk.text}</span>}
            {onOpenReport && (
              <button
                onClick={onOpenReport}
                className="ml-auto flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                📄 报告视图
              </button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-400">首获批</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{rec.first_approval ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">原研公司</p>
              {originatorSlug && onSelectCompany ? (
                <button
                  onClick={() => onSelectCompany(originatorSlug)}
                  className="mt-1 block max-w-full truncate text-left text-lg font-semibold text-blue-700 hover:underline"
                  title={rec.originator ?? undefined}
                >
                  {rec.originator ?? '—'}
                </button>
              ) : (
                <p className="mt-1 truncate text-lg font-semibold text-slate-900" title={rec.originator ?? undefined}>
                  {rec.originator ?? '—'}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-400">ANDA 竞争</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {rec.n_anda} <span className="text-sm font-normal text-slate-400">/ {rec.n_anda_companies} 家</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">专利到期</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {rec.months_to_expiry == null ? '—'
                  : rec.months_to_expiry < 0 ? <span className="text-amber-600">已过期</span>
                  : <span className={rec.months_to_expiry <= 24 ? 'text-amber-600' : ''}>{rec.months_to_expiry} 个月</span>}
              </p>
            </div>
          </div>

          {/* 全球批准：FDA × EMA（范围：2020 年至今 FDA 获批 NDA/BLA） */}
          {globalRec && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                  🇺🇸 FDA
                  <span className="font-normal text-blue-600">{rec.first_approval ? `${rec.first_approval.slice(0, 4)} 获批` : '已获批'}</span>
                </span>
                {globalRec.match_type === 'unmatched' || !globalRec.ema_status ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                    🇪🇺 EMA
                    <span className="font-normal">集中审批未检索到</span>
                  </span>
                ) : globalRec.ema_status === 'authorised' ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                    title={globalRec.ema_product ? `EMA 产品：${globalRec.ema_product}` : undefined}
                  >
                    🇪🇺 EMA
                    <span className="font-normal">
                      已授权{globalRec.ema_first_date ? ` ${globalRec.ema_first_date.slice(0, 4)}` : ''}
                      {globalRec.ema_product ? ` · ${globalRec.ema_product}` : ''}
                    </span>
                  </span>
                ) : globalRec.ema_status === 'withdrawn' ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
                    title={globalRec.ema_product ? `EMA 产品：${globalRec.ema_product}` : undefined}
                  >
                    🇪🇺 EMA
                    <span className="font-normal">已撤市{globalRec.ema_product ? ` · ${globalRec.ema_product}` : ''}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                    🇪🇺 EMA
                    <span className="font-normal">{globalRec.ema_status === 'refused' ? '已拒绝' : '其他状态'}</span>
                  </span>
                )}
                {globalRec.pmda_status === 'approved' ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                    🇯🇵 PMDA
                    <span className="font-normal">已获批{globalRec.pmda_first_date ? ` ${globalRec.pmda_first_date.slice(0, 4)}` : ''}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                    🇯🇵 PMDA
                    <span className="font-normal">新药清单未检索到</span>
                  </span>
                )}
                <span className="text-xs text-slate-400">范围：2020 年至今 FDA 获批 NDA/BLA · EMA 集中审批 · PMDA 新药（2004 年起）</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. 统一时间轴 */}
      {timeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Flag className="h-5 w-5 text-blue-600" />
              全生命周期时间轴（{timeline.length} 个事件）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative ml-2 space-y-4 border-l-2 border-slate-200 pl-5">
              {timeline.map((e, i) => {
                const style = EVENT_STYLE[e.kind]
                const Icon = style.icon
                return (
                  <li key={i} className="relative">
                    <span className={cn('absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white', style.dot)} />
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="w-24 shrink-0 text-sm font-semibold text-slate-900">{fmtDate(e.date)}</span>
                      <span className="flex items-center gap-1 text-sm font-medium text-slate-700">
                        <Icon className="h-3.5 w-3.5 text-slate-400" />
                        {e.title}
                      </span>
                    </div>
                    {e.note && <p className="ml-24 mt-0.5 text-xs text-slate-400 sm:ml-[7.5rem]">{e.note}</p>}
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* 3. 关联实体 + PubMed 证据 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Stethoscope className="h-5 w-5 text-teal-600" />
              关联实体
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(!links || (!links.diseases?.length && !links.companies?.length && !links.trials?.length)) && (
              <p className="py-4 text-center text-sm text-slate-400">暂无关联实体数据</p>
            )}
            {(links?.diseases?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">治疗疾病（点击跳转疾病视角）</p>
                <div className="flex flex-wrap gap-1.5">
                  {links!.diseases!.map((slug) => (
                    <button
                      key={slug}
                      onClick={() => onSelectDisease?.(slug)}
                      className="rounded-full border border-teal-200 bg-teal-50/60 px-2.5 py-1 text-xs text-teal-800 hover:border-teal-400 hover:bg-teal-100"
                    >
                      {diseaseNames[slug] ?? slug}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(links?.companies?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-500">
                  <Building2 className="h-3.5 w-3.5" />
                  持证企业（{links!.companies!.length} 家，点击跳转企业画像）
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {links!.companies!.slice(0, 12).map((slug) => (
                    <button
                      key={slug}
                      onClick={() => onSelectCompany?.(slug)}
                      title={entityMap?.companies[slug]?.name ?? slug}
                      className="rounded-full border border-indigo-200 bg-indigo-50/60 px-2.5 py-1 text-xs text-indigo-800 hover:border-indigo-400 hover:bg-indigo-100"
                    >
                      {entityMap?.companies[slug]?.name ?? slug}
                    </button>
                  ))}
                  {links!.companies!.length > 12 && (
                    <span className="px-1 py-1 text-xs text-slate-400">等 {links!.companies!.length} 家</span>
                  )}
                </div>
              </div>
            )}
            {(links?.trials?.length ?? 0) > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <FlaskConical className="h-3.5 w-3.5" />
                关联临床试验 {links!.trials!.length} 项（ClinicalTrials.gov，按启动日期倒序取前 20）
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-slate-400" />
              研究证据
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PubMedEvidence entry={pubmedEntry} />
            {!pubmedEntry && (
              <p className="mt-2 text-xs text-slate-400">PubMed 证据当前仅覆盖引入期成分。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
