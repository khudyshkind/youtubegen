import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase-server'
import OnboardingModal from '@/components/shared/OnboardingModal'
import ReferralBlock from '@/components/shared/ReferralBlock'
import DashboardClient from '@/components/dashboard/DashboardClient'
import type { Metadata } from 'next'
import type { Profile, Project } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Dashboard · YouTubeGen' }

export default async function DashboardPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const [{ data: profile }, { data: projects }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('projects')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const typedProfile = profile as Profile | null
  const typedProjects = (projects ?? []) as Project[]

  return (
    <>
      <OnboardingModal initialShow={typedProfile?.onboarding_completed === false} />
      {typedProfile?.referral_code && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <ReferralBlock
            referralCode={typedProfile.referral_code}
            referralCount={typedProfile.referral_count ?? 0}
            referralCreditsEarned={typedProfile.referral_credits_earned ?? 0}
          />
        </div>
      )}
      <DashboardClient profile={typedProfile} projects={typedProjects} />
    </>
  )
}
