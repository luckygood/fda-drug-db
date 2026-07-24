import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Loader2, Printer } from 'lucide-react'
import {
  loadLifecycleIndex, loadEntityMap, loadGlobalAccess, loadCnAccess,
  loadReportMetrics, loadLabelSafety, loadDiseaseIndex,
  type LifecycleRecord, type EntityMap, type GlobalAccess, type CnAccess,
  type ReportMetrics, type LabelSafetyIndex, type CompanyDetail,
} from '@/lib/data'
import { cn } from '@/lib/utils'

const STAGE_ORDER = ['引入期', '成长期', '成熟期', '衰退期', '仿制成熟期']
const STAGE_STYLE: Record<string, string> = {
  引入期: 'bg-blue-100 text-blue-700',
  成长期: 'bg-emerald-100 text-emerald-700',
  成熟期: 'bg-violet-100 text-violet-700',
  衰退期: 'bg-amber-100 text-amber-700',
  仿制成熟期: 'bg-slate-200 text-slate-600',
}
const TABLE_CAP = 25
const US_ONLY_CAP = 8

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

const thCls = 'px-2 py-1.5 text-left text-xs font-medium text-slate-500'
const tdCls = 'px-2 py-1.5 text-sm text-slate-700'

export default function CompanyReport({ detail, onBack, onSelectIngredient }: {
  detail: CompanyDetail
  onBack: () => void
  onSelectIngredient?: (ingredient: string) => void
}) {
  const [lifecycle, setLifecycle] = useState<Record<string, LifecycleRecord> | null>(null)
  const [entityMap, setEntityMap] = useState<EntityMap | null>(null)
  const [globalAccess, setGlobalAccess] = useState<GlobalAccess | null>(null)
  const [cnAccess, setCnAccess] = useState<CnAccess | null>(null)
  const [metrics, setMetrics] = useState<ReportMetrics | null>(null)
  const [safety, setSafety] = useState<LabelSafetyIndex | null>(null)
  const [diseaseNames, setDiseaseNames] = useState<Record<string, string>>({})
  const [generatedAt, setGeneratedAt] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      loadLifecycleIndex().then((d) => { setLifecycle(d.records); setGeneratedAt(d.generated_at) }).catch(() => setLifecycle(null)),
      loadEntityMap().then(setEntityMap).catch(() => setEntityMap(null)),
      loadGlobalAccess().then(setGlobalAccess).catch(() => setGlobalAccess(null)),
      loadCnAccess().then(setCnAccess).catch(() => setCnAccess(null)),
      loadReportMetrics().then(setMetrics).catch(() => setMetrics(null)),
      loadLabelSafety().then(setSafety).catch(() => setSafety(null)),
      loadDiseaseIndex()
        .then((d) => setDiseaseNames(Object.fromEntries(d.diseases.map((x) => [x.slug, x.name_zh]))))
        .catch(() => setDiseaseNames({})),
    ]).finally(() => setLoading(false))
  }, [detail.slug])

  // 成分清单（实体关系层：含原研 + ANDA 持证两种角色）
  const companyLinks = entityMap?.companies[detail.slug]
  const ingredients = useMemo(() => companyLinks?.ingredients ?? [], [companyLinks])
  const ingredientsTotal = companyLinks?.ingredients_total ?? ingredients.length

  // 角色判定：生命周期档案中的原研公司命中本企业名称变体 → 原研，否则 → 仿制持证
  const variantSet = useMemo(
    () => new Set([detail.name, ...detail.variants].map((v) => v.toUpperCase())),
    [detail],
  )
  const rows = useMemo(() => ingredients.map((ing) => {
    const rec = lifecycle?.[ing] ?? null
    const isOriginator = !!(rec?.originator && variantSet.has(rec.originator.toUpperCase()))
    return {
      ing,
      rec,
      role: isOriginator ? '原研' : '仿制',
      molType: metrics?.ingredients[ing]?.mol_type ?? null,
      bw: !!safety?.ingredients[ing]?.boxed_warning,
    }
  }), [ingredients, lifecycle, variantSet, metrics, safety])

  // 一、概要
  const overview = useMemo(() => {
    const nOrig = rows.filter((r) => r.role === '原研').length
    const nGeneric = rows.length - nOrig
    const dates = rows.map((r) => r.rec?.first_approval).filter((d): d is string => !!d).sort()
    const stageCounts = new Map<string, number>()
    let nBw = 0
    let nShortage = 0
    let nNoRec = 0
    for (const r of rows) {
      if (!r.rec) { nNoRec += 1; continue }
      stageCounts.set(r.rec.stage, (stageCounts.get(r.rec.stage) ?? 0) + 1)
      if (r.bw) nBw += 1
      if (r.rec.shortage_risk) nShortage += 1
    }
    const maxStage = Math.max(1, ...stageCounts.values())
    return {
      nOrig, nGeneric, nBw, nShortage, nNoRec, stageCounts, maxStage,
      span: dates.length ? { first: dates[0], latest: dates[dates.length - 1] } : null,
    }
  }, [rows])

  // 二、管线成分表（原研优先，其余按首获批倒序）
  const tableRows = useMemo(() => [...rows].sort((a, b) =>
    (a.role === b.role ? 0 : a.role === '原研' ? -1 : 1) ||
    (b.rec?.first_approval ?? '').localeCompare(a.rec?.first_approval ?? '') ||
    a.ing.localeCompare(b.ing),
  ), [rows])

  // 三、治疗领域分布（成分 → 疾病反向并集）
  const diseaseDist = useMemo(() => {
    if (!entityMap) return []
    const counts = new Map<string, number>()
    for (const ing of ingredients) {
      for (const slug of entityMap.ingredients[ing]?.diseases ?? []) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([slug, n]) => ({ slug, name: diseaseNames[slug] ?? slug, n }))
  }, [entityMap, ingredients, diseaseNames])

  // 四、全球可及（2020+ NME 专题范围内成分）
  const globalStats = useMemo(() => {
    if (!globalAccess) return null
    let ema = 0, pmda = 0, cn = 0
    const inScope: string[] = []
    const usOnly: string[] = []
    for (const ing of ingredients) {
      const g = globalAccess.records[ing]
      if (!g) continue
      inScope.push(ing)
      const emaOk = g.ema_status === 'authorised'
      const pmdaOk = g.pmda_status === 'approved'
      const cnOk = cnAccess?.records[ing]?.cn_status === 'approved'
      if (emaOk) ema += 1
      if (pmdaOk) pmda += 1
      if (cnOk) cn += 1
      if (!emaOk && !pmdaOk && !cnOk) usOnly.push(ing)
    }
    return { ema, pmda, cn, inScope, usOnly }
  }, [globalAccess, cnAccess, ingredients])

  // 五、竞争位置
  const competition = useMemo(() => {
    const origTop = rows
      .filter((r) => r.role === '原研' && r.rec)
      .sort((a, b) => (b.rec!.n_anda_companies - a.rec!.n_anda_companies) ||
        (a.rec!.months_to_expiry ?? 9999) - (b.rec!.months_to_expiry ?? 9999))
      .slice(0, 5)
    const nGeneric = rows.filter((r) => r.role === '仿制').length
    return { origTop, nGeneric }
  }, [rows])

  // 六、近期动态：近 24 个月首获批的引入期成分（以数据生成日为锚）
  const recent = useMemo(() => {
    const anchor = generatedAt || new Date().toISOString().slice(0, 10)
    const d = new Date(anchor)
    d.setMonth(d.getMonth() - 24)
    const cutoff = d.toISOString().slice(0, 10)
    return rows
      .filter((r) => r.rec?.first_approval && r.rec.first_approval >= cutoff)
      .sort((a, b) => (b.rec!.first_approval ?? '').localeCompare(a.rec!.first_approval ?? ''))
  }, [rows, generatedAt])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <p className="text-sm">正在生成报告…</p>
      </div>
    )
  }

  const todayStr = generatedAt || new Date().toISOString().slice(0, 10)

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
        <p className="text-xs tracking-wide text-slate-400">fda-drug-db · 报告中心 · 报告 D（永久免费）</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">《{detail.name_zh ?? detail.name} 管线画像报告》</h1>
        <p className="mt-1 text-sm text-slate-500">
          {detail.name_zh ? `${detail.name} · ` : ''}企业管线画像实体报告
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
          <span>生成日期：{todayStr}</span>
          <span>数据来源：Drugs@FDA · EMA 集中审批 · PMDA 新药清单 · 公开文献 NMPA 盘点 · openFDA 标签</span>
        </div>
      </section>

      {/* 一、概要 */}
      <Chapter title={`一、管线概要（${ingredientsTotal} 个成分）`}>
        {rows.length === 0 ? (
          <Muted>该企业在实体关系层暂无成分级映射，无法展开管线画像。</Muted>
        ) : (
          <div className="space-y-3">
            {ingredientsTotal > ingredients.length && (
              <p className="text-xs text-slate-400">
                注：共 {ingredientsTotal} 个成分，本报告基于展示截断的前 {ingredients.length} 个（实体关系层上限）。
              </p>
            )}
            <dl className="divide-y divide-slate-100">
              {[
                ['成分总数（原研 / 仿制持证）', `${rows.length} 个（原研 ${overview.nOrig} · 仿制 ${overview.nGeneric}）`],
                ['FDA 首获批跨度', overview.span ? `${overview.span.first} → ${overview.span.latest}` : '—'],
                ['黑框警告成分数', overview.nBw ? `${overview.nBw} 个` : '无'],
                ['短缺风险成分数', overview.nShortage ? `${overview.nShortage} 个` : '无'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-4 py-1.5">
                  <dt className="w-48 shrink-0 text-xs text-slate-400">{k}</dt>
                  <dd className="text-sm text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
            {/* 阶段分布 mini-bar */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-500">生命周期阶段分布</p>
              {overview.stageCounts.size === 0 ? (
                <Muted>成分均未建立生命周期档案（可能均为窗口外老药）。</Muted>
              ) : (
                <div className="space-y-1.5">
                  {STAGE_ORDER.filter((s) => overview.stageCounts.has(s)).map((stage) => {
                    const n = overview.stageCounts.get(stage)!
                    return (
                      <div key={stage} className="flex items-center gap-2">
                        <span className={cn('w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium', STAGE_STYLE[stage])}>
                          {stage === '仿制成熟期' ? '仿制药' : stage}
                        </span>
                        <div className="h-2 flex-1 rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-blue-400"
                            style={{ width: `${Math.round((n / overview.maxStage) * 100)}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs text-slate-600">{n} 个</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Chapter>

      {/* 二、管线成分表 */}
      <Chapter title={`二、管线成分表（前 ${Math.min(TABLE_CAP, tableRows.length)} / ${tableRows.length} 个）`}>
        {tableRows.length === 0 ? (
          <Muted>无成分数据。</Muted>
        ) : (
          <>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={thCls}>成分</th>
                  <th className={thCls}>角色</th>
                  <th className={thCls}>阶段</th>
                  <th className={thCls}>首获批</th>
                  <th className={thCls}>ANDA 竞争</th>
                  <th className={thCls}>分子类型</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.slice(0, TABLE_CAP).map((r) => (
                  <tr
                    key={r.ing}
                    onClick={() => onSelectIngredient?.(r.ing)}
                    className="cursor-pointer border-b border-slate-100 hover:bg-blue-50/50"
                    title="点击查看成分透视"
                  >
                    <td className={`${tdCls} max-w-52 truncate font-medium text-blue-700`}>{r.ing}</td>
                    <td className={tdCls}>
                      <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium',
                        r.role === '原研' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600')}>
                        {r.role}
                      </span>
                    </td>
                    <td className={tdCls}>
                      {r.rec ? (
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STAGE_STYLE[r.rec.stage] ?? 'bg-slate-100 text-slate-500')}>
                          {r.rec.stage === '仿制成熟期' ? '仿制药' : r.rec.stage}
                        </span>
                      ) : '—'}
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>{r.rec?.first_approval ?? '—'}</td>
                    <td className={tdCls}>{r.rec ? `${r.rec.n_anda_companies} 家` : '—'}</td>
                    <td className={tdCls}>{r.molType ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tableRows.length > TABLE_CAP && (
              <p className="mt-2 text-xs text-slate-400">其余 +{tableRows.length - TABLE_CAP} 个成分未列出（展示上限）。</p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              口径：角色按生命周期档案原研公司与本企业名称变体匹配判定（原研 / 仿制持证）；分子类型为规则推断（小分子 / 单抗等生物制品）。
            </p>
          </>
        )}
      </Chapter>

      {/* 三、治疗领域分布 */}
      <Chapter title="三、治疗领域分布（前 8）">
        {diseaseDist.length === 0 ? (
          <Muted>该企业成分未命中疾病视角 102 病种矩阵，无法展开治疗领域。</Muted>
        ) : (
          <div className="flex flex-wrap gap-2">
            {diseaseDist.map((d) => (
              <span key={d.slug} className="rounded-full border border-teal-200 bg-teal-50/60 px-3 py-1.5 text-xs text-teal-800">
                {d.name}
                <span className="ml-1 font-semibold">{d.n}</span>
              </span>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">口径：成分 → 疾病反向并集计数（同一成分可命中多个病种）。</p>
      </Chapter>

      {/* 四、全球可及 */}
      <Chapter title="四、全球可及（FDA → EMA / PMDA / NMPA）">
        {!globalStats || globalStats.inScope.length === 0 ? (
          <Muted>
            该企业成分均不在全球可及性专题范围内（专题口径：2020 年至今 FDA 首次获批的 NDA/BLA 活性成分）。
          </Muted>
        ) : (
          <div className="space-y-2 text-sm text-slate-700">
            <p>
              专题范围内成分 <b>{globalStats.inScope.length}</b> 个：
              EMA 已授权 <b>{globalStats.ema}</b> 个 · PMDA 已获批 <b>{globalStats.pmda}</b> 个 ·
              NMPA 公开来源确认 <b>{globalStats.cn}</b> 个。
            </p>
            {globalStats.usOnly.length > 0 && (
              <p className="text-xs text-slate-500">
                目前仅在美国获批（出海 / license 参考）：{globalStats.usOnly.slice(0, US_ONLY_CAP).join('、')}
                {globalStats.usOnly.length > US_ONLY_CAP && ` 等 +${globalStats.usOnly.length - US_ONLY_CAP} 个`}
              </p>
            )}
            <p className="text-xs text-slate-400">
              口径：EMA 集中审批与 PMDA 新药清单按成分名归一匹配；NMPA 为公开文献正向确认（未确认 ≠ 未批，需人工核实）。
            </p>
          </div>
        )}
      </Chapter>

      {/* 五、竞争位置 */}
      <Chapter title="五、竞争位置">
        {rows.length === 0 ? (
          <Muted>无成分数据。</Muted>
        ) : (
          <div className="space-y-3">
            {competition.origTop.length === 0 ? (
              <Muted>该企业在本数据集中无原研角色成分（以仿制持证为主），不展开仿制竞争承压分析。</Muted>
            ) : (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">原研成分 · 仿制竞争承压前 {competition.origTop.length} 名</p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={thCls}>成分</th>
                      <th className={thCls}>仿制厂家</th>
                      <th className={thCls}>专利剩余</th>
                    </tr>
                  </thead>
                  <tbody>
                    {competition.origTop.map((r) => (
                      <tr
                        key={r.ing}
                        onClick={() => onSelectIngredient?.(r.ing)}
                        className="cursor-pointer border-b border-slate-100 hover:bg-blue-50/50"
                      >
                        <td className={`${tdCls} max-w-52 truncate font-medium text-blue-700`}>{r.ing}</td>
                        <td className={tdCls}>{r.rec!.n_anda_companies} 家</td>
                        <td className={tdCls}>
                          {r.rec!.months_to_expiry == null ? '—'
                            : r.rec!.months_to_expiry < 0 ? '已过期'
                            : `${r.rec!.months_to_expiry} 个月`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-400">
              仿制持证角色成分 {competition.nGeneric} 个：该企业以 ANDA 持证参与这些成分的仿制竞争（竞争强度见各成分透视页）。
            </p>
          </div>
        )}
      </Chapter>

      {/* 六、近期动态 */}
      <Chapter title="六、近期动态（近 24 个月首获批成分）">
        {recent.length === 0 ? (
          <Muted>近 24 个月（以数据生成日 {todayStr} 为锚）无首获批成分记录。</Muted>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={thCls}>成分</th>
                <th className={thCls}>FDA 首获批</th>
                <th className={thCls}>角色</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr
                  key={r.ing}
                  onClick={() => onSelectIngredient?.(r.ing)}
                  className="cursor-pointer border-b border-slate-100 hover:bg-blue-50/50"
                >
                  <td className={`${tdCls} font-medium text-blue-700`}>{r.ing}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>{r.rec!.first_approval}</td>
                  <td className={tdCls}>{r.role}</td>
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
          PMDA《List of Approved Drugs》、openFDA 说明书全文、公开文献 NMPA 批准盘点），各数据集生成日期见各源文件；
          企业-成分映射来自实体关系层（含原研与 ANDA 持证两种角色，展示截断 ≤50 个成分），角色判定按企业名称变体自动匹配，可能存在少量错配；
          NMPA 状态为公开文献正向确认，未确认不等于未在中国获批。本报告仅供研究参考，不构成医疗建议或投资建议。
        </p>
        <p className="mt-2">由 fda-drug-db 永久免费数据分析平台生成 · 报告生成日期 {todayStr}</p>
      </footer>
    </div>
  )
}
