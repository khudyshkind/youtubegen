import { createServiceClient } from './supabase-server'

export async function trackEvent(
  userId: string,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('analytics_events').insert({
      user_id: userId,
      event,
      properties: properties ?? {},
    })
  } catch (err) {
    console.error('[analytics] track error:', err)
  }
}
