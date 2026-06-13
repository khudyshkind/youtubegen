'use client'

import { useCallback, useRef, useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import { CREDIT_COSTS } from '@/lib/types'
import type { SceneImage } from '@/lib/types'

const INTERVAL_PRESETS = [5, 8, 10, 15, 20] as const

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

export default function Step5Images() {
  const {
    script, scriptParams, subtitleBlocks, projectId,
    sceneImages, imageInterval,
    setSceneImages, setImageInterval, setStep,
  } = useStudioStore()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [customInterval, setCustomInterval] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState('')
  const imageFilesRef = useRef<HTMLInputElement>(null)

  // Per-scene regen state
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editingPrompt, setEditingPrompt] = useState('')
  // Ref mirrors editingPrompt so async handlers always read the latest value,
  // avoiding stale closure in React 18 Concurrent Mode.
  const editingPromptRef = useRef('')
  const [regenLoading, setRegenLoading] = useState<Set<number>>(new Set())
  const [regenErrors, setRegenErrors] = useState<Record<number, string>>({})

  // Derive audio duration: prefer actual subtitle data over estimated duration
  const audioDurationSec =
    subtitleBlocks.length > 0
      ? Math.ceil(subtitleBlocks[subtitleBlocks.length - 1].end)
      : scriptParams.duration_minutes * 60

  const imageCount = Math.max(1, Math.ceil(audioDurationSec / imageInterval))
  const creditCost = imageCount * CREDIT_COSTS.image

  function handleIntervalPreset(sec: number) {
    setImageInterval(sec)
    setCustomInterval('')
  }

  function handleCustomIntervalChange(raw: string) {
    setCustomInterval(raw)
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n >= 3 && n <= 30) {
      setImageInterval(n)
    }
  }

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 20)
    if (files.length === 0) return
    if (!projectId) { setUploadError('Сначала создайте проект (шаг 1)'); return }
    setUploadError('')
    setUploading(true)
    setUploadProgress(0)

    try {
      const results: SceneImage[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const signRes = await fetch('/api/upload/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'image',
            project_id: projectId,
            index: i + 1,
            content_type: file.type || 'image/jpeg',
          }),
        })
        const signJson = await signRes.json()
        if (!signJson.ok) throw new Error(signJson.error)

        const { signed_url, access_url } = signJson.data
        const uploadRes = await fetch(signed_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'image/jpeg' },
          body: file,
        })
        if (!uploadRes.ok) throw new Error(`Ошибка загрузки файла ${i + 1}`)

        results.push({ scene_index: i + 1, url: access_url, prompt: '' })
        setUploadProgress(Math.round(((i + 1) / files.length) * 100))
      }
      setSceneImages(results)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Ошибка загрузки изображений')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }, [projectId, setSceneImages])

  async function handleGenerate() {
    if (!script?.trim()) { setError('Сначала сгенерируйте сценарий (шаг 2)'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          topic: scriptParams.topic,
          duration_sec: audioDurationSec,
          image_count: imageCount,
          project_id: projectId,
          image_interval: imageInterval,
          subtitle_blocks: subtitleBlocks.length > 0 ? subtitleBlocks : undefined,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError(`Недостаточно кредитов. Нужно ${imageCount * CREDIT_COSTS.image} кр.`)
          return
        }
        throw new Error(json.error)
      }
      setSceneImages(json.data.scene_images as SceneImage[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации иллюстраций')
    } finally {
      setLoading(false)
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
    if (!projectId) {
      setRegenErrors((prev) => ({ ...prev, [sceneIndex]: 'Сначала сохраните проект' }))
      return
    }
    setRegenLoading((prev) => new Set([...prev, sceneIndex]))
    setRegenErrors((prev) => { const n = { ...prev }; delete n[sceneIndex]; return n })
    try {
      const promptToSend = editingPromptRef.current
      console.log(`[regen] scene_index=${sceneIndex} prompt sent:`, promptToSend)

      const res = await fetch('/api/generate/image-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, scene_index: sceneIndex, prompt: promptToSend }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setRegenErrors((prev) => ({ ...prev, [sceneIndex]: `Недостаточно кредитов (нужно ${CREDIT_COSTS.image} кр.)` }))
          return
        }
        throw new Error(json.error)
      }
      console.log(`[regen] scene_index=${sceneIndex} new URL:`, json.data.image?.url)

      // Append cache-buster so the browser fetches the new image even if the
      // Supabase Storage path (and therefore URL) is identical after upsert.
      const raw: SceneImage = json.data.image
      const newImage: SceneImage = {
        ...raw,
        url: raw.url ? `${raw.url}?t=${Date.now()}` : raw.url,
      }

      const latest = useStudioStore.getState().sceneImages
      setSceneImages(latest.map((img) => img.scene_index === sceneIndex ? newImage : img))
      closeEditor()
    } catch (err) {
      setRegenErrors((prev) => ({ ...prev, [sceneIndex]: err instanceof Error ? err.message : 'Ошибка перегенерации' }))
    } finally {
      setRegenLoading((prev) => { const n = new Set(prev); n.delete(sceneIndex); return n })
    }
  }

  const durationLabel =
    subtitleBlocks.length > 0
      ? `${Math.floor(audioDurationSec / 60)} мин ${audioDurationSec % 60} сек (из субтитров)`
      : `~${scriptParams.duration_minutes} мин (по параметрам)`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 5: Иллюстрации</h2>
        <p className="text-sm text-gray-500">
          Настройте частоту смены иллюстраций и сгенерируйте изображения
        </p>
      </div>

      {/* Interval selector */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">Смена изображения каждые...</p>
          <span className="text-xs text-gray-400">{durationLabel}</span>
        </div>

        {/* Preset buttons */}
        <div className="flex gap-2 flex-wrap">
          {INTERVAL_PRESETS.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => handleIntervalPreset(sec)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-all ${
                imageInterval === sec && !customInterval
                  ? 'border-red-400 bg-red-50 text-red-600'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
              }`}
            >
              {sec} сек
            </button>
          ))}

          {/* Custom input */}
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={3}
              max={30}
              value={customInterval}
              onChange={(e) => handleCustomIntervalChange(e.target.value)}
              placeholder="..."
              className={`w-16 px-2 py-1.5 border-2 rounded-xl text-sm text-center text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400 transition-all ${
                customInterval && !isNaN(parseInt(customInterval, 10))
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-200'
              }`}
            />
            <span className="text-xs text-gray-400">сек</span>
          </div>
        </div>

        {/* Calculation preview */}
        <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <p className="text-xs text-gray-700 leading-relaxed">
            {audioDurationSec} сек ÷ {imageInterval} сек/кадр = {' '}
            <strong className="text-gray-900">{imageCount} иллюстраций</strong>
            <span className="mx-1.5 text-gray-400">·</span>
            Стоимость: <strong className="text-red-600">{creditCost} кредитов</strong>
            <span className="ml-1 text-gray-400">({CREDIT_COSTS.image} кр./шт.)</span>
          </p>
        </div>
      </div>

      {/* Info about AI scene splitting */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-blue-700 leading-relaxed">
          Claude проанализирует сценарий целиком и разобьёт его на <strong>{imageCount} сцен</strong> по смыслу.
          Для каждой сцены будет написан детальный промпт на английском и сгенерирована иллюстрация через Flux.
        </p>
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading || !script?.trim()}
        className="w-full py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <SpinnerIcon className="w-4 h-4 animate-spin" />
            Claude анализирует сценарий и генерирует иллюстрации...
          </>
        ) : sceneImages.length > 0 ? (
          `↺ Перегенерировать все (−${imageCount * CREDIT_COSTS.image} кр.)`
        ) : (
          `🎨 Сгенерировать ${imageCount} иллюстраций (−${imageCount * CREDIT_COSTS.image} кр.)`
        )}
      </button>

      {/* Upload own images / skip */}
      {!loading && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => imageFilesRef.current?.click()}
            disabled={uploading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-300 text-gray-600 text-xs font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {uploading ? (
              <>
                <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
                Загрузка... {uploadProgress}%
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Загрузить свои фото (до 20)
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStep(6)}
            className="flex items-center gap-1 py-2 px-3 border border-gray-200 text-gray-400 text-xs font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Пропустить →
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
        <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{uploadError}</p>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Generated images grid */}
      {sceneImages.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-3">
            Готовые иллюстрации ({sceneImages.length})
            <span className="ml-2 text-xs text-gray-400 font-normal">— нажмите ↺ для перегенерации отдельной сцены</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {sceneImages.map((img, arrayIdx) => {
              const isLoading = regenLoading.has(img.scene_index)
              const isEditing = editingIdx === img.scene_index
              const err = regenErrors[img.scene_index]

              return (
                <div
                  key={img.scene_index}
                  className={`flex flex-col gap-2 ${isEditing ? 'col-span-2 sm:col-span-3' : ''}`}
                >
                  <div className={`flex gap-3 ${isEditing ? 'items-start' : 'flex-col'}`}>
                    {/* Image card */}
                    <div className={`relative rounded-xl overflow-hidden bg-gray-100 shrink-0 ${
                      isEditing ? 'w-40 sm:w-52 aspect-video' : 'aspect-video w-full'
                    }`}>
                      {img.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img.url}
                          alt={`Сцена ${arrayIdx + 1}`}
                          className={`w-full h-full object-cover transition-opacity ${isLoading ? 'opacity-40' : 'opacity-100'}`}
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-400 text-xs">
                          Ошибка
                        </div>
                      )}

                      {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                          <SpinnerIcon className="w-5 h-5 text-gray-700 animate-spin" />
                          <span className="text-xs text-gray-700 font-medium">Генерация...</span>
                        </div>
                      )}

                      <div className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded">
                        {img.timecode_start ?? arrayIdx + 1}
                      </div>

                      {!isLoading && !isEditing && (
                        <button
                          type="button"
                          onClick={() => openEditor(img.scene_index, img.prompt)}
                          className="absolute top-1 right-1 p-1.5 bg-black/50 hover:bg-black/75 text-white rounded-lg transition-colors"
                          title="Перегенерировать сцену"
                        >
                          <RefreshIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Inline prompt editor */}
                    {isEditing && (
                      <div className="flex-1 flex flex-col gap-2 min-w-0">
                        {img.scene && (
                          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5 leading-snug">
                            {img.scene}
                            {img.timecode_start && (
                              <span className="ml-2 text-gray-400">{img.timecode_start}–{img.timecode_end}</span>
                            )}
                          </p>
                        )}
                        <p className="text-xs font-medium text-gray-600">
                          Промпт для перегенерации сцены {arrayIdx + 1}
                        </p>
                        <textarea
                          rows={3}
                          value={editingPrompt}
                          onChange={(e) => { setEditingPrompt(e.target.value); editingPromptRef.current = e.target.value }}
                          disabled={isLoading}
                          className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-50"
                        />
                        {err && (
                          <p className="text-xs text-red-500 bg-red-50 rounded-lg px-2 py-1">{err}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleSingleRegen(img.scene_index)}
                            disabled={isLoading || !editingPrompt.trim()}
                            className="flex-1 py-2 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-medium rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
                          >
                            {isLoading ? (
                              <>
                                <SpinnerIcon className="w-3 h-3 animate-spin" />
                                Генерация...
                              </>
                            ) : (
                              <>
                                <RefreshIcon className="w-3 h-3" />
                                Перегенерировать (−{CREDIT_COSTS.image} кр.)
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={closeEditor}
                            disabled={isLoading}
                            className="px-4 py-2 border border-gray-300 text-gray-600 font-medium rounded-xl text-xs hover:bg-gray-50 disabled:opacity-40 transition-colors"
                          >
                            Отмена
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
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(4)}
          className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => setStep(6)}
          disabled={sceneImages.length === 0}
          className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-200 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Далее: Видео →
        </button>
      </div>
    </div>
  )
}
