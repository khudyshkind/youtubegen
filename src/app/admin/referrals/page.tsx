export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-server'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

export default async function AdminReferralsPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) redirect('/dashboard')

  const svc = createServiceClient()

  const [{ data: profiles }, { data: referred }] = await Promise.all([
    svc.from('profiles')
      .select('id, email, full_name, plan, referral_code, referral_count, referral_credits_earned')
      .gt('referral_count', 0)
      .order('referral_count', { ascending: false }),
    svc.from('profiles').select('referred_by, plan'),
  ])

  // Build conversion stats: for each referral code, how many referred became paid
  const paidByCode: Record<string, number> = {}
  const totalByCode: Record<string, number> = {}
  for (const r of referred ?? []) {
    if (!r.referred_by) continue
    totalByCode[r.referred_by] = (totalByCode[r.referred_by] ?? 0) + 1
    if (r.plan !== 'free') paidByCode[r.referred_by] = (paidByCode[r.referred_by] ?? 0) + 1
  }

  const totalReferrals = (referred ?? []).filter((r) => r.referred_by).length
  const totalPaid = (referred ?? []).filter((r) => r.referred_by && r.plan !== 'free').length
  const conversionPct = totalReferrals > 0 ? Math.round((totalPaid / totalReferrals) * 100) : 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Рефералы</h1>
        <p className="text-gray-500 text-sm mt-1">Статистика реферальной программы</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Всего рефералов</p>
          <p className="text-3xl font-extrabold text-gray-900">{totalReferrals}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Платящих из них</p>
          <p className="text-3xl font-extrabold text-gray-900">{totalPaid}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Конверсия в платящих</p>
          <p className="text-3xl font-extrabold text-gray-900">{conversionPct}%</p>
        </div>
      </div>

      {/* Referrers table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="font-semibold text-gray-800">Топ рефереров</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Пользователь</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Реф. код</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Привлёк</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Платящих</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Конверсия</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Кредитов заработано</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(profiles ?? []).map((p) => {
              const paid = paidByCode[p.referral_code ?? ''] ?? 0
              const total = p.referral_count
              const conv = total > 0 ? Math.round((paid / total) * 100) : 0
              return (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800 truncate max-w-[200px]">{p.email}</p>
                    <p className="text-xs text-gray-400">{p.full_name ?? ''} · {p.plan}</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded-md">{p.referral_code}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-700">{total}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{paid}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs font-semibold ${conv >= 20 ? 'text-green-600' : 'text-gray-500'}`}>
                      {conv}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-600">
                    {p.referral_credits_earned} кр.
                  </td>
                </tr>
              )
            })}
            {(profiles ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-400">
                  Рефералов пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
