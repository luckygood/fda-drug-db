import { useEffect, useMemo, useState } from 'react'
import { Database, ChevronDown, ChevronUp, Download, Copy, Check, Github, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  DATASETS, LICENSE_NOTE, citationLine, datasetUrl, loadManifest,
  type DatasetSpec, type Manifest, type DatasetCategory,
} from '@/lib/datasets'

const CATEGORY_ORDER: DatasetCategory[] = ['核心实体', '可及性', '证据', '安全', '指标']
const CATEGORY_STYLE: Record<DatasetCategory, string> = {
  核心实体: 'bg-blue-100 text-blue-700',
  可及性: 'bg-emerald-100 text-emerald-700',
  证据: 'bg-violet-100 text-violet-700',
  安全: 'bg-red-100 text-red-700',
  指标: 'bg-amber-100 text-amber-700',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => undefined)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
      title="复制引用格式"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {copied ? '已复制' : '复制引用'}
    </button>
  )
}

function DatasetCard({ spec, manifest }: { spec: DatasetSpec; manifest: Manifest | null }) {
  const [expanded, setExpanded] = useState(false)
  const entry = spec.sharded ? null : manifest?.datasets[spec.file]
  const generatedAt = entry?.generated_at
  const url = datasetUrl(spec)

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CATEGORY_STYLE[spec.category]}`}>
            {spec.category}
          </span>
          <p className="font-semibold text-slate-900">{spec.nameZh}</p>
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{spec.file}</code>
          <span className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-slate-400" title="数据生成日期（取自 manifest，构建期读取真实文件）">
              <RefreshCw className="h-3 w-3" />
              {generatedAt ?? (spec.sharded ? '随月度管道' : '未标记')}
            </span>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Download className="h-3 w-3" />
                下载
              </a>
            )}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-slate-500">{spec.desc}</p>
        {spec.sharded && (
          <p className="mt-1 text-xs text-slate-400">{spec.sharded}；请按入口文件递归获取分片。</p>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          {expanded ? <><ChevronUp className="h-3 w-3" />收起字段字典</> : <><ChevronDown className="h-3 w-3" />字段字典 · 口径 · 引用</>}
        </button>

        {expanded && (
          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            {/* 字段字典 */}
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500">字段字典（核心字段）</p>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-2 py-1 text-left text-xs font-medium text-slate-500">字段</th>
                    <th className="px-2 py-1 text-left text-xs font-medium text-slate-500">类型</th>
                    <th className="px-2 py-1 text-left text-xs font-medium text-slate-500">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.fields.map((f) => (
                    <tr key={f.name} className="border-b border-slate-100">
                      <td className="px-2 py-1 text-xs"><code className="text-blue-700">{f.name}</code></td>
                      <td className="whitespace-nowrap px-2 py-1 text-xs text-slate-500">{f.type}</td>
                      <td className="px-2 py-1 text-xs text-slate-600">{f.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 口径 + 频率 + 许可 */}
            <dl className="space-y-1.5 text-xs">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 font-medium text-slate-500">口径</dt>
                <dd className="text-slate-600">{spec.scopeNote}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 font-medium text-slate-500">更新频率</dt>
                <dd className="text-slate-600">{spec.cadence}{entry?.method_version ? ` · 方法版本 v${entry.method_version}` : ''}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 font-medium text-slate-500">许可</dt>
                <dd className="text-slate-600">{LICENSE_NOTE}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="w-16 shrink-0 font-medium text-slate-500">引用</dt>
                <dd className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-slate-600" title={citationLine(spec, generatedAt)}>
                  {citationLine(spec, generatedAt)}
                </dd>
                <CopyButton text={citationLine(spec, generatedAt)} />
              </div>
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function OpenDataPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null)

  useEffect(() => {
    loadManifest().then(setManifest).catch(() => setManifest(null))
  }, [])

  const groups = useMemo(
    () => CATEGORY_ORDER.map((c) => ({ category: c, items: DATASETS.filter((d) => d.category === c) })),
    [],
  )

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div>
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-bold text-slate-900">开放数据</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          全部数据免费开放 · 可下载 · 可引用 · 可追溯
        </p>
        <p className="mt-1 text-xs text-slate-400">
          共 {DATASETS.length} 个数据集目录（{manifest ? `manifest 收录 ${manifest.count} 个顶层 JSON 文件` : 'manifest 加载中…'}
          {manifest && `，合计 ${(Object.values(manifest.datasets).reduce((s, e) => s + (e.size_bytes ?? 0), 0) / 1024 / 1024).toFixed(1)} MB`}）
        </p>
      </div>

      {/* 分类数据集卡 */}
      {groups.map(({ category, items }) => (
        <section key={category}>
          <h3 className="mb-3 text-sm font-semibold text-slate-800">
            {category}
            <span className="ml-2 text-xs font-normal text-slate-400">{items.length} 个</span>
          </h3>
          <div className="grid gap-4 xl:grid-cols-2">
            {items.map((spec) => <DatasetCard key={spec.id} spec={spec} manifest={manifest} />)}
          </div>
        </section>
      ))}

      {/* 页脚说明 */}
      <Card>
        <CardContent className="space-y-2 pt-5 text-xs leading-relaxed text-slate-400">
          <p>
            <span className="font-medium text-slate-500">无 API 访问说明：</span>
            全部数据为静态 JSON 文件，托管于 GitHub Pages（CORS 开放），无需密钥、无速率限制，
            可直接 <code className="rounded bg-slate-100 px-1">fetch('https://luckygood.github.io/fda-drug-db/data/&lt;文件名&gt;')</code> 引用；
            分片数据集（companies / diseases / api / cards）请先取目录内 index.json 再按映射取分片。
          </p>
          <p>
            <span className="font-medium text-slate-500">可追溯性：</span>
            每个数据集带 generated_at + method_version 版本戳；构建管道为每个数据集保留最近 3 份快照
            （scripts/snapshots/，随仓库分发）；字段级口径见各数据集卡片与仓库 DATA_DICTIONARY.md。
          </p>
          <p>
            <span className="font-medium text-slate-500">数据纠错：</span>
            发现错配或数据问题请通过{' '}
            <a
              href="https://github.com/luckygood/fda-drug-db/issues"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
            >
              <Github className="h-3 w-3" />
              GitHub Issues
            </a>{' '}
            反馈，请注明数据集 id 与问题记录键值。
          </p>
          <p>{LICENSE_NOTE}。数据仅供研究参考，不构成医疗建议或投资建议。</p>
        </CardContent>
      </Card>
    </div>
  )
}
