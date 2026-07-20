import Anthropic from '@anthropic-ai/sdk'

/** True for Anthropic 529 (overloaded) or 503 (service unavailable). */
export function isAnthropicOverload(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 529 || error.status === 503
  }
  // Fallback: check message for SDKs that serialise status into message
  const msg = error instanceof Error ? error.message : String(error)
  return /529|overloaded_error|overloaded/i.test(msg)
}

/**
 * Calls fn(); on 529/503 waits 16 ± 4 s and retries once.
 * All other errors propagate immediately (no retry).
 */
export async function withAnthropicRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!isAnthropicOverload(err)) throw err
    const delay = 16_000 + Math.floor(Math.random() * 4_000)
    console.warn(`[${label}] Anthropic overload (529/503) — retrying in ${Math.round(delay / 1000)}s`)
    await new Promise<void>(r => setTimeout(r, delay))
    return await fn()  // propagates on second failure
  }
}
