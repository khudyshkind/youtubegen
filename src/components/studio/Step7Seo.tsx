'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useStudioStore } from '@/lib/studio-store'
import { CREDIT_COSTS } from '@/lib/types'
import type { SeoData } from '@/lib/types'

// ─── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
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
      className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border transition-all ${
        copied
          ? 'border-green-300 bg-green-50 text-green-600'
          : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 hover:bg-gray-50'
      }`}
    >
      {copied ? (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          Скопировано
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label ?? 'Копировать'}
        </>
      )}
    </button>
  )
}

// ─── Spinner ───────────────────────────────────────────────────────────────────

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

// ─── Thumbnail section ─────────────────────────────────────────────────────────

function ThumbnailSection({ seoTitle, topic }: { seoTitle: string; topic: string }) {
  const {
    projectId,
    thumbnailUrl, setThumbnailUrl,
    thumbnailBgUrl, setThumbnailBgUrl,
  } = useStudioStore()

  const [customTitle, setCustomTitle] = useState(seoTitle)
  const [editingTitle, setEditingTitle] = useState(false)
  const [loading, setLoading] = useState<'full' | 'text' | null>(null)
  const [error, setError] = useState('')
  // Keep ref in sync so the download handler always reads the latest URL
  const thumbUrlRef = useRef(thumbnailUrl)
  useEffect(() => { thumbUrlRef.current = thumbnailUrl }, [thumbnailUrl])

  // Sync custom title when SEO title changes (only if user hasn't overridden)
  const [titleEdited, setTitleEdited] = useState(false)
  useEffect(() => {
    if (!titleEdited) setCustomTitle(seoTitle)
  }, [seoTitle, titleEdited])

  async function generate(opts: { regenBg: boolean }) {
    if (!projectId) { setError('Сначала создайте проект'); return }
    setError('')
    setLoading(opts.regenBg ? 'full' : 'text')
    try {
      const res = await fetch('/api/generate/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          title: customTitle.trim() || seoTitle,
          topic,
          bg_url: opts.regenBg ? undefined : (thumbnailBgUrl ?? undefined),
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError(`Недостаточно кредитов (нужно ${CREDIT_COSTS.thumbnail} кр.)`)
          return
        }
        throw new Error(json.error)
      }
      setThumbnailUrl(json.data.thumbnail_url)
      setThumbnailBgUrl(json.data.bg_url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации превью')
    } finally {
      setLoading(null)
      setEditingTitle(false)
    }
  }

  async function handleDownload() {
    const url = thumbUrlRef.current
    if (!url) return
    const res = await fetch(url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'thumbnail.jpg'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }

  const isLoading = loading !== null

  return (
    <div className="flex flex-col gap-4 border-t border-gray-100 pt-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-700">Превью видео (Thumbnail)</p>
          <p className="text-xs text-gray-400 mt-0.5">1280×720 · яркое, кликабельное изображение с заголовком</p>
        </div>
        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">
          {CREDIT_COSTS.thumbnail} кр.
        </span>
      </div>

      {/* Custom title input */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1.5">Текст на превью</p>
        {editingTitle ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={customTitle}
              onChange={(e) => { setCustomTitle(e.target.value); setTitleEdited(true) }}
              maxLength={80}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setEditingTitle(false)}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm transition-colors"
            >
              ОК
            </button>
          </div>
        ) : (
          <div
            className="flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:border-gray-300 transition-colors"
            onClick={() => setEditingTitle(true)}
          >
            <span className="text-sm text-gray-800 truncate flex-1">{customTitle || seoTitle}</span>
            <svg className="w-4 h-4 text-gray-400 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
        )}
      </div>

      {/* Preview image */}
      {thumbnailUrl && (
        <div className="relative rounded-xl overflow-hidden bg-gray-100 aspect-video w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnailUrl}
            alt="YouTube thumbnail"
            className={`w-full h-full object-cover transition-opacity ${isLoading ? 'opacity-40' : 'opacity-100'}`}
          />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <SpinnerIcon className="w-8 h-8 text-white animate-spin" />
            </div>
          )}
          <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
            1280×720
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {!thumbnailUrl ? (
          <button
            type="button"
            onClick={() => generate({ regenBg: true })}
            disabled={isLoading}
            className="flex-1 py-2.5 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <SpinnerIcon className="w-4 h-4 animate-spin" />
                Генерация превью...
              </>
            ) : (
              `🖼 Сгенерировать превью (−${CREDIT_COSTS.thumbnail} кр.)`
            )}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => generate({ regenBg: true })}
              disabled={isLoading}
              title="Новое фоновое изображение + тот же текст"
              className="flex-1 py-2 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-medium rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              {loading === 'full' ? (
                <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" /> Генерация фона...</>
              ) : (
                <>↺ Новый фон (−{CREDIT_COSTS.thumbnail} кр.)</>
              )}
            </button>

            <button
              type="button"
              onClick={() => generate({ regenBg: false })}
              disabled={isLoading || !thumbnailBgUrl}
              title="Тот же фон с новым текстом"
              className="flex-1 py-2 border-2 border-gray-200 hover:border-gray-300 bg-white disabled:opacity-40 text-gray-700 font-medium rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              {loading === 'text' ? (
                <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" /> Обновление текста...</>
              ) : (
                <>T Изменить текст (−{CREDIT_COSTS.thumbnail} кр.)</>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              disabled={isLoading}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white font-medium rounded-xl text-xs transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              PNG
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Returns description body with the trailing hashtag line stripped.
function stripHashtags(desc: string): string {
  const trimmed = desc.trimEnd()
  const lastNl = trimmed.lastIndexOf('\n')
  const lastLine = lastNl >= 0 ? trimmed.slice(lastNl + 1).trim() : trimmed
  // If the very last line consists only of #-words, remove it
  if (lastLine.length > 0 && lastLine.split(/\s+/).every((w) => w.startsWith('#'))) {
    return trimmed.slice(0, lastNl >= 0 ? lastNl : 0).trimEnd()
  }
  return trimmed
}

function appendHashtags(body: string, tags: string[]): string {
  if (tags.length === 0) return body
  return `${body}\n\n${tags.join(' ')}`
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function Step7Seo() {
  const { script, scriptParams, subtitleBlocks, projectId, seo, setSeo, setStep, reset } = useStudioStore()
  const [localSeo, setLocalSeo] = useState<SeoData | null>(seo)
  const [newTag, setNewTag] = useState('')
  const [newHashtag, setNewHashtag] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Hashtags stored separately for the editing block; may be absent in old records
  const hashtags: string[] = localSeo?.hashtags ?? []

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
          duration_minutes: scriptParams.duration_minutes,
          subtitle_blocks: subtitleBlocks.length > 0 ? subtitleBlocks : undefined,
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
      const raw: SeoData = json.data.seo
      // Embed hashtags at the end of description so the textarea is "final YouTube text"
      const merged: SeoData = {
        ...raw,
        description: appendHashtags(raw.description, raw.hashtags ?? []),
      }
      setLocalSeo(merged)
      setSeo(merged)
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

  function addHashtag() {
    const raw = newHashtag.trim()
    if (!raw || !localSeo) return
    const tag = raw.startsWith('#') ? raw : `#${raw}`
    if (hashtags.includes(tag)) return
    const newTags = [...hashtags, tag]
    setLocalSeo({
      ...localSeo,
      hashtags: newTags,
      description: appendHashtags(stripHashtags(localSeo.description), newTags),
    })
    setNewHashtag('')
  }

  function removeHashtag(idx: number) {
    if (!localSeo) return
    const newTags = hashtags.filter((_, i) => i !== idx)
    setLocalSeo({
      ...localSeo,
      hashtags: newTags,
      description: appendHashtags(stripHashtags(localSeo.description), newTags),
    })
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
          <h2 className="text-xl font-bold text-gray-900 mb-2">Видео готово!</h2>
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
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 7: SEO + Превью</h2>
        <p className="text-sm text-gray-500">
          Заголовок, описание, теги и превью для максимального охвата
        </p>
      </div>

      {/* SEO generate button */}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="w-full py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <SpinnerIcon className="w-4 h-4 animate-spin" />
            Генерация SEO...
          </>
        ) : localSeo ? (
          '↺ Перегенерировать SEO (−5 кр.)'
        ) : (
          '🔍 Сгенерировать SEO (−5 кр.)'
        )}
      </button>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
      )}

      {localSeo && (
        <div className="flex flex-col gap-5">
          {/* Title A/B picker */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Заголовок</label>
              <CopyButton text={localSeo.title} />
            </div>

            {/* If we have an alt title — show A/B cards */}
            {localSeo.title_alt ? (
              <div className="flex flex-col gap-2 mb-2">
                {([localSeo.title, localSeo.title_alt] as [string, string]).map((t, i) => {
                  const isActive = i === 0
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (i === 1) {
                          // swap: alt becomes title, title becomes alt
                          setLocalSeo({ ...localSeo, title: localSeo.title_alt!, title_alt: localSeo.title })
                        }
                      }}
                      className={`flex items-start gap-3 w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                        isActive
                          ? 'border-red-400 bg-red-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <span className={`shrink-0 mt-0.5 text-xs font-bold px-1.5 py-0.5 rounded ${
                        isActive ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-600'
                      }`}>
                        {isActive ? 'A ✓' : 'B'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 leading-snug">{t}</p>
                        <p className={`text-xs mt-1 ${t.length > 70 ? 'text-red-500' : 'text-gray-400'}`}>
                          {t.length}/70 {isActive ? '· активный' : '· нажми чтобы выбрать'}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : null}

            {/* Editable input for active title */}
            <input
              type="text"
              value={localSeo.title}
              onChange={(e) => setLocalSeo({ ...localSeo, title: e.target.value })}
              className={`w-full px-4 py-2.5 border rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400 ${
                localSeo.title.length > 70 ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            <p className={`text-xs mt-1 text-right ${localSeo.title.length > 70 ? 'text-red-500' : 'text-gray-400'}`}>
              {localSeo.title.length}/70
            </p>
          </div>

          {/* Description — textarea already contains hashtags at the bottom */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <label className="text-sm font-medium text-gray-700">Описание</label>
                <span className="ml-2 text-xs text-gray-400">первые 2 строки видны в поиске без разворачивания</span>
              </div>
              <CopyButton text={localSeo.description} label="Копировать" />
            </div>
            <textarea
              rows={12}
              value={localSeo.description}
              onChange={(e) => setLocalSeo({ ...localSeo, description: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm text-gray-900 resize-y focus:outline-none focus:ring-2 focus:ring-red-400 leading-relaxed font-mono"
            />
          </div>

          {/* Hashtags — editing here auto-updates the end of the description textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Хэштеги</label>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                  hashtags.length >= 3 && hashtags.length <= 5
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {hashtags.length}/5
                </span>
                <span className="text-xs text-gray-400">изменения обновляют описание выше</span>
              </div>
              <CopyButton text={hashtags.join(' ')} label="Копировать хэштеги" />
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {hashtags.map((tag, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full border border-blue-200"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeHashtag(idx)}
                    className="text-blue-400 hover:text-red-500 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
              {hashtags.length === 0 && (
                <p className="text-xs text-gray-400">Хэштеги ещё не добавлены</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newHashtag}
                onChange={(e) => setNewHashtag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addHashtag())}
                placeholder="#история или история"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              <button
                type="button"
                onClick={addHashtag}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-xl transition-colors"
              >
                +
              </button>
            </div>
          </div>

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Теги</label>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                  localSeo.tags.length >= 20 && localSeo.tags.length <= 25
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {localSeo.tags.length}/25
                </span>
              </div>
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

          {/* Quick copy actions */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Скопировать для YouTube</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={localSeo.title} label="Заголовок A" />
              {localSeo.title_alt && (
                <CopyButton text={localSeo.title_alt} label="Заголовок B" />
              )}
              <CopyButton text={localSeo.description} label="Описание" />
              <CopyButton text={localSeo.tags.join(', ')} label="Теги" />
              <CopyButton
                text={`${localSeo.title}\n\n${localSeo.description}\n\nТеги: ${localSeo.tags.join(', ')}`}
                label="Всё сразу"
              />
            </div>
          </div>

          {/* Thumbnail section — only shown after SEO is generated */}
          <ThumbnailSection
            seoTitle={localSeo.title}
            topic={scriptParams.topic}
          />
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(6)}
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
