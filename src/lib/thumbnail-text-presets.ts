export type ThumbnailTextMode = 'overlay' | 'ai' | 'none'
export type TextPresetKey = 'default' | 'cartoon'

// Styles that look better with the cartoon text preset (flat, illustrated, painted)
const CARTOON_STYLE_MARKERS = ['cartoon', 'doodle', 'hand-drawn', 'sketch', 'watercolor', 'flat 2d']

export function getTextPresetKey(imageStyle?: string | null): TextPresetKey {
  if (!imageStyle) return 'default'
  const s = imageStyle.toLowerCase()
  return CARTOON_STYLE_MARKERS.some((m) => s.includes(m)) ? 'cartoon' : 'default'
}

// Per-preset, how to phrase the title in a Flux background prompt for Mode B (AI draws text).
export function getModeBAiPromptSuffix(title: string, presetKey: TextPresetKey): string {
  if (presetKey === 'cartoon') {
    return `, with the bold title text "${title}" drawn in large cartoon lettering at the top, uppercase, thick black outline, styled as part of the illustration`
  }
  return `, with bold YouTube-style title text "${title}" displayed prominently, large dramatic typography integrated into the scene`
}
