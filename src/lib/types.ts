export type Plan = 'free' | 'basic' | 'starter' | 'pro' | 'agency'

export const CREDIT_COSTS = {
  // Script
  script_sonnet: 4,
  script_opus:   7,
  script_gpt:    6,

  // Audio (per 1 000 chars)
  audio_openai_per_1000:          4,
  audio_elevenlabs_per_1000:     79,
  audio_apihost_basic_per_1000:   2,
  audio_apihost_standard_per_1000: 5,
  audio_apihost_pro_per_1000:    10,
  audio_apihost_studio_per_1000: 18,

  // Subtitles (per minute of audio)
  subtitles_per_minute: 2,

  // Images
  image: 7,           // legacy alias → Flux
  image_flux: 7,
  image_gpt_mini: 2,
  style_analysis: 2,

  // Video
  video: 1,

  // SEO / thumbnail
  seo:       2,
  thumbnail: 7,

  // Text tools
  humanize:  3,
  uniqueize: 3,

  // YouTube analytics
  niche_analysis:    4,
  niche_finder:      6,
  channel_plan:      8,
  trends:            3,
  channel_analysis:  6,
  revenue_calc:      2,
  comments_analysis: 4,
  keywords_analysis: 3,
  channels_compare:  6,
  rising_stars:      6,
} as const

export type AudioEngine = 'elevenlabs' | 'openai' | 'google' | 'apihost'
export type ApihostVoiceType = 'basic' | 'standard' | 'pro' | 'studio'

export function audioCost(chars: number, engine: AudioEngine, apihostVoiceType?: ApihostVoiceType): number {
  const blocks = Math.ceil(chars / 1000)
  if (engine === 'apihost') {
    const rates: Record<ApihostVoiceType, number> = {
      basic:    CREDIT_COSTS.audio_apihost_basic_per_1000,
      standard: CREDIT_COSTS.audio_apihost_standard_per_1000,
      pro:      CREDIT_COSTS.audio_apihost_pro_per_1000,
      studio:   CREDIT_COSTS.audio_apihost_studio_per_1000,
    }
    return Math.max(1, blocks * (rates[apihostVoiceType ?? 'standard']))
  }
  const rate =
    engine === 'elevenlabs' ? CREDIT_COSTS.audio_elevenlabs_per_1000 :
    engine === 'openai'     ? CREDIT_COSTS.audio_openai_per_1000     :
    CREDIT_COSTS.audio_openai_per_1000  // google same as openai
  return Math.max(1, blocks * rate)
}

export const PLAN_CREDITS: Record<Plan, number> = {
  free:    30,
  basic:   800,
  starter: 2000,
  pro:     5000,
  agency:  15000,
}

export const PLAN_PRICES: Record<Exclude<Plan, 'free'>, number> = {
  basic:   9,
  starter: 19,
  pro:     39,
  agency:  99,
}

// Maximum accumulated balance (2× monthly allocation)
export const PLAN_MAX_CREDITS: Record<Plan, number> = {
  free:    30,
  basic:   1600,
  starter: 4000,
  pro:     10000,
  agency:  30000,
}

export const TOPUP_PACKAGES = [
  { credits: 500,  price: 7,  label: '500 кредитов'  },
  { credits: 2000, price: 26, label: '2000 кредитов' },
  { credits: 5000, price: 60, label: '5000 кредитов' },
] as const

export const PLAN_ORDER: Plan[] = ['free', 'basic', 'starter', 'pro', 'agency']

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
  preferred_lang: string | null
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
  image_style: string | null
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
  scene?: string
  timecode_start?: string
  timecode_end?: string
}

export interface SeoData {
  title: string
  title_alt?: string
  description: string
  hashtags: string[]
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

export const IMAGE_STYLES = {
  realistic:   'photorealistic, professional photography, detailed, shot on camera',
  cartoon:     'cartoon style, vibrant colors, animated illustration, bold lines',
  sketch:      'hand-drawn illustration, pencil sketch style, artistic line art',
  watercolor:  'watercolor painting style, soft colors, textured paper, artistic',
  cinematic:   'cinematic photography, dramatic lighting, movie still, wide-angle',
  cyberpunk:   'neon cyberpunk style, vibrant neon colors, futuristic dystopia',
  doodle:      'flat 2D doodle cartoon, minimalist stick figures, bold black outlines, simple comedic style',
} as const

export type ImageStyleKey = keyof typeof IMAGE_STYLES

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
