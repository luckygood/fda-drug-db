// 预警中心（安全与市场页顶部大区块）：四张榜单卡 2x2，top 15 + 查看全部展开。
import { useEffect, useMemo, useState } from 'react'
import { Hourglass, AlertTriangle, Sparkles, OctagonAlert, Compass, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  loadLifecycleIndex, loadReportMetrics, loadLabelSafety, loadCnAccess, loadGlobalAccess,
  type LifecycleRecord, type ReportMetrics, type LabelSafetyIndex, type CnAccess, type GlobalAccess,
} from '@/lib/data'

const TOP_N = 15
const thCls = 'px-2.5 py-1.5 text-left text-xs font-medium text-slate-500'
const tdCls = 'px-2.5 py-1.5 text-sm text-slate-700'

interface Row {
  name: string
  cells: React.ReactNode[]
  date?: string
}

function BoardCard({ icon, title, total, source, generatedAt, headers, rows, onPick }: {
  icon: React.ReactNode
  title: string
  total: number
  source: string
  generatedAt?: string
  headers: string[]
  rows: Row[]
  onPick?: (name: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? rows : rows.slice(0, TOP_N)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {icon}
          {title}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
            共 {total.toLocaleString()} 个
          </span>
        </CardTitle>
        <p className="text-xs text-slate-400">
          {source}{generatedAt ? ` · 数据生成于 ${generatedAt}` : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className={expanded ? 'max-h-[420px] overflow-auto' : ''}>
          <table className="w-full border-collapse">
            <thead className={expanded ? 'sticky top-0 bg-white' : ''}>
              <tr className="border-b border-slate-100">
                {headers.map((h) => <th key={h} className={thCls}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.name}
                  onClick={() => onPick?.(r.name)}
                  className="cursor-pointer border-b border-slate-50 hover:bg-blue-50/50"
                  title="点击查看成分透视详情"
                >
                  <td className={`${tdCls} max-w-44 truncate font-medium text-blue-700`}>{r.name}</td>
                  {r.cells.map((c, i) => <td key={i} className={tdCls}>{c}</td>)}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={headers.length} className="py-6 text-center text-sm text-slate-400">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > TOP_N && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            {expanded ? <><ChevronUp className="h-3 w-3" />收起</> : <><ChevronDown className="h-3 w-3" />查看全部 {rows.length.toLocaleString()} 个</>}
          </button>
        )}
      </CardContent>
    </Card>
  )
}

export default function AlertCenter({ onSelectIngredient }: {
  onSelectIngredient?: (ingredient: string) => void
}) {
  const [records, setRecords] = useState<Record<string, LifecycleRecord> | null>(null)
  const [generatedAt, setGeneratedAt] = useState('')
  const [metrics, setMetrics] = useState<ReportMetrics | null>(null)
  const [safety, setSafety] = useState<LabelSafetyIndex | null>(null)
  const [cnAccess, setCnAccess] = useState<CnAccess | null>(null)
  const [globalAccess, setGlobalAccess] = useState<GlobalAccess | null>(null)

  useEffect(() => {
    loadLifecycleIndex()
      .then((d) => { setRecords(d.records); setGeneratedAt(d.generated_at) })
      .catch(() => setRecords(null))
    loadReportMetrics().then(setMetrics).catch(() => setMetrics(null))
    loadLabelSafety().then(setSafety).catch(() => setSafety(null))
    loadCnAccess().then(setCnAccess).catch(() => setCnAccess(null))
    loadGlobalAccess().then(setGlobalAccess).catch(() => setGlobalAccess(null))
  }, [])

  // 1. 专利悬崖倒计时榜：成熟期 + ≤36 个月，按剩余月数升序
  const cliff = useMemo(() => {
    if (!records) return []
    return Object.values(records)
      .filter((r) => r.stage === '成熟期' && r.months_to_expiry != null && r.months_to_expiry >= 0 && r.months_to_expiry <= 36)
      .sort((a, b) => (a.months_to_expiry ?? 0) - (b.months_to_expiry ?? 0))
      .map((r): Row => ({
        name: r.ingredient,
        cells: [
          <span className="block max-w-36 truncate text-slate-600" title={r.originator ?? undefined}>{r.originator ?? '—'}</span>,
          <span className={(r.months_to_expiry ?? 99) <= 12 ? 'font-semibold text-amber-600' : ''}>{r.months_to_expiry} 月</span>,
          `${r.n_anda_companies} 家`,
        ],
      }))
  }, [records])

  // 2. 短缺风险榜：高 → 中
  const shortage = useMemo(() => {
    if (!records) return []
    const rank = (x: string | null) => (x === 'high' ? 0 : x === 'medium' ? 1 : 2)
    return Object.values(records)
      .filter((r) => r.shortage_risk === 'high' || r.shortage_risk === 'medium')
      .sort((a, b) => rank(a.shortage_risk) - rank(b.shortage_risk) || b.n_anda_companies - a.n_anda_companies)
      .map((r): Row => ({
        name: r.ingredient,
        cells: [
          r.shortage_risk === 'high'
            ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">高</span>
            : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">中</span>,
          `${r.n_anda_companies} 家`,
          r.withdrawn ? <span className="text-slate-500">已撤市</span> : '在销',
        ],
      }))
  }, [records])

  // 3. 新品种动态榜：引入期按首获批倒序
  const fresh = useMemo(() => {
    if (!records) return []
    return Object.values(records)
      .filter((r) => r.stage === '引入期' && r.first_approval)
      .sort((a, b) => (b.first_approval ?? '').localeCompare(a.first_approval ?? ''))
      .map((r): Row => {
        const ev = metrics?.ingredients[r.ingredient]?.evidence
        return {
          name: r.ingredient,
          cells: [
            r.first_approval ?? '—',
            <span className="block max-w-36 truncate text-slate-600" title={r.originator ?? undefined}>{r.originator ?? '—'}</span>,
            ev ? `${ev.clinical_count.toLocaleString()} 篇` : '—',
          ],
        }
      })
  }, [records, metrics])

  // 4. 安全信号榜：黑框警告，按标签修订日期倒序（无日期排最后）
  const signals = useMemo(() => {
    if (!safety) return []
    return Object.entries(safety.ingredients)
      .filter(([, v]) => v.boxed_warning)
      .sort((a, b) => (b[1].label_effective_date ?? '').localeCompare(a[1].label_effective_date ?? ''))
      .map(([name, v]): Row => ({
        name,
        cells: [
          <span className="block max-w-72 truncate text-xs text-slate-600" title={v.bw_excerpt ?? undefined}>
            {(v.bw_excerpt ?? '—').slice(0, 60)}{(v.bw_excerpt?.length ?? 0) > 60 ? '…' : ''}
          </span>,
          v.label_effective_date ?? '—',
        ],
      }))
  }, [safety])

  // 5. License-in 雷达：FDA 已批、中国未检索到公开批准记录（unknown ≠ 未批），按 FDA 首获批倒序
  const radar = useMemo(() => {
    if (!cnAccess) return []
    return Object.entries(cnAccess.records)
      .filter(([, v]) => v.cn_status !== 'approved')
      .map(([ing]) => {
        const lc = records?.[ing]
        const ga = globalAccess?.records[ing]
        return { ing, fda: lc?.first_approval ?? '', originator: lc?.originator ?? null, ema: ga?.ema_status, pmda: ga?.pmda_status }
      })
      .sort((a, b) => b.fda.localeCompare(a.fda))
      .map((r): Row => ({
        name: r.ing,
        cells: [
          r.fda || '—',
          <span className="block max-w-36 truncate text-slate-600" title={r.originator ?? undefined}>{r.originator ?? '—'}</span>,
          <span className="flex gap-1">
            {r.ema === 'authorised'
              ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">EMA</span>
              : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-400">EMA</span>}
            {r.pmda === 'approved'
              ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">PMDA</span>
              : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-400">PMDA</span>}
          </span>,
        ],
      }))
  }, [cnAccess, records, globalAccess])

  if (!records) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-slate-400">预警中心数据加载中…</CardContent>
      </Card>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        <h2 className="text-lg font-bold text-slate-900">预警中心</h2>
        <span className="text-xs text-slate-400">
          专利悬崖 {cliff.length} · 短缺风险 {shortage.length} · 新品种 {fresh.length} · 黑框信号 {signals.length} · License-in 雷达 {radar.length}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BoardCard
          icon={<Hourglass className="h-4 w-4 text-amber-500" />}
          title="⏳ 专利悬崖倒计时榜"
          total={cliff.length}
          source="生命周期索引（成熟期 + 核心专利 ≤36 个月）"
          generatedAt={generatedAt}
          headers={['成分', '原研', '剩余', 'ANDA 厂家']}
          rows={cliff}
          onPick={onSelectIngredient}
        />
        <BoardCard
          icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
          title="⚠️ 短缺风险榜"
          total={shortage.length}
          source="FDA 药物短缺数据库（高 → 中）"
          generatedAt={generatedAt}
          headers={['成分', '风险', '持证企业', '状态']}
          rows={shortage}
          onPick={onSelectIngredient}
        />
        <BoardCard
          icon={<Sparkles className="h-4 w-4 text-blue-500" />}
          title="🆕 新品种动态榜"
          total={fresh.length}
          source="生命周期索引（引入期，按首获批倒序）· PubMed 证据"
          generatedAt={generatedAt}
          headers={['成分', '首获批', '原研', 'PubMed 临床']}
          rows={fresh}
          onPick={onSelectIngredient}
        />
        <BoardCard
          icon={<OctagonAlert className="h-4 w-4 text-red-700" />}
          title="⚫ 安全信号榜"
          total={signals.length}
          source="openFDA 现行标签黑框警告（按标签修订日期倒序）"
          generatedAt={safety?.generated_at}
          headers={['成分', '警告摘要', '标签修订']}
          rows={signals}
          onPick={onSelectIngredient}
        />
        <BoardCard
          icon={<Compass className="h-4 w-4 text-indigo-500" />}
          title="🧭 License-in 雷达"
          total={radar.length}
          source="FDA 已批（2020+）· 未检索到中国公开批准记录 — 未确认 ≠ 未批，仅供线索筛查，需人工核实 · NMPA 数据为公开文献正向确认"
          generatedAt={cnAccess?.generated_at}
          headers={['成分', 'FDA 首获批', '原研', 'EMA · PMDA']}
          rows={radar}
          onPick={onSelectIngredient}
        />
      </div>
      <p className="text-xs text-slate-400">
        🧭 License-in 雷达方法学：NMPA 批准状态来自公开文献正向确认（CDE 官网直连被反爬拦截，未能权威全量核验）；
        「未确认」不等于「未在中国获批」，覆盖以 2021–2025 年盘点文献为主且 2021/2022 较薄弱。上榜成分仅为潜在 license-in 线索，决策前请人工核实 CDE/官方渠道。
      </p>
    </section>
  )
}
