import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { env } from './env'
import type { Profile } from './types'

// Server client — use in Server Components and API routes
export async function createServerSupabase() {
  const cookieStore = await cookies()

  return createServerClient(
    env('NEXT_PUBLIC_SUPABASE_URL') || 'https://placeholder.supabase.co',
    env('NEXT_PUBLIC_SUPABASE_ANON_KEY') || 'placeholder-anon-key',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    }
  )
}

// Service client — bypasses RLS, server-only, never expose to client
export function createServiceClient() {
  const url = env('NEXT_PUBLIC_SUPABASE_URL') || 'https://placeholder.supabase.co'
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) {
    console.error('[supabase-server] SUPABASE_SERVICE_ROLE_KEY is missing or empty — service client will fail')
  }
  return createSupabaseClient(
    url,
    serviceKey || 'placeholder-service-key',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return data
}
