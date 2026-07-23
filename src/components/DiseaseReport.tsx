import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Loader2, Printer, ExternalLink } from 'lucide-react'
import {
  loadLifecycleIndex, loadEntityMap, loadGlobalAccess, loadDiseasePubMed,
  loadLabelSummary, loadReportMetrics, loadCtDisease,
  type LifecycleRecord, type EntityMap, type GlobalAccess, type DiseasePubMedEntry,
  type DiseaseIndexEntry, type LabelSummary, type ReportMetrics, type CtDiseaseEntry,
} from '@/lib/data'
import { diseaseInsights } from '@/lib/insights'
import { CtPhaseBar, CtStatusLine, CtTrialList } from '@/components/CtTrials'
import { cn } from '@/lib/utils'


const STAGE_ORDER = ['引入期', '成长期', '成熟期', '衰退期', '仿制成熟期']
const STAGE_STYLE: Record<string, string> = {
  引入期: 'bg-blue-100 text-blue-700',
  成长期: 'bg-emerald-100 text-emerald-700',
  成熟期: 'bg-violet-100 text-violet-700',
  衰退期: 'bg-amber-100 text-amber-700',
  仿制成熟期: 'bg-slate-200 text-slate-600',
}
const NAME_CAP = 10

function Chapter({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="report-chapter mb-3 border-b border-slate-100 pb-2 text-base font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>
}

function InsightList({ items }: { items: { text: string; source: string }[] }) {
  if (items.length === 0) return null
  return (
    <ul className="mb-3 space-y-1 rounded-md bg-slate-50 px-3 py-2">
      {items.map((it, i) => (
        <li key={i} className="text-xs leading-relaxed text-slate-600">
          <span className="mr-1 font-medium text-blue-700">◆</span>
          {it.text}
          <span className="ml-1 text-slate-400">{it.source}</span>
        </li>
      ))}
    </ul>
  )
}

export default function DiseaseReport({ entry, onBack }: {
  entry: DiseaseIndexEntry
  onBack: () => void
}) {
  const [lifecycle, setLifecycle] = useState<Record<string, LifecycleRecord> | null>(null)
  const [entityMap, setEntityMap] = useState<EntityMap | null>(null)
  const [globalAccess, setGlobalAccess] = useState<GlobalAccess | null>(null)
  const [pubmed, setPubmed] = useState<DiseasePubMedEntry | null>(null)
  const [pubmedWindow, setPubmedWindow] = useState('近三年')
  const [generatedAt, setGeneratedAt] = useState('')
  const [labelSummary, setLabelSummary] = useState<LabelSummary | null>(null)
  const [metrics, setMetrics] = useState<ReportMetrics | null>(null)
  const [ct, setCt] = useState<CtDiseaseEntry | null>(null)
  const [ctFailed, setCtFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      loadLifecycleIndex().then((d) => { setLifecycle(d.records); setGeneratedAt(d.generated_at) }).catch(() => setLifecycle(null)),
      loadEntityMap().then(setEntityMap).catch(() => setEntityMap(null)),
      loadGlobalAccess().then(setGlobalAccess).catch(() => setGlobalAccess(null)),
      loadDiseasePubMed()
        .then((d) => { setPubmed(d.diseases[entry.slug] ?? null); if (d.window) setPubmedWindow(d.window.replace(':', '–')) })
        .catch(() => setPubmed(null)),
      loadLabelSummary().then(setLabelSummary).catch(() => setLabelSummary(null)),
      loadReportMetrics().then(setMetrics).catch(() => setMetrics(null)),
      loadCtDisease()
        .then((d) => { setCt(d.diseases[entry.slug] ?? null); setCtFailed(false) })
        .catch(() => { setCt(null); setCtFailed(true) }),
    ]).finally(() => setLoading(false))
  }, [entry.slug])

  // 疾病关联成分（实体关系层；ingredients 展示截断 ≤50，统计用 ingredients_total）
  const diseaseLinks = entityMap?.diseases[entry.slug]
  const ingredients = useMemo(
    () => diseaseLinks?.ingredients ?? [],
    [diseaseLinks],
  )
  const ingredientsTotal = diseaseLinks?.ingredients_total ?? ingredients.length

  // 有生命周期档案的成分
  const withRec = useMemo(
    () => ingredients.map((ing) => ({ ing, rec: lifecycle?.[ing] ?? null })),
    [ingredients, lifecycle],
  )

  // 一、治疗全景：按生命周期阶段分组
  const byStage = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const { ing, rec } of withRec) {
      const stage = rec?.stage ?? '未建档'
      if (!m.has(stage)) m.set(stage, [])
      m.get(stage)!.push(ing)
    }
    return m
  }, [withRec])

  // 二、竞争密度
  const density = useMemo(() => {
    if (!entityMap) return null
    const companies = new Set<string>()
    let anda = 0
    let shortage = 0
    for (const { ing, rec } of withRec) {
      for (const c of entityMap.ingredients[ing]?.companies ?? []) companies.add(c)
      anda += rec?.n_anda ?? 0
      if (rec?.shortage_risk) shortage += 1
    }
    return { companies: companies.size, anda, shortage }
  }, [entityMap, withRec])

  // 三、全球可及性（2020+ NME 专题范围内的成分）
  const globalStats = useMemo(() => {
    if (!globalAccess) return null
    let ema = 0, pmda = 0
    const inScope: string[] = []
    const unmatched: string[] = []
    for (const ing of ingredients) {
      const rec = globalAccess.records[ing]
      if (!rec) continue
      inScope.push(ing)
      if (rec.ema_status === 'authorised') ema += 1
      else if (rec.match_type === 'unmatched') unmatched.push(ing)
      if (rec.pmda_status === 'approved') pmda += 1
    }
    return { ema, pmda, inScope, unmatched }
  }, [globalAccess, ingredients])

  // 六、近期重点新分子（引入期，按首获批倒序）
  const recentNme = useMemo(() => {
    return withRec
      .filter((x) => x.rec?.stage === '引入期' && x.rec.first_approval)
      .sort((a, b) => (b.rec!.first_approval ?? '').localeCompare(a.rec!.first_approval ?? ''))
      .slice(0, 5)
  }, [withRec])

  // 规则模板解读（疾病级衍生指标；缺指标时为空数组）
  const dMetrics = metrics?.diseases[entry.slug]
  const insights = useMemo(
    () => diseaseInsights(dMetrics, {
      nameZh: entry.name_zh,
      topCompanyName: dMetrics?.top_company
        ? entityMap?.companies[dMetrics.top_company]?.name ?? dMetrics.top_company
        : undefined,
    }),
    [dMetrics, entry.name_zh, entityMap],
  )

  // 说明书要点摘录：取疾病成分中有标签摘要的前 5 个（引入期/新获批优先）
  const labelPicks = useMemo(() => {
    if (!labelSummary) return []
    return withRec
      .filter(({ ing }) => labelSummary.ingredients[ing]?.efficacy || labelSummary.ingredients[ing]?.safety)
      .sort((a, b) => (b.rec?.first_approval ?? '').localeCompare(a.rec?.first_approval ?? ''))
      .slice(0, 5)
      .map(({ ing }) => ({ ing, card: labelSummary.ingredients[ing] }))
  }, [labelSummary, withRec])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <p className="text-sm">正在生成报告…</p>
      </div>
    )
  }

  const todayStr = generatedAt || new Date().toISOString().slice(0, 10)
  const crowdInsight = dMetrics && dMetrics.crowded_bucket !== '中位' ? insights.slice(0, 1) : []
  const hhiInsights = insights.slice(crowdInsight.length)
  const stageKeys = [...STAGE_ORDER.filter((s) => byStage.has(s)), ...(byStage.has('未建档') ? ['未建档'] : [])]

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
        <p className="text-xs tracking-wide text-slate-400">fda-drug-db · 报告中心 · 报告 A（永久免费）</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">《{entry.name_zh} 治疗格局报告》</h1>
        <p className="mt-1 text-sm text-slate-500">{entry.name_en} · 疾病治疗格局实体报告</p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
          <span>生成日期：{todayStr}</span>
          <span>数据来源：Drugs@FDA · EMA 集中审批 · PMDA 新药清单 · PubMed · ClinicalTrials.gov</span>
        </div>
      </section>

      {/* 一、治疗全景 */}
      <Chapter title={`一、治疗全景（${ingredientsTotal} 个相关活性成分）`}>
        <InsightList items={crowdInsight} />
        {ingredients.length === 0 ? (
          <Muted>该疾病暂无成分级实体映射，无法按生命周期阶段展开。</Muted>
        ) : (
          <div className="space-y-3">
            {ingredientsTotal > ingredients.length && (
              <p className="text-xs text-slate-400">
                注：共 {ingredientsTotal} 个相关成分，以下按生命周期阶段展开前 {ingredients.length} 个（展示上限）。
              </p>
            )}
            {stageKeys.map((stage) => {
              const names = byStage.get(stage)!
              const shown = names.slice(0, NAME_CAP)
              return (
                <div key={stage}>
                  <p className="flex items-center gap-2 text-sm">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STAGE_STYLE[stage] ?? 'bg-slate-100 text-slate-500')}>
                      {stage === '仿制成熟期' ? '仿制药' : stage}
                    </span>
                    <span className="font-semibold text-slate-800">{names.length} 个</span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {shown.join('、')}
                    {names.length > NAME_CAP && (
                      <span className="text-slate-400"> 等 +{names.length - NAME_CAP} 个</span>
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </Chapter>

      {/* 二、说明书要点摘录 */}
      <Chapter title="二、说明书要点摘录（FDA 标签）">
        {labelPicks.length === 0 ? (
          <Muted>该疾病相关成分暂未生成说明书摘要卡（当前成分级覆盖率约 46%，优先覆盖近年新分子）。</Muted>
        ) : (
          <div className="space-y-3">
            {labelPicks.map(({ ing, card }) => {
              const eff = card.efficacy?.key_results?.[0]
              const bw = card.safety?.boxed_warning
              return (
                <div key={ing} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                  <p className="text-sm font-medium text-slate-800">
                    {ing}
                    <span className="ml-2 text-xs font-normal text-slate-400">{card.drug_name} · {card.application_number}</span>
                  </p>
                  {eff && <p className="mt-0.5 text-xs leading-relaxed text-slate-600">疗效：{eff}</p>}
                  {bw && <p className="mt-0.5 text-xs leading-relaxed text-amber-700">黑框警告：{bw}</p>}
                </div>
              )
            })}
            <p className="text-xs text-slate-400">
              口径：摘自各成分最早原始 NDA/BLA 申请的首批准说明书（Drugs@FDA 标签全文自动提取），仅摘录不构成完整标签。
            </p>
          </div>
        )}
      </Chapter>

      {/* 三、竞争密度 */}
      <Chapter title="三、竞争密度">
        <InsightList items={hhiInsights} />
        {!density ? (
          <Muted>实体关系数据未加载，无法计算竞争密度。</Muted>
        ) : (
          <dl className="divide-y divide-slate-100">
            {[
              ['相关成分总数', `${ingredientsTotal} 个`],
              ['持证企业数', density.companies ? `${density.companies} 家` : '—'],
              ['ANDA 仿制竞争总数', `${density.anda.toLocaleString()} 个`],
              ['短缺风险成分数', density.shortage ? `${density.shortage} 个` : '无'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-4 py-1.5">
                <dt className="w-36 shrink-0 text-xs text-slate-400">{k}</dt>
                <dd className="text-sm text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Chapter>

      {/* 四、全球可及性 */}
      <Chapter title="四、全球可及性（FDA → EMA / PMDA）">
        {!globalStats || globalStats.inScope.length === 0 ? (
          <Muted>
            该疾病成分均不在全球可及性专题范围内（专题口径：2020 年至今 FDA 首次获批的 NDA/BLA 活性成分）。
          </Muted>
        ) : (
          <div className="space-y-2 text-sm text-slate-700">
            <p>
              专题范围内成分 <b>{globalStats.inScope.length}</b> 个：
              EMA 已授权 <b>{globalStats.ema}</b> 个 · PMDA 已获批 <b>{globalStats.pmda}</b> 个。
            </p>
            {globalStats.unmatched.length > 0 && (
              <p className="text-xs text-slate-400">
                EMA 集中审批未检索到：{globalStats.unmatched.slice(0, NAME_CAP).join('、')}
                {globalStats.unmatched.length > NAME_CAP && ` 等 +${globalStats.unmatched.length - NAME_CAP} 个`}
              </p>
            )}
            <p className="text-xs text-slate-400">
              口径：仅覆盖 2020 年至今 FDA 首次获批的 NDA/BLA 成分；匹配按成分名归一（去盐基、USAN→INN、复方排序）。
            </p>
          </div>
        )}
      </Chapter>

      {/* 五、学术证据 */}
      <Chapter title={`五、学术证据（PubMed ${pubmedWindow}）`}>
        {!pubmed ? (
          <Muted>该疾病暂未纳入 PubMed 证据覆盖（当前覆盖 22 个高数据量疾病）。</Muted>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              近三年：临床研究（含 RCT）<b>{pubmed.clinical_count?.toLocaleString() ?? '—'}</b> 篇 ·
              综述 / Meta 分析 <b>{pubmed.review_count?.toLocaleString() ?? '—'}</b> 篇。
            </p>
            {pubmed.recent.length > 0 && (
              <ol className="list-decimal space-y-2 pl-5">
                {pubmed.recent.map((r) => (
                  <li key={r.pmid} className="text-sm leading-snug text-slate-700">
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 hover:underline"
                    >
                      {r.title}
                      <ExternalLink className="mb-0.5 ml-1 inline h-3 w-3 text-slate-300" />
                    </a>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {[r.journal, r.pubdate].filter(Boolean).join(' · ')} · PMID {r.pmid}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Chapter>

      {/* 六、在研管线 */}
      <Chapter title="六、在研管线（ClinicalTrials.gov）">
        {ctFailed || (ct && ct.error) ? (
          <Muted>临床试验查询失败或未覆盖该疾病（查询失败 ≠ 0 项）。</Muted>
        ) : !ct ? (
          <Muted>临床试验数据未加载。</Muted>
        ) : (ct.total ?? 0) === 0 ? (
          <p className="text-sm text-slate-700">ClinicalTrials.gov 中该疾病相关研究确为 <b>0</b> 项（查询已成功返回）。</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              相关研究共 <b>{ct.total!.toLocaleString()}</b> 项（按最近更新排序取前列研究见下）
            </p>
            {ct.by_status && <CtStatusLine byStatus={ct.by_status} />}
            {ct.by_phase && (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">阶段分布</p>
                <CtPhaseBar byPhase={ct.by_phase} />
              </div>
            )}
            {(ct.top?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">最近更新研究（前 5）</p>
                <CtTrialList trials={ct.top!} max={5} />
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">
          口径：ClinicalTrials.gov API v2 全库计量（ConditionSearch 含同义词扩展，计数偏宽）；阶段/状态为分项计数，合计可能小于总数。
        </p>
      </Chapter>

      {/* 七、近期重点新分子 */}
      <Chapter title="七、近期重点新分子（引入期成分）">
        {recentNme.length === 0 ? (
          <Muted>该疾病当前无处于引入期的成分（近年无新分子获批记录）。</Muted>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">成分</th>
                <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">FDA 首获批</th>
                <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">原研公司</th>
              </tr>
            </thead>
            <tbody>
              {recentNme.map(({ ing, rec }) => (
                <tr key={ing} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 text-sm font-medium text-slate-800">{ing}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-sm text-slate-700">{rec!.first_approval}</td>
                  <td className="max-w-48 truncate px-2 py-1.5 text-sm text-slate-600">{rec!.originator ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Chapter>

      {/* 页脚 */}
      <footer className="report-card rounded-lg border border-slate-200 bg-white p-5 text-xs leading-relaxed text-slate-400 shadow-sm">
        <p>
          数据口径与免责声明：本报告基于公开监管数据自动生成（Drugs@FDA 产品及申请数据、EMA 集中审批药品清单、
          PMDA《List of Approved Drugs》2004-2026、PubMed 文献计量 2023-2026、ClinicalTrials.gov 试验索引），
          各数据集生成日期见各源文件；疾病-成分映射与实体匹配按成分名归一自动完成，可能存在少量错配；
          竞争密度中的 ANDA 计数为相关成分之和（同一 ANDA 不跨成分重复计入）。本报告仅供研究参考，不构成医疗建议或投资建议。
        </p>
        <p className="mt-2">由 fda-drug-db 永久免费数据分析平台生成 · 报告生成日期 {todayStr}</p>
      </footer>
    </div>
  )
}
