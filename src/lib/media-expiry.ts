export const RETENTION_MEDIA_HOURS = 72

export function mediaExpiryFromNow(): string {
  return new Date(Date.now() + RETENTION_MEDIA_HOURS * 3_600_000).toISOString()
}
