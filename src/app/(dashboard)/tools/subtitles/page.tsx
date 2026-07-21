'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/hooks/useLang'
import type { SubtitleBlock } from '@/lib/types'

const ALLOWED_EXTS = ['mp3', 'm4a', 'aac', 'ogg', 'wav']
const MAX_BYTES = 25 * 1024 * 1024

const LANGUAGES = [
  { code: 'ru', label: '🇷🇺 Русский' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'de', label: '🇩🇪 Deutsch' },
  { code: 'es', label: '🇪🇸 Español' },
  { code: 'fr', label: '🇫🇷 Français' },
  { code: 'it', label: '🇮🇹 Italiano' },
  { code: 'pt', label: '🇵🇹 Português' },
  { code: 'zh', label: '🇨🇳 中文' },
  { code: 'ja', label: '🇯🇵 日本語' },
  { code: 'ko', label: '🇰🇷 한국어' },
  { code: 'ar', label: '🇸🇦 العربية' },
  { code: 'uk', label: '🇺🇦 Українська' },
]

// Formats seconds as HH:MM:SS,mmm (SRT) or HH:MM:SS.mmm (VTT)
function fmtTime(s: number, vtt = false): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s % 1) * 1000)
  const sep = vtt ? '.' : ','
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':') + sep + String(ms).padStart(3, '0')
}

function toSRT(blocks: SubtitleBlock[]): string {
  return blocks
    .map((b, i) => `${i + 1}\n${fmtTime(b.start)} --> ${fmtTime(b.end)}\n${b.text}`)
    .join('\n\n') + '\n'
}

function toVTT(blocks: SubtitleBlock[]): string {
  return (
    'WEBVTT\n\n' +
    blocks
      .map((b, i) => `${i + 1}\n${fmtTime(b.start, true)} --> ${fmtTime(b.end, true)}\n${b.text}`)
      .join('\n\n') +
    '\n'
  )
}

function toTXT(blocks: SubtitleBlock[]): string {
  return blocks.map(b => b.text).join('\n') + '\n'
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type Phase = 'uploading' | 'transcribing' | 'saving'

function SubtitlesTool() {
  const { t } = useLang()
  const params = useSearchParams()
  const runId = params.get('run')

  const [file, setFile] = useState<File | null>(null)
  const [language, setLanguage] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [phase, setPhase] = useState<Phase | null>(null)
  const [error, setError] = useState('')
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([])
  const [duration, setDuration] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [baseName, setBaseName] = useState('subtitles')

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Restore from ?run=<project_id>
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        const p = json.data?.project
        if (json.ok && Array.isArray(p?.subtitle_blocks) && p.subtitle_blocks.length > 0) {
          setBlocks(p.subtitle_blocks as SubtitleBlock[])
          setSavedId(runId)
          if (p.title) setBaseName((p.title as string).replace(/\.[^.]+$/, ''))
        }
      })
      .catch(() => {})
  }, [runId])

  function getExt(name: string): string {
    return name.split('.').pop()?.toLowerCase() ?? ''
  }

  function validateFile(f: File): string | null {
    if (!ALLOWED_EXTS.includes(getExt(f.name))) return t('tools.subtitles_err_format')
    if (f.size > MAX_BYTES) return t('tools.subtitles_err_format')
    return null
  }

  function handleFileSelect(f: File) {
    const err = validateFile(f)
    if (err) { setError(err); return }
    setFile(f)
    setBaseName(f.name.replace(/\.[^.]+$/, ''))
    setError('')
    setBlocks([])
    setSavedId(null)
    setDuration(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileSelect(f)
  }

  function phaseLabel(): string {
    if (phase === 'uploading') return t('tools.subtitles_uploading')
    if (phase === 'transcribing') return t('tools.subtitles_transcribing')
    if (phase === 'saving') return t('tools.subtitles_saving')
    return t('tools.subtitles_gen_btn')
  }

  async function handleGenerate() {
    if (!file) { setError(t('tools.subtitles_err_no_file')); return }
    setError('')
    setGenerating(true)
    setBlocks([])
    setSavedId(null)
    setDuration(null)

    try {
      // 1. Get signed upload URL from Supabase Storage
      setPhase('uploading')
      const signRes = await fetch('/api/upload/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tool_audio',
          content_type: file.type || 'audio/mpeg',
          file_name: file.name,
          file_size: file.size,
        }),
      })
      const signJson = await signRes.json()
      if (!signJson.ok) { setError(signJson.error ?? 'Upload init error'); return }

      const { signed_url, access_url, path: storagePath } = signJson.data as {
        signed_url: string
        access_url: string
        path: string
      }

      // 2. Upload file bytes
      const uploadRes = await fetch(signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'audio/mpeg' },
        body: file,
      })
      if (!uploadRes.ok) { setError('Ошибка загрузки файла. Попробуйте ещё раз.'); return }

      // 3. Transcribe via Railway Whisper (no project_id → no DB write in subtitles route)
      setPhase('transcribing')
      const subRes = await fetch('/api/generate/subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_url: access_url,
          ...(language ? { language } : {}),
        }),
      })
      const subJson = await subRes.json()

      if (!subJson.ok) {
        setError(
          subJson.code === 'NO_CREDITS'
            ? t('tools.subtitles_err_credits')
            : (subJson.error ?? 'Ошибка транскрибации'),
        )
        return
      }

      const { subtitle_blocks, duration_seconds, credits_spent: routeCredits } = subJson.data as {
        subtitle_blocks: SubtitleBlock[]
        duration_seconds: number
        credits_spent: number
      }
      setBlocks(subtitle_blocks)
      setDuration(duration_seconds)

      // 4. Save as tool_run; route also deletes the temp audio from Storage.
      // credits_spent comes from the route (already charged via spendCredits) — we only record, never re-charge.
      setPhase('saving')
      const saveRes = await fetch('/api/tools/save-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_type: 'subtitles',
          title: file.name.slice(0, 120),
          input_text: file.name,
          subtitle_blocks,
          audio_storage_path: storagePath,
          credits_spent: routeCredits,
          ...(language ? { language } : {}),
        }),
      })
      const saveJson = await saveRes.json()
      if (saveJson.ok) setSavedId(saveJson.data.project_id as string)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setGenerating(false)
      setPhase(null)
    }
  }

  const hasResult = blocks.length > 0
  const noCredits = error === t('tools.subtitles_err_credits')

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Back */}
      <Link
        href="/tools"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-6"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M5 12l7-7M5 12l7 7" />
        </svg>
        {t('tools.back_to_tools')}
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">🎧 {t('tools.subtitles_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.subtitles_subtitle')}</p>
      </div>

      {/* File drop zone */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-slate-400 mb-2">
          {t('tools.subtitles_file_label')}
        </label>
        <div
          role="button"
          tabIndex={0}
          aria-label={t('tools.subtitles_file_hint')}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors"
          style={{
            borderColor: dragOver ? '#2dd4bf' : file ? 'rgba(45,212,191,0.45)' : 'rgba(100,116,139,0.3)',
            background: dragOver ? 'rgba(20,184,166,0.06)' : 'rgba(15,23,42,0.4)',
          }}
        >
          <svg
            width="32" height="32" viewBox="0 0 24 24" fill="none"
            stroke={file ? '#2dd4bf' : '#64748b'} strokeWidth="1.5"
          >
            <path d="M9 19V6l12-3v13" />
            <circle cx="6" cy="19" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>

          {file ? (
            <div className="text-center">
              <p className="text-sm font-medium text-teal-400">{file.name}</p>
              <p className="text-xs text-slate-500 mt-1">
                {(file.size / 1024 / 1024).toFixed(2)} МБ
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-center">{t('tools.subtitles_file_hint')}</p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.m4a,.aac,.ogg,.wav,audio/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleFileSelect(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {/* Language */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-400 mb-2">
          {t('tools.subtitles_lang_label')}
        </label>
        <select
          value={language}
          onChange={e => setLanguage(e.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-800/60 text-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="">{t('tools.subtitles_lang_auto')}</option>
          {LANGUAGES.map(l => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </div>

      {/* Cost note */}
      <p className="text-xs text-slate-600 mb-6">{t('tools.subtitles_cost_note')}</p>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
          </svg>
          <span>
            {error}
            {noCredits && (
              <>
                {' · '}
                <Link href="/billing" className="underline hover:text-red-300">
                  Пополнить
                </Link>
              </>
            )}
          </span>
        </div>
      )}

      {/* Generate */}
      <button
        onClick={handleGenerate}
        disabled={generating || !file}
        className="w-full rounded-xl py-3 text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{
          background: 'rgba(20,184,166,0.75)',
          color: '#fff',
        }}
      >
        {generating ? (
          <>
            <svg className="animate-spin shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity=".2" />
              <path d="M21 12a9 9 0 01-9 9" />
            </svg>
            {phaseLabel()}
          </>
        ) : t('tools.subtitles_gen_btn')}
      </button>

      {/* Result */}
      {hasResult && (
        <div className="mt-8">
          {/* Header row */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <h2 className="text-sm font-semibold text-slate-300">
              {t('tools.subtitles_result_label')}
              <span className="text-slate-500 font-normal ml-2">
                {blocks.length} {t('tools.subtitles_segments')}
                {duration != null ? ` · ${Math.ceil(duration / 60)} мин` : ''}
              </span>
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => downloadBlob(toSRT(blocks), `${baseName}.srt`, 'text/plain;charset=utf-8')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-teal-500/40 text-teal-400 hover:bg-teal-500/10 transition-colors"
              >
                {t('tools.subtitles_download_srt')}
              </button>
              <button
                onClick={() => downloadBlob(toVTT(blocks), `${baseName}.vtt`, 'text/vtt;charset=utf-8')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-teal-500/40 text-teal-400 hover:bg-teal-500/10 transition-colors"
              >
                {t('tools.subtitles_download_vtt')}
              </button>
              <button
                onClick={() => downloadBlob(toTXT(blocks), `${baseName}.txt`, 'text/plain;charset=utf-8')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-teal-500/40 text-teal-400 hover:bg-teal-500/10 transition-colors"
              >
                {t('tools.subtitles_download_txt')}
              </button>
            </div>
          </div>

          {/* Subtitle blocks preview */}
          <div
            className="rounded-xl border border-slate-700/60 overflow-y-auto divide-y divide-slate-800/60 bg-slate-900/40"
            style={{ maxHeight: '400px' }}
          >
            {blocks.map((b, i) => (
              <div key={i} className="px-4 py-2.5 flex gap-3 hover:bg-slate-800/30 transition-colors">
                <span className="text-xs text-slate-600 w-5 shrink-0 pt-0.5 tabular-nums">{i + 1}</span>
                <span className="text-xs text-teal-700 font-mono shrink-0 pt-0.5 tabular-nums">
                  {fmtTime(b.start, true).slice(0, 8)}
                </span>
                <span className="text-sm text-slate-300 leading-snug">{b.text}</span>
              </div>
            ))}
          </div>

          {/* Saved indicator */}
          {savedId && (
            <div className="mt-3 flex items-center gap-2 text-xs text-teal-600">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              {t('tools.subtitles_saved')}
              <span className="text-slate-600">·</span>
              <Link
                href={`/tools/subtitles?run=${savedId}`}
                className="hover:text-teal-400 transition-colors"
              >
                #{savedId.slice(0, 8)}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SubtitlesPage() {
  return (
    <Suspense>
      <SubtitlesTool />
    </Suspense>
  )
}
