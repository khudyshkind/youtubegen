import type { ReactNode } from 'react'
import SidebarNav from '@/components/shared/SidebarNav'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 min-h-0 dark-ui">
      <SidebarNav />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {children}
      </div>
    </div>
  )
}
