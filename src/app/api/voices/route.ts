import { NextRequest, NextResponse } from 'next/server'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ElevenLabel {
  gender?: string
  accent?: string
  age?: string
  description?: string
  'use case'?: string
}

interface OwnVoice {
  voice_id: string
  name: string
  preview_url?: string | null
  labels?: ElevenLabel
}

interface SharedVoice {
  voice_id: string
  name: string
  preview_url?: string | null
  gender?: string
  accent?: string
  language?: string
  description?: string
  use_case?: string
  category?: string
  free_users_allowed?: boolean
}

interface NormalizedVoice {
  voice_id: string
  name: string
  preview_url: string | null
  gender: 'M' | 'F' | null
  description: string | null
  accent: string | null
  language: string | null
  is_own: boolean
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function parseGender(raw?: string): 'M' | 'F' | null {
  const g = raw?.toLowerCase()
  if (g === 'male') return 'M'
  if (g === 'female') return 'F'
  return null
}

function normalizeOwn(v: OwnVoice): NormalizedVoice {
  const desc = [v.labels?.description, v.labels?.['use case']].filter(Boolean).join(', ')
  return {
    voice_id: v.voice_id,
    name: v.name,
    preview_url: v.preview_url ?? null,
    gender: parseGender(v.labels?.gender),
    description: desc || null,
    accent: v.labels?.accent ?? null,
    language: null,
    is_own: true,
  }
}

function normalizeShared(v: SharedVoice): NormalizedVoice {
  const desc = [v.description, v.use_case].filter(Boolean).join(', ')
  return {
    voice_id: v.voice_id,
    name: v.name,
    preview_url: v.preview_url ?? null,
    gender: parseGender(v.gender),
    description: desc || null,
    accent: v.accent ?? null,
    language: v.language ?? null,
    is_own: false,
  }
}

// ─── Fetch helpers ──────────────────────────────────────────────────────────────

async function fetchOwnVoices(apiKey: string): Promise<NormalizedVoice[]> {
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    const data = await res.json()
    return ((data.voices ?? []) as OwnVoice[]).map(normalizeOwn)
  } catch {
    return []
  }
}

async function fetchSharedPage(
  apiKey: string,
  language: string,
  page: number,
): Promise<{ voices: NormalizedVoice[]; has_more: boolean }> {
  try {
    const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
    url.searchParams.set('page_size', '100')
    url.searchParams.set('page', String(page))
    if (language) url.searchParams.set('language', language)

    const res = await fetch(url.toString(), {
      headers: { 'xi-api-key': apiKey },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { voices: [], has_more: false }

    const data = await res.json()
    const voices = ((data.voices ?? []) as SharedVoice[]).map(normalizeShared)
    return { voices, has_more: data.has_more ?? false }
  } catch {
    return { voices: [], has_more: false }
  }
}

async function fetchSharedVoices(apiKey: string, language: string): Promise<NormalizedVoice[]> {
  // Always fetch page 1; then if has_more fetch pages 2+3 in parallel (max 300 shared)
  const page1 = await fetchSharedPage(apiKey, language, 1)
  const all = [...page1.voices]

  if (page1.has_more) {
    const [p2, p3] = await Promise.all([
      fetchSharedPage(apiKey, language, 2),
      fetchSharedPage(apiKey, language, 3),
    ])
    all.push(...p2.voices)
    if (p2.has_more) all.push(...p3.voices)
  }

  return all
}

// ─── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY ?? ''
    const language = request.nextUrl.searchParams.get('language') ?? ''

    // Fetch own voices + shared in parallel
    const [ownVoices, sharedVoices] = await Promise.all([
      apiKey ? fetchOwnVoices(apiKey) : Promise.resolve([]),
      apiKey ? fetchSharedVoices(apiKey, language) : Promise.resolve([]),
    ])

    // Own voices first, then deduplicated shared voices
    const ownIds = new Set(ownVoices.map((v) => v.voice_id))
    const shared = sharedVoices.filter((v) => !ownIds.has(v.voice_id))

    const voices = [...ownVoices, ...shared]

    console.log(`[api/voices] own=${ownVoices.length} shared=${shared.length} total=${voices.length} lang="${language}"`)

    return NextResponse.json({ ok: true, data: { voices, total: voices.length } })
  } catch (err) {
    console.error('[api/voices]', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { ok: false, error: 'Ошибка соединения с ElevenLabs' },
      { status: 502 }
    )
  }
}
