'use client'

import { useState, useRef, Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { useLang } from '@/hooks/useLang'
import { refreshCredits } from '@/lib/refresh-credits'
import { CREDIT_COSTS } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import type { ThumbnailTextMode } from '@/lib/thumbnail-text-presets'

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

const TEXT_MODES: { value: ThumbnailTextMode; label: string; desc: string }[] = [
  { value: 'overlay', label: 'Наложить',    desc: 'Текст рисует наш движок — стабильно и чётко' },
  { value: 'ai',      label: 'AI рисует',   desc: 'Нейросеть встраивает текст в сцену — творчески, но возможны ошибки' },
  { value: 'none',    label: 'Без текста',  desc: 'Чистый фон без надписей' },
]

const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: '',  label: 'По умолчанию' },
  { value: 'cinematic photography, dramatic lighting, movie still, wide-angle',                  label: 'Кинематограф' },
  { value: 'photorealistic, professional photography, detailed, shot on camera',                 label: 'Фото' },
  { value: 'cartoon style, vibrant colors, animated illustration, bold lines',                   label: 'Мультфильм' },
  { value: 'anime style, cel shading, Japanese animation, expressive characters',                label: 'Аниме' },
  { value: 'flat 2D doodle cartoon, minimalist stick figures, bold black outlines, simple comedic style', label: 'Дудл' },
  { value: '3D animated render, Pixar style, volumetric lighting, polished CGI',                label: '3D Pixar' },
  { value: 'neon cyberpunk style, vibrant neon colors, futuristic dystopia',                    label: 'Киберпанк' },
  { value: 'watercolor painting style, soft colors, textured paper, artistic',                   label: 'Акварель' },
  { value: 'oil painting, visible brushstrokes, impasto texture, classical palette',             label: 'Масло' },
  { value: 'hand-drawn illustration, pencil sketch style, artistic line art',                    label: 'Скетч' },
  { value: 'dark atmospheric, low-key lighting, deep shadows, moody cinematic',                  label: 'Атмосфера' },
]

const BASE_COST = CREDIT_COSTS.thumbnail

function ThumbnailContent() {
  const { t } = useLang()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  const [title, setTitle]         = useState('')
  const [topic, setTopic]         = useState('')
  const [script, setScript]       = useState('')
  const [imageStyle, setImageStyle] = useState('')
  const [textMode, setTextMode]   = useState<ThumbnailTextMode>('overlay')
  const [customPrompt, setCustomPrompt] = useState('')
  const [showCustomPrompt, setShowCustomPrompt] = useState(false)

  // Reference image
  const [refUrl, setRefUrl]       = useState('')     // Supabase public URL
  const [refPreview, setRefPreview] = useState('')   // local blob URL for preview
  const [refUploading, setRefUploading] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [error, setError]         = useState('')

  // Result
  const [thumbUrl, setThumbUrl]   = useState('')
  const [bgUrl, setBgUrl]         = useState('')
  const [savedId, setSavedId]     = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  // Restore from ?run=
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        const p = json.data?.project
        if (json.ok && p?.thumbnail_url) {
          setThumbUrl(p.thumbnail_url)
          setTitle(p.title ?? '')
          setTopic(p.topic ?? '')
          setSavedId(runId)
        }
      })
      .catch(() => {})
  }, [runId])

  const cost = BASE_COST

  async function handleRefUpload(file: File) {
    if (!file.type.startsWith('image/')) { setError('Поддерживаются только изображения'); return }
    setRefUploading(true)
    setError('')
    try {
      const ext  = file.name.split('.').pop() ?? 'jpg'
      const path = `ref/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const sb   = createClient()
      const { error: upErr } = await sb.storage.from('images').upload(path, file, { upsert: true })
      if (upErr) throw new Error(upErr.message)
      const { data: { publicUrl } } = sb.storage.from('images').getPublicUrl(path)
      setRefUrl(publicUrl)
      setRefPreview(URL.createObjectURL(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setRefUploading(false)
    }
  }

  function clearRef() {
    if (refPreview) URL.revokeObjectURL(refPreview)
    setRefUrl('')
    setRefPreview('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function generate(opts: { reuseBackground?: boolean } = {}) {
    if (!title.trim()) { setError('Введите заголовок'); return }
    if (!topic.trim()) { setError('Введите тему'); return }
    setError('')
    setGenerating(true)

    try {
      const effectiveTopic = script.trim()
        ? `${topic.trim()}\n\nКонтекст сценария: ${script.trim().slice(0, 800)}`
        : topic.trim()

      const body: Record<string, unknown> = {
        title: title.trim(),
        topic: effectiveTopic,
        text_mode: textMode,
        image_style: imageStyle || undefined,
        custom_prompt: (showCustomPrompt && customPrompt.trim()) ? customPrompt.trim() : undefined,
        ref_url:   refUrl || undefined,
        ref_style: refUrl ? 'match reference image style, typography, color palette and mood' : undefined,
        ...(opts.reuseBackground && bgUrl ? { bg_url: bgUrl } : {}),
      }

      const res = await fetch('/api/generate/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 504 || res.status === 524) throw new Error(t('tools.err_timeout'))

      const json: {
        ok: boolean
        data?: { thumbnail_url?: string; bg_url?: string; tool_run_id?: string }
        error?: string; code?: string
      } = await res.json()

      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(json.error ?? t('thumb.err_gen'))
      }
      if (json.data?.thumbnail_url) setThumbUrl(json.data.thumbnail_url)
      if (json.data?.bg_url)        setBgUrl(json.data.bg_url)
      if (json.data?.tool_run_id)   setSavedId(json.data.tool_run_id)
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('thumb.err_gen'))
    } finally {
      setGenerating(false)
    }
  }

  const card  = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
  const input = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }
  const active   = { background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.5)', color: '#a78bfa' }
  const inactive = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b' }

  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.thumb_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.thumb_subtitle')}</p>
      </div>

      <div className="flex flex-col gap-5">
        {/* Title + Topic + Script */}
        <div className="rounded-2xl p-5 flex flex-col gap-4" style={card}>
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">
              {t('tools.thumb_title_label')} <span className="text-red-400">*</span>
            </label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder={t('tools.thumb_title_ph')} maxLength={120}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-200 outline-none" style={input}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">
              {t('tools.thumb_topic_label')} <span className="text-red-400">*</span>
            </label>
            <input
              type="text" value={topic} onChange={e => setTopic(e.target.value)}
              placeholder={t('tools.thumb_topic_ph')} maxLength={300}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-200 outline-none" style={input}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-400">{t('tools.thumb_script_label')}</label>
              <span className="text-[11px] text-slate-600">Уточняет визуал под содержание видео</span>
            </div>
            <textarea
              rows={3} value={script} onChange={e => setScript(e.target.value)}
              placeholder={t('tools.thumb_script_ph')}
              className="w-full px-3 py-2.5 rounded-xl text-sm resize-none outline-none"
              style={{ ...input, color: '#e2e8f0' }}
            />
          </div>
        </div>

        {/* Style selector */}
        <div className="rounded-2xl p-5" style={card}>
          <label className="text-xs font-medium text-slate-400 block mb-3">{t('tools.thumb_style_label')}</label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {STYLE_OPTIONS.map(s => (
              <button
                key={s.value} type="button" onClick={() => setImageStyle(s.value)}
                className="px-2 py-2 rounded-lg text-[11px] font-medium transition-all text-center"
                style={imageStyle === s.value ? active : inactive}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Text mode */}
        <div className="rounded-2xl p-5" style={card}>
          <label className="text-xs font-medium text-slate-400 block mb-3">{t('tools.thumb_mode_label')}</label>
          <div className="flex flex-col gap-2">
            {TEXT_MODES.map(m => (
              <button
                key={m.value} type="button" onClick={() => setTextMode(m.value)}
                className="flex items-start gap-3 p-3 rounded-xl transition-all text-left"
                style={textMode === m.value ? active : { ...inactive, color: '#94a3b8' }}
              >
                <div className="mt-0.5 shrink-0">
                  <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center
                    ${textMode === m.value ? 'border-violet-400' : 'border-slate-600'}`}>
                    {textMode === m.value && <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
                  </div>
                </div>
                <div>
                  <span className={`text-xs font-semibold block ${textMode === m.value ? 'text-violet-300' : 'text-slate-300'}`}>
                    {m.label}
                    {m.value === 'overlay' && <span className="ml-2 text-[10px] font-normal text-violet-500">Рекомендуем</span>}
                  </span>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">{m.desc}</span>
                </div>
              </button>
            ))}
          </div>
          {textMode === 'ai' && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl text-[11px] text-amber-400"
              style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
              ⚠️ Нейросеть может ошибаться в написании текста. Проверьте результат перед публикацией.
            </div>
          )}
        </div>

        {/* Reference image */}
        <div className="rounded-2xl p-5" style={card}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-slate-300">{t('tools.thumb_ref_label')}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{t('tools.thumb_ref_desc')}</p>
            </div>
            {refUrl && (
              <button type="button" onClick={clearRef} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                Удалить
              </button>
            )}
          </div>
          {refUrl ? (
            <div className="relative w-full rounded-xl overflow-hidden" style={{ paddingTop: '56.25%' }}>
              <Image src={refPreview || refUrl} alt="reference" fill className="object-cover" />
            </div>
          ) : (
            <label
              className="flex flex-col items-center gap-2 py-8 rounded-xl cursor-pointer transition-colors"
              style={{ border: '2px dashed rgba(255,255,255,0.12)' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.4)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')}
            >
              <input
                ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleRefUpload(f) }}
              />
              {refUploading
                ? <SpinnerIcon className="w-6 h-6 animate-spin text-violet-400" />
                : <span className="text-2xl">🖼️</span>
              }
              <span className="text-xs text-slate-500">
                {refUploading ? 'Загрузка...' : 'Нажмите, чтобы выбрать референс (+2 кр.)'}
              </span>
            </label>
          )}
        </div>

        {/* Custom prompt (collapsed by default) */}
        <div className="rounded-2xl p-5" style={card}>
          <button type="button" onClick={() => setShowCustomPrompt(!showCustomPrompt)}
            className="flex items-center justify-between w-full">
            <span className="text-xs font-medium text-slate-400">{t('tools.thumb_prompt_label')}</span>
            <span className="text-xs text-slate-600">{showCustomPrompt ? '▲' : '▼'}</span>
          </button>
          {showCustomPrompt && (
            <div className="mt-3">
              <p className="text-[11px] text-slate-600 mb-2">Заменяет автогенерированный промпт. Только английский, 25–50 слов.</p>
              <textarea
                rows={3} value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                placeholder="Dramatic scene: a lone wolf on a snowy cliff, cinematic lighting, deep shadows…"
                className="w-full px-3 py-2.5 rounded-xl text-sm resize-none outline-none"
                style={{ ...input, color: '#e2e8f0' }}
              />
            </div>
          )}
        </div>

        {/* Generate */}
        <button
          type="button" onClick={() => generate()}
          disabled={generating || !title.trim() || !topic.trim()}
          className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
        >
          {generating
            ? <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.thumb_generating')}</>
            : <>{t('tools.thumb_gen_btn')} · −{cost} {t('nav.credits_suffix')}</>
          }
        </button>

        {error && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Result */}
        {thumbUrl && (
          <div className="rounded-2xl p-5 flex flex-col gap-4" style={card}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-300">{t('tools.thumb_result_label')}</p>
              {savedId && <span className="text-[11px] text-green-500">{t('tools.saved')}</span>}
            </div>

            <div className="relative w-full rounded-xl overflow-hidden" style={{ paddingTop: '56.25%' }}>
              <Image src={thumbUrl} alt={title} fill className="object-cover" />
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={thumbUrl} download="thumbnail.png"
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg"
                style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}
              >
                ↓ {t('tools.thumb_download')}
              </a>
              {bgUrl && textMode !== 'ai' && (
                <button
                  type="button" onClick={() => generate({ reuseBackground: true })} disabled={generating}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-all disabled:opacity-60"
                  style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa' }}
                >
                  {generating ? <SpinnerIcon className="w-3 h-3 animate-spin" /> : '↺'} Сменить текст (−{BASE_COST} кр.)
                </button>
              )}
              <button
                type="button" onClick={() => generate()} disabled={generating}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-all disabled:opacity-60"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b' }}
              >
                {generating ? <SpinnerIcon className="w-3 h-3 animate-spin" /> : '↺'} Новый фон (−{cost} кр.)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ThumbnailGenPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Загрузка...</div>}>
      <ThumbnailContent />
    </Suspense>
  )
}
