import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Search, Database, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { loadProducts, statusKey, type Product, type StatusKey } from '@/lib/data'
import { StatusBadge, TypeBadge } from '@/components/StatusBadge'

const PAGE_SIZE = 50

interface SearchPageProps {
  onSelect: (applicationNumber: string) => void
}

export default function SearchPage({ onSelect }: SearchPageProps) {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | StatusKey>('all')
  const [yearFilter, setYearFilter] = useState('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    loadProducts()
      .then(setProducts)
      .catch((e: Error) => setError(e.message))
  }, [])

  const years = useMemo(() => {
    if (!products) return []
    const set = new Set<string>()
    for (const p of products) {
      if (p.approval_date && p.approval_date.length >= 4) {
        set.add(p.approval_date.slice(0, 4))
      }
    }
    return Array.from(set).sort((a, b) => Number(b) - Number(a))
  }, [products])

  const filtered = useMemo(() => {
    if (!products) return []
    const q = deferredQuery.trim().toLowerCase()
    return products.filter((p) => {
      if (typeFilter !== 'all' && p.appl_type !== typeFilter) return false
      if (statusFilter !== 'all' && statusKey(p.marketing_status) !== statusFilter) return false
      if (yearFilter !== 'all' && !(p.approval_date ?? '').startsWith(yearFilter)) return false
      if (q) {
        const hay = `${p.drug_name ?? ''} ${p.active_ingredient ?? ''} ${p.sponsor_name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [products, deferredQuery, typeFilter, statusFilter, yearFilter])

  // 筛选条件变化时回到第一页
  useEffect(() => {
    setPage(1)
  }, [deferredQuery, typeFilter, statusFilter, yearFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-600">数据加载失败：{error}</p>
      </div>
    )
  }

  if (!products) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p>正在加载药品数据（约 7 MB）…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 搜索与过滤器 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索商品名 / 活性成分 / 持证商，如 Keytruda、pembrolizumab、Merck…"
            className="h-12 pl-10 text-base"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="申请类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="NDA">NDA（新药）</SelectItem>
              <SelectItem value="ANDA">ANDA（仿制药）</SelectItem>
              <SelectItem value="BLA">BLA（生物制品）</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as 'all' | StatusKey)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="上市状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="rx">处方药</SelectItem>
              <SelectItem value="otc">OTC（非处方）</SelectItem>
              <SelectItem value="discontinued">已撤市</SelectItem>
              <SelectItem value="tentative">暂定批准</SelectItem>
            </SelectContent>
          </Select>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="获批年份" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部年份</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={y}>
                  {y} 年
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 结果统计 */}
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span className="flex items-center gap-1.5">
          <Database className="h-4 w-4 text-blue-600" />
          共 <span className="font-semibold text-slate-900">{filtered.length.toLocaleString()}</span> 条结果
          {filtered.length !== products.length && (
            <span className="text-slate-400">（库内总计 {products.length.toLocaleString()} 条）</span>
          )}
        </span>
        <span>
          第 {currentPage} / {totalPages} 页
        </span>
      </div>

      {/* 结果表格 */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-28">申请号</TableHead>
              <TableHead>商品名</TableHead>
              <TableHead>活性成分</TableHead>
              <TableHead>剂型 / 规格</TableHead>
              <TableHead>持证商</TableHead>
              <TableHead className="w-28">获批日期</TableHead>
              <TableHead className="w-24">状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-slate-400">
                  没有匹配的药品记录，请调整搜索词或筛选条件
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((p, i) => (
                <TableRow
                  key={`${p.application_number}-${i}`}
                  className="cursor-pointer hover:bg-blue-50/60"
                  onClick={() => onSelect(p.application_number)}
                >
                  <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-1.5">
                      <TypeBadge type={p.appl_type} />
                      <span>{p.application_number}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-56 truncate font-medium text-blue-700">
                    {p.drug_name || '—'}
                  </TableCell>
                  <TableCell className="max-w-52 truncate text-slate-600">
                    {p.active_ingredient || '—'}
                  </TableCell>
                  <TableCell className="max-w-44 truncate text-slate-600">
                    {[p.form, p.strength].filter(Boolean).join(' / ') || '—'}
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-slate-600">
                    {p.sponsor_name || '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">{p.approval_date || '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.marketing_status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            上一页
          </Button>
          <span className="px-3 text-sm text-slate-600">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
