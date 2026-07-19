export type Plan = 'free' | 'basic' | 'starter' | 'pro' | 'agency'

export interface PlanSection {
  title: string
  description: string
}

export const CREDIT_COSTS = {
  // Plan
  plan: 400,

  // Script
  script_sonnet: 550,
  script_opus:   900,
  script_gpt:    550,

  // Audio (per 1 000 chars)
  audio_secretvoicer_per_1000:     270,
  audio_openai_per_1000:           450,
  audio_google_per_1000:           480,
  audio_elevenlabs_per_1000:      6600,
  audio_apihost_basic_per_1000:    200,
  audio_apihost_standard_per_1000: 1320,
  audio_apihost_pro_per_1000:      2160,
  audio_apihost_studio_per_1000:   5010,
  audio_voicer_per_1000:           300,

  // Subtitles (per minute of audio)
  subtitles_per_minute: 180,

  // Images
  image: 780,           // legacy alias → Flux
  image_flux: 780,
  image_flux_schnell: 100,
  image_gpt_mini: 1230,    // gpt-image-2 medium 1536×1024 @ $0.041
  image_nano_banana: 1170, // fal-ai/nano-banana @ $0.039
  style_analysis: 60,

  // Video (per-minute rate; billing logic updated separately)
  video: 300,

  // SEO / thumbnail
  seo:       750,
  thumbnail: 2400, // nano-banana-2 @ $0.08 × 30000 = 2400

  // Text tools
  humanize:  660,
  uniqueize: 660,
  enhance:   630,

  // YouTube analytics
  niche_analysis:    1800,
  niche_finder:      7000,
  channel_plan:     12000,
  trends:            1500,
  channel_analysis:  2000,
  revenue_calc:       600,
  comments_analysis: 1800,
  keywords_analysis: 10000,
  channels_compare:  2400,
  rising_stars:      3000,
} as const

export const IMAGE_INTERVAL_MIN = 3    // seconds — lower bound for scene duration
export const IMAGE_INTERVAL_MAX = 300  // seconds — upper bound for scene duration
export const IMAGE_COUNT_MAX    = 450  // hard ceiling on scenes per generation (70 min ÷ 10 s = 420 → rounded up)

export type AudioEngine = 'secretvoicer' | 'elevenlabs' | 'openai' | 'google' | 'apihost' | 'voicer'
export type ApihostVoiceType = 'basic' | 'standard' | 'pro' | 'studio'

export const ENGINE_DISPLAY: Record<string, { name: string; descRu: string; descEn: string }> = {
  secretvoicer: { name: 'Voice Standard', descRu: 'Доступная озвучка, хорошее качество',          descEn: 'Affordable, good quality'                    },
  elevenlabs:   { name: 'Voice Studio',   descRu: 'Премиум — лучшее качество',                    descEn: 'Premium — best quality'                      },
  voicer:       { name: 'Voice Pro',      descRu: 'Мультиязычный, профессиональный',              descEn: 'Multilingual, professional'                  },
  openai:       { name: 'Voice Plus',     descRu: 'Хорошее качество',                             descEn: 'Good quality'                                },
  apihost:      { name: 'Voice Lite',     descRu: 'Российский сервис',                            descEn: 'Russian service'                             },
  google:       { name: 'Voice Global',   descRu: 'Скоро',                                        descEn: 'Coming soon'                                 },
  flux_schnell: { name: 'Vision Fast',    descRu: 'Быстро и дёшево',                             descEn: 'Fast and cheap'                              },
  flux:         { name: 'Vision Classic', descRu: 'Детальные художественные иллюстрации',         descEn: 'Detailed artistic illustrations'             },
  nano_banana:  { name: 'Vision Pro',     descRu: 'Точный текст в кадре, стабильные персонажи',  descEn: 'Accurate in-frame text, stable characters'  },
  gpt_mini:     { name: 'Vision Ultra',   descRu: 'Высокая детализация',                         descEn: 'High detail'                                 },
}

export function audioCost(chars: number, engine: AudioEngine, apihostVoiceType?: ApihostVoiceType): number {
  const blocks = Math.ceil(chars / 1000)
  if (engine === 'secretvoicer') return Math.max(1, blocks * CREDIT_COSTS.audio_secretvoicer_per_1000)
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
    engine === 'voicer'     ? CREDIT_COSTS.audio_voicer_per_1000     :
    CREDIT_COSTS.audio_google_per_1000  // google
  return Math.max(1, blocks * rate)
}

export const PLAN_CREDITS: Record<Plan, number> = {
  free:      10000,
  basic:     80000,
  starter:  200000,
  pro:      500000,
  agency:  1500000,
}

export const PLAN_PRICES: Record<Exclude<Plan, 'free'>, number> = {
  basic:   9,
  starter: 19,
  pro:     39,
  agency:  99,
}

// Maximum accumulated balance (2× monthly allocation)
export const PLAN_MAX_CREDITS: Record<Plan, number> = {
  free:      10000,
  basic:    160000,
  starter:  400000,
  pro:     1000000,
  agency:  3000000,
}

export const TOPUP_PACKAGES = [
  { credits:  50000, price: 7,  label: '50 000 кредитов'  },
  { credits: 200000, price: 26, label: '200 000 кредитов' },
  { credits: 500000, price: 60, label: '500 000 кредитов' },
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
  plan_credits: number
  purchased_credits: number
  plan_activated_at: string | null
  plan_expires_at: string | null
  telegram_chat_id: string | null
  last_expiry_notice_at: string | null
  encrypted_yt_key: string | null
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
  language: string | null
  voice_id: string | null
  plan_sections: PlanSection[] | null
  script: string | null
  audio_url: string | null
  subtitle_blocks: SubtitleBlock[] | null
  scene_images: SceneImage[] | null
  image_interval: number
  image_style: string | null
  thumbnail_url: string | null
  thumbnail_text_mode: string | null
  video_url: string | null
  seo: SeoData | null
  credits_spent: number
  created_at: string
  updated_at: string
  media_purged_at: string | null
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
  engine?: 'flux' | 'flux_schnell' | 'gpt_mini' | 'nano_banana'
  audio_fingerprint?: number
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
  anime:       'anime style, cel shading, Japanese animation, expressive characters',
  render3d:    '3D animated render, Pixar style, volumetric lighting, polished CGI',
  oil:         'oil painting, visible brushstrokes, impasto texture, classical palette',
  dark:        'dark atmospheric, low-key lighting, deep shadows, moody cinematic',
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
