// Lightweight scene analysis helper for /api/tools/illustrations/scenes.
// The full scene generation (prompts via Claude Haiku) lives in /api/generate/images.
// This module handles only: auto scene-count detection + brief scene descriptions for preview.

import Anthropic from '@anthropic-ai/sdk'
import { env } from '@/lib/env'

export interface ScenePreview {
  index: number
  description: string
}

export interface SceneCountResult {
  scene_count: number
  preview: ScenePreview[]
}

const DETECT_PROMPT = `Analyze this video script/text. Determine how many distinct visual scenes (separate topics, events, or moments) it contains.

Rules:
- Min 3 scenes, max 30 scenes
- Short text (< 200 words): 3–6 scenes
- Medium text (200–600 words): 6–12 scenes
- Long text (600+ words): 12–25 scenes
- Each scene = one topic or moment that needs its own illustration

Write a brief 1-sentence description of each scene (in the same language as the text).

Response — valid JSON only, no markdown:
{"count": N, "scenes": ["description 1", "description 2", ...]}`

export async function detectSceneCount(text: string): Promise<SceneCountResult> {
  try {
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 30_000 })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `${DETECT_PROMPT}\n\nText:\n${text.slice(0, 3000)}`,
      }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned) as { count: unknown; scenes: unknown }
    const count = Math.min(30, Math.max(3, parseInt(String(parsed.count), 10) || 6))
    const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : []

    return {
      scene_count: count,
      preview: rawScenes.slice(0, count).map((desc: unknown, i: number) => ({
        index: i + 1,
        description: String(desc),
      })),
    }
  } catch {
    // Fallback: word-count heuristic
    const words = text.split(/\s+/).filter(Boolean).length
    const count = Math.min(20, Math.max(3, Math.round(words / 80)))
    return { scene_count: count, preview: [] }
  }
}
