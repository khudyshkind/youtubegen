const YT_BASE = 'https://www.googleapis.com/youtube/v3'

export type ChannelRef =
  | { type: 'handle'; handle: string }
  | { type: 'id'; channelId: string }
  | { type: 'search'; query: string }

export function detectChannelInput(input: string): ChannelRef {
  const handleMatch = input.match(/youtube\.com\/@([\w.-]+)|^@([\w.-]+)/)
  if (handleMatch) return { type: 'handle', handle: handleMatch[1] ?? handleMatch[2] }
  const idMatch = input.match(/youtube\.com\/channel\/(UC[\w-]+)/)
  if (idMatch) return { type: 'id', channelId: idMatch[1] }
  if (/^UC[\w-]{20,}$/.test(input.trim())) return { type: 'id', channelId: input.trim() }
  return { type: 'search', query: input.trim() }
}

async function ytGet(path: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`YouTube API ${res.status} on ${path}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

// Cheap handle-only check: 1 quota unit. Returns channelId or null (no search fallback).
export async function verifyHandle(handle: string, apiKey: string): Promise<string | null> {
  const h = handle.startsWith('@') ? handle.slice(1) : handle
  try {
    const res = await ytGet('/channels', { part: 'snippet', forHandle: h }, apiKey) as { items?: Array<{ id: string }> }
    return res.items?.[0]?.id ?? null
  } catch {
    return null
  }
}

// Full resolution: handle (1 unit) → id (1 unit) → text search (100 units fallback).
// Returns channelId string or null if not found.
export async function resolveChannelId(input: string, apiKey: string): Promise<string | null> {
  const ref = detectChannelInput(input)

  if (ref.type === 'handle') {
    const res = await ytGet('/channels', { part: 'snippet', forHandle: ref.handle }, apiKey) as { items?: Array<{ id: string }> }
    return res.items?.[0]?.id ?? null
  }

  if (ref.type === 'id') {
    const res = await ytGet('/channels', { part: 'snippet', id: ref.channelId }, apiKey) as { items?: Array<{ id: string }> }
    return res.items?.[0]?.id ?? null
  }

  // Text search fallback (100 quota units)
  const searchRes = await ytGet('/search', { part: 'snippet', type: 'channel', q: ref.query, maxResults: '1' }, apiKey) as {
    items?: Array<{ id: { channelId: string } }>
  }
  return searchRes.items?.[0]?.id?.channelId ?? null
}

// Fetches recent video titles for a channel (100 + 1 quota units).
export async function fetchRecentVideoTitles(channelId: string, apiKey: string, max = 15): Promise<string[]> {
  const searchRes = await ytGet('/search', {
    part: 'snippet', channelId, order: 'date',
    maxResults: String(max), type: 'video',
  }, apiKey) as { items?: Array<{ id: { videoId: string }; snippet: { title: string } }> }

  const items = searchRes.items ?? []
  if (!items.length) return []

  const ids = items.map(v => v.id.videoId).filter(Boolean).join(',')
  const statsRes = await ytGet('/videos', { part: 'snippet', id: ids }, apiKey) as {
    items?: Array<{ snippet: { title: string } }>
  }
  return (statsRes.items ?? []).map(v => v.snippet.title)
}
