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

// ── Chunk-processing helpers ────────────────────────────────────────────────

/** Texts ≤ this word count use a single Claude call; longer texts are chunked. */
export const CHUNK_THRESHOLD = 800

/** First N words of text (seam context for adjacent chunks). */
export function chunkHeadWords(text: string, n: number): string {
  return text.trim().split(/\s+/).slice(0, n).join(' ')
}

/** Last N words of text (seam context for adjacent chunks). */
export function chunkTailWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/)
  return words.slice(Math.max(0, words.length - n)).join(' ')
}

/**
 * Split `text` into chunks of approximately `targetWords` words.
 * Primary boundary: paragraph separator (\n\n+).
 * Oversized single paragraphs are further split on sentence-end markers.
 *
 * INVARIANT: chunks.map(c => c.text + c.sep).join('') === original text.
 */
export function splitIntoChunks(
  text: string,
  targetWords = 550,
): Array<{ text: string; sep: string }> {
  // rawParts alternates: [content, sep, content, sep, ..., content]
  const rawParts = text.split(/(\n\n+)/)

  type Unit = { text: string; sep: string }
  const units: Unit[] = []

  for (let i = 0; i < rawParts.length; i += 2) {
    const content = rawParts[i]
    const sep = rawParts[i + 1] ?? ''
    if (!content) continue

    if (countWords(content) <= targetWords) {
      units.push({ text: content, sep })
    } else {
      // Split oversized paragraph on sentence-end markers
      const sentences = content.split(/(?<=[.!?…»"'])\s+/)
      let acc = ''
      for (const sent of sentences) {
        if (acc && countWords(acc) + countWords(sent) > targetWords) {
          units.push({ text: acc, sep: ' ' })
          acc = sent
        } else {
          acc = acc ? `${acc} ${sent}` : sent
        }
      }
      if (acc) units.push({ text: acc, sep })
    }
  }

  if (units.length === 0) return [{ text: text.trim(), sep: '' }]

  // Merge units into chunks; flush when the next unit would exceed targetWords
  const chunks: Unit[] = []
  let pending: Unit[] = []
  let pendingWords = 0

  function flush() {
    if (!pending.length) return
    const chunkText =
      pending.slice(0, -1).map(u => u.text + u.sep).join('') + pending.at(-1)!.text
    chunks.push({ text: chunkText, sep: pending.at(-1)!.sep })
    pending = []
    pendingWords = 0
  }

  for (const unit of units) {
    const w = countWords(unit.text)
    if (pendingWords > 0 && pendingWords + w > targetWords) flush()
    pending.push(unit)
    pendingWords += w
  }
  flush()

  return chunks
}

/**
 * Build the user-message content for a single chunk Claude call.
 * Seam words from adjacent original chunks are provided as read-only context
 * for smooth transitions; Claude must not include them in its output.
 */
export function buildChunkUserMessage(
  chunkText: string,
  index: number,
  total: number,
  prevSeam: string | null,
  nextSeam: string | null,
): string {
  const parts: string[] = []
  if (prevSeam) {
    parts.push(`[Предшествующий контекст — только для понимания стыка, в ответ НЕ включать]: «…${prevSeam}»`)
  }
  parts.push(
    `ТЕКСТ (фрагмент ${index + 1} из ${total} — обработать ТОЛЬКО его, объём ±15%, без вступлений и заключений):`,
  )
  parts.push(chunkText)
  if (nextSeam) {
    parts.push(`[Следующий контекст — только для понимания стыка, в ответ НЕ включать]: «…${nextSeam}»`)
  }
  return parts.join('\n')
}
