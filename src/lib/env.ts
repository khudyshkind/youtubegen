// Strips BOM (U+FEFF, char code 65279) that PowerShell adds when piping env var values.
// Apply to every secret read from process.env before passing to SDK clients.
export function env(key: string): string {
  const val = process.env[key] ?? ''
  return val.charCodeAt(0) === 0xfeff ? val.slice(1) : val
}
