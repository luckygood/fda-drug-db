import { useState } from 'react'
import { Search, BarChart3, Stethoscope, TrendingUp, Building2 } from 'lucide-react'
import SearchPage from './pages/SearchPage'
import DetailPage from './pages/DetailPage'
import InsightsPage from './pages/InsightsPage'
import DiseasesPage from './pages/DiseasesPage'
import MiningPage from './pages/MiningPage'
import CompaniesPage from './pages/CompaniesPage'
import GlobalSearch from './components/GlobalSearch'
import { cn } from '@/lib/utils'

type Page = 'search' | 'diseases' | 'insights' | 'mining' | 'companies'
type View =
  | { kind: 'list' }
  | { kind: 'detail'; applicationNumber: string; from: Page }

export default function App() {
  const [page, setPage] = useState<Page>('search')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [pendingDisease, setPendingDisease] = useState<string | null>(null)
  const [pendingCompany, setPendingCompany] = useState<string | null>(null)

  const tabs: { key: Page; label: string; icon: typeof Search }[] = [
    { key: 'search', label: '药品查询', icon: Search },
    { key: 'diseases', label: '疾病视角', icon: Stethoscope },
    { key: 'insights', label: '数据洞察', icon: BarChart3 },
    { key: 'mining', label: '深度挖掘', icon: TrendingUp },
    { key: 'companies', label: '企业画像', icon: Building2 },
  ]

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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航 */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                <span className="mr-2 text-blue-600">✚</span>
                FDA 获批药品数据库
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                数据来源：Drugs@FDA + openFDA 药品说明书 · 数据截至 2026-07-16
              </p>
            </div>
            {/* 全局统一搜索框（药物/疾病/企业一站式） */}
            <GlobalSearch
              onSelectDisease={(entry) => openDisease(entry.slug)}
              onSelectDrug={(appNo) => openDetail(appNo, page)}
              onSelectCompany={(entry) => openCompany(entry.slug)}
            />
          </div>
          {/* 页面切换标签 */}
          <nav className="mt-4 flex gap-1">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => {
                  setPage(key)
                  setView({ kind: 'list' })
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                  page === key
                    ? 'border-blue-600 bg-blue-50/60 text-blue-700'
                    : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* 主内容 */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {view.kind === 'detail' ? (
          <DetailPage
            applicationNumber={view.applicationNumber}
            onBack={() => {
              setPage(view.from)
              setView({ kind: 'list' })
            }}
            onSelectCompany={openCompany}
          />
        ) : page === 'insights' ? (
          <InsightsPage />
        ) : page === 'mining' ? (
          <MiningPage onSelectDrug={(appNo) => openDetail(appNo, 'mining')} />
        ) : page === 'companies' ? (
          <CompaniesPage
            pendingCompany={pendingCompany}
            onConsumePendingCompany={() => setPendingCompany(null)}
            onSelectDrug={(appNo) => openDetail(appNo, 'companies')}
            onSelectDisease={openDisease}
          />
        ) : page === 'diseases' ? (
          <DiseasesPage
            pendingDisease={pendingDisease}
            onConsumePending={() => setPendingDisease(null)}
            onSelectDrug={(appNo) => openDetail(appNo, 'diseases')}
            onSelectCompany={openCompany}
          />
        ) : (
          <SearchPage onSelect={(appNo) => openDetail(appNo, 'search')} />
        )}
      </main>

      {/* 页脚 */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 text-center text-xs text-slate-400">
          数据仅供研究参考，不构成医疗建议；权威信息以 FDA 官网（accessdata.fda.gov）为准。
        </div>
      </footer>
    </div>
  )
}
