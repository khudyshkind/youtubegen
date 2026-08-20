import { NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 10

const ENGINES = ['secretvoicer', 'elevenlabs', 'voicer', 'apihost'] as const
type EngineStatus = 'ok' | 'down' | 'unknown'

async function readSetting(key: string): Promise<string | null> {
  try {
    const svc = createServiceClient()
    const { data } = await svc.from('bot_settings').select('value').eq('key', key).single()
    return (data as { value?: string } | null)?.value ?? null
  } catch { return null }
}

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const health: Record<string, EngineStatus> = {}
  const now = Date.now()

  for (const engine of ENGINES) {
    const status = await readSetting(`${engine}_synth_health`)
    const ts     = await readSetting(`${engine}_synth_health_ts`)
    const ageMin = ts ? (now - new Date(ts).getTime()) / 60_000 : Infinity
    // Stale after 20 minutes (two missed cron cycles) → report as unknown
    if (!status || ageMin > 20) {
      health[engine] = 'unknown'
    } else {
      health[engine] = status === 'ok' ? 'ok' : 'down'
    }
  }

  return NextResponse.json({ ok: true, health })
}
