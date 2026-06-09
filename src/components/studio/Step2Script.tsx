'use client'

import { useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'

type Model = 'claude' | 'gpt-4o'

const MODEL_OPTIONS: { value: Model; label: string; desc: string }[] = [
  { value: 'claude', label: 'Claude Sonnet', desc: 'Быстро, отличное качество' },
  { value: 'gpt-4o', label: 'GPT-4o', desc: 'Альтернативный стиль письма' },
]

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export default function Step2Script() {
  const { scriptParams, projectId, script, setScript, setStep } = useStudioStore()
  const [model, setModel] = useState<Model>('claude')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerate() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scriptParams, project_id: projectId, model }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError('Недостаточно кредитов. Пополните баланс в разделе «Тарифы».')
          return
        }
        throw new Error(json.error)
      }
      setScript(json.data.script)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации сценария')
    } finally {
      setLoading(false)
    }
  }

  const words = script ? countWords(script) : 0
  const estimatedMin = Math.round(words / 130)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 2: Сценарий</h2>
        <p className="text-sm text-gray-500">
          Тема: <span className="font-medium text-gray-700">«{scriptParams.topic}»</span>
        </p>
      </div>

      {/* Model selector */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Модель</p>
        <div className="grid grid-cols-2 gap-3">
          {MODEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setModel(opt.value)}
              className={`text-left px-4 py-3 rounded-xl border-2 transition-all ${
                model === opt.value
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="w-full py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Генерация сценария...
          </>
        ) : script ? (
          '↺ Перегенерировать (−10 кр.)'
        ) : (
          '✨ Сгенерировать сценарий (−10 кр.)'
        )}
      </button>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Script textarea */}
      {script !== null && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">Сценарий</p>
            <span className="text-xs text-gray-400">
              {words} слов · ~{estimatedMin} мин.
            </span>
          </div>
          <textarea
            rows={16}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400 leading-relaxed"
          />
          <p className="text-xs text-gray-400 mt-1">
            Отредактируйте сценарий при необходимости перед озвучкой
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(1)}
          className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => setStep(3)}
          disabled={!script}
          className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-200 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Далее: Озвучка →
        </button>
      </div>
    </div>
  )
}
