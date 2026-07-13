import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

const YT_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'
// YouTube official channel — 1 quota unit, always exists, safe for validation
const PROBE_CHANNEL_ID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json() as { key?: string }
    const key = (body.key ?? '').trim()

    // Format check — YouTube Data API v3 keys start with AIza and are ~39 chars
    if (!key) return NextResponse.json({ ok: false, code: 'invalid_format', error: 'Key is required' }, { status: 400 })
    if (!key.startsWith('AIza') || key.length < 30 || key.length > 50) {
      return NextResponse.json({ ok: false, code: 'invalid_format', error: 'Invalid key format (must start with AIza)' }, { status: 400 })
    }

    // Live probe: channels.list = 1 quota unit
    const url = new URL(YT_CHANNELS_URL)
    url.searchParams.set('part', 'id')
    url.searchParams.set('id', PROBE_CHANNEL_ID)
    url.searchParams.set('key', key)     // key goes in URL param (YouTube requirement)

    const res = await fetch(url.toString())
    const text = await res.text()

    if (res.status === 200) {
      return NextResponse.json({ ok: true })
    }

    if (res.status === 400) {
      return NextResponse.json({ ok: false, code: 'invalid_key', error: 'API key is not valid' }, { status: 400 })
    }

    if (res.status === 403) {
      try {
        const json = JSON.parse(text) as { error?: { errors?: Array<{ reason?: string; domain?: string }> } }
        const errors = json.error?.errors ?? []
        const reasons = errors.map(e => e.reason ?? '')
        const domains = errors.map(e => e.domain ?? '')

        if (reasons.some(r => r === 'quotaExceeded' || r === 'dailyLimitExceeded')) {
          return NextResponse.json({ ok: false, code: 'quota_exceeded', error: 'API key quota is exhausted (try tomorrow)' }, { status: 400 })
        }
        if (reasons.some(r => r === 'keyInvalid') || domains.some(d => d === 'youtube.quota')) {
          return NextResponse.json({ ok: false, code: 'invalid_key', error: 'API key is not valid' }, { status: 400 })
        }
        if (reasons.some(r => r === 'ipRefererBlocked' || r === 'refererNotAllowedByKey' || r === 'accessNotConfigured')) {
          return NextResponse.json({ ok: false, code: 'key_restricted', error: 'Key has IP/referrer restrictions or YouTube Data API v3 is not enabled' }, { status: 400 })
        }
      } catch {}
      return NextResponse.json({ ok: false, code: 'forbidden', error: 'Key rejected by YouTube API (403)' }, { status: 400 })
    }

    return NextResponse.json({ ok: false, code: 'youtube_error', error: `YouTube API returned ${res.status}` }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[validate-yt-key] error:', msg)
    return NextResponse.json({ ok: false, error: 'Validation failed' }, { status: 500 })
  }
}
