'use client'

import { useCallback, useRef, useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import { exportPrompts } from '@/lib/exportPrompts'
import { CREDIT_COSTS, IMAGE_STYLES } from '@/lib/types'
import type { SceneImage, ImageStyleKey } from '@/lib/types'
import { refreshCredits } from '@/lib/refresh-credits'
import { confirmRegenIfCompleted } from '@/lib/confirm-regen'
import { useLang } from '@/hooks/useLang'

const INTERVAL_PRESETS = [5, 8, 10, 15, 20] as const
const MAX_GPT_MINI_SAFE = 20
// Engines hidden from UI cards but still accepted by the server (backward-compat reserve)
const HIDDEN_ENGINES = ['gpt_mini'] as const
// Styles where Schnell (4 inference steps) produces visible artifacts on faces/hands
const RISKY_STYLES_FOR_SCHNELL = ['realistic', 'cinematic'] as const

// Parse timecode "M:SS.mm" → seconds. Returns -1 if invalid.
function parseTimecode(tc: string | undefined): number {
  if (!tc) return -1
  const [minPart, secPart] = tc.split(':')
  const mins = parseInt(minPart || '0', 10)
  const secs = parseFloat(secPart || '0')
  if (isNaN(mins) || isNaN(secs)) return -1
  return mins * 60 + secs
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function AudioSyncPlayer({
  audioUrl,
  images,
  audioRef,
  onActiveChange,
}: {
  audioUrl: string
  images: SceneImage[]
  audioRef: React.RefObject<HTMLAudioElement | null>
  onActiveChange: (idx: number | null) => void
}) {
  const { t } = useLang()
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (!audio) return
    const t = audio.currentTime
    setCurrentTime(t)

    let found: number | null = null
    for (let i = 0; i < images.length; i++) {
      const start = parseTimecode(images[i].timecode_start)
      const end = parseTimecode(images[i].timecode_end)
      if (start >= 0 && end > start && t >= start && t < end) {
        found = i
        break
      }
    }
    // Keep last scene active if past its end
    if (found === null && images.length > 0) {
      const lastEnd = parseTimecode(images[images.length - 1].timecode_end)
      if (lastEnd >= 0 && t >= lastEnd) found = images.length - 1
    }
    onActiveChange(found)
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) { audio.pause() } else { void audio.play() }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current
    if (!audio) return
    const t = parseFloat(e.target.value)
    audio.currentTime = t
    setCurrentTime(t)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2.5"
      style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); onActiveChange(null) }}
        preload="metadata"
      />

      <div className="flex items-center gap-3">
        {/* Play / Pause */}
        <button
          type="button"
          onClick={togglePlay}
          className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-colors"
          style={{ background: 'rgba(124,58,237,0.35)', color: '#C4B5FD' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.55)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.35)')}
          title={isPlaying ? t('step5.pause') : t('step5.play')}
        >
          {isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Seekable progress bar */}
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #7C3AED ${progress}%, rgba(255,255,255,0.1) ${progress}%)`,
              accentColor: '#7C3AED',
            }}
          />
        </div>

        {/* Time counter */}
        <span className="text-xs text-slate-400 shrink-0 tabular-nums">
          {formatTime(currentTime)}<span className="text-slate-600 mx-0.5">/</span>{formatTime(duration)}
        </span>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'rgba(196,181,253,0.7)' }}>
        {t('step5.listen_hint')}{' '}
        <span style={{ color: 'rgba(196,181,253,0.45)' }}>
          {t('step5.click_hint')}
        </span>
      </p>
    </div>
  )
}

export default function Step5Images() {
  const {
    script, scriptParams, subtitleBlocks, projectId, audioUrl,
    sceneImages, imageInterval, imageStyle, imageEngine,
    setSceneImages, setImageInterval, setStep, setImageStyle, setImageEngine,
  } = useStudioStore()

  const { t } = useLang()
  const [showGptLimitModal, setShowGptLimitModal] = useState(false)
  // Overrides imageCount for display/cost when user picks "Reduce to 20" from modal
  const [gptCountOverride, setGptCountOverride] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [customInterval, setCustomInterval] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState('')
  const imageFilesRef = useRef<HTMLInputElement>(null)

  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)

  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editingPrompt, setEditingPrompt] = useState('')
  const editingPromptRef = useRef('')
  const [regenLoading, setRegenLoading] = useState<Set<number>>(new Set())
  const [regenErrors, setRegenErrors] = useState<Record<number, string>>({})

  // Style selector
  const [selectedStyleKey, setSelectedStyleKey] = useState<ImageStyleKey | 'none'>(() => {
    if (!imageStyle) return 'none'
    const match = (Object.entries(IMAGE_STYLES) as [ImageStyleKey, string][]).find(([, v]) => v === imageStyle)
    return match ? match[0] : 'none'
  })
  const [refStyle, setRefStyle] = useState<string | null>(() => {
    if (!imageStyle) return null
    const isPreset = (Object.values(IMAGE_STYLES) as string[]).includes(imageStyle)
    return isPreset ? null : imageStyle
  })
  const [refPreviewUrl, setRefPreviewUrl] = useState<string | null>(null)
  const [refAnalyzing, setRefAnalyzing] = useState(false)
  const styleRefInputRef = useRef<HTMLInputElement>(null)

  // Audio sync
  const audioRef = useRef<HTMLAudioElement>(null)
  const [activeSceneIdx, setActiveSceneIdx] = useState<number | null>(null)

  const audioDurationSec =
    subtitleBlocks.length > 0
      ? Math.ceil(subtitleBlocks[subtitleBlocks.length - 1].end)
      : scriptParams.duration_minutes * 60

  const imageCount = Math.max(1, Math.ceil(audioDurationSec / imageInterval))
  const costPerImage =
    imageEngine === 'gpt_mini'     ? CREDIT_COSTS.image_gpt_mini :
    imageEngine === 'flux_schnell' ? CREDIT_COSTS.image_flux_schnell :
    imageEngine === 'nano_banana'  ? CREDIT_COSTS.image_nano_banana :
    CREDIT_COSTS.image_flux
  // displayCount respects the "reduce to 20" override; actual imageCount is unaffected
  const displayCount = gptCountOverride ?? imageCount
  const creditCost = displayCount * costPerImage

  function handleIntervalPreset(sec: number) {
    setImageInterval(sec)
    setCustomInterval('')
    setGptCountOverride(null)
  }

  function handleCustomIntervalChange(raw: string) {
    setCustomInterval(raw)
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n >= 3 && n <= 300) { setImageInterval(n); setGptCountOverride(null) }
  }

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    if (!projectId) { setUploadError(t('step5.err_no_project')); return }
    setUploadError('')
    setUploading(true)
    setUploadProgress(0)
    try {
      const uploaded: SceneImage[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const signRes = await fetch('/api/upload/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'image', project_id: projectId, index: i + 1, content_type: file.type || 'image/jpeg' }),
        })
        const signJson = await signRes.json()
        if (!signJson.ok) throw new Error(signJson.error)
        const { signed_url, access_url } = signJson.data
        const uploadRes = await fetch(signed_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file })
        if (!uploadRes.ok) throw new Error(`${t('step5.err_upload')} ${i + 1}`)
        // Add ?t= so React re-renders if the same scene is re-uploaded
        uploaded.push({ scene_index: i + 1, url: `${access_url}?t=${Date.now()}`, prompt: '' })
        setUploadProgress(Math.round(((i + 1) / files.length) * 100))
      }
      // Merge: keep existing scenes, overwrite/add uploaded ones by scene_index
      const current = useStudioStore.getState().sceneImages
      const merged = [...current]
      for (const img of uploaded) {
        const idx = merged.findIndex(p => p.scene_index === img.scene_index)
        if (idx >= 0) merged[idx] = img
        else merged.push(img)
      }
      setSceneImages(merged.sort((a, b) => a.scene_index - b.scene_index))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('step5.err_upload'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }, [projectId, setSceneImages])

  async function handleRefUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setRefPreviewUrl(URL.createObjectURL(file))
    setRefAnalyzing(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      if (projectId) fd.append('project_id', projectId)
      const res = await fetch('/api/generate/analyze-style', { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.ok) {
        setError(json.code === 'NO_CREDITS' ? `${t('msg.no_credits')} (2 ${t('nav.credits_suffix')})` : json.error)
        setRefPreviewUrl(null)
        return
      }
      const desc: string = json.data.style_description
      setRefStyle(desc)
      setImageStyle(desc)
      setSelectedStyleKey('none')
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка анализа стиля')
      setRefPreviewUrl(null)
    } finally {
      setRefAnalyzing(false)
      e.target.value = ''
    }
  }

  async function handleGenerate(overrideEngine?: 'flux' | 'flux_schnell', overrideCount?: number) {
    if (!script?.trim()) { setError(t('step5.err_no_script')); return }

    // Show confirmation only for the initial call (not the recursive modal override)
    if (!overrideEngine && !confirmRegenIfCompleted(t('regen_confirm.message'))) return

    const effectiveEngine = overrideEngine ?? imageEngine
    const effectiveCount = overrideCount ?? imageCount

    // Pre-check: show modal if GPT Mini with too many images
    if (!overrideEngine && effectiveEngine === 'gpt_mini' && effectiveCount > MAX_GPT_MINI_SAFE) {
      setShowGptLimitModal(true)
      return
    }

    setShowGptLimitModal(false)
    setError('')
    setLoading(true)
    setProgress(null)
    setSceneImages([])

    try {
      const res = await fetch('/api/generate/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script, topic: scriptParams.topic, duration_sec: audioDurationSec,
          image_count: effectiveCount, project_id: projectId, image_interval: imageInterval,
          subtitle_blocks: subtitleBlocks.length > 0 ? subtitleBlocks : undefined,
          engine: effectiveEngine,
          image_style: imageStyle ?? undefined,
        }),
      })

      // Pre-stream errors (401, 402, 400) are plain JSON
      if (!res.ok) {
        const json = await res.json()
        if (json.code === 'NO_CREDITS') { setError(`${t('step5.err_gen')} (${creditCost} ${t('nav.credits_suffix')})`); return }
        if (json.code === 'TOO_MANY_FOR_GPT_MINI') { setShowGptLimitModal(true); return }
        throw new Error(json.error ?? t('step5.err_gen'))
      }

      // Read SSE stream
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // SSE events are separated by \n\n; keep the last incomplete chunk in buffer
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as {
              type: string
              total?: number
              completed?: number
              images?: SceneImage[]
              error?: string
            }

            if (data.type === 'start') {
              setProgress({ completed: 0, total: data.total ?? imageCount })
            } else if (data.type === 'progress') {
              setProgress({ completed: data.completed ?? 0, total: data.total ?? imageCount })
              if (data.images?.length) {
                const ts = Date.now()
                const newImgs = data.images.map((img) => ({
                  ...img,
                  url: img.url ? `${img.url}?t=${ts}` : img.url,
                }))
                // Merge into existing progressively-rendered images
                const current = useStudioStore.getState().sceneImages
                const merged = [...current]
                for (const img of newImgs) {
                  const idx = merged.findIndex((p) => p.scene_index === img.scene_index)
                  if (idx >= 0) merged[idx] = img
                  else merged.push(img)
                }
                setSceneImages(merged.sort((a, b) => a.scene_index - b.scene_index))
              }
            } else if (data.type === 'done') {
              const ts = Date.now()
              setSceneImages((data.images ?? []).map((img) => ({
                ...img,
                url: img.url ? `${img.url}?t=${ts}` : img.url,
              })))
              void refreshCredits()
            } else if (data.type === 'error') {
              throw new Error(data.error ?? t('step5.err_gen'))
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue // malformed chunk — skip
            throw parseErr
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('step5.err_gen'))
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  function openEditor(sceneIndex: number, currentPrompt: string) {
    const val = currentPrompt || ''
    setEditingIdx(sceneIndex)
    setEditingPrompt(val)
    editingPromptRef.current = val
    setRegenErrors((prev) => { const n = { ...prev }; delete n[sceneIndex]; return n })
  }

  function closeEditor() {
    setEditingIdx(null)
    setEditingPrompt('')
    editingPromptRef.current = ''
  }

  async function handleSingleRegen(sceneIndex: number) {
    if (!projectId) { setRegenErrors((prev) => ({ ...prev, [sceneIndex]: t('step5.err_no_save') })); return }
    setRegenLoading((prev) => new Set([...prev, sceneIndex]))
    setRegenErrors((prev) => { const n = { ...prev }; delete n[sceneIndex]; return n })
    try {
      const promptToSend = editingPromptRef.current
      const res = await fetch('/api/generate/image-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, scene_index: sceneIndex, prompt: promptToSend, engine: imageEngine, image_style: imageStyle ?? undefined }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setRegenErrors((prev) => ({ ...prev, [sceneIndex]: `${t('msg.no_credits')} (${costPerImage} ${t('nav.credits_suffix')})` }))
          return
        }
        throw new Error(json.error)
      }
      const raw: SceneImage = json.data.image
      const newImage: SceneImage = { ...raw, url: raw.url ? `${raw.url}?t=${Date.now()}` : raw.url }
      const latest = useStudioStore.getState().sceneImages
      setSceneImages(latest.map((img) => img.scene_index === sceneIndex ? newImage : img))
      void refreshCredits()
      closeEditor()
    } catch (err) {
      setRegenErrors((prev) => ({ ...prev, [sceneIndex]: err instanceof Error ? err.message : t('step5.err_regen') }))
    } finally {
      setRegenLoading((prev) => { const n = new Set(prev); n.delete(sceneIndex); return n })
    }
  }

  function seekAndPlay(tc: string | undefined) {
    const audio = audioRef.current
    if (!audio || !audioUrl) return
    const t = parseTimecode(tc)
    if (t >= 0) audio.currentTime = t
    void audio.play()
  }

  const durationLabel =
    subtitleBlocks.length > 0
      ? `${Math.floor(audioDurationSec / 60)} ${t('step1.min')} ${audioDurationSec % 60} ${t('step5.sec')}`
      : `~${scriptParams.duration_minutes} ${t('step1.min')}`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{t('step5.title')}</h2>
        <p className="text-sm text-slate-500">{t('step5.subtitle')}</p>
      </div>

      {/* Interval selector */}
      <div
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-300">{t('step5.interval')}</p>
          <span className="text-xs text-slate-500">{durationLabel}</span>
        </div>

        <div className="flex gap-2 flex-wrap">
          {INTERVAL_PRESETS.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => handleIntervalPreset(sec)}
              className="px-3 py-1.5 rounded-xl text-sm font-medium transition-all"
              style={
                imageInterval === sec && !customInterval
                  ? { border: '2px solid #7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
                  : { border: '2px solid rgba(255,255,255,0.08)', color: '#94A3B8' }
              }
            >
              {sec} {t('step5.sec')}
            </button>
          ))}

          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={3}
              max={300}
              value={customInterval}
              onChange={(e) => handleCustomIntervalChange(e.target.value)}
              placeholder="..."
              className="w-16 px-2 py-1.5 rounded-xl text-sm text-center focus:outline-none"
              style={customInterval && !isNaN(parseInt(customInterval, 10))
                ? { border: '2px solid #7C3AED' }
                : { border: '2px solid rgba(255,255,255,0.08)' }
              }
            />
            <span className="text-xs text-slate-500">{t('step5.sec')}</span>
          </div>
        </div>

        {/* Calculation preview */}
        <div
          className="flex items-center gap-3 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <p className="text-xs text-slate-400 leading-relaxed">
            −{costPerImage} {t('nav.credits_suffix')}/шт
            <span className="mx-1.5 text-slate-600">·</span>
            <strong className="text-slate-200">{displayCount}</strong> илл.
            {gptCountOverride !== null && (
              <span className="ml-1 text-amber-500/70 text-xs">(сокращено)</span>
            )}
            <span className="mx-1.5 text-slate-600">·</span>
            Итого: <strong className="text-violet-400">{creditCost} {t('nav.credits_suffix')}</strong>
          </p>
        </div>
      </div>

      {/* Engine selector */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-slate-300">{t('step5.engine_label')}</p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: 'flux',         name: t('step5.engine_flux_name'),     desc: t('step5.engine_flux_desc')    },
            { id: 'flux_schnell', name: t('step5.engine_schnell_name'),  desc: t('step5.engine_schnell_desc') },
            { id: 'nano_banana',  name: t('step5.engine_nano_name'),     desc: t('step5.engine_nano_desc')    },
            { id: 'gpt_mini',     name: t('step5.engine_gpt_name'),      desc: t('step5.engine_gpt_desc')     },
          ] as const).filter((eng) => !(HIDDEN_ENGINES as readonly string[]).includes(eng.id)).map((eng) => {
            const active = imageEngine === eng.id
            return (
              <button
                key={eng.id}
                type="button"
                onClick={() => { setImageEngine(eng.id); setGptCountOverride(null) }}
                className="text-left rounded-xl p-3 transition-all"
                style={active
                  ? { border: '2px solid #7C3AED', background: 'rgba(124,58,237,0.12)' }
                  : { border: '2px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }
                }
              >
                <p className={`text-xs font-semibold mb-0.5 ${active ? 'text-violet-300' : 'text-slate-300'}`}>
                  {eng.name}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">{eng.desc}</p>
              </button>
            )
          })}
        </div>

        {/* Contextual warning: Schnell + risky style */}
        {imageEngine === 'flux_schnell' && (RISKY_STYLES_FOR_SCHNELL as readonly string[]).includes(selectedStyleKey) && (
          <div
            className="flex items-start gap-2 rounded-xl px-3 py-2.5 mt-1"
            style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)' }}
          >
            <span className="text-amber-400 text-sm shrink-0 mt-px">⚠️</span>
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(253,211,77,0.8)' }}>
              {t('step5.schnell_risk_warning').replace('{style}', t(`step5.style_${selectedStyleKey}` as Parameters<typeof t>[0]))}
            </p>
          </div>
        )}

        {/* Export prompts */}
        <div className="flex items-center justify-between mt-1">
          {sceneImages.length > 0 ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={exportPrompts}
                className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                style={{ color: '#64748B' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#94A3B8')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#64748B')}
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t('step5.export_prompts_btn')}
              </button>
              <p className="text-xs" style={{ color: '#334155' }}>{t('step5.export_prompts_note')}</p>
            </div>
          ) : (
            <p className="text-xs" style={{ color: '#334155' }}>{t('step5.export_prompts_disabled')}</p>
          )}
        </div>
      </div>

      {/* GPT Image limit modal */}
      {showGptLimitModal && (
        <div
          className="rounded-xl p-4 flex flex-col gap-3"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}
        >
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-300 mb-1">{t('step5.gpt_limit_title')}</p>
              <p className="text-xs text-amber-200/70 leading-relaxed">
                {t('step5.gpt_limit_body').replace('{N}', String(imageCount))}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => { setGptCountOverride(MAX_GPT_MINI_SAFE); void handleGenerate(undefined, MAX_GPT_MINI_SAFE) }}
              className="w-full py-2.5 text-sm font-semibold rounded-xl transition-all"
              style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#FCD34D' }}
            >
              {t('step5.gpt_limit_reduce')}
            </button>
            <button
              type="button"
              onClick={() => { setImageEngine('flux_schnell'); setGptCountOverride(null); void handleGenerate('flux_schnell') }}
              className="w-full py-2.5 text-sm font-semibold rounded-xl transition-all"
              style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#A78BFA' }}
            >
              {t('step5.gpt_limit_schnell').replace('{N}', String(imageCount))}
            </button>
            <button
              type="button"
              onClick={() => { setImageEngine('flux'); setGptCountOverride(null); void handleGenerate('flux') }}
              className="w-full py-2.5 text-sm font-semibold rounded-xl transition-all"
              style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#93C5FD' }}
            >
              {t('step5.gpt_limit_flux').replace('{N}', String(imageCount))}
            </button>
            <button
              type="button"
              onClick={() => setShowGptLimitModal(false)}
              className="text-xs text-slate-500 hover:text-slate-400 text-center transition-colors"
            >
              {t('btn.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Style selector */}
      <div
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <p className="text-sm font-semibold text-slate-300">{t('step5.style_label')}</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => { setSelectedStyleKey('none'); setRefStyle(null); setRefPreviewUrl(null); setImageStyle(null) }}
            className="rounded-xl px-2 py-2 transition-all text-xs font-medium text-center"
            style={selectedStyleKey === 'none' && !refStyle
              ? { border: '2px solid #7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
              : { border: '2px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#94A3B8' }
            }
          >
            {t('step5.style_none')}
          </button>
          {(Object.keys(IMAGE_STYLES) as ImageStyleKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => { setSelectedStyleKey(key); setRefStyle(null); setRefPreviewUrl(null); setImageStyle(IMAGE_STYLES[key]) }}
              className="rounded-xl px-2 py-2 transition-all text-xs font-medium text-center"
              style={selectedStyleKey === key
                ? { border: '2px solid #7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
                : { border: '2px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#94A3B8' }
              }
            >
              {t(`step5.style_${key}`)}
            </button>
          ))}
        </div>

        {/* Reference image upload */}
        <div className="flex items-center gap-2 flex-wrap">
          {refPreviewUrl && (
            <div className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={refPreviewUrl} alt="ref" className="w-10 h-10 object-cover rounded-lg" />
              <button
                type="button"
                onClick={() => { setRefPreviewUrl(null); setRefStyle(null); setImageStyle(selectedStyleKey !== 'none' ? IMAGE_STYLES[selectedStyleKey] : null) }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-white flex items-center justify-center"
                style={{ background: '#EF4444', fontSize: 10, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => styleRefInputRef.current?.click()}
            disabled={refAnalyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl hover:text-slate-200 disabled:opacity-50 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#94A3B8' }}
          >
            {refAnalyzing ? (
              <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" />{t('step5.ref_analyzing')}</>
            ) : (
              t('step5.ref_btn')
            )}
          </button>
          {refStyle && (
            <p className="text-xs flex-1 min-w-0" style={{ color: '#A78BFA' }}>
              <span className="text-slate-500">{t('step5.ref_detected')} </span>
              {refStyle.length > 60 ? `${refStyle.slice(0, 60)}…` : refStyle}
            </p>
          )}
          <input
            ref={styleRefInputRef}
            type="file"
            accept="image/jpeg,image/png,image/jpg,image/webp"
            className="hidden"
            onChange={handleRefUpload}
          />
        </div>
      </div>

      {/* Info about AI scene splitting */}
      <div
        className="flex items-start gap-3 rounded-xl px-4 py-3"
        style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)' }}
      >
        <svg className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-blue-300 leading-relaxed">
          <strong>{imageCount}</strong> {t('studio.step5').toLowerCase()} · {t('step5.generating')}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={loading || !script?.trim()}
        className="w-full py-3 btn-gradient disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <SpinnerIcon className="w-4 h-4 animate-spin" />
            {progress
              ? `${progress.completed} / ${progress.total} · ${t('step5.generating')}`
              : t('step5.generating')
            }
          </>
        ) : sceneImages.length > 0 ? (
          `↺ ${t('step2.regenerate')} (−${creditCost} ${t('nav.credits_suffix')})`
        ) : (
          `🎨 ${t('btn.generate')} ${displayCount} (−${creditCost} ${t('nav.credits_suffix')})`
        )}
      </button>

      {loading && progress && (
        <div
          className="flex flex-col gap-2 rounded-xl px-4 py-3"
          style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: '#A78BFA' }}>{t('step5.generating')}</span>
            <span className="text-xs tabular-nums" style={{ color: '#94A3B8' }}>
              {progress.completed} / {progress.total}
            </span>
          </div>
          <div className="w-full rounded-full overflow-hidden" style={{ height: 6, background: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0}%`,
                background: 'linear-gradient(90deg, #7C3AED, #A78BFA)',
              }}
            />
          </div>
          <p className="text-xs" style={{ color: '#64748B' }}>
            {progress.completed} {t('step5.progress_of')} {progress.total} {t('step5.progress_images')}
          </p>
        </div>
      )}

      {!loading && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => imageFilesRef.current?.click()}
            disabled={uploading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-slate-400 text-xs font-medium rounded-xl hover:text-slate-200 disabled:opacity-50 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
          >
            {uploading ? (
              <>
                <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
                {t('msg.loading')} {uploadProgress}%
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {t('step5.upload')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStep(7)}
            className="flex items-center gap-1 py-2 px-3 text-slate-500 text-xs font-medium rounded-xl hover:text-slate-300 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {t('step5.skip')}
          </button>
          <input
            ref={imageFilesRef}
            type="file"
            accept="image/jpeg,image/png,image/jpg,.jpg,.jpeg,.png"
            multiple
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-red-400 rounded-xl px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.15)' }}>
          {uploadError}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}

      {/* Generated images with audio sync */}
      {sceneImages.length > 0 && (
        <div className="flex flex-col gap-4">
          {/* Audio player or hint to go record audio */}
          {audioUrl ? (
            <AudioSyncPlayer
              audioUrl={audioUrl}
              images={sceneImages}
              audioRef={audioRef}
              onActiveChange={setActiveSceneIdx}
            />
          ) : (
            <div
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <p className="text-xs text-slate-500">
                {t('step5.audio_hint')}
              </p>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-slate-300 mb-3">
              {t('studio.step5')} ({sceneImages.length})
              <span className="ml-2 text-xs text-slate-500 font-normal">{t('step5.regen_hint')}</span>
            </p>

            {/* Broken-image banner — shown when any scene failed to upload */}
            {sceneImages.some((img) => !img.url) && (
              <div
                className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-xl text-sm text-orange-300"
                style={{ background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.25)' }}
              >
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span>
                  <strong>{sceneImages.filter((img) => !img.url).length}</strong> {t('step5.broken_banner')}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {sceneImages.map((img, arrayIdx) => {
                const isLoading = regenLoading.has(img.scene_index)
                const isEditing = editingIdx === img.scene_index
                const err = regenErrors[img.scene_index]
                const isActive = !isEditing && activeSceneIdx === arrayIdx
                const canSeek = !!audioUrl && !!img.timecode_start && !isEditing && !!img.url

                return (
                  <div
                    key={img.scene_index}
                    className={`flex flex-col gap-2 rounded-xl transition-all ${isEditing ? 'col-span-full' : ''} ${canSeek ? 'cursor-pointer' : ''}`}
                    onClick={canSeek ? () => seekAndPlay(img.timecode_start) : undefined}
                    style={
                      !img.url && !isEditing
                        ? { outline: '2px solid rgba(251,146,60,0.6)', boxShadow: '0 0 12px rgba(251,146,60,0.15)' }
                        : isActive
                        ? { outline: '2px solid rgba(124,58,237,0.7)', boxShadow: '0 0 18px rgba(124,58,237,0.25)' }
                        : {}
                    }
                  >
                    <div className={`flex gap-3 ${isEditing ? 'items-start' : 'flex-col'}`}>
                      {/* Image card */}
                      <div
                        className={`relative rounded-xl overflow-hidden shrink-0 ${
                          isEditing ? 'w-40 sm:w-52 aspect-video' : 'aspect-video w-full'
                        }`}
                        style={{ background: img.url ? 'rgba(255,255,255,0.04)' : 'rgba(251,146,60,0.06)' }}
                      >
                        {img.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img.url}
                            alt={`${t('studio.step5')} ${arrayIdx + 1}`}
                            className={`w-full h-full object-cover transition-opacity ${isLoading ? 'opacity-40' : 'opacity-100'}`}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full gap-1.5 px-2 text-center">
                            <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                            </svg>
                            <span className="text-xs text-orange-300">↺ {t('step2.regenerate')}</span>
                          </div>
                        )}

                        {isLoading && (
                          <div
                            className="absolute inset-0 flex flex-col items-center justify-center gap-1"
                            style={{ background: 'rgba(0,0,0,0.5)' }}
                          >
                            <SpinnerIcon className="w-5 h-5 text-violet-400 animate-spin" />
                            <span className="text-xs text-slate-300 font-medium">{t('msg.generating')}</span>
                          </div>
                        )}

                        <div className="absolute bottom-1 left-1 text-white text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.6)' }}>
                          {img.timecode_start ?? arrayIdx + 1}
                        </div>

                        {!isLoading && !isEditing && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEditor(img.scene_index, img.prompt) }}
                            className="absolute top-1 right-1 p-1.5 rounded-lg transition-colors text-white"
                            style={{ background: img.url ? 'rgba(0,0,0,0.5)' : 'rgba(251,146,60,0.6)' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = img.url ? 'rgba(124,58,237,0.7)' : 'rgba(251,146,60,0.9)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = img.url ? 'rgba(0,0,0,0.5)' : 'rgba(251,146,60,0.6)')}
                            title={t('step2.regenerate')}
                          >
                            <RefreshIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Inline prompt editor */}
                      {isEditing && (
                        <div className="flex-1 flex flex-col gap-2 min-w-0">
                          {img.scene && (
                            <p
                              className="text-xs text-slate-400 rounded-lg px-2 py-1.5 leading-snug"
                              style={{ background: 'rgba(255,255,255,0.05)' }}
                            >
                              {img.scene}
                              {img.timecode_start && (
                                <span className="ml-2 text-slate-600">{img.timecode_start}–{img.timecode_end}</span>
                              )}
                            </p>
                          )}
                          <p className="text-xs font-medium text-slate-400">
                            {t('step2.regenerate')} — {arrayIdx + 1}
                          </p>
                          <textarea
                            rows={3}
                            value={editingPrompt}
                            onChange={(e) => { setEditingPrompt(e.target.value); editingPromptRef.current = e.target.value }}
                            disabled={isLoading}
                            className="w-full px-3 py-2 rounded-xl text-sm resize-none focus:outline-none disabled:opacity-50"
                          />
                          {err && (
                            <p className="text-xs text-red-400 rounded-lg px-2 py-1" style={{ background: 'rgba(239,68,68,0.1)' }}>
                              {err}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleSingleRegen(img.scene_index)}
                              disabled={isLoading || !editingPrompt.trim()}
                              className="flex-1 py-2 btn-gradient disabled:opacity-40 text-white font-medium rounded-xl text-xs flex items-center justify-center gap-1.5"
                            >
                              {isLoading ? (
                                <>
                                  <SpinnerIcon className="w-3 h-3 animate-spin" />
                                  {t('msg.generating')}
                                </>
                              ) : (
                                <>
                                  <RefreshIcon className="w-3 h-3" />
                                  {t('step2.regenerate')} (−{costPerImage} {t('nav.credits_suffix')})
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={closeEditor}
                              disabled={isLoading}
                              className="px-4 py-2 text-slate-400 font-medium rounded-xl text-xs hover:text-slate-200 disabled:opacity-40 transition-colors"
                              style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                            >
                              {t('btn.cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(5)}
          className="px-5 py-3 btn-ghost-dark font-medium rounded-xl text-sm"
        >
          {t('step5.back')}
        </button>
        <button
          type="button"
          onClick={() => setStep(7)}
          disabled={sceneImages.length === 0 || sceneImages.some((img) => !img.url)}
          className="flex-1 py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-40"
        >
          {t('step5.next')}
        </button>
      </div>
    </div>
  )
}
