import { createBrowserClient } from '@supabase/ssr'

// Browser client — use in Client Components only
// Fallback strings let the build complete; real values are required at runtime.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'
  )
}
