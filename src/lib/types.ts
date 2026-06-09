export type Plan = 'free' | 'starter' | 'pro' | 'agency'

export const CREDIT_COSTS = {
  script: 10,
  voice: 5,
  subtitles: 3,
  image: 8,
  seo: 5,
} as const

export const PLAN_CREDITS: Record<Plan, number> = {
  free: 5,
  starter: 50,
  pro: 200,
  agency: 1000,
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  plan: Plan
  credits: number
  paddle_customer_id: string | null
  paddle_subscription_id: string | null
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
  video_url: string | null
  seo: SeoData | null
  credits_spent: number
  created_at: string
  updated_at: string
}

export interface ScriptParams {
  topic: string
  duration_minutes: number
  style?: 'educational' | 'entertaining' | 'motivational' | 'news'
  target_audience?: string
}

export interface VoiceParams {
  text: string
  voice_id: string
  stability?: number
  similarity_boost?: number
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
}

export interface SeoData {
  title: string
  description: string
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
