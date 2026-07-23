import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Loader2, Printer } from 'lucide-react'
import PubMedEvidence from '@/components/PubMedEvidence'
import {
  loadLifecycleIndex, loadEntityMap, loadDiseaseIndex, loadIngredientPubMed, loadGlobalAccess,
  loadLabelSummary, loadReportMetrics, loadCtIngredient,
  type LifecycleRecord, type EntityMap, type IngredientPubMedIndex,
  type GlobalAccessRecord, type APIProduct,
  type LabelSummaryEntry, type IngredientMetrics, type CtDiseaseEntry,
} from '@/lib/data'
import { ingredientInsights } from '@/lib/insights'
import { CtTrialList } from '@/components/CtTrials'
import { cn } from '@/lib/utils'


const STAGE_STYLE: Record<string, string> = {
  引入期: 'bg-blue-100 text-blue-700',
  成长期: 'bg-emerald-100 text-emerald-700',
  成熟期: 'bg-violet-100 text-violet-700',
  衰退期: 'bg-amber-100 text-amber-700',
  仿制成熟期: 'bg-slate-200 text-slate-600',
}

const SHORTAGE_LABEL: Record<string, string> = {
  high: '短缺·高',
  medium: '短缺·中',
  watch: '短缺·观察',
}

interface TimelineEvent {
  date: string
  label: string
  note?: string
  color: string
}

function buildTimeline(rec: LifecycleRecord, products: APIProduct[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  if (rec.first_approval) {
    events.push({ date: rec.first_approval, label: '首次批准（FDA）', note: rec.originator ? `原研 ${rec.originator}` : undefined, color: 'bg-blue-500' })
  }
  const PLCM_COLOR: Record<string, string> = { 新适应症: 'bg-blue-400', 新剂型: 'bg-emerald-500', 新规格: 'bg-violet-500' }
  for (const a of rec.plcm_actions) {
    events.push({ date: String(a.year), label: a.type, note: a.note, color: PLCM_COLOR[a.type] ?? 'bg-slate-400' })
  }
  if (rec.patent_earliest_expiry) events.push({ date: rec.patent_earliest_expiry, label: '核心专利最早到期', color: 'bg-orange-500' })
  if (rec.patent_latest_expiry && rec.patent_latest_expiry !== rec.patent_earliest_expiry) {
    events.push({ date: rec.patent_latest_expiry, label: '专利最晚到期', color: 'bg-orange-500' })
  }
  const firstAnda = products.filter((p) => p.appl_type === 'ANDA' && p.approval_date).map((p) => p.approval_date).sort()[0]
  if (firstAnda) events.push({ date: firstAnda, label: '首个 ANDA 获批（仿制进入）', color: 'bg-green-500' })
  if (rec.withdrawn) events.push({ date: '9999', label: '已撤市 / 全面停产', color: 'bg-red-500' })
  events.sort((a, b) => a.date.localeCompare(b.date)) // 报告按时间正序叙述
  return events
}

function monthsBetween(d1: string, d2: string): number {
  return (parseInt(d2.slice(0, 4)) - parseInt(d1.slice(0, 4))) * 12 + (parseInt(d2.slice(5, 7)) - parseInt(d1.slice(5, 7)))
}

function RegionBadge({ flag, name, children, tone }: {
  flag: string; name: string; children: React.ReactNode
  tone: 'green' | 'red' | 'gray' | 'blue'
}) {
  const tones = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    gray: 'border-slate-200 bg-slate-50 text-slate-500',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm', tones[tone])}>
      <span>{flag}</span>
      <b>{name}</b>
      <span>{children}</span>
    </span>
  )
}

function Chapter({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="report-chapter mb-3 border-b border-slate-100 pb-2 text-base font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

export default function IngredientReport({ apiName, products, onBack }: {
  apiName: string
  products: APIProduct[]
  onBack: () => void
}) {
  const [rec, setRec] = useState<LifecycleRecord | null>(null)
  const [entityMap, setEntityMap] = useState<EntityMap | null>(null)
  const [diseaseNames, setDiseaseNames] = useState<Record<string, string>>({})
  const [pubmed, setPubmed] = useState<IngredientPubMedIndex | null>(null)
  const [globalRec, setGlobalRec] = useState<GlobalAccessRecord | null>(null)
  const [labelCard, setLabelCard] = useState<LabelSummaryEntry | null>(null)
  const [ingMetrics, setIngMetrics] = useState<IngredientMetrics | null>(null)
  const [ct, setCt] = useState<CtDiseaseEntry | null>(null)
  const [generatedAt, setGeneratedAt] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      loadLifecycleIndex().then((d) => {
        setRec(d.records[apiName.toUpperCase()] ?? null)
        setGeneratedAt(d.generated_at)
      }).catch(() => setRec(null)),
      loadEntityMap().then(setEntityMap).catch(() => setEntityMap(null)),
      loadDiseaseIndex()
        .then((d) => setDiseaseNames(Object.fromEntries(d.diseases.map((x) => [x.slug, x.name_zh]))))
        .catch(() => setDiseaseNames({})),
      loadIngredientPubMed().then(setPubmed).catch(() => setPubmed(null)),
      loadGlobalAccess()
        .then((d) => setGlobalRec(d.records[apiName.toUpperCase()] ?? null))
        .catch(() => setGlobalRec(null)),
      loadLabelSummary()
        .then((d) => setLabelCard(d.ingredients[apiName.toUpperCase()] ?? null))
        .catch(() => setLabelCard(null)),
      loadReportMetrics()
        .then((d) => setIngMetrics(d.ingredients[apiName.toUpperCase()] ?? null))
        .catch(() => setIngMetrics(null)),
      loadCtIngredient()
        .then((d) => setCt(d.ingredients[apiName.toUpperCase()] ?? null))
        .catch(() => setCt(null)),
    ]).finally(() => setLoading(false))
  }, [apiName])

  const insights = useMemo(
    () => (rec ? ingredientInsights(rec, ingMetrics ?? undefined) : []),
    [rec, ingMetrics],
  )

  const links = entityMap?.ingredients[apiName.toUpperCase()]
  const pubmedEntry = pubmed?.ingredients[apiName.toUpperCase()]
  const timeline = useMemo(() => (rec ? buildTimeline(rec, products) : []), [rec, products])
  const andaHistory = useMemo(
    () => products
      .filter((p) => p.appl_type === 'ANDA' && p.approval_date)
      .sort((a, b) => a.approval_date.localeCompare(b.approval_date))
      .slice(0, 15),
    [products],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <p className="text-sm">正在生成报告…</p>
      </div>
    )
  }
  if (!rec) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">
        该成分暂无生命周期档案，无法生成报告。
        <button onClick={onBack} className="ml-2 text-blue-600 hover:underline">返回</button>
      </div>
    )
  }

  const todayStr = generatedAt || new Date().toISOString().slice(0, 10)
  const emaLag = globalRec?.ema_first_date && rec.first_approval
    ? monthsBetween(rec.first_approval, globalRec.ema_first_date) : null
  const pmdaLag = globalRec?.pmda_first_date && rec.first_approval
    ? monthsBetween(rec.first_approval, globalRec.pmda_first_date) : null
  const summaryRows: [string, React.ReactNode][] = [
    ['生命周期阶段', (
      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STAGE_STYLE[rec.stage])}>
        {rec.stage === '仿制成熟期' ? '仿制药' : rec.stage}
      </span>
    )],
    ['FDA 首获批', rec.first_approval ?? '—'],
    ['原研公司', rec.originator ?? '—'],
    ['NDA/BLA 数', String(rec.n_nda)],
    ['ANDA 竞争数', `${rec.n_anda}（${rec.n_anda_companies} 家）`],
    ['专利最早到期', rec.patent_earliest_expiry
      ? `${rec.patent_earliest_expiry}${rec.months_to_expiry != null ? (rec.months_to_expiry >= 0 ? `（剩 ${rec.months_to_expiry} 个月）` : '（已过期）') : ''}`
      : '—'],
    ['全球三地状态', [
      `FDA 已获批（${rec.first_approval?.slice(0, 4) ?? '—'}）`,
      globalRec?.ema_status === 'authorised' ? `EMA 已授权（${globalRec.ema_first_date?.slice(0, 4)}）`
        : globalRec?.ema_status === 'withdrawn' ? 'EMA 已撤市' : 'EMA 集中审批未检索到',
      globalRec?.pmda_status === 'approved' ? `PMDA 已获批（${globalRec.pmda_first_date?.slice(0, 4)}）` : 'PMDA 新药清单未检索到',
    ].join(' · ')],
    ['短缺 / 撤市', [rec.withdrawn ? '已撤市' : null, rec.shortage_risk ? SHORTAGE_LABEL[rec.shortage_risk] : null].filter(Boolean).join('；') || '无'],
  ]

  return (
    <div className="report-doc mx-auto max-w-[800px] space-y-5">
      {/* 操作条（打印隐藏） */}
      <div className="no-print flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
          返回交互视图
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Printer className="h-4 w-4" />
          导出 PDF / 打印
        </button>
      </div>

      {/* 封面区 */}
      <section className="report-card rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs tracking-wide text-slate-400">fda-drug-db · 报告中心 · 报告 B（永久免费）</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">《{rec.ingredient} 全生命周期档案》</h1>
        <p className="mt-1 text-sm text-slate-500">{rec.ingredient} · 活性成分实体报告</p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
          <span>生成日期：{todayStr}</span>
          <span>数据来源：Drugs@FDA（{generatedAt || '—'}）· EMA 集中审批 · PMDA 新药清单 · PubMed</span>
        </div>
      </section>

      {/* 一、概要 */}
      <Chapter title="一、概要">
        {insights.length > 0 && (
          <ul className="mb-3 space-y-1 rounded-md bg-slate-50 px-3 py-2">
            {insights.map((it, i) => (
              <li key={i} className="text-xs leading-relaxed text-slate-600">
                <span className="mr-1 font-medium text-blue-700">◆</span>
                {it.text}
                <span className="ml-1 text-slate-400">{it.source}</span>
              </li>
            ))}
          </ul>
        )}
        <dl className="divide-y divide-slate-100">
          {summaryRows.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-4 py-1.5">
              <dt className="w-28 shrink-0 text-xs text-slate-400">{k}</dt>
              <dd className="text-sm text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
      </Chapter>

      {/* 二、生命周期时间轴 */}
      <Chapter title={`二、生命周期时间轴（${timeline.length} 个事件）`}>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-400">暂无时间轴事件。</p>
        ) : (
          <ol className="relative ml-2 space-y-3 border-l-2 border-slate-200 pl-5">
            {timeline.map((e, i) => (
              <li key={i} className="relative">
                <span className={cn('absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-white', e.color)} />
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="w-24 shrink-0 text-sm font-semibold text-slate-900">{e.date === '9999' ? '现状' : e.date}</span>
                  <span className="text-sm text-slate-700">{e.label}</span>
                </div>
                {e.note && <p className="ml-[7.5rem] mt-0.5 text-xs text-slate-400">{e.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </Chapter>

      {/* 三、竞争格局 */}
      <Chapter title="三、竞争格局">
        <p className="text-sm text-slate-700">
          该成分共有 <b>{rec.n_anda}</b> 个 ANDA 申请（<b>{rec.n_anda_companies}</b> 家仿制厂家），
          原研 NDA/BLA <b>{rec.n_nda}</b> 个。
          {rec.n_anda === 0 && '目前尚无仿制药进入。'}
        </p>
        {andaHistory.length > 0 && (
          <table className="mt-3 w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">ANDA 获批日期</th>
                <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">申请号</th>
                <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">厂家</th>
                <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">状态</th>
              </tr>
            </thead>
            <tbody>
              {andaHistory.map((p, i) => (
                <tr key={`${p.application_number}-${i}`} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-2 py-1.5 text-sm text-slate-700">{p.approval_date}</td>
                  <td className="px-2 py-1.5 text-sm text-slate-700">{p.application_number}</td>
                  <td className="max-w-56 truncate px-2 py-1.5 text-sm text-slate-600">{p.sponsor_name || '—'}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">{p.marketing_status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rec.n_anda > andaHistory.length && andaHistory.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">注：仅列最早获批的前 {andaHistory.length} 个 ANDA。</p>
        )}
      </Chapter>

      {/* 四、全球可及性 */}
      <Chapter title="四、全球可及性">
        {globalRec ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <RegionBadge flag="🇺🇸" name="FDA" tone="blue">{rec.first_approval ?? '已获批'}</RegionBadge>
              {globalRec.match_type === 'unmatched' || !globalRec.ema_status ? (
                <RegionBadge flag="🇪🇺" name="EMA" tone="gray">集中审批未检索到</RegionBadge>
              ) : globalRec.ema_status === 'authorised' ? (
                <RegionBadge flag="🇪🇺" name="EMA" tone="green">
                  已授权 {globalRec.ema_first_date ?? ''}{globalRec.ema_product ? ` · ${globalRec.ema_product}` : ''}
                </RegionBadge>
              ) : (
                <RegionBadge flag="🇪🇺" name="EMA" tone="red">
                  {globalRec.ema_status === 'withdrawn' ? '已撤市' : globalRec.ema_status === 'refused' ? '已拒绝' : '其他状态'}
                </RegionBadge>
              )}
              {globalRec.pmda_status === 'approved' ? (
                <RegionBadge flag="🇯🇵" name="PMDA" tone="green">已获批 {globalRec.pmda_first_date ?? ''}</RegionBadge>
              ) : (
                <RegionBadge flag="🇯🇵" name="PMDA" tone="gray">新药清单未检索到</RegionBadge>
              )}
            </div>
            <p className="text-sm text-slate-600">
              批准时滞（相对 FDA）：
              {emaLag != null ? `EMA ${emaLag >= 0 ? '+' : ''}${emaLag} 个月` : 'EMA —'}
              {' · '}
              {pmdaLag != null ? `PMDA ${pmdaLag >= 0 ? '+' : ''}${pmdaLag} 个月` : 'PMDA —'}
              <span className="ml-1 text-xs text-slate-400">（负值 = 先于 FDA 获批）</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">该成分不在全球可及性专题范围内（2020 年至今 FDA 获批 NDA/BLA）。</p>
        )}
      </Chapter>

      {/* 五、说明书要点 */}
      <Chapter title="五、说明书要点（FDA 标签）">
        {!labelCard ? (
          <p className="text-sm text-slate-400">该成分暂未生成说明书摘要卡（当前成分级覆盖率约 46%，优先覆盖近年新分子）。</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              来源：{labelCard.drug_name} · {labelCard.application_number}（最早原始 NDA/BLA 首批准标签，自动摘录）
            </p>
            {(labelCard.efficacy?.key_results?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500">疗效要点（{labelCard.efficacy!.source_section}）</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {labelCard.efficacy!.key_results.map((k, i) => (
                    <li key={i} className="text-xs leading-relaxed text-slate-700">{k}</li>
                  ))}
                </ul>
              </div>
            )}
            {labelCard.safety?.boxed_warning && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold text-amber-800">黑框警告</p>
                <p className="mt-0.5 text-xs leading-relaxed text-amber-700">{labelCard.safety.boxed_warning}</p>
              </div>
            )}
            {(labelCard.safety?.warnings?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500">警告与注意事项</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {labelCard.safety!.warnings.map((w, i) => (
                    <li key={i} className="text-xs leading-relaxed text-slate-700">{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {labelCard.safety?.common_adverse_reactions && (
              <p className="text-xs leading-relaxed text-slate-600">
                <span className="font-medium text-slate-500">常见不良反应：</span>
                {labelCard.safety.common_adverse_reactions}
              </p>
            )}
          </div>
        )}
      </Chapter>

      {/* 六、学术证据 */}
      <Chapter title="六、学术证据（PubMed 2023-2026）">
        <PubMedEvidence entry={pubmedEntry} />
        {!pubmedEntry && (
          <p className="mt-2 text-xs text-slate-400">口径提示：PubMed 证据当前仅覆盖引入期成分。</p>
        )}
      </Chapter>

      {/* 七、关联实体 */}
      <Chapter title="七、关联实体">
        {(!links || (!links.diseases?.length && !links.companies?.length && !links.trials?.length)) && (!ct || ct.error || (ct.total ?? 0) === 0) ? (
          <p className="text-sm text-slate-400">暂无关联实体数据。</p>
        ) : (
          <div className="space-y-3 text-sm text-slate-700">
            {(links?.diseases?.length ?? 0) > 0 && (
              <p><span className="mr-2 text-xs text-slate-400">治疗疾病</span>{links!.diseases!.map((s) => diseaseNames[s] ?? s).join('、')}</p>
            )}
            {(links?.companies?.length ?? 0) > 0 && (
              <p>
                <span className="mr-2 text-xs text-slate-400">持证企业</span>
                {links!.companies!.map((s) => entityMap?.companies[s]?.name ?? s).join('、')}
                （{links!.companies!.length} 家）
              </p>
            )}
            {ct && !ct.error && (ct.total ?? 0) > 0 ? (
              <div>
                <p>
                  <span className="mr-2 text-xs text-slate-400">临床试验</span>
                  相关研究 <b>{ct.total!.toLocaleString()}</b> 项（ClinicalTrials.gov API v2 干预名匹配，含对照组提及）
                </p>
                {(ct.top?.length ?? 0) > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-xs text-slate-400">最近更新研究（前 3）</p>
                    <CtTrialList trials={ct.top!} max={3} />
                  </div>
                )}
              </div>
            ) : (links?.trials?.length ?? 0) > 0 ? (
              <p><span className="mr-2 text-xs text-slate-400">临床试验</span>关联 {links!.trials!.length} 项（ClinicalTrials.gov，前 20 项）</p>
            ) : null}
          </div>
        )}
      </Chapter>

      {/* 页脚 */}
      <footer className="report-card rounded-lg border border-slate-200 bg-white p-5 text-xs leading-relaxed text-slate-400 shadow-sm">
        <p>
          数据口径与免责声明：本报告基于公开监管数据自动生成（Drugs@FDA 产品及申请数据、FDA 橙皮书专利/独占期、
          EMA 集中审批药品清单、PMDA《List of Approved Drugs》2004-2026、PubMed 文献计量、ClinicalTrials.gov 试验索引），
          各数据集生成日期见各源文件；实体匹配按成分名归一（去盐基、USAN→INN、复方排序）自动完成，可能存在少量错配。
          本报告仅供研究参考，不构成医疗建议或投资建议。
        </p>
        <p className="mt-2">由 fda-drug-db 永久免费数据分析平台生成 · 报告生成日期 {todayStr}</p>
      </footer>
    </div>
  )
}
