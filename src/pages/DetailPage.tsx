import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, FileText, Loader2, History, Pill } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getAppCard,
  loadDetails,
  loadProducts,
  type AppCard,
  type AppDetail,
  type Product,
} from '@/lib/data'
import { StatusBadge, TypeBadge } from '@/components/StatusBadge'
import DrugSummaryCards from '@/components/DrugSummaryCards'

interface DetailPageProps {
  applicationNumber: string
  onBack: () => void
}

const STATUS_TEXT: Record<string, string> = {
  AP: '批准 (AP)',
  TA: '暂定批准 (TA)',
}

function highlightClass(submissionClass: string | null): boolean {
  const c = (submissionClass ?? '').toUpperCase()
  return c.startsWith('TYPE 1') || c.startsWith('TYPE 4')
}

export default function DetailPage({ applicationNumber, onBack }: DetailPageProps) {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [detail, setDetail] = useState<AppDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appCard, setAppCard] = useState<AppCard | null>(null)
  const [cardLoading, setCardLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadProducts(), loadDetails()])
      .then(([prods, details]) => {
        if (cancelled) return
        setProducts(prods.filter((p) => p.application_number === applicationNumber))
        setDetail(
          details.get(applicationNumber) ?? { submissions: [], docs: [] },
        )
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [applicationNumber])

  // 惰性加载申请号语境的摘要卡（分片带缓存）
  useEffect(() => {
    let cancelled = false
    setCardLoading(true)
    setAppCard(null)
    getAppCard(applicationNumber)
      .then((c) => {
        if (!cancelled) setAppCard(c)
      })
      .catch(() => {
        if (!cancelled) setAppCard(null)
      })
      .finally(() => {
        if (!cancelled) setCardLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [applicationNumber])

  const firstApproval = useMemo(() => {
    if (!products) return null
    const dates = products
      .map((p) => p.approval_date)
      .filter((d): d is string => !!d)
      .sort()
    return dates[0] ?? null
  }, [products])

  const head = products?.[0]

  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> 返回
        </Button>
        <p className="text-red-600">详情数据加载失败:{error}</p>
      </div>
    )
  }

  if (!products || !detail) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p>正在加载申请详情…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="outline" onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" /> 返回
      </Button>

      {/* 头部信息 */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              {head?.drug_name || applicationNumber}
            </h2>
            <p className="mt-1 font-mono text-sm text-slate-500">{applicationNumber}</p>
          </div>
          <div className="flex items-center gap-2">
            {head && <TypeBadge type={head.appl_type} />}
            {head && <StatusBadge status={head.marketing_status} />}
          </div>
        </div>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-slate-400">持证商</p>
            <p className="mt-0.5 font-medium text-slate-800">{head?.sponsor_name || '—'}</p>
          </div>
          <div>
            <p className="text-slate-400">活性成分</p>
            <p className="mt-0.5 font-medium text-slate-800">{head?.active_ingredient || '—'}</p>
          </div>
          <div>
            <p className="text-slate-400">首次获批日期</p>
            <p className="mt-0.5 font-medium text-slate-800">{firstApproval || '—'}</p>
          </div>
          <div>
            <p className="text-slate-400">治疗等效代码 (TE Code)</p>
            <p className="mt-0.5 font-medium text-slate-800">{head?.te_code || '—'}</p>
          </div>
        </div>
      </div>

      {/* 有效性 / 安全性摘要卡 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">有效性 / 安全性摘要</CardTitle>
        </CardHeader>
        <CardContent>
          {cardLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              正在加载说明书摘要…
            </div>
          ) : (
            <DrugSummaryCards
              efficacyCard={appCard?.efficacy_card ?? null}
              safetyCard={appCard?.safety_card ?? null}
            />
          )}
        </CardContent>
      </Card>

      {/* 产品规格 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Pill className="h-5 w-5 text-blue-600" />
            产品规格（{products.length} 个）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>商品名</TableHead>
                <TableHead>活性成分</TableHead>
                <TableHead>剂型</TableHead>
                <TableHead>规格</TableHead>
                <TableHead>获批日期</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{p.drug_name || '—'}</TableCell>
                  <TableCell className="text-slate-600">{p.active_ingredient || '—'}</TableCell>
                  <TableCell className="text-slate-600">{p.form || '—'}</TableCell>
                  <TableCell className="text-slate-600">{p.strength || '—'}</TableCell>
                  <TableCell className="text-slate-600">{p.approval_date || '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.marketing_status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 审评历史 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5 text-blue-600" />
            审评历史（最近 {detail.submissions.length} 条）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detail.submissions.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">暂无审评历史记录</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-28">日期</TableHead>
                  <TableHead className="w-24">类型</TableHead>
                  <TableHead className="w-24">编号</TableHead>
                  <TableHead className="w-32">状态</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead className="w-28">审评优先级</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.submissions.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-slate-600">{s.status_date || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {s.submission_type || '—'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {s.submission_no || '—'}
                    </TableCell>
                    <TableCell className="text-slate-700">
                      {STATUS_TEXT[s.submission_status] ?? s.submission_status ?? '—'}
                    </TableCell>
                    <TableCell>
                      {s.submission_class ? (
                        <Badge
                          variant="outline"
                          className={
                            highlightClass(s.submission_class)
                              ? 'border-blue-300 bg-blue-50 text-blue-700'
                              : 'text-slate-600'
                          }
                        >
                          {s.submission_class}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {s.review_priority === 'PRIORITY' ? (
                        <Badge className="bg-amber-500 text-white hover:bg-amber-500">优先</Badge>
                      ) : (
                        s.review_priority || '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 官方文档 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-blue-600" />
            FDA 官方文档（最近 {detail.docs.length} 条）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detail.docs.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">暂无官方文档</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {detail.docs.map((d, i) => (
                <li key={i}>
                  <a
                    href={d.doc_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-4 py-3"
                  >
                    <span className="flex items-center gap-2 text-sm text-slate-700 group-hover:text-blue-700">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-blue-600" />
                      {d.doc_title || '未命名文档'}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                      {d.doc_date || ''}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
