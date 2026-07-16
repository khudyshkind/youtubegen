// YouTube RSS feed fetcher for channel analytics — zero API quota cost.
// Feeds verified by live requests (2026-07-16):
//   channel_id=UC…  → all recent (shorts + longs mixed, last 15)
//   playlist_id=UULF… → long-form only (last 15)
//   playlist_id=UUSH… → shorts only (last 15)
//   playlist_id=UULP… → top all-time (last 15 by popularity)
// Each entry contains: videoId, title, published, updated, description,
//   thumbnail, views (media:statistics), likes (media:starRating count).
// isShort is detected from link href (/shorts/ vs /watch?v=).

export interface RssVideo {
  videoId:     string
  title:       string
  description: string
  published:   Date
  updated:     Date
  views:       number
  likes:       number
  thumbnail:   string
  isShort:     boolean
  url:         string
}

export type FeedKind = 'all' | 'long' | 'shorts' | 'popular'

const RSS_BASE         = 'https://www.youtube.com/feeds/videos.xml'
const RSS_TTL_MS       = 30 * 60 * 1000  // 30-min in-process cache; YouTube CDN refreshes within minutes
const FETCH_TIMEOUT_MS = 10_000

// Module-level in-process cache (per Railway dyno instance).
const _cache = new Map<string, { data: RssVideo[]; expiresAt: number }>()

function buildFeedUrl(channelId: string, kind: FeedKind): string {
  const bare = channelId.replace(/^UC/, '')
  switch (kind) {
    case 'all':     return `${RSS_BASE}?channel_id=${channelId}`
    case 'long':    return `${RSS_BASE}?playlist_id=UULF${bare}`
    case 'shorts':  return `${RSS_BASE}?playlist_id=UUSH${bare}`
    case 'popular': return `${RSS_BASE}?playlist_id=UULP${bare}`
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
}

function parseEntry(block: string): RssVideo | null {
  try {
    const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(block)?.[1]?.trim()
    if (!videoId) return null

    const title       = decodeXmlEntities(/<title>([^<]*)<\/title>/.exec(block)?.[1] ?? '')
    const published   = /<published>([^<]+)<\/published>/.exec(block)?.[1] ?? ''
    const updated     = /<updated>([^<]+)<\/updated>/.exec(block)?.[1] ?? ''
    const description = decodeXmlEntities(
      (/<media:description>([\s\S]*?)<\/media:description>/.exec(block)?.[1] ?? '').trim()
    )
    const thumbnail = /<media:thumbnail url="([^"]+)"/.exec(block)?.[1] ?? ''
    const views     = parseInt(/<media:statistics views="([^"]+)"/.exec(block)?.[1] ?? '0', 10)
    const likes     = parseInt(/<media:starRating count="([^"]+)"/.exec(block)?.[1] ?? '0', 10)
    const linkHref  = /<link rel="alternate" href="([^"]+)"/.exec(block)?.[1] ?? ''
    const isShort   = linkHref.includes('/shorts/')
    const url       = isShort
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`

    return { videoId, title, description, published: new Date(published), updated: new Date(updated), views, likes, thumbnail, isShort, url }
  } catch {
    return null
  }
}

function parseXml(xml: string): RssVideo[] {
  return xml
    .split('<entry>')
    .slice(1)
    .map(chunk => parseEntry('<entry>' + (chunk.split('</entry>')[0] ?? '') + '</entry>'))
    .filter((v): v is RssVideo => v !== null)
}

// Fetch and parse one YouTube RSS feed. Returns [] on 404, timeout, or network error.
// Results are cached in-process for RSS_TTL_MS (30 min).
export async function fetchChannelFeed(channelId: string, kind: FeedKind): Promise<RssVideo[]> {
  const key = `${channelId}:${kind}`
  const hit = _cache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.data

  const url = buildFeedUrl(channelId, kind)

  try {
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res   = await fetch(url, {
      signal:  ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YouTubeGen/1.0)' },
    })
    clearTimeout(timer)

    if (!res.ok) {
      // 404 = playlist doesn't exist (e.g. channel has no shorts) — not an error
      _cache.set(key, { data: [], expiresAt: Date.now() + RSS_TTL_MS })
      return []
    }

    const data = parseXml(await res.text())
    _cache.set(key, { data, expiresAt: Date.now() + RSS_TTL_MS })
    return data
  } catch {
    // timeout or DNS error — return stale cache if available
    return _cache.get(key)?.data ?? []
  }
}
