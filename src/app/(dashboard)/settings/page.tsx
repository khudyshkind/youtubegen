import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase-server'
import SettingsClient from '@/components/settings/SettingsClient'
import type { Metadata } from 'next'
import type { Profile } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Settings · Lefiro' }

export default async function SettingsPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return <SettingsClient profile={profile as Profile | null} />
}
