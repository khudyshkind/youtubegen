export type ThumbnailTextMode = 'overlay' | 'ai' | 'none'

// Returned by Claude vision analysis for Mode A text overlay.
// All fields map directly to Satori rendering parameters.
export interface TextOverlayParams {
  position: 'top-center' | 'bottom-left'
  textColor: string        // hex, e.g. "#FFFFFF" or "#FFD700"
  uppercase: boolean
  strokeColor: string | null   // null = no stroke
  strokeWidth: number          // 0–6 px
  accentBar: boolean           // red left-edge vertical bar (bottom-left only)
  bandOpacity: number          // 0.0–0.9 — semi-transparent dark band behind text
}
