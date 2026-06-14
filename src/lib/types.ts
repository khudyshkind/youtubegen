export type Plan = 'free' | 'starter' | 'pro' | 'agency'

export const CREDIT_COSTS = {
  script_sonnet: 1,
  script_opus: 2,
  script_gpt: 1,
  subtitles: 1,
  image: 1,
  video: 2,
  seo: 1,
  thumbnail: 1,
} as const

export type AudioEngine = 'elevenlabs' | 'openai' | 'google'

export const AUDIO_CREDITS_PER_1000_CHARS: Record<AudioEngine, number> = {
  elevenlabs: 3,
  openai: 1,
  google: 1,
}

export function audioCost(chars: number, engine: AudioEngine): number {
  return Math.ceil(chars / 1000) * AUDIO_CREDITS_PER_1000_CHARS[engine]
}

export const PLAN_CREDITS: Record<Plan, number> = {
  free: 20,
  starter: 100,
  pro: 300,
  agency: 1000,
}

// ─── Script params ────────────────────────────────────────────────────────────

export type ScriptLanguage =
  | 'ru' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'zh'
  | 'ja' | 'ko' | 'ar' | 'hi' | 'nl' | 'pl' | 'tr' | 'sv'
  | 'no' | 'da' | 'fi' | 'uk' | 'cs' | 'ro' | 'hu' | 'el'
  | 'he' | 'th' | 'id' | 'vi'

export type ScriptModel = 'claude-sonnet' | 'claude-opus' | 'gpt-4o'
export type NarrativeStyle = 'storytelling' | 'science' | 'documentary' | 'conversational' | 'children'
export type ToneType = 'neutral' | 'emotional' | 'humorous' | 'dramatic' | 'inspiring'
export type AudienceType = 'children' | 'teens' | 'wide' | 'adults'
export type HookType = 'question' | 'statistic' | 'story' | 'provocation'

export interface ScriptParams {
  topic: string
  duration_minutes: number
  language: ScriptLanguage
  model: ScriptModel
  narrative_style: NarrativeStyle
  tone: ToneType
  target_audience: AudienceType
  hook: boolean
  hook_type: HookType
  cta: boolean
  scene_markers: boolean
  pauses: boolean
}

// ─── Voice settings ───────────────────────────────────────────────────────────

export type VoiceStyleType = 'neutral' | 'conversational' | 'documentary' | 'emotional'

export interface VoiceSettings {
  voiceId: string
  speechRate: number       // 0.5–2.0
  stability: number        // 0–1
  similarityBoost: number  // 0–1
  style: VoiceStyleType
  clarityBoost: boolean
  paragraphPauses: boolean
}

// ─── Subtitle style ───────────────────────────────────────────────────────────

export type SubtitleFont = 'sans' | 'serif' | 'mono'
export type SubtitleSize = 'small' | 'medium' | 'large'
export type SubtitlePosition = 'top' | 'center' | 'bottom'
export type SubtitleAnimation = 'none' | 'fade' | 'slide'

export interface SubtitleStyle {
  font: SubtitleFont
  size: SubtitleSize
  color: string
  position: SubtitlePosition
  background: boolean
  animation: SubtitleAnimation
  burnIn: boolean
}

// ─── Profile & project ────────────────────────────────────────────────────────

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  plan: Plan
  credits: number
  paddle_customer_id: string | null
  paddle_subscription_id: string | null
  onboarding_completed: boolean
  is_admin: boolean
  referral_code: string | null
  referred_by: string | null
  referral_count: number
  referral_credits_earned: number
  created_at: string
  updated_at: string
}

export type ProjectStatus =
  | 'draft'
  | 'generating_script'
  | 'generating_audio'
  | 'generating_subtitles'
  | 'generating_images'
  | 'generating_video'
  | 'generating_seo'
  | 'completed'
  | 'failed'

export interface Project {
  id: string
  user_id: string
  title: string
  status: ProjectStatus
  topic: string
  duration_minutes: number
  voice_id: string | null
  script: string | null
  audio_url: string | null
  subtitle_blocks: SubtitleBlock[] | null
  scene_images: SceneImage[] | null
  image_interval: number
  thumbnail_url: string | null
  video_url: string | null
  seo: SeoData | null
  credits_spent: number
  created_at: string
  updated_at: string
}

export interface SubtitleBlock {
  start: number
  end: number
  text: string
}

export interface SceneImage {
  scene_index: number
  prompt: string
  url: string | null
  scene?: string            // Russian scene description from Claude
  timecode_start?: string
  timecode_end?: string
}

export interface SeoData {
  title: string
  title_alt?: string     // A/B variant — user picks one
  description: string    // without hashtags — appended separately on copy
  hashtags: string[]     // 3-5 items, each starts with #
  tags: string[]
}

export interface CreditTransaction {
  id: string
  user_id: string
  amount: number
  operation: string
  project_id: string | null
  created_at: string
}

export interface VoiceParams {
  text: string
  voice_id: string
  stability?: number
  similarity_boost?: number
}

export interface ApiError {
  ok: false
  error: string
  code?: string
}

export interface ApiSuccess<T = void> {
  ok: true
  data: T
}

export type ApiResponse<T = void> = ApiSuccess<T> | ApiError
