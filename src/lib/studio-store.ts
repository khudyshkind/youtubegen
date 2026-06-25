import { create } from 'zustand'
import type {
  ScriptParams, SubtitleBlock, SceneImage, SeoData,
  VoiceSettings, SubtitleStyle,
} from './types'

export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7

interface StudioState {
  currentStep: Step
  projectId: string | null

  // Step 1: Topic & params
  scriptParams: ScriptParams

  // Step 2: Script
  script: string | null

  // Step 3: Voice
  voiceSettings: VoiceSettings
  audioUrl: string | null

  // Step 4: Subtitles
  subtitleBlocks: SubtitleBlock[]
  subtitleStyle: SubtitleStyle

  // Step 5: Illustrations
  sceneImages: SceneImage[]
  imageInterval: number  // seconds per scene (3–30)
  imageStyle: string | null

  // Step 6: Video
  videoUrl: string | null

  // Step 7: SEO + Thumbnail
  seo: SeoData | null
  thumbnailUrl: string | null
  thumbnailBgUrl: string | null
  thumbnailTextMode: 'overlay' | 'ai' | 'none'
  setThumbnailTextMode: (mode: 'overlay' | 'ai' | 'none') => void

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
  setScript: (script: string) => void
  setVoiceSettings: (settings: Partial<VoiceSettings>) => void
  setVoiceId: (id: string) => void          // backwards-compat for DB restore
  setAudioUrl: (url: string) => void
  setSubtitleBlocks: (blocks: SubtitleBlock[]) => void
  setSubtitleStyle: (style: Partial<SubtitleStyle>) => void
  setSceneImages: (images: SceneImage[]) => void
  setImageInterval: (interval: number) => void
  setImageStyle: (style: string | null) => void
  setVideoUrl: (url: string) => void
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
  hook: false,
  hook_type: 'question',
  cta: false,
  scene_markers: false,
  pauses: false,
}

const defaultVoiceSettings: VoiceSettings = {
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  speechRate: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
  style: 'neutral',
  clarityBoost: false,
  paragraphPauses: false,
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
  script: null,
  voiceSettings: defaultVoiceSettings,
  audioUrl: null,
  subtitleBlocks: [],
  subtitleStyle: defaultSubtitleStyle,
  sceneImages: [],
  imageInterval: 10,
  imageStyle: null,
  videoUrl: null,
  seo: null,
  thumbnailUrl: null,
  thumbnailBgUrl: null,
  thumbnailTextMode: 'overlay' as 'overlay' | 'ai' | 'none',
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
  setScript: (script) => set({ script }),
  setVoiceSettings: (settings) =>
    set((s) => ({ voiceSettings: { ...s.voiceSettings, ...settings } })),
  setVoiceId: (id) =>
    set((s) => ({ voiceSettings: { ...s.voiceSettings, voiceId: id } })),
  setAudioUrl: (url) => set({ audioUrl: url }),
  setSubtitleBlocks: (blocks) => set({ subtitleBlocks: blocks }),
  setSubtitleStyle: (style) =>
    set((s) => ({ subtitleStyle: { ...s.subtitleStyle, ...style } })),
  setSceneImages: (images) => set({ sceneImages: images }),
  setImageInterval: (interval) => set({ imageInterval: Math.max(3, Math.min(30, interval)) }),
  setImageStyle: (style) => set({ imageStyle: style }),
  setVideoUrl: (url) => set({ videoUrl: url }),
  setSeo: (seo) => set({ seo }),
  setThumbnailUrl: (url) => set({ thumbnailUrl: url }),
  setThumbnailBgUrl: (url) => set({ thumbnailBgUrl: url }),
  setThumbnailTextMode: (mode) => set({ thumbnailTextMode: mode }),
  setCredits: (n) => set({ credits: n }),
  setGenerating: (isGenerating, step) =>
    set({ isGenerating, generatingStep: step ?? null }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}))
