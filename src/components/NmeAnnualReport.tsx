import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, Loader2, Printer } from 'lucide-react'
import EChart from '@/components/EChart'
import { loadNmeAnnual, type NmeAnnual, type NmeIngredient } from '@/lib/data'
import { cn } from '@/lib/utils'


const TYPE_COLORS: Record<string, string> = {
  小分子: '#3b82f6',
  单克隆抗体: '#8b5cf6',
  '抗体偶联药物（ADC）': '#ec4899',
  核酸类: '#14b8a6',
  多肽: '#f59e0b',
  融合蛋白: '#f97316',
  酶: '#84cc16',
  疫苗: '#06b6d4',
  '细胞/基因疗法': '#e11d48',
  其他生物药: '#94a3b8',
}

type SortKey = 'ing' | 'date' | 'company' | 'type'

function Chapter({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="report-chapter mb-3 border-b border-slate-100 pb-2 text-base font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

export default function NmeAnnualReport({ onBack, onSelectIngredient }: {
  onBack: () => void
  /** 点击成分名 → 跳转生命周期页 */
  onSelectIngredient: (ing: string) => void
}) {
  const [data, setData] = useState<NmeAnnual | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickedYear, setPickedYear] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    loadNmeAnnual().then(setData).catch((e: Error) => setError(e.message))
  }, [])

  const years = useMemo(() => (data ? Object.keys(data.years).sort() : []), [data])
  // 默认年度：最新有官方计数的年份；用户点选后以其为准
  const defaultYear = useMemo(() => {
    if (!data) return null
    const officialYears = Object.keys(data.years).filter((y) => data.years[y].official_count != null).sort()
    return officialYears.length > 0 ? officialYears[officialYears.length - 1] : years[years.length - 1] ?? null
  }, [data, years])
  const year = pickedYear ?? defaultYear ?? '2025'
  const yd = data?.years[year] ?? null

  const sortedIngredients = useMemo(() => {
    if (!yd) return []
    const arr = [...yd.ingredients]
    arr.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortAsc ? cmp : -cmp
    })
    return arr
  }, [yd, sortKey, sortAsc])

  if (error) {
    return <div className="py-16 text-center text-sm text-red-500">报告数据加载失败：{error}</div>
  }
  if (!data || !yd) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <p className="text-sm">正在生成报告…</p>
      </div>
    )
  }

  const todayStr = data.generated_at || new Date().toISOString().slice(0, 10)
  const smallPct = yd.total ? Math.round(((yd.type_dist['小分子'] ?? 0) / yd.total) * 100) : 0
  const g = yd.global

  const monthlyOption = {
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    xAxis: { type: 'category' as const, data: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'] },
    yAxis: { type: 'value' as const, minInterval: 1 },
    tooltip: { trigger: 'axis' as const },
    series: [{ type: 'bar' as const, data: yd.monthly, itemStyle: { color: '#3b82f6', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 28 }],
  }

  const typeEntries = Object.entries(yd.type_dist)
  const donutOption = {
    tooltip: { trigger: 'item' as const, formatter: '{b}: {c} 个（{d}%）' },
    legend: { orient: 'vertical' as const, right: 0, top: 'middle', textStyle: { fontSize: 11 } },
    series: [{
      type: 'pie' as const,
      radius: ['45%', '72%'],
      center: ['38%', '50%'],
      label: { show: false },
      data: typeEntries.map(([name, value]) => ({
        name, value, itemStyle: { color: TYPE_COLORS[name] ?? '#94a3b8' },
      })),
    }],
  }

  const areaOption = {
    grid: { left: 90, right: 30, top: 8, bottom: 24 },
    xAxis: { type: 'value' as const, minInterval: 1 },
    yAxis: { type: 'category' as const, data: yd.top_areas.map(([a]) => a).reverse() },
    tooltip: { trigger: 'axis' as const },
    series: [{ type: 'bar' as const, data: yd.top_areas.map(([, n]) => n).reverse(), itemStyle: { color: '#8b5cf6', borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18 }],
  }

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc(!sortAsc)
    else { setSortKey(k); setSortAsc(true) }
  }

  const renderSortTh = (k: SortKey, label: string) => (
    <th
      key={k}
      onClick={() => toggleSort(k)}
      className="cursor-pointer select-none px-2 py-1.5 text-left text-xs font-medium text-slate-500 hover:text-slate-800"
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortKey === k && (sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  )

  return (
    <div className="report-doc mx-auto max-w-[800px] space-y-5">
      {/* 操作条（打印隐藏） */}
      <div className="no-print flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
          返回报告中心
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
        <p className="text-xs tracking-wide text-slate-400">fda-drug-db · 报告中心 · 报告 C（永久免费）</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">《{year} 年度新分子实体（NME）全景报告》</h1>
        <p className="mt-1 text-sm text-slate-500">年度 FDA 新分子实体的一站式回顾与全球同步分析</p>
        {/* 年度切换（打印隐藏） */}
        <div className="no-print mt-4 flex flex-wrap gap-1.5">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setPickedYear(y)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium',
                y === year
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600',
              )}
            >
              {y}{y === '2026' ? ' YTD' : ''}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
          <span>生成日期：{todayStr}</span>
          <span>口径：{data.scope}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          方法论：标题数字采用 FDA CDER 官方年度名单（Novel Drug Approvals，CDER 口径不含 CBER），
          名单检索于 {data.official_retrieved_at}；
          平台另按「首次 NDA/BLA ≥ 2020」推导补充成分（清单中标注「补充推断」）。
          官方汇编页：
          <a href={data.official_source_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
            Compilation of CDER NME and New Biologic Approvals
          </a>
        </p>
      </section>

      {/* 概要磁贴 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: '年度 NME 总数',
            value: `${yd.official_count ?? yd.total} 个`,
            note: yd.official_count != null
              ? `FDA 官方口径${yd.derived_extra > 0 ? ` · 平台补充推断 +${yd.derived_extra}` : ''}`
              : `平台推导 ${yd.total} 个（FDA 官方名单未发布）`,
          },
          { label: '小分子占比', value: `${smallPct}%`, note: `${yd.type_dist['小分子'] ?? 0} / ${yd.total} 个` },
          {
            label: '全球可及（EMA / PMDA）',
            value: `${g.ema_pct ?? '—'}% / ${g.pmda_pct ?? '—'}%`,
            note: `中位时滞 EMA ${g.ema_median_lag != null ? `+${g.ema_median_lag}` : '—'} 月 · PMDA ${g.pmda_median_lag != null ? `+${g.pmda_median_lag}` : '—'} 月`,
          },
        ].map((t) => (
          <section key={t.label} className="report-card rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-400">{t.label}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{t.value}</p>
            <p className="mt-0.5 text-xs text-slate-400">{t.note}</p>
          </section>
        ))}
      </div>

      {/* 一、审批节奏 */}
      <Chapter title={`一、审批节奏（${year} 年逐月 NME 获批数）`}>
        <EChart option={monthlyOption} height={220} />
      </Chapter>

      {/* 二、分子类型分布 */}
      <Chapter title="二、分子类型分布">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="md:w-3/5">
            <EChart option={donutOption} height={240} />
          </div>
          <table className="w-full border-collapse md:w-2/5">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">类型</th>
                <th className="px-2 py-1.5 text-right text-xs font-medium text-slate-500">数量</th>
                <th className="px-2 py-1.5 text-right text-xs font-medium text-slate-500">占比</th>
              </tr>
            </thead>
            <tbody>
              {typeEntries.map(([name, n]) => (
                <tr key={name} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 text-sm text-slate-700">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TYPE_COLORS[name] ?? '#94a3b8' }} />
                    {name}
                  </td>
                  <td className="px-2 py-1.5 text-right text-sm text-slate-700">{n}</td>
                  <td className="px-2 py-1.5 text-right text-sm text-slate-500">{yd.total ? Math.round((n / yd.total) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Chapter>

      {/* 三、治疗领域 */}
      <Chapter title="三、治疗领域（按疾病领域归集，Top 8）">
        {yd.top_areas.length === 0 ? (
          <p className="text-sm text-slate-400">该年度成分暂无疾病领域映射。</p>
        ) : (
          <EChart option={areaOption} height={Math.max(160, yd.top_areas.length * 34)} />
        )}
        <p className="mt-1 text-xs text-slate-400">注：一个成分可对应多个疾病领域，各领域计数为该领域覆盖的 NME 数。</p>
      </Chapter>

      {/* 四、企业归属 */}
      <Chapter title="四、企业归属（首次获批申请持证方 Top 5）">
        <ol className="space-y-1.5">
          {yd.top_companies.map(([name, n], i) => (
            <li key={name} className="flex items-center gap-3 text-sm">
              <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-300">{i + 1}</span>
              <span className="flex-1 truncate text-slate-700">{name}</span>
              <span className="text-slate-500">{n} 个</span>
            </li>
          ))}
        </ol>
      </Chapter>

      {/* 五、全球同步率 */}
      <Chapter title="五、全球同步率（FDA → EMA / PMDA）">
        <div className="grid grid-cols-2 gap-3">
          {[
            { flag: '🇪🇺', name: 'EMA', pct: g.ema_pct, lag: g.ema_median_lag, n: g.ema_n },
            { flag: '🇯🇵', name: 'PMDA', pct: g.pmda_pct, lag: g.pmda_median_lag, n: g.pmda_n },
          ].map((r) => (
            <div key={r.name} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">{r.flag} {r.name}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{r.pct ?? '—'}%</p>
              <p className="mt-1 text-xs text-slate-400">
                已可及 · 中位时滞 {r.lag != null ? `${r.lag >= 0 ? '+' : ''}${r.lag} 个月` : '—'}（n={r.n}）
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          口径：{year} 年 {yd.total} 个 NME 中 {g.n_with_data} 个纳入全球可及性专题匹配（成分名归一：去盐基、USAN→INN、复方排序）；
          时滞为其他地区首获批日期相对 FDA 首获批的整月数，负值 = 先于 FDA。
        </p>
      </Chapter>

      {/* 六、完整清单 */}
      <Chapter title={`六、完整清单（官方 ${yd.official_count ?? '—'} 个 + 补充推断 ${yd.derived_extra} 个，点击成分查看生命周期档案）`}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              {renderSortTh('ing', '成分')}
              {renderSortTh('date', '获批日')}
              {renderSortTh('company', '企业')}
              {renderSortTh('type', '类型')}
              <th className="px-2 py-1.5 text-left text-xs font-medium text-slate-500">疾病</th>
            </tr>
          </thead>
          <tbody>
            {sortedIngredients.map((it: NmeIngredient) => (
              <tr key={`${it.ing}-${it.date}`} className={cn('border-b border-slate-100', it.stub && 'opacity-60')}>
                <td className="px-2 py-1.5 text-sm">
                  {it.stub ? (
                    <span className="font-medium text-slate-700">
                      {it.official_name ?? it.ing}
                      <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">仅官方名单</span>
                    </span>
                  ) : (
                    <button
                      onClick={() => onSelectIngredient(it.ing)}
                      className="text-left font-medium text-blue-600 hover:underline"
                    >
                      {it.ing}
                    </button>
                  )}
                  {it.source === 'derived' && (
                    <span className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-600">补充推断</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-sm text-slate-700">{it.date || '—'}</td>
                <td className="max-w-40 truncate px-2 py-1.5 text-sm text-slate-600">{it.company}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-sm text-slate-600">{it.type}</td>
                <td className="max-w-48 truncate px-2 py-1.5 text-xs text-slate-500">
                  {it.diseases.length ? it.diseases.join('、') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-400">
          「补充推断」为平台按首次 NDA/BLA 推导、但未列入 FDA CDER 官方年度名单的成分（可能为复方新组合、
          盐型差异或 CDER/CBER 口径差异）；「仅官方名单」为官方名单中本地暂无结构化推导记录的条目。
        </p>
      </Chapter>

      {/* 页脚 */}
      <footer className="report-card rounded-lg border border-slate-200 bg-white p-5 text-xs leading-relaxed text-slate-400 shadow-sm">
        <p>
          数据口径与免责声明：本报告基于公开监管数据自动生成（Drugs@FDA 产品及申请数据、EMA 集中审批药品清单、
          PMDA《List of Approved Drugs》2004-2026、内部疾病/企业实体映射），各数据集生成日期见各源文件。
          NME 标题数字采用 FDA CDER 官方年度名单（Novel Drug Approvals，CDER 口径不含 CBER 审批的疫苗/血液/细胞基因疗法），
          检索于 {data.official_retrieved_at}；清单中「补充推断」为平台按首次 FDA 原始 NDA/BLA ≥ 2020-01-01 推导的补充成分
          （不同盐型/水合物归并为同一实体，生物制品四字母后缀名归一至主名，不含 ANDA）；分子类型为规则法自动分类（按 INN 词干与申请类型），可能存在少量误判；
          企业归属取首次获批申请的持证方，可能与最终商业化主体不同。本报告仅供研究参考，不构成医疗建议或投资建议。
        </p>
        <p className="mt-2">由 fda-drug-db 永久免费数据分析平台生成 · 报告生成日期 {todayStr}</p>
      </footer>
    </div>
  )
}
