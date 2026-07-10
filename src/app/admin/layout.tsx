import Link from 'next/link'
import type { ReactNode } from 'react'

const NAV = [
  { href: '/admin',            icon: '📊', label: 'Дашборд' },
  { href: '/admin/users',      icon: '👥', label: 'Пользователи' },
  { href: '/admin/referrals',  icon: '🔗', label: 'Рефералы' },
  { href: '/admin/analytics',  icon: '📈', label: 'Аналитика' },
  { href: '/admin/services',   icon: '🔧', label: 'Сервисы' },
]

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-gray-900 min-h-screen flex flex-col py-6 px-3">
        <div className="px-3 mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Админ-панель</p>
          <p className="text-lg font-bold text-white mt-1">Lefiro</p>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto pt-4 border-t border-gray-700">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Вернуться на сайт
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 p-8">
        {children}
      </main>
    </div>
  )
}
