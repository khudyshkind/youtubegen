import { NextResponse } from 'next/server'

export class YouTubeQuotaError extends Error {
  constructor() {
    super('youtube_quota_exceeded')
    this.name = 'YouTubeQuotaError'
  }
}

/**
 * Throws YouTubeQuotaError if the response indicates the API quota is exhausted.
 * Call this after receiving a non-ok YouTube API response, before throwing the generic error.
 */
export function checkYouTubeQuota(status: number, body: string): void {
  if (status !== 403) return
  try {
    const json = JSON.parse(body) as { error?: { errors?: Array<{ reason?: string }> } }
    const reasons = (json.error?.errors ?? []).map(e => e.reason ?? '')
    if (reasons.some(r => r === 'quotaExceeded' || r === 'dailyLimitExceeded')) {
      throw new YouTubeQuotaError()
    }
  } catch (e) {
    if (e instanceof YouTubeQuotaError) throw e
  }
}

export function quotaExceededResponse(lang = 'ru'): NextResponse {
  const isRu = lang !== 'en'
  return NextResponse.json(
    {
      ok: false,
      error: isRu
        ? 'Аналитика временно недоступна: дневная квота YouTube API исчерпана. Обновится в полночь по тихоокеанскому времени (PT). Попробуйте позже.'
        : 'Analytics temporarily unavailable: YouTube daily API quota exceeded. Resets at midnight Pacific Time (PT). Please try again later.',
      code: 'youtube_quota_exceeded',
    },
    { status: 503 }
  )
}
