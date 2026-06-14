import { useStudioStore } from './studio-store'

export async function refreshCredits(): Promise<void> {
  try {
    const res = await fetch('/api/profile')
    if (!res.ok) return
    const json: { ok: boolean; credits?: number } = await res.json()
    if (json.ok && typeof json.credits === 'number') {
      useStudioStore.getState().setCredits(json.credits)
    }
  } catch {
    // silent — don't break generation flow
  }
}
