'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useStudioStore } from '@/lib/studio-store'
import { refreshCredits } from '@/lib/refresh-credits'
import { CREDIT_COSTS } from '@/lib/types'
import type { SeoData } from '@/lib/types'
import { useLang } from '@/hooks/useLang'
import { downloadAllMaterials } from '@/lib/downloadAllMaterials'

// ─── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useLang()
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
      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border transition-all"
      style={copied
        ? { borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.1)', color: '#34D399' }
        : { borderColor: 'rgba(255,255,255,0.1)', color: '#64748B' }
      }
      onMouseEnter={(e) => { if (!copied) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#94A3B8' } }}
      onMouseLeave={(e) => { if (!copied) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#64748B' } }}
    >
      {copied ? (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          {t('copy.copied')}
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label ?? t('copy.copy')}
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
  const { t } = useLang()
  const { projectId, thumbnailUrl, setThumbnailUrl, thumbnailBgUrl, setThumbnailBgUrl,
    thumbnailTextMode, setThumbnailTextMode, imageStyle } = useStudioStore()

  const [customTitle, setCustomTitle] = useState(seoTitle)
  const [editingTitle, setEditingTitle] = useState(false)
  const [loading, setLoading] = useState<'full' | 'text' | null>(null)
  const [error, setError] = useState('')
  const thumbUrlRef = useRef(thumbnailUrl)
  useEffect(() => { thumbUrlRef.current = thumbnailUrl }, [thumbnailUrl])

  const [titleEdited, setTitleEdited] = useState(false)
  useEffect(() => {
    if (!titleEdited) setCustomTitle(seoTitle)
  }, [seoTitle, titleEdited])

  // Reference style
  const [refStyle, setRefStyle] = useState<string | null>(null)
  const [refPreview, setRefPreview] = useState<string | null>(null)
  const [refAnalyzing, setRefAnalyzing] = useState(false)
  const refInputRef = useRef<HTMLInputElement>(null)

  // Prompt editor
  const [promptText, setPromptText] = useState('')
  const [promptLoading, setPromptLoading] = useState(false)
  const [showPromptEditor, setShowPromptEditor] = useState(false)

  async function loadPrompt(refStyleOverride?: string) {
    if (!projectId) return
    setPromptLoading(true)
    try {
      const res = await fetch('/api/generate/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          title: customTitle.trim() || seoTitle,
          topic,
          dry_run: true,
          ref_style: refStyleOverride ?? refStyle ?? undefined,
          text_mode: thumbnailTextMode,
          image_style: imageStyle ?? undefined,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setPromptText(json.data.prompt)
        setShowPromptEditor(true)
      }
    } catch {
      // ignore prompt load errors silently
    } finally {
      setPromptLoading(false)
    }
  }

  async function handleRefUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setRefPreview(URL.createObjectURL(file))
    setRefAnalyzing(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      if (projectId) fd.append('project_id', projectId)
      const res = await fetch('/api/generate/analyze-style', { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.ok) {
        setError(json.code === 'NO_CREDITS' ? t('step7.err_credits') : json.error)
        setRefPreview(null)
        return
      }
      const desc: string = json.data.style_description
      setRefStyle(desc)
      await loadPrompt(desc)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('thumb.err_gen'))
      setRefPreview(null)
    } finally {
      setRefAnalyzing(false)
      e.target.value = ''
    }
  }

  async function generate(opts: { regenBg: boolean; useCustomPrompt?: boolean }) {
    if (!projectId) { setError(t('thumb.err_project')); return }
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
          custom_prompt: opts.useCustomPrompt && promptText.trim() ? promptText.trim() : undefined,
          ref_style: refStyle ?? undefined,
          text_mode: thumbnailTextMode,
          image_style: imageStyle ?? undefined,
        }),
      })
      if (!res.headers.get('content-type')?.includes('application/json')) {
        throw new Error(t('thumb.err_gen'))
      }
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError(t('step7.err_credits'))
          return
        }
        throw new Error(json.error)
      }
      setThumbnailUrl(json.data.thumbnail_url)
      setThumbnailBgUrl(json.data.bg_url)
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('thumb.err_gen'))
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
    <div className="flex flex-col gap-4 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-200">{t('thumb.title')}</p>
          <p className="text-xs text-slate-500 mt-0.5">{t('thumb.desc')}</p>
        </div>
        <span
          className="text-xs px-2 py-1 rounded-full"
          style={{ background: 'rgba(124,58,237,0.12)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.2)' }}
        >
          {CREDIT_COSTS.thumbnail} {t('nav.credits_suffix')}
        </span>
      </div>

      {/* Custom title input */}
      <div>
        <p className="text-xs font-medium text-slate-400 mb-1.5">{t('thumb.text_label')}</p>
        {editingTitle ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={customTitle}
              onChange={(e) => { setCustomTitle(e.target.value); setTitleEdited(true) }}
              maxLength={80}
              className="flex-1 px-3 py-2 rounded-xl text-sm"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setEditingTitle(false)}
              className="px-3 py-2 text-slate-300 rounded-xl text-sm transition-colors hover:text-white"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {t('thumb.ok')}
            </button>
          </div>
        ) : (
          <div
            className="flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={() => setEditingTitle(true)}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.4)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
          >
            <span className="text-sm text-slate-300 truncate flex-1">{customTitle || seoTitle}</span>
            <svg className="w-4 h-4 text-slate-600 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
        )}
      </div>

      {/* Text mode selector */}
      <div>
        <p className="text-xs font-medium text-slate-400 mb-1.5">{t('thumb.text_mode_label')}</p>
        <div className="flex gap-1.5">
          {(['overlay', 'ai', 'none'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setThumbnailTextMode(mode)}
              className="flex-1 px-2 py-1.5 rounded-xl text-xs font-medium transition-all flex flex-col items-center gap-0.5"
              style={thumbnailTextMode === mode
                ? { background: 'rgba(124,58,237,0.25)', border: '1px solid rgba(124,58,237,0.5)', color: '#A78BFA' }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748B' }
              }
            >
              <span>{mode === 'overlay' ? t('thumb.mode_overlay') : mode === 'ai' ? t('thumb.mode_ai') : t('thumb.mode_none')}</span>
              {mode === 'overlay' && thumbnailTextMode !== 'overlay' && (
                <span className="text-[9px] px-1 rounded-sm font-semibold" style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981' }}>
                  {t('thumb.mode_recommended')}
                </span>
              )}
            </button>
          ))}
        </div>
        {thumbnailTextMode === 'ai' && (
          <div className="flex flex-col gap-1 mt-1.5">
            {refStyle && (
              <p className="text-xs" style={{ color: '#F97316' }}>
                {t('thumb.mode_ai_hint_ref_style')}
              </p>
            )}
            {/[а-яёА-ЯЁ]/.test(customTitle || seoTitle) && (
              <p className="text-xs" style={{ color: '#F59E0B' }}>
                {t('thumb.mode_ai_hint_cyrillic')}
              </p>
            )}
            {!refStyle && !/[а-яёА-ЯЁ]/.test(customTitle || seoTitle) && (
              <p className="text-xs" style={{ color: '#F59E0B' }}>
                {t('thumb.mode_ai_hint')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Reference + prompt editor */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {refPreview && (
            <div className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={refPreview} alt="ref" className="w-10 h-10 object-cover rounded-lg" />
              <button
                type="button"
                onClick={() => { setRefPreview(null); setRefStyle(null) }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-white flex items-center justify-center"
                style={{ background: '#EF4444', fontSize: 10, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => refInputRef.current?.click()}
            disabled={refAnalyzing || isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl hover:text-slate-200 disabled:opacity-50 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#94A3B8' }}
          >
            {refAnalyzing ? (
              <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" />{t('thumb.ref_analyzing')}</>
            ) : (
              t('thumb.ref_btn')
            )}
          </button>
          <button
            type="button"
            onClick={() => loadPrompt()}
            disabled={promptLoading || isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl hover:text-slate-200 disabled:opacity-50 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#94A3B8' }}
          >
            {promptLoading ? (
              <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" /></>
            ) : (
              <>✏️ {t('thumb.prompt_btn')}</>
            )}
          </button>
          <input ref={refInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleRefUpload} />
        </div>

        {refStyle && (
          <p className="text-xs" style={{ color: '#A78BFA' }}>
            <span className="text-slate-500">{t('thumb.ref_detected')} </span>
            {refStyle.length > 90 ? `${refStyle.slice(0, 90)}…` : refStyle}
          </p>
        )}

        {showPromptEditor && (
          <div className="flex flex-col gap-2 mt-1">
            <p className="text-xs font-medium text-slate-400">{t('thumb.prompt_label')}</p>
            <textarea
              rows={3}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-xs resize-y font-mono"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1' }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => generate({ regenBg: true, useCustomPrompt: true })}
                disabled={isLoading || !promptText.trim()}
                className="flex-1 py-2 btn-gradient disabled:opacity-40 text-white font-medium rounded-xl text-xs flex items-center justify-center"
              >
                {isLoading ? (
                  <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  `${t('thumb.gen_custom')} (−${CREDIT_COSTS.thumbnail} ${t('nav.credits_suffix')})`
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowPromptEditor(false)}
                className="px-3 py-2 text-slate-400 text-xs rounded-xl hover:text-slate-200 transition-colors"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Preview image */}
      {thumbnailUrl && (
        <div className="relative rounded-xl overflow-hidden aspect-video w-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnailUrl}
            alt="YouTube thumbnail"
            className={`w-full h-full object-cover transition-opacity ${isLoading ? 'opacity-40' : 'opacity-100'}`}
          />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <SpinnerIcon className="w-8 h-8 text-violet-400 animate-spin" />
            </div>
          )}
          <div className="absolute top-2 right-2 text-xs px-2 py-1 rounded" style={{ background: 'rgba(0,0,0,0.7)', color: '#94A3B8' }}>
            1280×720
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 rounded-xl px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.15)' }}>
          {error}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {!thumbnailUrl ? (
          <button
            type="button"
            onClick={() => generate({ regenBg: true })}
            disabled={isLoading}
            className="flex-1 py-2.5 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('thumb.generating')}</>
            ) : (
              `${t('thumb.gen_btn')} (−${CREDIT_COSTS.thumbnail} ${t('nav.credits_suffix')})`
            )}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => generate({ regenBg: true })}
              disabled={isLoading}
              title={t('thumb.new_bg_title')}
              className="flex-1 py-2 text-white font-medium rounded-xl text-xs disabled:opacity-50 flex items-center justify-center gap-1.5 btn-gradient"
            >
              {loading === 'full' ? (
                <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" /> {t('thumb.gen_bg')}</>
              ) : (
                <>{t('thumb.gen_bg_btn')} (−{CREDIT_COSTS.thumbnail} {t('nav.credits_suffix')})</>
              )}
            </button>

            {thumbnailTextMode === 'overlay' && (
              <button
                type="button"
                onClick={() => generate({ regenBg: false })}
                disabled={isLoading || !thumbnailBgUrl}
                title={t('thumb.update_text_title')}
                className="flex-1 py-2 text-slate-300 font-medium rounded-xl text-xs disabled:opacity-40 flex items-center justify-center gap-1.5 hover:text-white transition-colors"
                style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)' }}
              >
                {loading === 'text' ? (
                  <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" /> {t('thumb.update_text')}</>
                ) : (
                  <>{t('thumb.update_text_btn')} (−{CREDIT_COSTS.thumbnail} {t('nav.credits_suffix')})</>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleDownload}
              disabled={isLoading}
              className="px-4 py-2 btn-gradient text-white font-medium rounded-xl text-xs disabled:opacity-40 flex items-center gap-1.5"
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function stripHashtags(desc: string): string {
  const trimmed = desc.trimEnd()
  const lastNl = trimmed.lastIndexOf('\n')
  const lastLine = lastNl >= 0 ? trimmed.slice(lastNl + 1).trim() : trimmed
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

interface Step7SeoProps {
  onRegisterFinish?: (fn: () => void) => void
}

export default function Step7Seo({ onRegisterFinish }: Step7SeoProps) {
  const { t } = useLang()
  const { script, scriptParams, ownScript, subtitleBlocks, sceneImages, audioUrl, videoUrl, projectId, seo, setSeo, setStep, reset } = useStudioStore()
  const [localSeo, setLocalSeo] = useState<SeoData | null>(seo)
  const [newTag, setNewTag] = useState('')
  const [newHashtag, setNewHashtag] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [dlState, setDlState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  // Panel integration: register a finish handler so StepWizard panel calls the same action
  const localSeoRef = useRef<SeoData | null>(localSeo)
  useEffect(() => { localSeoRef.current = localSeo }, [localSeo])
  useEffect(() => {
    onRegisterFinish?.(() => {
      if (localSeoRef.current) { setSeo(localSeoRef.current); setDone(true) }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDownloadAll() {
    setDlState('loading')
    try {
      await downloadAllMaterials({ seo: localSeo })
      setDlState('done')
      setTimeout(() => setDlState('idle'), 3000)
    } catch {
      setDlState('error')
      setTimeout(() => setDlState('idle'), 3000)
    }
  }

  const hasMaterials = sceneImages.length > 0 || !!audioUrl || !!script

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
          ...(scriptParams.language ? { lang: scriptParams.language } : {}),
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('step7.err_credits')); return }
        throw new Error(json.error)
      }
      const raw: SeoData = json.data.seo
      const merged: SeoData = { ...raw, description: appendHashtags(raw.description, raw.hashtags ?? []) }
      setLocalSeo(merged)
      setSeo(merged)
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('step7.err_gen'))
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
    setLocalSeo({ ...localSeo, hashtags: newTags, description: appendHashtags(stripHashtags(localSeo.description), newTags) })
    setNewHashtag('')
  }

  function removeHashtag(idx: number) {
    if (!localSeo) return
    const newTags = hashtags.filter((_, i) => i !== idx)
    setLocalSeo({ ...localSeo, hashtags: newTags, description: appendHashtags(stripHashtags(localSeo.description), newTags) })
  }

  if (done) {
    return (
      <div className="flex flex-col items-center text-center gap-6 py-8">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.3)', boxShadow: '0 0 30px rgba(16,185,129,0.2)' }}
        >
          <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">{t('step7.done_title')}</h2>
          <p className="text-slate-400 text-sm">{t('step7.done_desc')}</p>
        </div>
        <div className="flex gap-3 w-full max-w-xs">
          <Link
            href="/dashboard"
            className="flex-1 py-3 btn-gradient text-white font-semibold rounded-xl text-sm text-center"
          >
            {t('step7.to_dashboard')}
          </Link>
          <button
            type="button"
            onClick={reset}
            className="flex-1 py-3 btn-ghost-dark font-medium rounded-xl text-sm"
          >
            {t('step7.new_video')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{t('step7.title')}</h2>
        <p className="text-sm text-slate-500">{t('step7.subtitle')}</p>
      </div>

      {/* SEO generate button */}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="w-full py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('step7.generating')}</>
        ) : localSeo ? (
          `${t('step7.seo_regen')} (−${CREDIT_COSTS.seo} ${t('nav.credits_suffix')})`
        ) : (
          `${t('step7.seo_gen')} (−${CREDIT_COSTS.seo} ${t('nav.credits_suffix')})`
        )}
      </button>

      {error && (
        <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}

      {localSeo && (
        <div className="flex flex-col gap-5">
          {/* Title A/B picker */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-300">{t('step7.title_label')}</label>
              <CopyButton text={localSeo.title} />
            </div>

            {localSeo.title_alt ? (
              <div className="flex flex-col gap-2 mb-2">
                {([localSeo.title, localSeo.title_alt] as [string, string]).map((title, i) => {
                  const isActive = i === 0
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (i === 1) setLocalSeo({ ...localSeo, title: localSeo.title_alt!, title_alt: localSeo.title })
                      }}
                      className="flex items-start gap-3 w-full text-left px-4 py-3 rounded-xl transition-all"
                      style={
                        isActive
                          ? { border: '2px solid #7C3AED', background: 'rgba(124,58,237,0.1)' }
                          : { border: '2px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }
                      }
                    >
                      <span
                        className="shrink-0 mt-0.5 text-xs font-bold px-1.5 py-0.5 rounded"
                        style={isActive
                          ? { background: '#7C3AED', color: '#fff' }
                          : { background: 'rgba(255,255,255,0.08)', color: '#64748B' }
                        }
                      >
                        {isActive ? 'A ✓' : 'B'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-200 leading-snug">{title}</p>
                        <p className={`text-xs mt-1 ${title.length > 70 ? 'text-red-400' : 'text-slate-500'}`}>
                          {title.length}/70 {isActive ? t('step7.active') : t('step7.select_hint')}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : null}

            <input
              type="text"
              value={localSeo.title}
              onChange={(e) => setLocalSeo({ ...localSeo, title: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl text-sm"
              style={localSeo.title.length > 70 ? { borderColor: 'rgba(239,68,68,0.5) !important' } : {}}
            />
            <p className={`text-xs mt-1 text-right ${localSeo.title.length > 70 ? 'text-red-400' : 'text-slate-500'}`}>
              {localSeo.title.length}/70
            </p>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <label className="text-sm font-medium text-slate-300">{t('step7.description')}</label>
                <span className="ml-2 text-xs text-slate-600">{t('step7.desc_hint')}</span>
              </div>
              <CopyButton text={localSeo.description} label={t('step7.copy')} />
            </div>
            <textarea
              rows={12}
              value={localSeo.description}
              onChange={(e) => setLocalSeo({ ...localSeo, description: e.target.value })}
              className="w-full px-4 py-3 rounded-xl text-sm resize-y leading-relaxed font-mono"
            />
          </div>

          {/* Hashtags */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-300">{t('step7.hashtags')}</label>
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                  style={
                    hashtags.length >= 3 && hashtags.length <= 5
                      ? { background: 'rgba(16,185,129,0.12)', color: '#34D399' }
                      : { background: 'rgba(245,158,11,0.12)', color: '#FBB04D' }
                  }
                >
                  {hashtags.length}/5
                </span>
                <span className="text-xs text-slate-600">{t('step7.hashtags_hint')}</span>
              </div>
              <CopyButton text={hashtags.join(' ')} label={t('step7.copy')} />
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {hashtags.map((tag, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(59,130,246,0.12)', color: '#60A5FA', border: '1px solid rgba(59,130,246,0.2)' }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeHashtag(idx)}
                    className="text-blue-400 hover:text-red-400 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
              {hashtags.length === 0 && (
                <p className="text-xs text-slate-600">{t('step7.no_hashtags')}</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newHashtag}
                onChange={(e) => setNewHashtag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addHashtag())}
                placeholder={t('step7.hashtag_ph')}
                className="flex-1 px-3 py-2 rounded-xl text-sm"
              />
              <button
                type="button"
                onClick={addHashtag}
                className="px-4 py-2 text-slate-300 text-sm font-medium rounded-xl hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                +
              </button>
            </div>
          </div>

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-300">{t('step7.tags')}</label>
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                  style={
                    localSeo.tags.length >= 20 && localSeo.tags.length <= 25
                      ? { background: 'rgba(16,185,129,0.12)', color: '#34D399' }
                      : { background: 'rgba(245,158,11,0.12)', color: '#FBB04D' }
                  }
                >
                  {localSeo.tags.length}/25
                </span>
              </div>
              <CopyButton text={localSeo.tags.join(', ')} />
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {localSeo.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#94A3B8', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(idx)}
                    className="text-slate-500 hover:text-red-400 transition-colors"
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
                placeholder={t('step7.tag_ph')}
                className="flex-1 px-3 py-2 rounded-xl text-sm"
              />
              <button
                type="button"
                onClick={addTag}
                className="px-4 py-2 text-slate-300 text-sm font-medium rounded-xl hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                +
              </button>
            </div>
          </div>

          {/* Quick copy actions */}
          <div
            className="rounded-xl p-4"
            style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)' }}
          >
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('step7.copy_label')}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={localSeo.title} label={t('step7.copy_title_a')} />
              {localSeo.title_alt && <CopyButton text={localSeo.title_alt} label={t('step7.copy_title_b')} />}
              <CopyButton text={localSeo.description} label={t('step7.copy_desc')} />
              <CopyButton text={localSeo.tags.join(', ')} label={t('step7.copy_tags')} />
              <CopyButton
                text={`${localSeo.title}\n\n${localSeo.description}\n\n${t('step7.tags')}: ${localSeo.tags.join(', ')}`}
                label={t('step7.copy_all')}
              />
            </div>
          </div>

          {/* Thumbnail section */}
          <ThumbnailSection seoTitle={localSeo.title} topic={scriptParams.topic} />
        </div>
      )}

      {(hasMaterials || videoUrl) && (
        <div
          className="rounded-xl p-4 flex flex-col gap-3"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {videoUrl && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-300">{t('step7.download_video')}</p>
              <a
                href={videoUrl}
                download={`${(scriptParams.topic || 'video').replace(/[^\wа-яА-ЯёЁ\s-]/g, '').replace(/\s+/g, '_').slice(0, 50)}.mp4`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#94A3B8', border: '1px solid rgba(255,255,255,0.1)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#e2e8f0' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#94A3B8' }}
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                MP4
              </a>
            </div>
          )}

          {hasMaterials && (
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-300">{t('step7.download_all')}</p>
                <p className="text-xs text-slate-600 mt-0.5">{t('step7.download_all_hint')}</p>
              </div>
              <button
                type="button"
                onClick={handleDownloadAll}
                disabled={dlState === 'loading'}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={dlState === 'done'
                  ? { background: 'rgba(16,185,129,0.12)', color: '#34D399', border: '1px solid rgba(16,185,129,0.25)' }
                  : dlState === 'error'
                  ? { background: 'rgba(239,68,68,0.1)', color: '#F87171', border: '1px solid rgba(239,68,68,0.2)' }
                  : { background: 'rgba(255,255,255,0.06)', color: '#94A3B8', border: '1px solid rgba(255,255,255,0.1)' }
                }
                onMouseEnter={(e) => { if (dlState === 'idle') { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#e2e8f0' } }}
                onMouseLeave={(e) => { if (dlState === 'idle') { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#94A3B8' } }}
              >
                {dlState === 'loading' ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {t('step7.download_all_loading')}
                  </>
                ) : dlState === 'done' ? (
                  t('step7.download_all_done')
                ) : dlState === 'error' ? (
                  t('step7.download_all_error')
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    ZIP
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(7)}
          className="px-5 py-3 btn-ghost-dark font-medium rounded-xl text-sm"
        >
          {t('step7.back')}
        </button>
        <div className="flex-1 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => { setSeo(localSeo!); setDone(true) }}
            disabled={!localSeo}
            className="w-full py-3 font-semibold rounded-xl text-sm disabled:opacity-40 transition-all"
            style={localSeo
              ? { background: 'linear-gradient(135deg, #10B981, #059669)', color: '#fff', boxShadow: '0 4px 20px rgba(16,185,129,0.3)' }
              : { background: 'rgba(255,255,255,0.05)', color: '#475569', border: '1px solid rgba(255,255,255,0.08)' }
            }
          >
            {t('step7.finish')}
          </button>
          <p className="text-xs text-center" style={{ color: 'rgba(100,116,139,0.7)' }}>{t('step7.finish_caption')}</p>
        </div>
      </div>
    </div>
  )
}
