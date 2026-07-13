// Shared token-budget and output-quality guard for AI text-processing routes
// (enhance-script, uniqueize). Constants declared here exactly once.

export const TOKENS_PER_WORD  = 2.9   // Conservative: covers RU (≈2.3 tok/word), EN (≈1.3), mixed
export const SAFETY_FACTOR    = 1.4   // Headroom for hooks, CTA, pauses, humanisation (up to 40%)
export const MIN_TOKENS       = 4_096
export const MAX_TOKENS       = 32_768
export const MIN_OUTPUT_RATIO = 0.85  // Output must retain ≥85% of input word count

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function calcMaxTokens(inputText: string): number {
  const raw = Math.ceil(countWords(inputText) * TOKENS_PER_WORD * SAFETY_FACTOR)
  return Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, raw))
}

// Returns true when the model finished normally AND the output retained enough words.
export function isGuardOk(
  stopReason: string | null | undefined,
  outputText: string,
  inputWords: number,
): boolean {
  return stopReason !== 'max_tokens' && countWords(outputText) >= inputWords * MIN_OUTPUT_RATIO
}
