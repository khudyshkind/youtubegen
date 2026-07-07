'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useStudioStore } from '@/lib/studio-store'
import type { SeoData } from '@/lib/types'
import { CREDIT_COSTS } from '@/lib/types'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-xs text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 rounded hover:bg-gray-100"
    >
      {copied ? '✓ Скопировано' : 'Копировать'}
    </button>
  )
}

export default function Step6Seo() {
  const { script, scriptParams, ownScript, projectId, seo, setSeo, setStep, reset } = useStudioStore()
  const [localSeo, setLocalSeo] = useState<SeoData | null>(seo)
  const [newTag, setNewTag] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleGenerate() {
    if (!script) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          topic: scriptParams.topic,
          project_id: projectId,
          ...(ownScript ? {} : { lang: scriptParams.language }),
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError('Недостаточно кредитов для SEO-оптимизации.')
          return
        }
        throw new Error(json.error)
      }
      setLocalSeo(json.data.seo)
      setSeo(json.data.seo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации SEO')
    } finally {
      setLoading(false)
    }
  }

  function addTag() {
    const tag = newTag.trim()
    if (!tag || !localSeo) return
    setLocalSeo({ ...localSeo, tags: [...localSeo.tags, tag] })
    setNewTag('')
  }

  function removeTag(idx: number) {
    if (!localSeo) return
    setLocalSeo({ ...localSeo, tags: localSeo.tags.filter((_, i) => i !== idx) })
  }

  if (done) {
    return (
      <div className="flex flex-col items-center text-center gap-6 py-8">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
          <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Видео готово! 🎉</h2>
          <p className="text-gray-600 text-sm">
            Все материалы сгенерированы. Перейдите в дашборд чтобы найти свой проект.
          </p>
        </div>
        <div className="flex gap-3 w-full max-w-xs">
          <Link
            href="/dashboard"
            className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm text-center transition-colors"
          >
            Перейти в дашборд
          </Link>
          <button
            type="button"
            onClick={reset}
            className="flex-1 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
          >
            Новое видео
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 6: SEO-оптимизация</h2>
        <p className="text-sm text-gray-500">
          Заголовок, описание и теги для максимального охвата
        </p>
      </div>

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
            Генерация SEO...
          </>
        ) : localSeo ? (
          `↺ Перегенерировать SEO (−${CREDIT_COSTS.seo} кр.)`
        ) : (
          `🔍 Сгенерировать SEO (−${CREDIT_COSTS.seo} кр.)`
        )}
      </button>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
      )}

      {localSeo && (
        <div className="flex flex-col gap-5">
          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">Заголовок</label>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${localSeo.title.length > 70 ? 'text-red-500' : 'text-gray-400'}`}>
                  {localSeo.title.length}/70
                </span>
                <CopyButton text={localSeo.title} />
              </div>
            </div>
            <input
              type="text"
              value={localSeo.title}
              onChange={(e) => setLocalSeo({ ...localSeo, title: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">Описание</label>
              <CopyButton text={localSeo.description} />
            </div>
            <textarea
              rows={4}
              value={localSeo.description}
              onChange={(e) => setLocalSeo({ ...localSeo, description: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-red-400 leading-relaxed"
            />
          </div>

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">
                Теги ({localSeo.tags.length})
              </label>
              <CopyButton text={localSeo.tags.join(', ')} />
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {localSeo.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(idx)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Добавить тег..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              <button
                type="button"
                onClick={addTag}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-xl transition-colors"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(5)}
          className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => { setSeo(localSeo!); setDone(true) }}
          disabled={!localSeo}
          className="flex-1 py-3 bg-green-500 hover:bg-green-600 disabled:bg-green-200 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          ✓ Завершить проект
        </button>
      </div>
    </div>
  )
}
