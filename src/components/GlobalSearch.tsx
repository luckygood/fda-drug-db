import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Loader2, Pill, Stethoscope, Building2, FlaskConical } from 'lucide-react'
import {
  loadAPIIndex,
  loadCompanyIndex,
  loadDiseaseIndex,
  loadProducts,
  loadSponsorMap,
  type APIIndexEntry,
  type CompanyIndexEntry,
  type DiseaseIndexEntry,
  type Product,
} from '@/lib/data'

interface GlobalSearchProps {
  onSelectDisease: (entry: DiseaseIndexEntry) => void
  onSelectDrug: (applicationNumber: string) => void
  onSelectCompany: (entry: CompanyIndexEntry) => void
  onSelectAPI?: (entry: APIIndexEntry) => void
}

type Suggestion =
  | { kind: 'disease'; entry: DiseaseIndexEntry }
  | { kind: 'api'; entry: APIIndexEntry }
  | { kind: 'company'; entry: CompanyIndexEntry }
  | { kind: 'drug'; product: Product }

const MAX_PER_GROUP = 8
const MAX_COMPANY = 5

export default function GlobalSearch({ onSelectDisease, onSelectDrug, onSelectCompany, onSelectAPI }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [diseases, setDiseases] = useState<DiseaseIndexEntry[] | null>(null)
  const [products, setProducts] = useState<Product[] | null>(null)
  const [productsLoading, setProductsLoading] = useState(false)
  const [companies, setCompanies] = useState<CompanyIndexEntry[] | null>(null)
  const [sponsorMap, setSponsorMap] = useState<Record<string, string> | null>(null)
  const [companiesLoading, setCompaniesLoading] = useState(false)
  const [apiIndex, setApiIndex] = useState<APIIndexEntry[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 疾病/API 索引立即加载（体积小）；药品/企业数据聚焦时按需加载
  useEffect(() => {
    loadDiseaseIndex()
      .then((d) => setDiseases(d.diseases))
      .catch(() => setDiseases([]))
    loadAPIIndex()
      .then(setApiIndex)
      .catch(() => setApiIndex([]))
  }, [])

  const ensureProducts = () => {
    if (products || productsLoading) return
    setProductsLoading(true)
    loadProducts()
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setProductsLoading(false))
  }

  const ensureCompanies = () => {
    if (companies || companiesLoading) return
    setCompaniesLoading(true)
    Promise.all([loadCompanyIndex(), loadSponsorMap()])
      .then(([idx, map]) => {
        setCompanies(idx)
        setSponsorMap(map)
      })
      .catch(() => setCompanies([]))
      .finally(() => setCompaniesLoading(false))
  }

  // debounce ~200ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query])

  // 点击外部关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const diseaseMatches = useMemo((): DiseaseIndexEntry[] => {
    if (!diseases || !debounced) return []
    const q = debounced.toLowerCase()
    return diseases
      .filter(
        (d) =>
          d.name_zh.includes(debounced) ||
          d.name_en.toLowerCase().includes(q) ||
          d.slug.includes(q) ||
          (d.synonyms ?? []).some((s) => s.toLowerCase().includes(q)),
      )
      .slice(0, MAX_PER_GROUP)
  }, [diseases, debounced])

  const drugMatches = useMemo((): Product[] => {
    if (!products || !debounced || debounced.length < 2) return []
    const q = debounced.toLowerCase()
    const prefix: Product[] = []
    const substr: Product[] = []
    const seen = new Set<string>()
    for (const p of products) {
      if (seen.has(p.application_number)) continue
      const name = (p.drug_name ?? '').toLowerCase()
      const ing = (p.active_ingredient ?? '').toLowerCase()
      const isPrefix = name.startsWith(q) || ing.startsWith(q)
      const isSub = name.includes(q) || ing.includes(q)
      if (!isPrefix && !isSub) continue
      seen.add(p.application_number)
      if (isPrefix) prefix.push(p)
      else substr.push(p)
      if (prefix.length >= MAX_PER_GROUP) break
    }
    const out = prefix.slice(0, MAX_PER_GROUP)
    for (const p of substr) {
      if (out.length >= MAX_PER_GROUP) break
      out.push(p)
    }
    return out
  }, [products, debounced])

  const companyMatches = useMemo((): CompanyIndexEntry[] => {
    if (!companies || !debounced || debounced.length < 2) return []
    const q = debounced.toUpperCase()
    const raw = debounced
    const hits = new Map<string, CompanyIndexEntry>()
    // 归一名 / 中文别名
    for (const c of companies) {
      if (c.name.includes(q) || (c.name_zh && c.name_zh.includes(raw))) {
        hits.set(c.slug, c)
        if (hits.size >= MAX_COMPANY) break
      }
    }
    // 变体名（原始 sponsor 名）
    if (sponsorMap && hits.size < MAX_COMPANY) {
      for (const [variant, slug] of Object.entries(sponsorMap)) {
        if (hits.size >= MAX_COMPANY) break
        if (hits.has(slug) || !variant.includes(q)) continue
        const c = companies.find((x) => x.slug === slug)
        if (c) hits.set(slug, c)
      }
    }
    return [...hits.values()].slice(0, MAX_COMPANY)
  }, [companies, sponsorMap, debounced])

  const apiMatches = useMemo((): APIIndexEntry[] => {
    if (!apiIndex || !debounced || debounced.length < 2) return []
    const q = debounced.toUpperCase()
    return apiIndex.filter((a) => a.api_name.includes(q)).slice(0, MAX_PER_GROUP)
  }, [apiIndex, debounced])

  // 拍平成可选列表（疾病 → API → 企业 → 药品）
  const suggestions = useMemo((): Suggestion[] => {
    const list: Suggestion[] = diseaseMatches.map((entry) => ({ kind: 'disease', entry }))
    for (const entry of apiMatches) list.push({ kind: 'api', entry })
    for (const entry of companyMatches) list.push({ kind: 'company', entry })
    for (const product of drugMatches) list.push({ kind: 'drug', product })
    return list
  }, [diseaseMatches, apiMatches, companyMatches, drugMatches])

  useEffect(() => {
    setActive(-1)
  }, [suggestions.length, debounced])

  // 键盘导航时滚动到可见区域
  useEffect(() => {
    if (active < 0 || !listRef.current) return
    const el = listRef.current.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (s: Suggestion) => {
    setOpen(false)
    setQuery('')
    if (s.kind === 'disease') onSelectDisease(s.entry)
    else if (s.kind === 'api') onSelectAPI?.(s.entry)
    else if (s.kind === 'company') onSelectCompany(s.entry)
    else onSelectDrug(s.product.application_number)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, -1))
    } else if (e.key === 'Enter') {
      if (active >= 0 && suggestions[active]) {
        e.preventDefault()
        choose(suggestions[active])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const showDropdown = open && debounced.length > 0
  const diseaseStart = 0
  const apiStart = diseaseMatches.length
  const companyStart = apiStart + apiMatches.length
  const drugStart = companyStart + companyMatches.length

  return (
    <div ref={rootRef} className="relative w-full sm:w-80">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            ensureProducts()
            ensureCompanies()
          }}
          onKeyDown={onKeyDown}
          placeholder="全局搜索：疾病 / 活性成分 / 药品 / 企业…"
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {showDropdown && (
        <div className="absolute right-0 z-50 mt-1 w-full min-w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl sm:w-96">
          <div ref={listRef} className="max-h-96 overflow-y-auto">
            {/* 疾病组 */}
            {diseaseMatches.length > 0 && (
              <div>
                <p className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400">疾病</p>
                {diseaseMatches.map((d, i) => (
                  <button
                    key={`d-${d.slug}`}
                    onClick={() => choose({ kind: 'disease', entry: d })}
                    onMouseEnter={() => setActive(diseaseStart + i)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      active === diseaseStart + i ? 'bg-blue-50' : ''
                    }`}
                  >
                    <Stethoscope className="h-4 w-4 shrink-0 text-teal-600" />
                    <span className="font-medium text-slate-800">{d.name_zh}</span>
                    <span className="truncate text-xs text-slate-400">{d.name_en}</span>
                    <span className="ml-auto shrink-0 text-xs text-slate-400">{d.drug_count} 药</span>
                  </button>
                ))}
              </div>
            )}

            {/* API 组 */}
            {apiMatches.length > 0 && (
              <div>
                <p className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400">活性成分</p>
                {apiMatches.map((a, i) => (
                  <button
                    key={`a-${a.api_slug}`}
                    onClick={() => choose({ kind: 'api', entry: a })}
                    onMouseEnter={() => setActive(apiStart + i)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      active === apiStart + i ? 'bg-blue-50' : ''
                    }`}
                  >
                    <FlaskConical className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="font-medium text-slate-800">{a.api_name}</span>
                    <span className="ml-auto shrink-0 text-xs text-slate-400">
                      {a.stats.total} 产品
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* 企业组 */}
            {(companyMatches.length > 0 || (companiesLoading && debounced.length >= 2)) && (
              <div>
                <p className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400">企业</p>
                {companiesLoading && companyMatches.length === 0 && (
                  <p className="flex items-center gap-2 px-3 py-3 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    正在加载企业数据…
                  </p>
                )}
                {companyMatches.map((c, i) => (
                  <button
                    key={`c-${c.slug}`}
                    onClick={() => choose({ kind: 'company', entry: c })}
                    onMouseEnter={() => setActive(companyStart + i)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      active === companyStart + i ? 'bg-blue-50' : ''
                    }`}
                  >
                    <Building2 className="h-4 w-4 shrink-0 text-violet-600" />
                    <span className="truncate font-medium text-slate-800">{c.name}</span>
                    {c.name_zh && (
                      <span className="shrink-0 text-xs text-slate-500">{c.name_zh}</span>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-slate-400">
                      在售 {c.active_products}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* 药品组 */}
            {(drugMatches.length > 0 || productsLoading) && (
              <div>
                <p className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400">药品</p>
                {productsLoading && drugMatches.length === 0 && (
                  <p className="flex items-center gap-2 px-3 py-3 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    正在加载药品数据…
                  </p>
                )}
                {drugMatches.map((p, i) => (
                  <button
                    key={`p-${p.application_number}`}
                    onClick={() => choose({ kind: 'drug', product: p })}
                    onMouseEnter={() => setActive(drugStart + i)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      active === drugStart + i ? 'bg-blue-50' : ''
                    }`}
                  >
                    <Pill className="h-4 w-4 shrink-0 text-blue-600" />
                    <span className="font-medium text-slate-800">{p.drug_name}</span>
                    <span className="truncate text-xs text-slate-400">{p.active_ingredient}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-slate-400">
                      {p.application_number}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* 空结果 */}
            {diseaseMatches.length === 0 && apiMatches.length === 0 && companyMatches.length === 0 && drugMatches.length === 0 && !productsLoading && !companiesLoading && (
              <p className="px-3 py-4 text-center text-sm text-slate-400">
                未找到匹配的疾病、活性成分、药品或企业
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
