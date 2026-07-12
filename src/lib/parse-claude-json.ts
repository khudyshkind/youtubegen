function fixControlCharsInStrings(s: string): string {
  let result = ''
  let inStr = false
  let esc = false
  for (const c of s) {
    if (esc) { result += c; esc = false; continue }
    if (c === '\\') { result += c; esc = true; continue }
    if (c === '"') { inStr = !inStr; result += c; continue }
    if (inStr) {
      if (c === '\n') { result += '\\n'; continue }
      if (c === '\r') { result += '\\r'; continue }
      if (c === '\t') { result += '\\t'; continue }
    }
    result += c
  }
  return result
}

function tryParse<T>(slice: string, label: string): T {
  try {
    return JSON.parse(slice) as T
  } catch {
    const repaired = fixControlCharsInStrings(slice)
    try {
      return JSON.parse(repaired) as T
    } catch (e2) {
      console.error(`[parse-claude-json] ${label} parse failed. Slice (first 2000):`, slice.substring(0, 2000))
      throw new Error(`${label}: JSON parse failed — ${e2 instanceof Error ? e2.message : String(e2)}`)
    }
  }
}

export function parseClaudeJson<T>(text: string, label: string): T {
  console.log(`[parse-claude-json] ${label} raw length:`, text.length, 'preview:', text.substring(0, 300))
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error(`${label}: no { found`)

  // Pass 1: exact boundary scanner
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    if (c === '}') {
      depth--
      if (depth === 0) return tryParse<T>(cleaned.slice(start, i + 1), label)
    }
  }

  // Pass 2: greedy fallback — handles unescaped quotes that confuse the scanner
  console.warn(`[parse-claude-json] ${label} exact scan lost track (depth=${depth}), trying greedy fallback`)
  const lastBrace = cleaned.lastIndexOf('}')
  if (lastBrace > start) {
    try {
      return tryParse<T>(cleaned.slice(start, lastBrace + 1), label)
    } catch { /* fall through to Pass 3 */ }
  }

  // Pass 3: truncation recovery — close open structures for max_tokens cutoff
  console.warn(`[parse-claude-json] ${label} attempting truncation recovery`)
  const fragment = cleaned.slice(start)
  const stack: string[] = []
  let rInStr = false, rEsc = false
  for (const c of fragment) {
    if (rEsc) { rEsc = false; continue }
    if (c === '\\') { rEsc = true; continue }
    if (c === '"') { rInStr = !rInStr; continue }
    if (rInStr) continue
    if (c === '{') stack.push('}')
    if (c === '[') stack.push(']')
    if (c === '}' || c === ']') {
      if (stack.length > 0) stack.pop()
    }
  }
  if (stack.length > 0 || rInStr) {
    const closing = (rInStr ? '"' : '') + stack.reverse().join('')
    try {
      return tryParse<T>(fragment + closing, label)
    } catch { /* fall through to throw */ }
  }

  throw new Error(`${label}: unbalanced braces`)
}

export function parseClaudeJsonArray<T>(text: string, label: string): T[] {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  const start = cleaned.indexOf('[')
  if (start === -1) throw new Error(`${label}: no [ found`)

  // Pass 1: exact bracket scanner
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '[') depth++
    if (c === ']') {
      depth--
      if (depth === 0) return tryParse<T[]>(cleaned.slice(start, i + 1), label)
    }
  }

  // Pass 2: greedy fallback
  console.warn(`[parse-claude-json] ${label} array exact scan lost track, trying greedy fallback`)
  const lastBracket = cleaned.lastIndexOf(']')
  if (lastBracket > start) {
    try { return tryParse<T[]>(cleaned.slice(start, lastBracket + 1), label) }
    catch { /* fall through */ }
  }

  throw new Error(`${label}: unbalanced brackets`)
}
