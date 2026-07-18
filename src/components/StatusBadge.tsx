import { Badge } from '@/components/ui/badge'
import { statusKey, STATUS_LABEL, type StatusKey } from '@/lib/data'

const STATUS_CLASS: Record<StatusKey, string> = {
  rx: 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
  otc: 'bg-sky-100 text-sky-800 border-sky-200 hover:bg-sky-100',
  discontinued: 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-100',
  tentative: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100',
  other: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100',
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = statusKey(status)
  return (
    <Badge variant="outline" className={STATUS_CLASS[key]}>
      {STATUS_LABEL[key]}
    </Badge>
  )
}

const TYPE_CLASS: Record<string, string> = {
  NDA: 'bg-blue-600 text-white hover:bg-blue-600',
  ANDA: 'bg-teal-600 text-white hover:bg-teal-600',
  BLA: 'bg-violet-600 text-white hover:bg-violet-600',
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <Badge className={TYPE_CLASS[type] ?? 'bg-slate-500 text-white hover:bg-slate-500'}>
      {type}
    </Badge>
  )
}
