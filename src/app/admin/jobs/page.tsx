export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase-server'
import JobsTable from './JobsTable'

// Same guard as src/app/api/admin/dashboard/route.ts:7 and src/app/admin/analytics/page.tsx:9
const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

export default async function AdminJobsPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) redirect('/dashboard')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Журнал задач</h1>
        <p className="text-gray-500 text-sm mt-1">
          audio_jobs · image_jobs · video_jobs — последние N дней, новые сверху
        </p>
      </div>
      <JobsTable />
    </div>
  )
}
