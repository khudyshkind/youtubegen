'use client'

import { useEffect, useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import type { SceneImage } from '@/lib/types'
import { CREDIT_COSTS } from '@/lib/types'

// Derive scene prompts by splitting script into N chunks
function extractPrompts(script: string, count: number): string[] {
  const paragraphs = script.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 40)
  if (paragraphs.length >= count) {
    return paragraphs.slice(0, count).map((p) => p.substring(0, 220))
  }
  const chunkLen = Math.ceil(script.length / count)
  return Array.from({ length: count }, (_, i) => {
    const chunk = script.substring(i * chunkLen, (i + 1) * chunkLen)
    const sentence = chunk.match(/[^.!?\n]+[.!?]/)?.[0]?.trim() ?? chunk.substring(0, 150)
    return sentence
  })
}

export default function Step4Images() {
  const { script, scriptParams, projectId, sceneImages, setSceneImages, setStep } = useStudioStore()
  const [prompts, setPrompts] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Init prompts from script on mount
  useEffect(() => {
    if (!script) return
    const count = Math.max(3, Math.min(8, Math.round(scriptParams.duration_minutes * 1.2)))
    setPrompts(extractPrompts(script, count))
  }, [script, scriptParams.duration_minutes])

  function updatePrompt(idx: number, value: string) {
    setPrompts((prev) => prev.map((p, i) => (i === idx ? value : p)))
  }

  function addPrompt() {
    setPrompts((prev) => [...prev, ''])
  }

  function removePrompt(idx: number) {
    setPrompts((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleGenerate() {
    const nonEmpty = prompts.filter((p) => p.trim())
    if (nonEmpty.length === 0) { setError('Добавьте хотя бы один промпт'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: nonEmpty, project_id: projectId }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError(`Недостаточно кредитов. Нужно ${nonEmpty.length * CREDIT_COSTS.image} кр. (по ${CREDIT_COSTS.image} за изображение).`)
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

  const creditCost = prompts.filter((p) => p.trim()).length * CREDIT_COSTS.image

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 4: Иллюстрации</h2>
        <p className="text-sm text-gray-500">
          Отредактируйте промпты и сгенерируйте иллюстрации для каждой сцены
        </p>
      </div>

      {/* Prompts list */}
      <div className="flex flex-col gap-3">
        {prompts.map((prompt, idx) => (
          <div key={idx} className="flex gap-2 items-start">
            <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0 mt-1.5">
              {idx + 1}
            </div>
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => updatePrompt(idx, e.target.value)}
              placeholder="Опишите сцену для генерации иллюстрации..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <button
              type="button"
              onClick={() => removePrompt(idx)}
              className="text-gray-400 hover:text-red-500 mt-2 transition-colors"
              title="Удалить"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addPrompt}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors self-start"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Добавить сцену
        </button>
      </div>

      {/* Cost notice */}
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-amber-700">
          {prompts.filter((p) => p.trim()).length} иллюстраций · стоимость{' '}
          <strong>{creditCost} кредитов</strong> ({CREDIT_COSTS.image} кр. за штуку)
        </p>
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading || prompts.filter((p) => p.trim()).length === 0}
        className="w-full py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Генерация иллюстраций... (30–60 сек)
          </>
        ) : sceneImages.length > 0 ? (
          `↺ Перегенерировать (−${creditCost} кр.)`
        ) : (
          `🎨 Сгенерировать ${prompts.filter((p) => p.trim()).length} иллюстраций (−${creditCost} кр.)`
        )}
      </button>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Preview grid */}
      {sceneImages.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-3">
            Готовые иллюстрации ({sceneImages.length})
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {sceneImages.map((img) => (
              <div key={img.scene_index} className="relative aspect-video rounded-xl overflow-hidden bg-gray-100">
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.url}
                    alt={`Сцена ${img.scene_index + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 text-xs">
                    Ошибка загрузки
                  </div>
                )}
                <div className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded">
                  {img.scene_index + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(3)}
          className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => setStep(5)}
          disabled={sceneImages.length === 0}
          className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-200 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Далее: Видео →
        </button>
      </div>
    </div>
  )
}
