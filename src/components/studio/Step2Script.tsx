'use client'

import { useRef, useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet': 'Claude Sonnet',
  'claude-opus': 'Claude Opus',
  'gpt-4o': 'GPT-4o',
}

const MODEL_COSTS: Record<string, number> = {
  'claude-sonnet': 10,
  'claude-opus': 20,
  'gpt-4o': 12,
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

export default function Step2Script() {
  const { scriptParams, projectId, script, setScript, setStep } = useStudioStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const model = scriptParams.model
  const creditCost = MODEL_COSTS[model] ?? 10

  async function handleGenerate() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scriptParams, project_id: projectId }),
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

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Файл слишком большой (макс. 5 МБ)')
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (!text?.trim()) {
        setUploadError('Файл пустой')
        return
      }
      setScript(text.trim())
    }
    reader.onerror = () => setUploadError('Не удалось прочитать файл')
    reader.readAsText(file, 'UTF-8')

    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  function handlePasteMode() {
    setScript('')  // shows textarea
  }

  const words = script ? countWords(script) : 0
  const estimatedMin = Math.round(words / 130)
  const hasScript = script !== null && script.trim().length > 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 2: Сценарий</h2>
        <p className="text-sm text-gray-500">
          Тема: <span className="font-medium text-gray-700">«{scriptParams.topic}»</span>
        </p>
      </div>

      {/* Selected model info */}
      <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
        <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{MODEL_LABELS[model]}</p>
          <p className="text-xs text-gray-500">{scriptParams.duration_minutes} мин · {scriptParams.language.toUpperCase()}</p>
        </div>
        <button
          type="button"
          onClick={() => setStep(1)}
          className="text-xs text-red-500 hover:text-red-600 font-medium shrink-0"
        >
          Изменить
        </button>
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
            <SpinnerIcon className="w-4 h-4 animate-spin" />
            Генерация сценария...
          </>
        ) : hasScript ? (
          `↺ Перегенерировать (−${creditCost} кр.)`
        ) : (
          `✨ Сгенерировать сценарий (−${creditCost} кр.)`
        )}
      </button>

      {/* Secondary actions: upload / paste / skip */}
      {!loading && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-300 text-gray-600 text-xs font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Загрузить .txt
          </button>
          {script === null && (
            <button
              type="button"
              onClick={handlePasteMode}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-300 text-gray-600 text-xs font-medium rounded-xl hover:bg-gray-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Вставить текст
            </button>
          )}
          <button
            type="button"
            onClick={() => setStep(3)}
            className="flex items-center gap-1 py-2 px-3 border border-gray-200 text-gray-400 text-xs font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Пропустить →
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{uploadError}</p>
      )}

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
            placeholder="Введите или вставьте ваш сценарий здесь..."
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-red-400 leading-relaxed"
          />
          <p className="text-xs text-gray-400 mt-1">
            Отредактируйте при необходимости перед озвучкой
          </p>
        </div>
      )}

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
          disabled={!hasScript}
          className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-200 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Далее: Озвучка →
        </button>
      </div>
    </div>
  )
}
