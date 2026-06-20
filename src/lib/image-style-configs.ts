// Shared image style configurations used by both /api/generate/images and /api/generate/image-single.
// Key = IMAGE_STYLES value string sent from the client.
//
// IMPORTANT: "NOT X" in a Flux positive prompt does NOT work as negation — Flux processes
// the word "photorealistic" regardless of "NOT" before it. Always put unwanted concepts in
// the separate negativePrompt field, which maps to Flux's native negative_prompt parameter.

export interface StyleConfig {
  claudeInstruction: string     // replaces generic "Cinematic lighting, photorealistic" in Claude prompts
  fluxSuffix: string            // POSITIVE style descriptors only — appended to every Flux/GPT prompt
  negativePrompt: string        // concepts to avoid — sent as negative_prompt to Flux (NOT inline "NOT X")
  enhanceSystemHint: string     // injected into enhancePrompt system prompt for single-image regen
  fallbackPrompt: string        // template for failed/missing scene prompts ({topic} is replaced)
}

export const STYLE_CONFIGS: Record<string, StyleConfig> = {
  'hand-drawn illustration, pencil sketch style, artistic line art': {
    claudeInstruction: 'Hand-drawn pencil sketch only. Black and white line art. Describe subject and composition using pencil-sketch vocabulary: hatching, cross-hatching, pencil strokes. 20–25 words.',
    fluxSuffix: 'hand-drawn pencil sketch, black and white line art, hatching technique, pencil strokes, monochrome illustration',
    negativePrompt: 'photorealistic, photograph, color, cinematic lighting, cartoon, watercolor, digital art, oil painting, 3d render',
    enhanceSystemHint: 'Hand-drawn pencil sketch style. Black and white. No color, no photo, no cinematic.',
    fallbackPrompt: 'Hand-drawn pencil sketch of scene related to {topic}, black and white line art, detailed hatching',
  },
  'cartoon style, vibrant colors, animated illustration, bold lines': {
    claudeInstruction: 'Cartoon illustration. Bold outlines, vibrant flat colors, animated style. Describe characters and scenes as cartoon visuals. 20–25 words.',
    fluxSuffix: 'cartoon illustration, bold outlines, vibrant flat colors, animated style, 2d animation',
    negativePrompt: 'photorealistic, photograph, cinematic lighting, pencil sketch, watercolor, realistic texture, 3d render',
    enhanceSystemHint: 'Cartoon illustration style. Bold colors, animated. No photorealism, no cinematic.',
    fallbackPrompt: 'Cartoon illustration of scene related to {topic}, bold outlines, vibrant colors',
  },
  'watercolor painting style, soft colors, textured paper, artistic': {
    claudeInstruction: 'Watercolor painting. Soft blended colors, textured paper. Describe subjects with painterly vocabulary: washes, wet-on-wet, soft edges. 20–25 words.',
    fluxSuffix: 'watercolor painting, soft blended washes, wet-on-wet technique, textured paper background, artistic painting',
    negativePrompt: 'photorealistic, photograph, cinematic lighting, sharp lines, pencil sketch, cartoon, digital art, 3d render',
    enhanceSystemHint: 'Watercolor painting style. Soft blended colors. No sharp lines, no photo, no cinematic.',
    fallbackPrompt: 'Watercolor painting of scene related to {topic}, soft blended colors, textured paper',
  },
  'cinematic photography, dramatic lighting, movie still, wide-angle': {
    claudeInstruction: 'Cinematic photography. Movie still frame, dramatic lighting, wide-angle composition. 25–35 words.',
    fluxSuffix: 'cinematic photography, dramatic lighting, movie still, wide-angle lens, film grain, depth of field',
    negativePrompt: 'cartoon, sketch, watercolor, painting, illustration, anime, low quality, blurry',
    enhanceSystemHint: 'Cinematic photography style. Dramatic lighting, movie still.',
    fallbackPrompt: 'Cinematic scene related to {topic}, dramatic lighting, movie still, wide angle',
  },
  'neon cyberpunk style, vibrant neon colors, futuristic dystopia': {
    claudeInstruction: 'Neon cyberpunk aesthetic. Futuristic urban dystopia, glowing neon lights. Describe city scenes with neon glow vocabulary. 20–25 words.',
    fluxSuffix: 'neon cyberpunk aesthetic, glowing neon lights, futuristic city, dark dystopian atmosphere, vibrant neon colors',
    negativePrompt: 'naturalistic, daytime countryside, watercolor, pencil sketch, cartoon, soft colors, pastel',
    enhanceSystemHint: 'Neon cyberpunk style. Futuristic city, glowing neon. No naturalism, no soft colors.',
    fallbackPrompt: 'Cyberpunk neon scene related to {topic}, futuristic city, glowing neon lights',
  },
  'photorealistic, professional photography, detailed, shot on camera': {
    claudeInstruction: 'Photorealistic photography. Professional camera shot, sharp detail. 25–35 words.',
    fluxSuffix: 'photorealistic, professional photography, sharp detail, shot on DSLR, 8K resolution',
    negativePrompt: 'cartoon, sketch, watercolor, painting, illustration, anime, low quality, blur, grain',
    enhanceSystemHint: 'Photorealistic photography style. Professional camera, detailed.',
    fallbackPrompt: 'Photorealistic scene related to {topic}, professional photography, detailed',
  },
}

export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  claudeInstruction: 'Cinematic lighting, photorealistic. 25–35 words.',
  fluxSuffix: 'cinematic lighting, photorealistic, detailed',
  negativePrompt: 'cartoon, sketch, watercolor, low quality',
  enhanceSystemHint: 'Photorealistic style. Cinematic lighting.',
  fallbackPrompt: 'Cinematic scene related to {topic}, dramatic lighting, photorealistic, wide shot',
}

export function getStyleConfig(imageStyle?: string | null): StyleConfig {
  if (!imageStyle) return DEFAULT_STYLE_CONFIG
  return STYLE_CONFIGS[imageStyle] ?? DEFAULT_STYLE_CONFIG
}
