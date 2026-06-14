// Strips BOM (U+FEFF, char code 65279) that PowerShell adds when piping env var values,
// then trims surrounding whitespace. Apply to every secret from process.env.
export function env(key: string): string {
  const val = process.env[key] ?? ''
  const stripped = val.charCodeAt(0) === 0xfeff ? val.slice(1) : val
  return stripped.trim()
}
