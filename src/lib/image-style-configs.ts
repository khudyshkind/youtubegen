// Shared image style configurations used by both /api/generate/images and /api/generate/image-single.
// Key = IMAGE_STYLES value string sent from the client.
// fluxSuffix negates conflicting style terms so Flux doesn't blend styles.

export interface StyleConfig {
  claudeInstruction: string   // replaces generic "Cinematic lighting, photorealistic" in Claude prompts
  fluxSuffix: string          // appended to every Flux/GPT prompt; must negate conflicting terms
  enhanceSystemHint: string   // injected into enhancePrompt system prompt for single-image regen
  fallbackPrompt: string      // template for failed/missing scene prompts ({topic} is replaced)
}

export const STYLE_CONFIGS: Record<string, StyleConfig> = {
  'hand-drawn illustration, pencil sketch style, artistic line art': {
    claudeInstruction: 'Hand-drawn pencil sketch only. Black and white line art. Describe the subject and composition using pencil-sketch vocabulary. NO cinematic, NO photorealism, NO color. 20–25 words.',
    fluxSuffix: 'hand-drawn pencil sketch, black and white line art, consistent hatching technique, pencil strokes only, NOT photorealistic, NOT colored, NOT cinematic, NOT cartoon',
    enhanceSystemHint: 'Hand-drawn pencil sketch style. Black and white. No color, no cinematic, no photorealism.',
    fallbackPrompt: 'Hand-drawn pencil sketch of scene related to {topic}, black and white line art, detailed hatching',
  },
  'cartoon style, vibrant colors, animated illustration, bold lines': {
    claudeInstruction: 'Cartoon illustration. Bold outlines, vibrant flat colors, animated style. NO photorealism, NO cinematic. 20–25 words.',
    fluxSuffix: 'cartoon illustration, bold outlines, vibrant flat colors, animated style, NOT photorealistic, NOT cinematic, NOT sketch',
    enhanceSystemHint: 'Cartoon illustration style. Bold colors, animated. No photorealism, no cinematic.',
    fallbackPrompt: 'Cartoon illustration of scene related to {topic}, bold outlines, vibrant colors',
  },
  'watercolor painting style, soft colors, textured paper, artistic': {
    claudeInstruction: 'Watercolor painting. Soft blended colors, textured paper. NO photorealism, NO harsh lines, NO cinematic. 20–25 words.',
    fluxSuffix: 'watercolor painting, soft blended colors, wet-on-wet technique, textured paper background, NOT photorealistic, NOT sketch, NOT cinematic',
    enhanceSystemHint: 'Watercolor painting style. Soft blended colors. No photorealism, no cinematic.',
    fallbackPrompt: 'Watercolor painting of scene related to {topic}, soft blended colors, textured paper',
  },
  'cinematic photography, dramatic lighting, movie still, wide-angle': {
    claudeInstruction: 'Cinematic photography. Movie still frame, dramatic lighting, wide-angle. 25–35 words.',
    fluxSuffix: 'cinematic photography, dramatic lighting, movie still, wide-angle lens, film grain, depth of field',
    enhanceSystemHint: 'Cinematic photography style. Dramatic lighting, movie still.',
    fallbackPrompt: 'Cinematic scene related to {topic}, dramatic lighting, movie still, wide angle',
  },
  'neon cyberpunk style, vibrant neon colors, futuristic dystopia': {
    claudeInstruction: 'Neon cyberpunk aesthetic. Futuristic urban dystopia, glowing neon lights. NO naturalism. 20–25 words.',
    fluxSuffix: 'neon cyberpunk aesthetic, glowing neon lights, futuristic city, dark dystopian atmosphere, vibrant neon colors',
    enhanceSystemHint: 'Neon cyberpunk style. Futuristic city, glowing neon. No naturalism.',
    fallbackPrompt: 'Cyberpunk neon scene related to {topic}, futuristic city, glowing neon lights',
  },
  'photorealistic, professional photography, detailed, shot on camera': {
    claudeInstruction: 'Photorealistic photography. Professional camera shot, detailed. 25–35 words.',
    fluxSuffix: 'photorealistic, professional photography, sharp detail, shot on DSLR, 8K resolution',
    enhanceSystemHint: 'Photorealistic photography style. Professional camera, detailed.',
    fallbackPrompt: 'Photorealistic scene related to {topic}, professional photography, detailed',
  },
}

export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  claudeInstruction: 'Cinematic lighting, photorealistic. 25–35 words.',
  fluxSuffix: 'cinematic lighting, photorealistic, detailed',
  enhanceSystemHint: 'Photorealistic style. Cinematic lighting.',
  fallbackPrompt: 'Cinematic scene related to {topic}, dramatic lighting, photorealistic, wide shot',
}

export function getStyleConfig(imageStyle?: string | null): StyleConfig {
  if (!imageStyle) return DEFAULT_STYLE_CONFIG
  return STYLE_CONFIGS[imageStyle] ?? DEFAULT_STYLE_CONFIG
}
