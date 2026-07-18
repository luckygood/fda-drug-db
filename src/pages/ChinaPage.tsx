import { useEffect, useMemo, useState } from 'react'
import { Loader2, Award, Building2, TrendingUp, FlaskConical } from 'lucide-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EChart from '@/components/EChart'
import { loadChinaPharma, type ChinaPharma } from '@/lib/data'

const COLORS = {
  blue: '#2563eb',
  teal: '#0d9488',
  violet: '#7c3aed',
  amber: '#f59e0b',
}

const BASE_AXIS = {
  axisLine: { lineStyle: { color: '#cbd5e1' } },
  axisLabel: { color: '#475569' },
  splitLine: { lineStyle: { color: '#e2e8f0' } },
} as const

const thCls = 'px-3 py-2 text-left text-xs font-medium text-slate-500'
const tdCls = 'px-3 py-2 text-sm text-slate-700'

function StatCard({ label, value, sub, tone = 'text-slate-900' }: {
  label: string; value: string; sub?: string; tone?: string
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-slate-400">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${tone}`}>{value}</p>
        {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export default function ChinaPage({
  onSelectCompany,
  onSelectDrug,
}: {
  onSelectCompany: (slug: string) => void
  onSelectDrug: (applicationNumber: string) => void
}) {
  const [data, setData] = useState<ChinaPharma | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadChinaPharma()
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  const timelineOption = useMemo((): EChartsOption | null => {
    if (!data) return null
    const years = Object.keys(data.timeline).sort()
    const t = data.timeline
    return {
      color: [COLORS.blue, COLORS.teal, COLORS.violet],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['NDA（新药）', 'ANDA（仿制药）', 'BLA（生物制品）'], top: 0 },
      grid: { left: 45, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: years, ...BASE_AXIS },
      yAxis: { type: 'value', name: '获批申请数', ...BASE_AXIS },
      series: [
        { name: 'NDA（新药）', type: 'bar', stack: 'total', data: years.map((y) => t[y].nda) },
        { name: 'ANDA（仿制药）', type: 'bar', stack: 'total', data: years.map((y) => t[y].anda) },
        { name: 'BLA（生物制品）', type: 'bar', stack: 'total', data: years.map((y) => t[y].bla) },
      ],
    }
  }, [data])

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-600">出海数据加载失败：{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p>正在加载出海数据…</p>
      </div>
    )
  }

  const s = data.summary

  return (
    <div className="space-y-6">
      {/* 导语 */}
      <Card className="border-blue-100 bg-blue-50/40">
        <CardContent className="pt-5">
          <p className="text-sm leading-relaxed text-slate-600">
            本页追踪<strong className="text-slate-800">中国药企在 FDA 的获批全景</strong>：
            通过对持证商名称的地名与企业名启发式识别（HENGRUI、BEIGENE、QILU、ZHEJIANG 等关键词，词边界匹配并人工排除误报），
            共识别 <strong className="text-blue-700">{s.company_count}</strong> 个中国实体。
            识别基于 sponsor 名称文本，不含股权关系推断，<span className="text-slate-500">可能有遗漏或口径偏差，仅供参考</span>。
          </p>
        </CardContent>
      </Card>

      {/* 概览统计卡 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="中国实体" value={String(s.company_count)} sub="名称归一化合并后" />
        <StatCard label="申请总数" value={s.applications.toLocaleString()} sub={`ANDA ${s.anda} · NDA ${s.nda} · BLA ${s.bla}`} />
        <StatCard label="在售产品" value={s.active_products.toLocaleString()} sub="处方药 + OTC" tone="text-teal-700" />
        <StatCard label="NME（创新药）" value={String(s.nme_count)} sub="Type 1 原始获批" tone="text-violet-700" />
        <StatCard label="暂定批准" value={String(s.tentative_count)} sub="在途管线（产品级）" tone="text-amber-600" />
        <StatCard label="管线成分" value={String(data.pipeline.length)} sub="暂定批准聚合" tone="text-amber-600" />
      </div>

      {/* 获批时间线 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            获批时间线
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timelineOption && <EChart option={timelineOption} height={320} />}
          <p className="mt-2 text-xs text-slate-400">
            口径：中国实体申请按首个获批日期分年统计；ANDA 仿制药为绝对主力，NDA/BLA 创新药 2023 年起开始放量。
          </p>
        </CardContent>
      </Card>

      {/* 创新药专栏 */}
      <Card className="border-violet-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Award className="h-5 w-5 text-violet-600" />
            创新药（NME）专栏 · {data.innovation.length} 个
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {data.innovation.map((n) => (
              <button
                key={n.application_number}
                onClick={() => onSelectDrug(n.application_number)}
                className="rounded-lg border border-violet-100 bg-violet-50/40 p-4 text-left transition-colors hover:border-violet-300 hover:bg-violet-50"
              >
                <p className="text-lg font-bold text-violet-800">{n.drug_name}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {n.sponsor_zh && <span className="mr-1.5 font-medium">{n.sponsor_zh}</span>}
                  <span className="text-slate-400">{n.sponsor}</span>
                </p>
                <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono">{n.application_number}</span>
                  <span>{n.ap_date}</span>
                </p>
                <p className="mt-2 space-x-1">
                  {n.orphan === 1 && (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700">孤儿药</span>
                  )}
                  {n.priority === 1 && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">优先审评</span>
                  )}
                </p>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            口径：NME 指 FDA 申报分类 Type 1（New Molecular Entity）的原始获批。注：部分中国原研药由海外合作方持证
            （如呋喹替尼 FRUZAQLA 由 TAKEDA 持证、特瑞普利单抗 LOQTORZI 由 COHERUS 持证），不计入本表；
            HUTCHMED、ZAI LAB、INNOVENT、LEGEND、JUNSHI 等在当前数据中无持证记录。
          </p>
        </CardContent>
      </Card>

      {/* 企业排行 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-teal-600" />
            企业排行（按在售产品数）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[520px] overflow-auto rounded-md border border-slate-100">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={thCls}>#</th>
                  <th className={thCls}>企业</th>
                  <th className={`${thCls} text-right`}>在售</th>
                  <th className={`${thCls} text-right`}>ANDA</th>
                  <th className={`${thCls} text-right`}>NDA</th>
                  <th className={`${thCls} text-right`}>BLA</th>
                  <th className={`${thCls} text-right`}>NME</th>
                  <th className={`${thCls} text-right`}>暂定</th>
                  <th className={`${thCls} text-right`}>首获年份</th>
                </tr>
              </thead>
              <tbody>
                {data.companies.map((c, i) => (
                  <tr
                    key={c.slug}
                    onClick={() => onSelectCompany(c.slug)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                  >
                    <td className={`${tdCls} text-slate-400`}>{i + 1}</td>
                    <td className={tdCls}>
                      <span className="font-medium text-blue-700">{c.name_zh ? `${c.name_zh} · ` : ''}{c.name}</span>
                    </td>
                    <td className={`${tdCls} text-right font-semibold text-teal-700`}>{c.active}</td>
                    <td className={`${tdCls} text-right`}>{c.anda}</td>
                    <td className={`${tdCls} text-right`}>{c.nda}</td>
                    <td className={`${tdCls} text-right`}>{c.bla}</td>
                    <td className={`${tdCls} text-right`}>{c.nme_count > 0 ? <span className="font-semibold text-violet-700">{c.nme_count}</span> : c.nme_count}</td>
                    <td className={`${tdCls} text-right`}>{c.tentative_count}</td>
                    <td className={`${tdCls} text-right text-slate-500`}>{c.first_year ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">点击行跳转企业画像。</p>
        </CardContent>
      </Card>

      {/* 在途管线 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FlaskConical className="h-5 w-5 text-amber-500" />
            在途管线（暂定批准，按成分聚合）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[420px] overflow-auto rounded-md border border-slate-100">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={thCls}>成分</th>
                  <th className={`${thCls} text-right`}>申请数</th>
                  <th className={thCls}>涉及实体</th>
                </tr>
              </thead>
              <tbody>
                {data.pipeline.map((p) => (
                  <tr key={p.ingredient} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className={`${tdCls} max-w-[280px] truncate font-medium`}>{p.ingredient}</td>
                    <td className={`${tdCls} text-right font-semibold text-amber-600`}>{p.n}</td>
                    <td className={`${tdCls} max-w-[300px] truncate text-xs text-slate-500`}>
                      {p.sponsors.join('、')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            口径：暂定批准（Tentative Approval）已满足 FDA 技术要求、待专利/独占期到期即可上市，是出海管线的先行指标。
          </p>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-slate-400">
        数据来源：Drugs@FDA · 中国实体按 sponsor 名称启发式识别（{s.company_count} 个），或有遗漏
      </p>
    </div>
  )
}
