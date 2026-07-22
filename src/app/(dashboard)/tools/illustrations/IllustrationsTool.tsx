'use client'

import { useState, useCallback } from 'react'
import { useLang } from '@/hooks/useLang'
import { refreshCredits } from '@/lib/refresh-credits'
import { CREDIT_COSTS, IMAGE_STYLES } from '@/lib/types'
import type { SceneImage, ImageStyleKey } from '@/lib/types'
import { SCRIPT_LANGUAGES } from '@/lib/languages'
import type { ScenePreview } from '@/lib/scene-split'

// ─── Types ────────────────────────────────────────────────────────────────────

type EngineType = 'flux_schnell' | 'flux' | 'nano_banana'
type Phase = 'input' | 'previewing' | 'generating' | 'done'

interface RestoredMeta {
  engine: string
  style_value: string
  custom_style: string
}

interface Props {
  initialImages: SceneImage[]
  initialTitle: string
  initialScript: string
  restoredMeta: RestoredMeta | null
  restoredId: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STYLE_LABELS: Record<ImageStyleKey, string> = {
  realistic:   'Реалистичный',
  cartoon:     'Мультяшный',
  sketch:      'Скетч / Карандаш',
  watercolor:  'Акварель',
  cinematic:   'Кинематограф',
  cyberpunk:   'Киберпанк',
  doodle:      'Дудл',
  anime:       'Аниме',
  render3d:    '3D Рендер',
  oil:         'Масло',
  dark:        'Тёмный',
}

const ENGINE_OPTIONS: { key: EngineType; labelKey: string; credits: number }[] = [
  { key: 'flux_schnell', labelKey: 'tools.ill_engine_fast',    credits: CREDIT_COSTS.image_flux_schnell },
  { key: 'flux',         labelKey: 'tools.ill_engine_quality', credits: CREDIT_COSTS.image_flux },
  { key: 'nano_banana',  labelKey: 'tools.ill_engine_pro',     credits: CREDIT_COSTS.image_nano_banana },
]

function parseEngine(s: string): EngineType {
  if (s === 'flux' || s === 'flux_schnell' || s === 'nano_banana') return s
  return 'flux_schnell'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SpinnerIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function IllustrationsTool({
  initialImages,
  initialTitle: _initialTitle,
  initialScript,
  restoredMeta,
  restoredId,
}: Props) {
  const { t } = useLang()

  const [phase, setPhase] = useState<Phase>(restoredId ? 'done' : 'input')

  // Input state — preserved across phases so "Back to settings" restores everything
  const [text, setText] = useState(initialScript)
  const [engine, setEngine] = useState<EngineType>(
    restoredMeta ? parseEngine(restoredMeta.engine) : 'flux_schnell',
  )
  const [countMode, setCountMode] = useState<'auto' | 'manual'>('auto')
  const [manualCount, setManualCount] = useState(10)
  const [styleMode, setStyleMode] = useState<'preset' | 'custom'>(
    restoredMeta?.custom_style ? 'custom' : 'preset',
  )
  const [selectedStyleKey, setSelectedStyleKey] = useState<ImageStyleKey | ''>(() => {
    if (!restoredMeta?.style_value) return ''
    const match = (Object.entries(IMAGE_STYLES) as [ImageStyleKey, string][]).find(
      ([, v]) => v === restoredMeta.style_value,
    )
    return match ? match[0] : ''
  })
  const [customStyleText, setCustomStyleText] = useState(restoredMeta?.custom_style ?? '')
  const [language, setLanguage] = useState('ru')

  // Preview state
  const [sceneCount, setSceneCount] = useState(0)
  const [scenePreviews, setScenePreviews] = useState<ScenePreview[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  // Generation state
  const [images, setImages] = useState<SceneImage[]>(initialImages)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [projectId, setProjectId] = useState<string | null>(restoredId)
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState<string | null>(restoredId)
  const [creditsSpent, setCreditsSpent] = useState(0)

  // Single-image regen state
  const [regenLoading, setRegenLoading] = useState<Set<number>>(new Set())
  const [regenErrors, setRegenErrors] = useState<Record<number, string>>({})

  // ─── Computed ─────────────────────────────────────────────────────────────

  const costPerImage = engine === 'flux_schnell' ? CREDIT_COSTS.image_flux_schnell
    : engine === 'nano_banana' ? CREDIT_COSTS.image_nano_banana
    : CREDIT_COSTS.image_flux

  const effectiveStyleValue = styleMode === 'preset' && selectedStyleKey
    ? IMAGE_STYLES[selectedStyleKey]
    : undefined

  const effectiveCustomStyle = styleMode === 'custom' && customStyleText.trim()
    ? customStyleText.trim()
    : undefined

  // Effective count for cost preview: manual uses manualCount, auto uses detected sceneCount
  const displayCount = countMode === 'manual' ? manualCount : sceneCount
  const displayCost  = displayCount * costPerImage

  // Engine display label (no brand names)
  const engineLabel = t((ENGINE_OPTIONS.find(e => e.key === engine)?.labelKey ?? 'tools.ill_engine_fast') as Parameters<typeof t>[0])

  // Style display name for preview info box
  const styleLabel = styleMode === 'preset'
    ? (selectedStyleKey ? STYLE_LABELS[selectedStyleKey] : 'По умолчанию')
    : 'Свой стиль'

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function validateInput(): string | null {
    if (!text.trim()) return t('tools.ill_err_no_text')
    if (text.trim().length < 50) return t('tools.ill_err_short')
    return null
  }

  async function handlePreview() {
    const err = validateInput()
    if (err) { setError(err); return }
    setPreviewLoading(true)
    setError('')
    try {
      const res = await fetch('/api/tools/illustrations/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, count_mode: 'auto' }),
      })
      const json = await res.json() as { ok: boolean; data?: { scene_count: number; preview: ScenePreview[] }; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'Ошибка')
      setSceneCount(json.data!.scene_count)
      setScenePreviews(json.data!.preview ?? [])
      setPhase('previewing')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setPreviewLoading(false)
    }
  }

  // countArg lets caller pass count directly (manual mode — avoids React async state issue)
  async function handleGenerate(countArg?: number) {
    const count = countArg ?? sceneCount
    if (count < 1) return

    setError('')
    setPhase('generating')
    setImages([])
    setProgress(null)
    setCreditsSpent(0)

    try {
      const autoTitle = text.trim().split(/[.!?\n]/)[0]?.slice(0, 80).trim() || 'Иллюстрации'
      const initRes = await fetch('/api/tools/illustrations/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: autoTitle,
          script: text,
          engine,
          style_value: effectiveStyleValue ?? '',
          custom_style: effectiveCustomStyle ?? '',
          language,
          scene_count: count,
        }),
      })
      const initJson = await initRes.json() as { ok: boolean; data?: { project_id: string }; error?: string }
      if (!initJson.ok) throw new Error(initJson.error ?? 'Ошибка создания проекта')
      const pid = initJson.data!.project_id
      setProjectId(pid)

      const genRes = await fetch('/api/generate/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: text,
          topic: autoTitle,
          duration_sec: count * 10,
          image_count: count,
          project_id: pid,
          image_interval: 10,
          engine,
          image_style: effectiveStyleValue ?? null,
          custom_style: effectiveCustomStyle ?? null,
        }),
      })

      if (!genRes.ok) {
        const ct = genRes.headers.get('content-type') ?? ''
        if (!ct.includes('application/json')) throw new Error(t('tools.ill_err_gen'))
        const json = await genRes.json() as { ok: boolean; error?: string; code?: string }
        if (json.code === 'NO_CREDITS') throw new Error(`${t('tools.ill_err_no_credits')} (${count * costPerImage} кр.)`)
        throw new Error(json.error ?? t('tools.ill_err_gen'))
      }

      const reader = genRes.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let actualChargedCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          let data: {
            type: string
            total?: number
            completed?: number
            images?: SceneImage[]
            success_count?: number
            charged_count?: number
            fail_count?: number
            error?: string
          }
          try {
            data = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (data.type === 'start') {
            setProgress({ completed: 0, total: data.total ?? count })
          } else if (data.type === 'progress') {
            setProgress({ completed: data.completed ?? 0, total: data.total ?? count })
            if (data.images?.length) {
              const ts = Date.now()
              const incoming = data.images.map((img) => ({
                ...img,
                url: img.url ? `${img.url}?t=${ts}` : img.url,
              }))
              setImages((prev) => {
                const merged = [...prev]
                for (const img of incoming) {
                  const idx = merged.findIndex((p) => p.scene_index === img.scene_index)
                  if (idx >= 0) merged[idx] = img
                  else merged.push(img)
                }
                return merged.sort((a, b) => a.scene_index - b.scene_index)
              })
            }
          } else if (data.type === 'done') {
            const ts = Date.now()
            const finalImages = (data.images ?? []).map((img) => ({
              ...img,
              url: img.url ? `${img.url}?t=${ts}` : img.url,
            }))
            setImages(finalImages)
            // Use charged_count (actual debits) for display — matches server's spendCredits calls
            actualChargedCount = data.charged_count ?? data.success_count ?? 0
            const spent = actualChargedCount * costPerImage
            setCreditsSpent(spent)
            void refreshCredits()

            await fetch('/api/tools/illustrations/finalize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project_id: pid, credits_spent: spent }),
            })
            setSavedId(pid)
            setPhase('done')
          } else if (data.type === 'error') {
            throw new Error(data.error ?? t('tools.ill_err_gen'))
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('tools.ill_err_gen')
      setError(msg)
      // manual mode never had a previewing phase — go back to input
      setPhase(countMode === 'manual' ? 'input' : 'previewing')
    }
  }

  const handleRegen = useCallback(async (sceneIndex: number, prompt: string) => {
    if (!projectId) return
    setRegenLoading((prev) => new Set([...prev, sceneIndex]))
    setRegenErrors((prev) => { const n = { ...prev }; delete n[sceneIndex]; return n })
    try {
      const res = await fetch('/api/generate/image-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          scene_index: sceneIndex,
          prompt,
          engine,
          image_style: effectiveStyleValue,
          custom_style: effectiveCustomStyle,
        }),
      })
      const json = await res.json() as { ok: boolean; data?: { image: SceneImage }; error?: string }
      if (!json.ok) throw new Error(json.error)
      const newImg = json.data!.image
      const ts = Date.now()
      setImages((prev) =>
        prev.map((img) =>
          img.scene_index === sceneIndex
            ? { ...newImg, url: newImg.url ? `${newImg.url}?t=${ts}` : newImg.url }
            : img,
        ),
      )
      void refreshCredits()
    } catch (e) {
      setRegenErrors((prev) => ({
        ...prev,
        [sceneIndex]: e instanceof Error ? e.message : 'Ошибка',
      }))
    } finally {
      setRegenLoading((prev) => { const n = new Set([...prev]); n.delete(sceneIndex); return n })
    }
  }, [projectId, engine, effectiveStyleValue, effectiveCustomStyle])

  async function handleDownloadZip() {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    const valid = images.filter((img) => img.url)
    for (const img of valid) {
      try {
        const cleanUrl = img.url!.split('?')[0]
        const response = await fetch(cleanUrl)
        const blob = await response.blob()
        const ext = blob.type.includes('png') ? 'png' : 'jpg'
        zip.file(`scene_${String(img.scene_index + 1).padStart(3, '0')}.${ext}`, blob)
      } catch {
        // skip failed fetches
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'illustrations.zip'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Returns to input form with all settings preserved (text, engine, style, language)
  function handleBackToSettings() {
    setPhase('input')
    setImages([])
    setProgress(null)
    setProjectId(null)
    setSavedId(null)
    setCreditsSpent(0)
    setSceneCount(0)
    setScenePreviews([])
    setError('')
  }

  // Resets everything including the text field
  function handleReset() {
    handleBackToSettings()
    setText('')
  }

  // ─── Shared input form ────────────────────────────────────────────────────

  const inputSection = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Text input */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            {t('tools.ill_text_label')}
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('tools.ill_text_ph')}
            rows={16}
            className="w-full px-4 py-3 rounded-xl text-sm text-slate-100 bg-white/5 border border-white/10 resize-none focus:outline-none focus:border-violet-500/60 transition-colors placeholder-slate-600"
          />
          <p className="text-xs text-slate-600 mt-1">{text.trim().length} символов</p>
        </div>

        {/* Count mode */}
        <div>
          <p className="text-sm font-medium text-slate-300 mb-2">{t('tools.ill_count_mode')}</p>
          <div className="flex gap-3 flex-wrap items-center">
            {(['auto', 'manual'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="countMode"
                  value={mode}
                  checked={countMode === mode}
                  onChange={() => setCountMode(mode)}
                  className="accent-violet-500"
                />
                <span className="text-sm text-slate-300">
                  {mode === 'auto' ? t('tools.ill_count_auto') : t('tools.ill_count_manual')}
                </span>
              </label>
            ))}
            {countMode === 'manual' && (
              <input
                type="number"
                min={1}
                max={30}
                value={manualCount}
                onChange={(e) => setManualCount(Math.min(30, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-20 px-3 py-1.5 rounded-lg text-sm text-slate-100 bg-white/5 border border-white/10 focus:outline-none focus:border-violet-500/60"
              />
            )}
          </div>

          {/* Inline cost preview for manual mode */}
          {countMode === 'manual' && (
            <div className="mt-3 px-4 py-3 rounded-xl"
              style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
              <p className="text-sm text-violet-300">
                {manualCount} × {costPerImage} кр. = <strong>{displayCost} кр.</strong>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Settings sidebar */}
      <div className="flex flex-col gap-5">
        {/* Engine */}
        <div>
          <p className="text-sm font-medium text-slate-300 mb-2">{t('tools.ill_engine')}</p>
          <div className="flex flex-col gap-2">
            {ENGINE_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg transition-colors"
                style={{
                  background: engine === opt.key ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${engine === opt.key ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.08)'}`,
                }}
              >
                <input
                  type="radio"
                  name="engine"
                  value={opt.key}
                  checked={engine === opt.key}
                  onChange={() => setEngine(opt.key)}
                  className="accent-violet-500"
                />
                <span className="text-sm text-slate-300">{t(opt.labelKey as Parameters<typeof t>[0])}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Style */}
        <div>
          <p className="text-sm font-medium text-slate-300 mb-2">{t('tools.ill_style_label')}</p>
          <div className="flex gap-2 mb-3">
            {(['preset', 'custom'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setStyleMode(m)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: styleMode === m ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${styleMode === m ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  color: styleMode === m ? '#c4b5fd' : '#94a3b8',
                }}
              >
                {m === 'preset' ? t('tools.ill_style_preset') : t('tools.ill_style_custom')}
              </button>
            ))}
          </div>

          {styleMode === 'preset' ? (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedStyleKey('')}
                className="px-2 py-1.5 rounded-lg text-xs text-left transition-all"
                style={{
                  background: selectedStyleKey === '' ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${selectedStyleKey === '' ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: selectedStyleKey === '' ? '#c4b5fd' : '#64748b',
                }}
              >
                {t('tools.ill_style_none')}
              </button>
              {(Object.entries(STYLE_LABELS) as [ImageStyleKey, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedStyleKey(key)}
                  className="px-2 py-1.5 rounded-lg text-xs text-left transition-all"
                  style={{
                    background: selectedStyleKey === key ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${selectedStyleKey === key ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    color: selectedStyleKey === key ? '#c4b5fd' : '#94a3b8',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <textarea
              value={customStyleText}
              onChange={(e) => setCustomStyleText(e.target.value)}
              placeholder={t('tools.ill_style_custom_ph')}
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-xs text-slate-100 bg-white/5 border border-white/10 resize-none focus:outline-none focus:border-violet-500/60 placeholder-slate-600"
            />
          )}
        </div>

        {/* Language */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">{t('tools.ill_lang')}</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm text-slate-100 border border-white/10 focus:outline-none focus:border-violet-500/60"
            style={{ background: '#1e293b' }}
          >
            <option value="">{t('tools.ill_lang_auto')}</option>
            {SCRIPT_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )

  // ─── Phase: INPUT ──────────────────────────────────────────────────────────
  if (phase === 'input') {
    return (
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100">{t('tools.ill_title')}</h1>
          <p className="text-slate-500 text-sm mt-1">{t('tools.ill_subtitle')}</p>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm text-red-300 bg-red-500/10 border border-red-500/20">
            {error}
          </div>
        )}

        {inputSection}

        <div className="mt-6">
          {/* Manual mode: direct generate button */}
          {countMode === 'manual' ? (
            <button
              type="button"
              onClick={() => handleGenerate(manualCount)}
              disabled={!text.trim()}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #2563EB)', color: '#fff' }}
            >
              {t('tools.ill_gen_btn').replace('{total}', String(displayCost))}
            </button>
          ) : (
            /* Auto mode: preview step first */
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewLoading || !text.trim()}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #2563EB)', color: '#fff' }}
            >
              {previewLoading ? (
                <><SpinnerIcon /> ИИ определяет сцены...</>
              ) : (
                t('tools.ill_preview_btn')
              )}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ─── Phase: PREVIEWING (auto mode only) ───────────────────────────────────
  if (phase === 'previewing') {
    const previewCostStr = t('tools.ill_preview_cost')
      .replace('{n}', String(sceneCount))
      .replace('{cost}', String(costPerImage))
      .replace('{total}', String(displayCost))

    const genBtnStr = t('tools.ill_gen_btn').replace('{total}', String(displayCost))

    return (
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100">{t('tools.ill_title')}</h1>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm text-red-300 bg-red-500/10 border border-red-500/20">
            {error}
          </div>
        )}

        {/* Cost preview card */}
        <div className="rounded-2xl p-6 mb-6"
          style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
          <p className="text-lg font-semibold text-violet-300 mb-1">{previewCostStr}</p>
          <p className="text-xs text-slate-500">
            {engineLabel}
            {(effectiveStyleValue || effectiveCustomStyle) && ` · Стиль: ${styleLabel}`}
          </p>
        </div>

        {/* Scene previews */}
        {scenePreviews.length > 0 && (
          <div className="mb-6">
            <p className="text-sm font-medium text-slate-400 mb-3">{t('tools.ill_preview_scenes')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {scenePreviews.map((s) => (
                <div
                  key={s.index}
                  className="px-3 py-2 rounded-lg text-xs text-slate-400"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <span className="text-slate-600 mr-1.5">#{s.index}</span>
                  {s.description}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => { setPhase('input'); setError('') }}
            className="px-5 py-3 rounded-xl text-sm font-medium text-slate-400 transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            {t('tools.ill_cancel')}
          </button>
          <button
            type="button"
            onClick={() => handleGenerate()}
            className="px-6 py-3 rounded-xl font-semibold text-sm text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #7C3AED, #2563EB)' }}
          >
            {genBtnStr}
          </button>
        </div>
      </div>
    )
  }

  // ─── Phase: GENERATING ────────────────────────────────────────────────────
  if (phase === 'generating') {
    const currentTotal = progress?.total ?? displayCount
    const pct = progress ? Math.round((progress.completed / progress.total) * 100) : 0
    const progressStr = progress
      ? t('tools.ill_progress').replace('{done}', String(progress.completed)).replace('{total}', String(progress.total))
      : t('tools.ill_generating')

    return (
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100">{t('tools.ill_generating')}</h1>
          <p className="text-slate-500 text-sm mt-1">{progressStr} · {currentTotal} иллюстраций</p>
        </div>

        <div className="mb-8 rounded-full h-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-2 rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #7C3AED, #2563EB)' }}
          />
        </div>

        {images.length > 0 && (
          <GalleryGrid images={images} onRegen={null} regenLoading={regenLoading} regenErrors={regenErrors} t={t} />
        )}
      </div>
    )
  }

  // ─── Phase: DONE ──────────────────────────────────────────────────────────
  const successCount = images.filter((i) => i.url).length
  const failedCount  = images.filter((i) => !i.url).length

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t('tools.ill_title')}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {successCount} иллюстраций
            {failedCount > 0 && <span className="text-red-400"> · {failedCount} не удалось</span>}
            {creditsSpent > 0 && ` · списано ${creditsSpent} кр.`}
            {savedId && ` · ${t('tools.ill_saved')}`}
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {successCount > 0 && (
            <button
              type="button"
              onClick={handleDownloadZip}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {t('tools.ill_zip')}
            </button>
          )}
          {/* Back to settings: keeps text & all params, clears only generated images */}
          <button
            type="button"
            onClick={handleBackToSettings}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-violet-300 transition-all"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)' }}
          >
            {t('tools.ill_back')}
          </button>
          {/* Full reset: clears text too */}
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-500 transition-all"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {t('tools.ill_new')}
          </button>
        </div>
      </div>

      <GalleryGrid
        images={images}
        onRegen={handleRegen}
        regenLoading={regenLoading}
        regenErrors={regenErrors}
        t={t}
      />
    </div>
  )
}

// ─── Gallery grid ─────────────────────────────────────────────────────────────

interface GalleryGridProps {
  images: SceneImage[]
  onRegen: ((sceneIndex: number, prompt: string) => void) | null
  regenLoading: Set<number>
  regenErrors: Record<number, string>
  t: (key: string) => string
}

function GalleryGrid({ images, onRegen, regenLoading, regenErrors, t }: GalleryGridProps) {
  if (!images.length) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {images.map((img) => (
        <div
          key={img.scene_index}
          className="rounded-2xl overflow-hidden flex flex-col"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {/* Image or failed state */}
          <div className="relative aspect-video bg-black/30">
            {img.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.url}
                alt={img.scene ?? `Сцена ${img.scene_index + 1}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-4">
                <svg className="w-8 h-8 text-red-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-xs text-red-400 text-center">Не удалось сгенерировать</span>
              </div>
            )}

            {/* Scene number badge */}
            <span
              className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-xs font-medium"
              style={{ background: 'rgba(0,0,0,0.6)', color: '#94a3b8' }}
            >
              {t('tools.ill_scene_label')} {img.scene_index + 1}
            </span>

            {/* Regen button — visible for both failed and succeeded images */}
            {onRegen && img.prompt && (
              <button
                type="button"
                onClick={() => onRegen(img.scene_index, img.prompt)}
                disabled={regenLoading.has(img.scene_index)}
                title={t('tools.ill_regen')}
                className="absolute top-2 right-2 p-1.5 rounded-lg transition-all disabled:opacity-50"
                style={{
                  background: img.url ? 'rgba(0,0,0,0.6)' : 'rgba(124,58,237,0.7)',
                  color: img.url ? '#94a3b8' : '#e9d5ff',
                }}
              >
                {regenLoading.has(img.scene_index) ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
              </button>
            )}
          </div>

          {/* Scene description */}
          {(img.scene || regenErrors[img.scene_index]) && (
            <div className="px-3 py-2">
              {regenErrors[img.scene_index] && (
                <p className="text-xs text-red-400 mb-1">{regenErrors[img.scene_index]}</p>
              )}
              {img.scene && (
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{img.scene}</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
