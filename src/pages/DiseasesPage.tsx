import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { Search, Loader2, Stethoscope, ChevronDown, ChevronUp, AlertTriangle, FileText } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import EChart from '@/components/EChart'
import DiseasePubMedPanel from '@/components/DiseasePubMedPanel'
import DiseaseReport from '@/components/DiseaseReport'
import DrugSummaryCards from '@/components/DrugSummaryCards'
import { StatusBadge, TypeBadge } from '@/components/StatusBadge'
import {
  loadDisease,
  loadDiseaseIndex,
  loadSponsorMap,
  loadEntityMap,
  resolveCompanySlug,
  type DiseaseDetail,
  type DiseaseIndexEntry,
  type EntityMap,
} from '@/lib/data'

interface DiseasesPageProps {
  onSelectDrug: (applicationNumber: string) => void
  /** 跨页传入的疾病 slug（全局搜索 / 企业画像疾病 chips），待本页消费 */
  pendingDisease?: string | null
  onConsumePending?: () => void
  /** 点击药物行持证商跳转企业画像 */
  onSelectCompany?: (slug: string) => void
  /** 点击成分 chip 跳转生命周期页 */
  onSelectIngredient?: (ingredient: string) => void
}

export default function DiseasesPage({ onSelectDrug, pendingDisease, onConsumePending, onSelectCompany, onSelectIngredient }: DiseasesPageProps) {
  const [index, setIndex] = useState<DiseaseIndexEntry[] | null>(null)
  const [areas, setAreas] = useState<string[]>([])
  const [indexError, setIndexError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selected, setSelected] = useState<DiseaseIndexEntry | null>(null)
  const [reportMode, setReportMode] = useState(false)
  const [detail, setDetail] = useState<DiseaseDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sponsorMap, setSponsorMap] = useState<Record<string, string> | null>(null)
  const [entityMap, setEntityMap] = useState<EntityMap | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadSponsorMap()
      .then(setSponsorMap)
      .catch(() => setSponsorMap(null))
    loadEntityMap()
      .then(setEntityMap)
      .catch(() => setEntityMap(null))
  }, [])

  useEffect(() => {
    loadDiseaseIndex()
      .then((d) => {
        setIndex(d.diseases)
        setAreas(d.areas)
      })
      .catch((e: Error) => setIndexError(e.message))
  }, [])

  // 点击组件外部时收起下拉
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const filtered = useMemo(() => {
    if (!index) return []
    const q = query.trim().toLowerCase()
    if (!q) return []
    return index
      .filter(
        (d) =>
          d.name_zh.includes(query.trim()) ||
          d.name_en.toLowerCase().includes(q) ||
          d.slug.includes(q),
      )
      .slice(0, 12)
  }, [index, query])

  const selectDisease = (entry: DiseaseIndexEntry) => {
    setSelected(entry)
    setQuery('')
    setShowDropdown(false)
    setDetail(null)
    setExpanded(new Set())
    setReportMode(false) // 切换疾病时自动退出报告视图
    setDetailLoading(true)
    loadDisease(entry.slug)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false))
  }

  // 消费跨页传来的疾病选择（需等疾病索引加载完成，按 slug 定位）
  useEffect(() => {
    if (pendingDisease && index) {
      const entry = index.find((d) => d.slug === pendingDisease)
      if (entry) selectDisease(entry)
      onConsumePending?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDisease, index])

  const timelineOption = useMemo((): EChartsOption | null => {
    if (!detail) return null
    const years = Object.keys(detail.approvals_by_year).sort()
    return {
      color: ['#2563eb'],
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 30, bottom: 30 },
      xAxis: {
        type: 'category', data: years,
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#475569' },
      },
      yAxis: {
        type: 'value', name: '获批数',
        axisLabel: { color: '#475569' },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      series: [{
        type: 'bar',
        data: years.map((y) => detail.approvals_by_year[y]),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 28,
      }],
    }
  }, [detail])

  const yearSpan = useMemo(() => {
    if (!detail) return ''
    const years = Object.keys(detail.approvals_by_year).sort()
    if (years.length === 0) return '—'
    return `${years[0]}–${years[years.length - 1]}`
  }, [detail])

  const toggleExpand = (appno: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(appno)) next.delete(appno)
      else next.add(appno)
      return next
    })
  }

  if (indexError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-600">疾病索引加载失败：{indexError}</p>
      </div>
    )
  }

  if (!index) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p>正在加载疾病词表…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 疾病搜索 */}
      <div ref={searchRef} className="relative mx-auto max-w-2xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShowDropdown(true)
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder="搜索疾病：中文名或英文名，如 肺癌 / breast cancer / diabetes…"
            className="h-12 pl-10 text-base"
          />
        </div>
        {showDropdown && filtered.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {filtered.map((d) => (
              <button
                key={d.slug}
                onClick={() => selectDisease(d)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-blue-50"
              >
                <span>
                  <span className="font-medium text-slate-800">{d.name_zh}</span>
                  <span className="ml-2 text-sm text-slate-400">{d.name_en}</span>
                </span>
                <span className="text-xs text-slate-400">{d.drug_count} 药</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 治疗领域浏览 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-slate-600">
          <Stethoscope className="h-4 w-4 text-blue-600" />
          按治疗领域浏览（{index.length} 个疾病）
        </p>
        <div className="space-y-3">
          {areas.map((area) => (
            <div key={area} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 w-20 shrink-0 text-xs font-semibold text-slate-400">
                {area}
              </span>
              {index
                .filter((d) => d.area === area)
                .map((d) => (
                  <button
                    key={d.slug}
                    onClick={() => selectDisease(d)}
                    className={
                      selected?.slug === d.slug
                        ? 'rounded-full border border-blue-600 bg-blue-600 px-3 py-1 text-xs font-medium text-white'
                        : 'rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
                    }
                  >
                    {d.name_zh}
                    <span className="ml-1 opacity-60">{d.drug_count}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>

      {/* 疾病详情 */}
      {detailLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          正在加载 {selected?.name_zh} 药物数据…
        </div>
      )}

      {/* 报告视图（报告 A：疾病治疗格局报告） */}
      {!detailLoading && detail && selected && reportMode && (
        <DiseaseReport entry={selected} onBack={() => setReportMode(false)} />
      )}

      {!detailLoading && detail && selected && !reportMode && (
        <>
          {/* 摘要卡片 */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold text-slate-900">
                {detail.name_zh}
                <span className="ml-2 text-base font-normal text-slate-400">{detail.name_en}</span>
              </h2>
              <button
                onClick={() => setReportMode(true)}
                className="no-print flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                <FileText className="h-4 w-4" />
                报告视图
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm text-slate-400">药物总数</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{detail.drugs.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm text-slate-400">最新获批</p>
                  <p className="mt-1 truncate text-xl font-bold text-slate-900">
                    {selected.newest_drug || '—'}
                  </p>
                  <p className="text-xs text-slate-400">{selected.newest_approval || ''}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm text-slate-400">黑框警告药物</p>
                  <p className="mt-1 text-3xl font-bold text-red-600">{selected.boxed_count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm text-slate-400">获批年代跨度</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{yearSpan}</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* 获批时间线 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">获批时间线（1995 至今）</CardTitle>
            </CardHeader>
            <CardContent>{timelineOption && <EChart option={timelineOption} height={260} />}</CardContent>
          </Card>

          {/* 相关成分 / 在研管线（实体关系层） */}
          {(() => {
            const links = entityMap?.diseases[selected.slug]
            if (!links || (links.ingredients.length === 0 && links.trial_count === 0 && links.trials_coverage !== 'not_covered')) return null
            const ingsTotal = links.ingredients_total ?? links.ingredients.length
            const truncated = ingsTotal > links.ingredients.length
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">相关成分 / 在研管线</CardTitle>
                  {links.trials_coverage === 'not_covered' ? (
                    <p className="text-xs text-slate-400">该疾病暂未接入临床试验索引（试验数据未覆盖，不代表无在研试验）</p>
                  ) : links.trial_count > 0 ? (
                    <p className="text-xs text-slate-400">关联临床试验 {links.trial_count} 项（ClinicalTrials.gov）</p>
                  ) : (
                    <p className="text-xs text-slate-400">临床试验索引中该疾病确为 0 项（ClinicalTrials.gov 已覆盖）</p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {links.ingredients.map((ing) => (
                      <button
                        key={ing}
                        onClick={() => onSelectIngredient?.(ing)}
                        title="在生命周期页查看该成分"
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                      >
                        {ing}
                      </button>
                    ))}
                    {truncated && (
                      <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-400">
                        +{ingsTotal - links.ingredients.length} 个（共 {ingsTotal} 个，仅展示前 {links.ingredients.length}）
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })()}

          {/* PubMed 研究洞察（覆盖疾病见 disease_pubmed.json，未覆盖的疾病面板不渲染） */}
          <DiseasePubMedPanel slug={selected.slug} />

          {/* 药物全景表 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">药物全景表（{detail.drugs.length}）</CardTitle>
              {detail.cards_truncated && (
                <p className="text-xs text-amber-600">
                  注：该疾病药物较多，仅最近获批的前 200 个药物提供摘要卡
                </p>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>药物名</TableHead>
                    <TableHead>活性成分</TableHead>
                    <TableHead>持证商</TableHead>
                    <TableHead className="w-20">类型</TableHead>
                    <TableHead className="w-28">获批日期</TableHead>
                    <TableHead className="w-24">状态</TableHead>
                    <TableHead className="w-24">黑框警告</TableHead>
                    <TableHead className="w-20">摘要卡</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.drugs.map((d) => {
                    const isOpen = expanded.has(d.application_number)
                    const hasCards = !!(d.efficacy_card || d.safety_card)
                    return (
                      <Fragment key={d.application_number}>
                        <TableRow
                          className="cursor-pointer hover:bg-blue-50/60"
                          onClick={() => onSelectDrug(d.application_number)}
                        >
                          <TableCell className="font-medium text-blue-700">
                            {d.drug_name || '—'}
                          </TableCell>
                          <TableCell className="max-w-44 truncate text-slate-600">
                            {d.active_ingredient || '—'}
                          </TableCell>
                          <TableCell className="max-w-40 truncate text-slate-600">
                            {(() => {
                              const slug = sponsorMap ? resolveCompanySlug(sponsorMap, d.sponsor_name) : null
                              return slug && onSelectCompany ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onSelectCompany(slug)
                                  }}
                                  title="查看企业画像"
                                  className="max-w-full truncate text-left text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                                >
                                  {d.sponsor_name || '—'}
                                </button>
                              ) : (
                                d.sponsor_name || '—'
                              )
                            })()}
                          </TableCell>
                          <TableCell>
                            <TypeBadge type={d.appl_type} />
                          </TableCell>
                          <TableCell className="text-slate-600">{d.approval_date || '—'}</TableCell>
                          <TableCell>
                            <StatusBadge status={d.marketing_status} />
                          </TableCell>
                          <TableCell>
                            {d.has_boxed_warning ? (
                              <Badge className="bg-red-100 text-red-700 border border-red-200 hover:bg-red-100">
                                <AlertTriangle className="mr-1 h-3 w-3" />黑框
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-slate-400">无</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {hasCards ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleExpand(d.application_number)
                                }}
                                className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                              >
                                {isOpen ? (
                                  <><ChevronUp className="h-3 w-3" />收起</>
                                ) : (
                                  <><ChevronDown className="h-3 w-3" />摘要</>
                                )}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                            <TableCell colSpan={8} className="p-4">
                              <DrugSummaryCards efficacyCard={d.efficacy_card} safetyCard={d.safety_card} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* 说明 */}
      <p className="text-center text-xs text-slate-400">
        数据来源：openFDA 药品说明书（适应症全文检索）+ Drugs@FDA 获批记录 · 共收录 {index.length} 个疾病 ·
        未收录的疾病可在本地通过 CLI（disease_drugs.py）查询 · 数据仅供研究参考，不构成医疗建议
      </p>
    </div>
  )
}
