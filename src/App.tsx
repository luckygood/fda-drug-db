import { useEffect, useState } from 'react'
import { Search, BarChart3, Stethoscope, TrendingUp, Building2, Ship, ShieldAlert, Landmark, FlaskConical, Newspaper, Hourglass, FileText, ChevronsLeft, ChevronsRight } from 'lucide-react'
import SearchPage from './pages/SearchPage'
import DetailPage from './pages/DetailPage'
import InsightsPage from './pages/InsightsPage'
import DiseasesPage from './pages/DiseasesPage'
import MiningPage from './pages/MiningPage'
import CompaniesPage from './pages/CompaniesPage'
import ChinaPage from './pages/ChinaPage'
import SafetyMarketPage from './pages/SafetyMarketPage'
import PatentSupplyPage from './pages/PatentSupplyPage'
import APIPage from './pages/APIPage'
import FeedPage from './pages/FeedPage'
import LifecyclePage from './pages/LifecyclePage'
import ReportsPage from './pages/ReportsPage'
import GlobalSearch from './components/GlobalSearch'
import { cn } from '@/lib/utils'

type Page = 'search' | 'diseases' | 'insights' | 'mining' | 'companies' | 'china' | 'safety' | 'patent' | 'api' | 'feed' | 'lifecycle' | 'reports'
type View =
  | { kind: 'list' }
  | { kind: 'detail'; applicationNumber: string; from: Page }

interface NavItem { key: Page; label: string; icon: typeof Search }
interface NavGroup { title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: '查询',
    items: [
      { key: 'search', label: '药品查询', icon: Search },
      { key: 'api', label: '成分透视', icon: FlaskConical },
      { key: 'diseases', label: '疾病视角', icon: Stethoscope },
    ],
  },
  {
    title: '洞察',
    items: [
      { key: 'insights', label: '数据洞察', icon: BarChart3 },
      { key: 'mining', label: '深度挖掘', icon: TrendingUp },
      { key: 'companies', label: '企业画像', icon: Building2 },
    ],
  },
  {
    title: '市场',
    items: [
      { key: 'china', label: '出海观察', icon: Ship },
      { key: 'safety', label: '安全与市场', icon: ShieldAlert },
      { key: 'patent', label: '专利与供应', icon: Landmark },
    ],
  },
  {
    title: '情报',
    items: [
      { key: 'feed', label: '研发情报', icon: Newspaper },
      { key: 'lifecycle', label: '生命周期', icon: Hourglass },
      { key: 'reports', label: '报告中心', icon: FileText },
    ],
  },
]

const COLLAPSE_KEY = 'fda-db-sidebar-collapsed'

export default function App() {
  const [page, setPage] = useState<Page>('search')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [pendingDisease, setPendingDisease] = useState<string | null>(null)
  const [pendingCompany, setPendingCompany] = useState<string | null>(null)
  const [pendingAPI, setPendingAPI] = useState<string | null>(null)
  const [pendingIngredient, setPendingIngredient] = useState<string | null>(null)
  const [pendingAPIName, setPendingAPIName] = useState<string | null>(null)
  const [pendingCompare, setPendingCompare] = useState<string[] | null>(null)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })

  // 窄屏（<768px）自动折叠为图标模式
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const apply = () => { if (mq.matches) setCollapsed(true) }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1') } catch { /* ignore */ }
      return !v
    })
  }

  const openDetail = (applicationNumber: string, from: Page) =>
    setView({ kind: 'detail', applicationNumber, from })

  const openDisease = (slug: string) => {
    setPendingDisease(slug)
    setPage('diseases')
    setView({ kind: 'list' })
  }

  const openCompany = (slug: string) => {
    setPendingCompany(slug)
    setPage('companies')
    setView({ kind: 'list' })
  }

  const openAPI = (slug: string) => {
    setPendingAPI(slug)
    setPage('api')
    setView({ kind: 'list' })
  }

  /** 跨页跳转：在成分透视页按成分名打开完整实体页 */
  const openAPIByName = (apiName: string) => {
    setPendingAPIName(apiName)
    setPage('api')
    setView({ kind: 'list' })
  }

  /** 跨页跳转：在生命周期页检索并展开某个成分 */
  const openLifecycleIngredient = (ingredient: string) => {
    setPendingIngredient(ingredient)
    setPage('lifecycle')
    setView({ kind: 'list' })
  }

  /** 跨页跳转：生命周期页对比模式（成分透视页"送去对比"，≤4 个成分） */
  const openLifecycleCompare = (ingredients: string[]) => {
    setPendingCompare(ingredients.slice(0, 4))
    setPage('lifecycle')
    setView({ kind: 'list' })
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* 左侧边栏导航 */}
      <aside
        className={cn(
          'sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-52',
        )}
      >
        {/* 标题 / Logo */}
        <div className={cn('border-b border-slate-100 py-4', collapsed ? 'px-2' : 'px-4')}>
          {collapsed ? (
            <span className="block text-center text-lg font-bold text-blue-600" title="FDA 获批药品数据库">✚</span>
          ) : (
            <>
              <h1 className="text-sm font-bold text-slate-900">
                <span className="mr-1.5 text-blue-600">✚</span>
                FDA 获批药品数据库
              </h1>
              <p className="mt-1 text-xs leading-snug text-slate-400">
                Drugs@FDA + openFDA · 截至 2026-07-18
              </p>
            </>
          )}
        </div>

        {/* 分组导航 */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-3">
              {!collapsed && (
                <p className="mb-1 px-2 text-xs font-medium tracking-wide text-slate-400">{group.title}</p>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ key, label, icon: Icon }) => {
                  const active = page === key && view.kind === 'list'
                  return (
                    <button
                      key={key}
                      title={collapsed ? label : undefined}
                      onClick={() => {
                        setPage(key)
                        setView({ kind: 'list' })
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2 text-sm transition-colors',
                        collapsed && 'justify-center px-0',
                        active
                          ? 'border-blue-600 bg-blue-50/70 font-medium text-blue-700'
                          : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* 折叠开关 */}
        <div className="border-t border-slate-100 p-2">
          <button
            onClick={toggleCollapsed}
            title={collapsed ? '展开导航' : '收起导航'}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" />收起</>}
          </button>
        </div>
      </aside>

      {/* 右侧主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏：全局统一搜索框（药物/疾病/活性成分/企业一站式） */}
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-7xl justify-end px-4 py-3">
            <GlobalSearch
              onSelectDisease={(entry) => openDisease(entry.slug)}
              onSelectDrug={(appNo) => openDetail(appNo, page)}
              onSelectCompany={(entry) => openCompany(entry.slug)}
              onSelectAPI={(entry) => openAPI(entry.api_slug)}
            />
          </div>
        </header>

        {/* 主内容 */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          {view.kind === 'detail' ? (
            <DetailPage
              applicationNumber={view.applicationNumber}
              onBack={() => {
                setPage(view.from)
                setView({ kind: 'list' })
              }}
              onSelectCompany={openCompany}
              onSelectDisease={openDisease}
            />
          ) : page === 'insights' ? (
            <InsightsPage onSelectIngredient={openLifecycleIngredient} />
          ) : page === 'mining' ? (
            <MiningPage
              onSelectDrug={(appNo) => openDetail(appNo, 'mining')}
              onSelectDisease={openDisease}
            />
          ) : page === 'companies' ? (
            <CompaniesPage
              pendingCompany={pendingCompany}
              onConsumePendingCompany={() => setPendingCompany(null)}
              onSelectDrug={(appNo) => openDetail(appNo, 'companies')}
              onSelectDisease={openDisease}
              onSelectIngredient={openLifecycleIngredient}
            />
          ) : page === 'china' ? (
            <ChinaPage
              onSelectCompany={openCompany}
              onSelectDrug={(appNo) => openDetail(appNo, 'china')}
            />
          ) : page === 'safety' ? (
            <SafetyMarketPage
              onSelectDrug={(appNo) => openDetail(appNo, 'safety')}
              onSelectIngredient={openAPIByName}
            />
          ) : page === 'patent' ? (
            <PatentSupplyPage onSelectDrug={(appNo) => openDetail(appNo, 'patent')} />
          ) : page === 'diseases' ? (
            <DiseasesPage
              pendingDisease={pendingDisease}
              onConsumePending={() => setPendingDisease(null)}
              onSelectDrug={(appNo) => openDetail(appNo, 'diseases')}
              onSelectCompany={openCompany}
              onSelectIngredient={openLifecycleIngredient}
            />
          ) : page === 'api' ? (
            <APIPage
              pendingAPI={pendingAPI}
              onConsumePendingAPI={() => setPendingAPI(null)}
              pendingAPIName={pendingAPIName}
              onConsumePendingAPIName={() => setPendingAPIName(null)}
              onSelectDrug={(appNo) => openDetail(appNo, 'api')}
              onSelectDisease={openDisease}
              onSelectCompany={openCompany}
              onCompare={openLifecycleCompare}
            />
          ) : page === 'feed' ? (
            <FeedPage />
          ) : page === 'reports' ? (
            <ReportsPage
              onGoAPI={() => { setPage('api'); setView({ kind: 'list' }) }}
              onGoFeed={() => { setPage('feed'); setView({ kind: 'list' }) }}
              onSelectIngredient={openLifecycleIngredient}
              onGoDiseases={() => { setPage('diseases'); setView({ kind: 'list' }) }}
            />
          ) : page === 'lifecycle' ? (
            <LifecyclePage
            pendingIngredient={pendingIngredient}
            onConsumePendingIngredient={() => setPendingIngredient(null)}
            pendingCompare={pendingCompare}
            onConsumePendingCompare={() => setPendingCompare(null)}
            onSelectDisease={openDisease}
            onSelectCompany={openCompany}
            onOpenEntityPage={openAPIByName}
          />
          ) : (
            <SearchPage onSelect={(appNo) => openDetail(appNo, 'search')} />
          )}
        </main>

        {/* 页脚 */}
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto w-full max-w-7xl px-4 py-4 text-center text-xs text-slate-400">
            数据仅供研究参考，不构成医疗建议；权威信息以 FDA 官网（accessdata.fda.gov）为准。
          </div>
        </footer>
      </div>
    </div>
  )
}
