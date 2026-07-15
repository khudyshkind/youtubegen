// Shared image style configurations used by both /api/generate/images and /api/generate/image-single.
// Key = IMAGE_STYLES value string sent from the client.
//
// IMPORTANT: "NOT X" in a Flux positive prompt does NOT work as negation — Flux processes
// the word "photorealistic" regardless of "NOT" before it. Always put unwanted concepts in
// the separate negativePrompt field, which maps to Flux's native negative_prompt parameter.
//
// negativePrompt is ONLY forwarded to fal-ai/flux/dev (image-single:260, images:723).
// flux_schnell, nano_banana and gpt_mini silently ignore it — their API has no such field.
// NO_TEXT_POSITIVE is therefore injected into every fluxSuffix via getStyleConfig() so the
// anti-text constraint reaches all four engines as a positive directive.

export interface StyleConfig {
  claudeInstruction: string     // replaces generic "Cinematic lighting, photorealistic" in Claude prompts
  fluxSuffix: string            // POSITIVE style descriptors only — appended to every Flux/GPT prompt
  negativePrompt: string        // concepts to avoid — sent as negative_prompt to Flux (NOT inline "NOT X")
  enhanceSystemHint: string     // injected into enhancePrompt system prompt for single-image regen
  fallbackPrompt: string        // template for failed/missing scene prompts ({topic} is replaced)
}

// Injected into every fluxSuffix by getStyleConfig() — works on ALL engines (flux, schnell, NB, GPT)
// because those engines have no negativePrompt field. Positive constraint is the only reliable lever.
export const NO_TEXT_POSITIVE = 'clean wordless illustration, no speech bubbles, no signs, no labels, no captions, no written words or letters anywhere, characters express meaning through poses gestures and facial expressions only'

export const STYLE_CONFIGS: Record<string, StyleConfig> = {
  'hand-drawn illustration, pencil sketch style, artistic line art': {
    claudeInstruction: 'Hand-drawn pencil sketch only. Black and white line art. Describe subject and composition using pencil-sketch vocabulary: hatching, cross-hatching, pencil strokes. 20–25 words.',
    fluxSuffix: 'hand-drawn pencil sketch, black and white line art, hatching technique, pencil strokes, monochrome illustration',
    negativePrompt: 'photorealistic, photograph, color, cinematic lighting, cartoon, watercolor, digital art, oil painting, 3d render, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Hand-drawn pencil sketch style. Black and white. No color, no photo, no cinematic.',
    fallbackPrompt: 'Hand-drawn pencil sketch of scene related to {topic}, black and white line art, detailed hatching',
  },
  'cartoon style, vibrant colors, animated illustration, bold lines': {
    claudeInstruction: 'Cartoon illustration. Bold outlines, vibrant flat colors, animated style. Describe characters and scenes as cartoon visuals. 20–25 words.',
    fluxSuffix: 'cartoon illustration, bold outlines, vibrant flat colors, animated style, 2d animation',
    negativePrompt: 'photorealistic, photograph, cinematic lighting, pencil sketch, watercolor, realistic texture, 3d render, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Cartoon illustration style. Bold colors, animated. No photorealism, no cinematic.',
    fallbackPrompt: 'Cartoon illustration of scene related to {topic}, bold outlines, vibrant colors',
  },
  'watercolor painting style, soft colors, textured paper, artistic': {
    claudeInstruction: 'Watercolor painting. Soft blended colors, textured paper. Describe subjects with painterly vocabulary: washes, wet-on-wet, soft edges. 20–25 words.',
    fluxSuffix: 'watercolor painting, soft blended washes, wet-on-wet technique, textured paper background, artistic painting',
    negativePrompt: 'photorealistic, photograph, cinematic lighting, sharp lines, pencil sketch, cartoon, digital art, 3d render, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Watercolor painting style. Soft blended colors. No sharp lines, no photo, no cinematic.',
    fallbackPrompt: 'Watercolor painting of scene related to {topic}, soft blended colors, textured paper',
  },
  'cinematic photography, dramatic lighting, movie still, wide-angle': {
    claudeInstruction: 'Cinematic movie still frame. CRITICAL: first describe the actual subject, action and setting from the scene text — what is happening, who or what is in frame, and where. Apply cinematic treatment (dramatic lighting, wide-angle, depth of field) only as framing around that concrete content. The subject and action must stay clearly identifiable, never replaced by mood words. 25-35 words.',
    fluxSuffix: 'cinematic photography, dramatic lighting, movie still, wide-angle lens, film grain, depth of field',
    negativePrompt: 'cartoon, sketch, watercolor, painting, illustration, anime, low quality, blurry, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Cinematic photography style. Dramatic lighting, movie still.',
    fallbackPrompt: 'Cinematic scene related to {topic}, dramatic lighting, movie still, wide angle',
  },
  'flat 2D doodle cartoon, minimalist stick figures, bold black outlines, simple comedic style': {
    claudeInstruction: 'Doodle cartoon scene. Stick-figure characters — humans AND animals are all drawn as simple doodles with round heads, dot eyes and thin limbs (a doodle monkey is a stick figure with monkey ears/tail, not a realistic monkey) — but ALWAYS describe a full, specific environment around them (place, background objects, weather/season, colorful details). Never describe signs, labels, books with visible text, banners, screens with text, or characters speaking in bubbles. The illustration must be wordless — convey meaning through action, posture and objects. Simple characters, rich scene. 35–45 words.',
    fluxSuffix: 'flat 2D doodle cartoon illustration, ALL characters — humans and animals alike — drawn as simple stick-figure doodles with round heads, dot eyes and thin limbs, bold thick black outlines, vibrant saturated flat colors, no shading, no 3D volume, colorful cartoon background environment with props and scenery, playful expressive poses',
    negativePrompt: 'photorealistic, photograph, 3d render, 3d volume, shading, fur texture, detailed animals, realistic animals, pixar style, rendered characters, realistic anatomy, complex textures, cinematic lighting, watercolor, pencil sketch, detailed faces, white background, empty background, plain background, blank canvas, isolated object, sparse composition, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Doodle cartoon style: all creatures — humans and animals — drawn in the same flat stick-figure doodle manner with round heads and dot eyes, bold outlines, vibrant flat colors, in a full colorful scene with background environment. Simple characters, rich world.',
    fallbackPrompt: 'Doodle cartoon scene related to {topic}, stick figure characters with round heads, bold black outlines, vibrant saturated flat colors, no shading, colorful cartoon background environment',
  },
  'neon cyberpunk style, vibrant neon colors, futuristic dystopia': {
    claudeInstruction: 'Neon cyberpunk aesthetic. Futuristic urban dystopia, glowing neon lights. Describe city scenes with neon glow vocabulary. 20–25 words.',
    fluxSuffix: 'neon cyberpunk aesthetic, glowing neon lights, futuristic city, dark dystopian atmosphere, vibrant neon colors',
    negativePrompt: 'naturalistic, daytime countryside, watercolor, pencil sketch, cartoon, soft colors, pastel, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Neon cyberpunk style. Futuristic city, glowing neon. No naturalism, no soft colors.',
    fallbackPrompt: 'Cyberpunk neon scene related to {topic}, futuristic city, glowing neon lights',
  },
  'photorealistic, professional photography, detailed, shot on camera': {
    claudeInstruction: 'Photorealistic photograph. First describe the actual subject, action and setting from the scene text — what is happening and who or what is in frame. Render it with professional camera realism and sharp detail. The concrete content must be clearly described, not just photographic style. 25-35 words.',
    fluxSuffix: 'photorealistic, professional photography, sharp detail, shot on DSLR, 8K resolution',
    negativePrompt: 'cartoon, sketch, watercolor, painting, illustration, anime, low quality, blur, grain, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Photorealistic photography style. Professional camera, detailed.',
    fallbackPrompt: 'Photorealistic scene related to {topic}, professional photography, detailed',
  },
  'anime style, cel shading, Japanese animation, expressive characters': {
    claudeInstruction: 'Anime illustration in modern Japanese animation style. First describe the actual subject, action and setting from the scene text — what is happening and who or what is in frame. Render with clean cel-shaded lines, expressive eyes, vibrant colors. 20-25 words.',
    fluxSuffix: 'anime style, cel shading, clean linework, expressive large eyes, vibrant colors, modern Japanese animation',
    negativePrompt: 'photorealistic, photograph, 3d render, western cartoon, pencil sketch, watercolor, oil painting, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Anime illustration style. Cel shading, clean linework. No photorealism, no western cartoon.',
    fallbackPrompt: 'Anime-style illustration of scene related to {topic}, cel shading, vibrant colors, expressive characters',
  },
  '3D animated render, Pixar style, volumetric lighting, polished CGI': {
    claudeInstruction: '3D animated render in polished Pixar-like style. First describe the actual subject, action and setting from the scene text — what is happening and who or what is in frame. Render with soft volumetric lighting, smooth rounded forms, rich detail. 20-25 words.',
    fluxSuffix: '3d animated render, pixar style, soft volumetric lighting, smooth rounded shapes, subsurface scattering, polished cgi',
    negativePrompt: 'photorealistic photograph, 2d flat, pencil sketch, watercolor, anime cel shading, oil painting, low poly, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: '3D Pixar-style render. Volumetric lighting, smooth shapes. No flat 2D, no photorealism.',
    fallbackPrompt: '3D Pixar-style render of scene related to {topic}, soft lighting, smooth shapes, polished CGI',
  },
  'oil painting, visible brushstrokes, impasto texture, classical palette': {
    claudeInstruction: 'Classical oil painting. First describe the actual subject, action and setting from the scene text — what is happening and who or what is in frame. Render with visible brushstrokes, rich textured impasto, warm classical palette. 20-25 words.',
    fluxSuffix: 'oil painting, visible brushstrokes, textured impasto, rich classical palette, canvas texture, old master style',
    negativePrompt: 'photorealistic, photograph, 3d render, digital art, cartoon, anime, pencil sketch, flat colors, cgi, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Classical oil painting style. Visible brushstrokes, impasto texture. No photorealism, no digital art.',
    fallbackPrompt: 'Oil painting of scene related to {topic}, visible brushstrokes, rich textured colors, classical style',
  },
  'dark atmospheric, low-key lighting, deep shadows, moody cinematic': {
    claudeInstruction: 'Dark atmospheric cinematic scene. First describe the actual subject, action and setting from the scene text — what is happening and who or what is in frame. Render with deep shadows, moody low-key lighting, muted desaturated tones, heavy atmosphere. 25-35 words.',
    fluxSuffix: 'dark atmospheric, low-key lighting, deep shadows, moody, muted desaturated colors, cinematic, dramatic chiaroscuro',
    negativePrompt: 'bright, cheerful, vibrant colors, cartoon, sketch, watercolor, high-key lighting, pastel, daytime, text, numbers, digits, numerals, typography, lettering, written words',
    enhanceSystemHint: 'Dark atmospheric style. Low-key lighting, deep shadows. No bright colors, no cartoon.',
    fallbackPrompt: 'Dark atmospheric scene related to {topic}, deep shadows, moody lighting, muted tones',
  },
}

export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  claudeInstruction: 'Cinematic lighting, photorealistic. 25–35 words.',
  fluxSuffix: 'cinematic lighting, photorealistic, detailed',
  negativePrompt: 'cartoon, sketch, watercolor, low quality, text, numbers, digits, numerals, typography, lettering, written words',
  enhanceSystemHint: 'Photorealistic style. Cinematic lighting.',
  fallbackPrompt: 'Cinematic scene related to {topic}, dramatic lighting, photorealistic, wide shot',
}

export function getStyleConfig(imageStyle?: string | null): StyleConfig {
  const base = imageStyle ? (STYLE_CONFIGS[imageStyle] ?? DEFAULT_STYLE_CONFIG) : DEFAULT_STYLE_CONFIG
  // NO_TEXT_POSITIVE appended here — single injection point that reaches ALL engines
  // (flux, flux_schnell, nano_banana, gpt_mini) as a positive constraint.
  return { ...base, fluxSuffix: `${base.fluxSuffix}, ${NO_TEXT_POSITIVE}` }
}
