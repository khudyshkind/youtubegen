'use client'

import { type FormEvent, useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'

const STYLE_OPTIONS = [
  { value: 'educational', label: 'Образовательный' },
  { value: 'entertaining', label: 'Развлекательный' },
  { value: 'motivational', label: 'Мотивационный' },
  { value: 'news', label: 'Новостной' },
] as const

const DURATION_OPTIONS = [3, 5, 7, 10]

export default function Step1Topic() {
  const { scriptParams, setScriptParams, setStep, setProjectId } = useStudioStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!scriptParams.topic.trim()) {
      setError('Введите тему видео')
      return
    }
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: scriptParams.topic.trim(),
          duration_minutes: scriptParams.duration_minutes,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Ошибка создания проекта')

      setProjectId(json.data.project.id)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 1: Тема видео</h2>
        <p className="text-sm text-gray-500">
          Опишите тему — ИИ напишет сценарий, который готов к озвучке
        </p>
      </div>

      {/* Topic */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Тема видео <span className="text-red-500">*</span>
        </label>
        <textarea
          rows={3}
          required
          value={scriptParams.topic}
          onChange={(e) => setScriptParams({ topic: e.target.value })}
          placeholder="Например: Как правильно начать инвестировать с нуля в 2025 году"
          className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
        />
        <p className="text-xs text-gray-400 mt-1">
          Чем конкретнее тема, тем лучше сценарий
        </p>
      </div>

      {/* Duration + Style in a row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Длительность
          </label>
          <select
            value={scriptParams.duration_minutes}
            onChange={(e) => setScriptParams({ duration_minutes: Number(e.target.value) })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d} value={d}>{d} минут</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Стиль
          </label>
          <select
            value={scriptParams.style}
            onChange={(e) =>
              setScriptParams({
                style: e.target.value as typeof scriptParams.style,
              })
            }
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            {STYLE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Target audience */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Целевая аудитория
          <span className="text-gray-400 font-normal ml-1">(необязательно)</span>
        </label>
        <input
          type="text"
          value={scriptParams.target_audience ?? ''}
          onChange={(e) => setScriptParams({ target_audience: e.target.value })}
          placeholder="Например: начинающие инвесторы 25–40 лет"
          className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
        />
      </div>

      {/* Cost notice */}
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-amber-700">
          Генерация сценария стоит <strong>10 кредитов</strong>
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !scriptParams.topic.trim()}
        className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-semibold rounded-xl text-sm transition-colors"
      >
        {loading ? 'Создание проекта...' : 'Далее: Сценарий →'}
      </button>
    </form>
  )
}
