import { useState } from 'react'
import SearchPage from './pages/SearchPage'
import DetailPage from './pages/DetailPage'

type View = { kind: 'search' } | { kind: 'detail'; applicationNumber: string }

export default function App() {
  const [view, setView] = useState<View>({ kind: 'search' })

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航 */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5">
          <h1 className="text-xl font-bold text-slate-900">
            <span className="mr-2 text-blue-600">✚</span>
            FDA 获批药品数据库
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            数据来源：Drugs@FDA（美国食品药品监督管理局）· 数据截至 2026-07-16
          </p>
        </div>
      </header>

      {/* 主内容 */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {view.kind === 'search' ? (
          <SearchPage
            onSelect={(applicationNumber) =>
              setView({ kind: 'detail', applicationNumber })
            }
          />
        ) : (
          <DetailPage
            applicationNumber={view.applicationNumber}
            onBack={() => setView({ kind: 'search' })}
          />
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
