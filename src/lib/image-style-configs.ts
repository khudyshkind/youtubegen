// Shared image style configurations used by both /api/generate/images and /api/generate/image-single.
// Key = IMAGE_STYLES value string sent from the client.
//
// IMPORTANT: "NOT X" in a Flux positive prompt does NOT work as negation — Flux processes
// the word "photorealistic" regardless of "NOT" before it. Always put unwanted concepts in
// the separate negativePrompt field, which maps to Flux's native negative_prompt parameter.
//
// negativePrompt is ONLY forwarded to fal-ai/flux/dev (image-single:260, images:723).
// flux_schnell, nano_banana and gpt_mini silently ignore it — their API has no such field.
// Anti-text for those engines is handled by "NO TEXT, NO NUMBERS..." appended inside each
// engine function. Do NOT duplicate this in fluxSuffix — extra tail tokens dilute attention.
//
// illustrative: true  → images/route.ts uses illustration-mode system prompt (no photo/3D terms)
// illustrative: false → uses photographic/cinematic system prompt (default)
//
// Data source: video-server/image-style-configs.json (single source of truth for both Next.js and Railway).

import _sharedStyles from '../../video-server/image-style-configs.json'

export interface StyleConfig {
  claudeInstruction: string     // replaces generic "Cinematic lighting, photorealistic" in Claude prompts
  fluxSuffix: string            // POSITIVE style descriptors only — appended to every Flux/GPT prompt
  negativePrompt: string        // concepts to avoid — sent as negative_prompt to Flux (NOT inline "NOT X")
  enhanceSystemHint: string     // injected into enhancePrompt system prompt for single-image regen
  fallbackPrompt: string        // pure visual scene for failed/missing scene prompts — no {topic} substitution
  illustrative?: boolean        // true = flat/2D/painted art; scene prompts use illustration rules (no photo/3D)
}

export const STYLE_CONFIGS: Record<string, StyleConfig> = _sharedStyles.STYLE_CONFIGS as unknown as Record<string, StyleConfig>

export const DEFAULT_STYLE_CONFIG: StyleConfig = _sharedStyles.DEFAULT_STYLE_CONFIG as unknown as StyleConfig

export function getStyleConfig(imageStyle?: string | null): StyleConfig {
  return imageStyle ? (STYLE_CONFIGS[imageStyle] ?? DEFAULT_STYLE_CONFIG) : DEFAULT_STYLE_CONFIG
}
