import { create } from 'zustand'
import { IMAGE_INTERVAL_MIN, IMAGE_INTERVAL_MAX } from './types'
import type {
  ScriptParams, SubtitleBlock, SceneImage, SeoData,
  VoiceSettings, SubtitleStyle, PlanSection,
} from './types'

export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** Append ?t=<ts> to a raw audio URL for cache-busting. Strips any existing ?t= first. */
export function stampAudioUrl(rawUrl: string, ts: number): string {
  return `${rawUrl.split('?')[0]}?t=${ts}`
}

interface StudioState {
  currentStep: Step
  projectId: string | null

  // Step 1: Topic & params
  scriptParams: ScriptParams
  ownScript: boolean

  // Step 2: Plan
  planSections: PlanSection[]

  // Step 3: Script
  script: string | null

  // Step 3: Voice
  voiceSettings: VoiceSettings
  audioUrl: string | null

  // Step 4: Subtitles
  subtitleBlocks: SubtitleBlock[]
  subtitleStyle: SubtitleStyle
  // ?t= timestamp from audioUrl when subtitles were last generated (session-only)
  subtitleAudioTs: number | null

  // Step 5: Illustrations
  sceneImages: SceneImage[]
  imageInterval: number  // seconds per scene (IMAGE_INTERVAL_MIN–IMAGE_INTERVAL_MAX)
  imageStyle: string | null
  imageEngine: 'flux' | 'flux_schnell' | 'gpt_mini' | 'nano_banana'
  audioCostEstimate: number | null

  // Step 6: Video
  videoUrl: string | null
  renderJobId: string | null

  // Step 7: SEO + Thumbnail
  seo: SeoData | null
  thumbnailUrl: string | null
  thumbnailBgUrl: string | null
  thumbnailTextMode: 'overlay' | 'ai' | 'none'
  setThumbnailTextMode: (mode: 'overlay' | 'ai' | 'none') => void

  // True only when subtitles were generated or confirmed in the current wizard session.
  // Loaded-from-DB blocks leave this false so Step 7 defaults to "no burn-in" until
  // the user explicitly visits Step 5 or enables the toggle.
  subtitlesConfirmedThisSession: boolean
  setSubtitlesConfirmedThisSession: (v: boolean) => void

  // Status of the project as it was when loaded from DB (null = new project).
  // Used to detect a completed project being re-generated after opening for review.
  projectStatus: string | null
  setProjectStatus: (status: string | null) => void

  // Set by retention cron when media (images/audio/video) have been purged.
  // UI uses this to show a banner and block video render.
  mediaPurgedAt: string | null
  setMediaPurgedAt: (ts: string | null) => void

  // Global credits (synced from /api/profile, updated after each generation)
  credits: number | null
  setCredits: (n: number) => void

  isGenerating: boolean
  generatingStep: string | null
  error: string | null

  // Actions
  setStep: (step: Step) => void
  setProjectId: (id: string) => void
  setScriptParams: (params: Partial<ScriptParams>) => void
  setOwnScript: (v: boolean) => void
  setPlanSections: (sections: PlanSection[]) => void
  setScript: (script: string) => void
  setVoiceSettings: (settings: Partial<VoiceSettings>) => void
  setVoiceId: (id: string) => void          // backwards-compat for DB restore
  setAudioUrl: (url: string) => void
  setSubtitleBlocks: (blocks: SubtitleBlock[]) => void
  setSubtitleAudioTs: (ts: number | null) => void
  setSubtitleStyle: (style: Partial<SubtitleStyle>) => void
  setSceneImages: (images: SceneImage[]) => void
  setImageInterval: (interval: number) => void
  setImageStyle: (style: string | null) => void
  setImageEngine: (engine: 'flux' | 'flux_schnell' | 'gpt_mini' | 'nano_banana') => void
  setAudioCostEstimate: (v: number | null) => void
  setVideoUrl: (url: string | null) => void
  setRenderJobId: (id: string | null) => void
  setSeo: (seo: SeoData) => void
  setThumbnailUrl: (url: string | null) => void
  setThumbnailBgUrl: (url: string | null) => void
  setGenerating: (isGenerating: boolean, step?: string) => void
  setError: (error: string | null) => void
  reset: () => void
}

const defaultScriptParams: ScriptParams = {
  topic: '',
  duration_minutes: 5,
  language: 'ru',
  model: 'claude-sonnet',
  narrative_style: 'storytelling',
  tone: 'neutral',
  target_audience: 'wide',
  hook: true,
  hook_type: 'question',
  cta: true,
  scene_markers: false,
  pauses: false,
}

const defaultVoiceSettings: VoiceSettings = {
  voiceId: 'EXAVITQu4vr4xnSDxMaL', // ElevenLabs voice; used only when user switches to ElevenLabs engine
  speechRate: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
  style: 'neutral',
  clarityBoost: false,
}

const defaultSubtitleStyle: SubtitleStyle = {
  font: 'sans',
  size: 'medium',
  color: '#FFFFFF',
  position: 'bottom',
  background: true,
  animation: 'none',
  burnIn: false,
}

const initialState = {
  currentStep: 1 as Step,
  projectId: null,
  scriptParams: defaultScriptParams,
  ownScript: false,
  planSections: [] as PlanSection[],
  script: null,
  voiceSettings: defaultVoiceSettings,
  audioUrl: null,
  subtitleBlocks: [],
  subtitleStyle: defaultSubtitleStyle,
  subtitleAudioTs: null,
  subtitlesConfirmedThisSession: false,
  sceneImages: [],
  imageInterval: 10,
  imageStyle: null,
  imageEngine: 'flux' as 'flux' | 'flux_schnell' | 'gpt_mini' | 'nano_banana',
  audioCostEstimate: null,
  videoUrl: null,
  renderJobId: null,
  seo: null,
  thumbnailUrl: null,
  thumbnailBgUrl: null,
  thumbnailTextMode: 'overlay' as 'overlay' | 'ai' | 'none',
  projectStatus: null as string | null,
  mediaPurgedAt: null as string | null,
  credits: null as number | null,
  isGenerating: false,
  generatingStep: null,
  error: null,
}

export const useStudioStore = create<StudioState>((set) => ({
  ...initialState,

  setStep: (step) => set({ currentStep: step }),
  setProjectId: (id) => set({ projectId: id }),
  setScriptParams: (params) =>
    set((s) => ({ scriptParams: { ...s.scriptParams, ...params } })),
  setOwnScript: (v) => set({ ownScript: v }),
  setPlanSections: (sections) => set({ planSections: sections }),
  setScript: (script) => set({ script }),
  setVoiceSettings: (settings) =>
    set((s) => ({ voiceSettings: { ...s.voiceSettings, ...settings } })),
  setVoiceId: (id) =>
    set((s) => ({ voiceSettings: { ...s.voiceSettings, voiceId: id } })),
  setAudioUrl: (url) => set({ audioUrl: url }),
  setSubtitleBlocks: (blocks) => set({ subtitleBlocks: blocks }),
  setSubtitleAudioTs: (ts) => set({ subtitleAudioTs: ts }),
  setSubtitlesConfirmedThisSession: (v) => set({ subtitlesConfirmedThisSession: v }),
  setSubtitleStyle: (style) =>
    set((s) => ({ subtitleStyle: { ...s.subtitleStyle, ...style } })),
  setSceneImages: (images) => set({ sceneImages: images }),
  setImageInterval: (interval) => set({ imageInterval: Math.max(IMAGE_INTERVAL_MIN, Math.min(IMAGE_INTERVAL_MAX, interval)) }),
  setImageStyle: (style) => set({ imageStyle: style }),
  setImageEngine: (engine) => set({ imageEngine: engine }),
  setAudioCostEstimate: (v) => set({ audioCostEstimate: v }),
  setVideoUrl: (url) => set({ videoUrl: url ?? null }),
  setRenderJobId: (id) => set({ renderJobId: id }),
  setSeo: (seo) => set({ seo }),
  setThumbnailUrl: (url) => set({ thumbnailUrl: url }),
  setThumbnailBgUrl: (url) => set({ thumbnailBgUrl: url }),
  setThumbnailTextMode: (mode) => set({ thumbnailTextMode: mode }),
  setProjectStatus: (status) => set({ projectStatus: status }),
  setMediaPurgedAt: (ts) => set({ mediaPurgedAt: ts }),
  setCredits: (n) => set({ credits: n }),
  setGenerating: (isGenerating, step) =>
    set({ isGenerating, generatingStep: step ?? null }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}))
