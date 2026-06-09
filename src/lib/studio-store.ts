import { create } from 'zustand'
import type { ScriptParams, SubtitleBlock, SceneImage, SeoData } from './types'

type Step = 1 | 2 | 3 | 4 | 5 | 6

interface StudioState {
  currentStep: Step
  projectId: string | null

  // Step 1: Topic & params
  scriptParams: ScriptParams

  // Step 2: Script
  script: string | null

  // Step 3: Voice & audio
  voiceId: string
  audioUrl: string | null
  subtitleBlocks: SubtitleBlock[]

  // Step 4: Illustrations
  sceneImages: SceneImage[]

  // Step 5: Video
  videoUrl: string | null

  // Step 6: SEO
  seo: SeoData | null

  // Status
  isGenerating: boolean
  generatingStep: string | null
  error: string | null

  // Actions
  setStep: (step: Step) => void
  setProjectId: (id: string) => void
  setScriptParams: (params: Partial<ScriptParams>) => void
  setScript: (script: string) => void
  setVoiceId: (id: string) => void
  setAudioUrl: (url: string) => void
  setSubtitleBlocks: (blocks: SubtitleBlock[]) => void
  setSceneImages: (images: SceneImage[]) => void
  setVideoUrl: (url: string) => void
  setSeo: (seo: SeoData) => void
  setGenerating: (isGenerating: boolean, step?: string) => void
  setError: (error: string | null) => void
  reset: () => void
}

const defaultParams: ScriptParams = {
  topic: '',
  duration_minutes: 5,
  style: 'educational',
  target_audience: 'широкая аудитория',
}

const initialState = {
  currentStep: 1 as Step,
  projectId: null,
  scriptParams: defaultParams,
  script: null,
  voiceId: '',
  audioUrl: null,
  subtitleBlocks: [],
  sceneImages: [],
  videoUrl: null,
  seo: null,
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
  setVoiceId: (id) => set({ voiceId: id }),
  setAudioUrl: (url) => set({ audioUrl: url }),
  setSubtitleBlocks: (blocks) => set({ subtitleBlocks: blocks }),
  setSceneImages: (images) => set({ sceneImages: images }),
  setVideoUrl: (url) => set({ videoUrl: url }),
  setSeo: (seo) => set({ seo }),
  setGenerating: (isGenerating, step) =>
    set({ isGenerating, generatingStep: step ?? null }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}))
