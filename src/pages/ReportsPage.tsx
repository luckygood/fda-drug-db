import { useEffect, useState } from 'react'
import {
  FileText, FlaskConical, Stethoscope, Building2, Globe2,
  Newspaper, ChevronRight, Loader2, CalendarClock, Lock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabaseGet, type WeeklyReport } from '@/lib/supabase'

interface ReportCardSpec {
  icon: typeof FileText
  title: string
  desc: string
  chapters: string[]
}

const UPCOMING_ENTITY_REPORTS: ReportCardSpec[] = [
  {
    icon: Stethoscope,
    title: '《疾病治疗格局报告》',
    desc: '以疾病为主线的治疗全景与竞争密度分析',
    chapters: ['治疗全景', '竞争密度', '全球可及', '在研管线', '证据热度', '近期动态'],
  },
  {
    icon: Building2,
    title: '《企业管线画像报告》',
    desc: '以企业为主线的获批产品与管线成分盘点',
    chapters: ['获批产品', '治疗领域', '管线成分', '近年活动'],
  },
]

const UPCOMING_TOPIC_REPORTS: ReportCardSpec[] = [
  {
    icon: Globe2,
    title: '《年度新分子实体（NME）全景报告》',
    desc: '年度 FDA 新分子实体的一站式回顾与全球同步分析',
    chapters: ['年度清单', '分子类型', '治疗领域', '企业归属', '全球同步率', '审评速度'],
  },
]

function UpcomingCard({ spec }: { spec: ReportCardSpec }) {
  const Icon = spec.icon
  return (
    <Card className="border-dashed opacity-75">
      <CardContent className="pt-5">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-slate-300" />
          <p className="font-semibold text-slate-500">{spec.title}</p>
          <Badge variant="outline" className="ml-auto border-slate-200 font-normal text-slate-400">
            <Lock className="mr-1 h-3 w-3" />
            即将推出
          </Badge>
        </div>
        <p className="mt-2 text-sm text-slate-400">{spec.desc}</p>
        <p className="mt-3 text-xs font-medium text-slate-400">规划章节</p>
        <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
          {spec.chapters.map((c) => (
            <li key={c} className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              {c}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export default function ReportsPage({ onGoAPI, onGoFeed }: {
  /** 跳转成分透视 tab（报告 B 的生成入口） */
  onGoAPI: () => void
  /** 跳转研发情报 tab（周报详情） */
  onGoFeed: () => void
}) {
  const [reports, setReports] = useState<WeeklyReport[] | null>(null)
  const [reportsError, setReportsError] = useState<string | null>(null)

  useEffect(() => {
    supabaseGet<WeeklyReport[]>('weekly_reports?order=generated_at.desc&limit=8')
      .then(setReports)
      .catch((e: Error) => setReportsError(e.message))
  }, [])

  return (
    <div className="space-y-8">
      {/* 页头 */}
      <div>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-bold text-slate-900">报告中心</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">全部报告永久免费 · 可在线阅读 · 可导出 PDF</p>
      </div>

      {/* Section 1：实体报告 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">实体报告（交互生成）</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* 报告 B：已上线 */}
          <Card className="border-blue-200 bg-blue-50/30">
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-blue-600" />
                <p className="font-semibold text-slate-900">《成分全生命周期档案》</p>
                <Badge className="ml-auto bg-blue-600 font-normal">已上线</Badge>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                任一活性成分的概要、生命周期时间轴、竞争格局、全球三地可及性、学术证据与关联实体，单栏叙事文档，支持浏览器导出 PDF。
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5">
                {['概要', '生命周期时间轴', '竞争格局', '全球可及性', '学术证据', '关联实体'].map((c) => (
                  <li key={c} className="flex items-center gap-1.5 text-xs text-slate-400">
                    <span className="h-1 w-1 rounded-full bg-blue-300" />
                    {c}
                  </li>
                ))}
              </ul>
              <button
                onClick={onGoAPI}
                className="mt-4 flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                去选择成分
                <ChevronRight className="h-4 w-4" />
              </button>
            </CardContent>
          </Card>

          {UPCOMING_ENTITY_REPORTS.map((spec) => <UpcomingCard key={spec.title} spec={spec} />)}
        </div>
      </section>

      {/* Section 2：专题报告 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">专题报告</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {UPCOMING_TOPIC_REPORTS.map((spec) => <UpcomingCard key={spec.title} spec={spec} />)}
        </div>
      </section>

      {/* Section 3：研发情报周报 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">研发情报周报</h3>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Newspaper className="h-5 w-5 text-blue-600" />
              最新周报
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reportsError ? (
              <p className="py-8 text-center text-sm text-red-500">周报列表加载失败：{reportsError}</p>
            ) : !reports ? (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <p className="text-sm">正在加载周报列表…</p>
              </div>
            ) : reports.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                <CalendarClock className="h-8 w-8 text-slate-300" />
                <p className="text-sm">首期周报将于 2026-07-27 生成</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {reports.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={onGoFeed}
                      className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-slate-50"
                    >
                      <Newspaper className="h-4 w-4 shrink-0 text-slate-300" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">
                          研发情报周报 · {r.period}
                          {r.batch && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">{r.batch}</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          生成于 {new Date(r.generated_at).toLocaleString('zh-CN')} · 覆盖跟踪企业的监管审批、临床进展、并购合作与财报动态
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-400">
              周报详情在「研发情报」页阅读（要闻 / 自免管线 / 分领域动态），点击任意一期跳转。
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
