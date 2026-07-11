'use client'

import { useRef, useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import ConfirmModal from '@/components/shared/ConfirmModal'

function extractAudioTs(url: string | null): number | null {
  if (!url) return null
  const m = url.match(/[?&]t=(\d+)/)
  return m ? parseInt(m[1], 10) : null
}
import type { SubtitleBlock } from '@/lib/types'
import { refreshCredits } from '@/lib/refresh-credits'
import { confirmRegenIfCompleted } from '@/lib/confirm-regen'
import { useLang } from '@/hooks/useLang'

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec % 1) * 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

function toSrt(blocks: SubtitleBlock[]): string {
  function srtTime(sec: number) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    const ms = Math.round((sec % 1) * 1000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
  }
  return blocks.map((b, i) => `${i + 1}\n${srtTime(b.start)} --> ${srtTime(b.end)}\n${b.text}`).join('\n\n')
}

function parseSrt(text: string): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = []
  const entries = text.trim().split(/\n\s*\n/)
  for (const entry of entries) {
    const lines = entry.trim().split('\n')
    if (lines.length < 3) continue
    const timeLine = lines.find((l) => l.includes('-->'))
    if (!timeLine) continue
    const [startStr, endStr] = timeLine.split(/\s*-->\s*/)
    const parseTime = (s: string) => {
      const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/)
      if (!m) return 0
      return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 1000
    }
    const textLines = lines.slice(lines.indexOf(timeLine) + 1).join(' ').trim()
    if (!textLines) continue
    blocks.push({ start: parseTime(startStr), end: parseTime(endStr), text: textLines })
  }
  return blocks
}

export default function Step4Subtitles() {
  const {
    audioUrl, projectId, scriptParams, subtitleBlocks, subtitleAudioTs,
    setSubtitleBlocks, setSubtitleAudioTs, setStep,
  } = useStudioStore()

  const { t } = useLang()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [srtUploadError, setSrtUploadError] = useState('')
  const [showSkipModal, setShowSkipModal] = useState(false)
  const srtFileRef = useRef<HTMLInputElement>(null)

  function handleSrtUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSrtUploadError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const blocks = parseSrt(text)
      if (blocks.length === 0) {
        setSrtUploadError(t('step4.err_srt'))
        return
      }
      setSubtitleBlocks(blocks)
    }
    reader.onerror = () => setSrtUploadError(t('step4.err_file'))
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  async function handleGenerate() {
    if (!audioUrl) { setError(t('step4.no_audio')); return }
    if (!confirmRegenIfCompleted(t('regen_confirm.message'))) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: audioUrl, project_id: projectId, language: scriptParams.language }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('step4.err_credits')); return }
        throw new Error(json.error)
      }
      setSubtitleBlocks(json.data.subtitle_blocks)
      setSubtitleAudioTs(extractAudioTs(audioUrl))
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('step4.err_gen'))
    } finally {
      setLoading(false)
    }
  }

  function updateBlock(idx: number, field: keyof SubtitleBlock, raw: string) {
    const updated = subtitleBlocks.map((b, i) => {
      if (i !== idx) return b
      if (field === 'text') return { ...b, text: raw }
      const num = parseFloat(raw)
      if (!isNaN(num)) return { ...b, [field]: num }
      return b
    })
    setSubtitleBlocks(updated)
  }

  function downloadSrt() {
    const content = toSrt(subtitleBlocks)
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'subtitles.srt'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{t('step4.title')}</h2>
        <p className="text-sm text-slate-500">{t('step4.subtitle')}</p>
      </div>

      {subtitleAudioTs !== null && extractAudioTs(audioUrl) !== subtitleAudioTs && (
        <div
          className="flex items-start gap-2.5 rounded-xl px-4 py-3"
          style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)' }}
        >
          <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <p className="text-xs text-yellow-300 leading-relaxed">{t('step4.audio_changed')}</p>
        </div>
      )}

      {subtitleBlocks.length === 0 ? (
        <div className="flex flex-col gap-4">
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <p className="text-sm text-slate-400">
              {t('step4.desc')}
            </p>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !audioUrl}
            className="w-full py-3 btn-gradient disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t('step4.transcribing')}
              </>
            ) : (
              t('step4.generate_btn')
            )}
          </button>

          {!audioUrl && (
            <p className="text-xs text-slate-500 text-center">{t('step4.no_audio')}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => srtFileRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-slate-400 text-xs font-medium rounded-xl hover:text-slate-200 transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {t('step4.upload_srt')}
            </button>
            <input
              ref={srtFileRef}
              type="file"
              accept=".srt,text/plain"
              className="hidden"
              onChange={handleSrtUpload}
            />
          </div>

          {srtUploadError && (
            <p className="text-xs text-red-400 rounded-xl px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.15)' }}>
              {srtUploadError}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Subtitle blocks editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-300">{subtitleBlocks.length} {t('step4.blocks')}</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading || !audioUrl}
                  className="text-xs font-medium transition-colors flex items-center gap-1"
                  style={{ color: loading ? '#475569' : '#94A3B8' }}
                >
                  {loading ? (
                    <>
                      <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      {t('step4.regenerating')}
                    </>
                  ) : t('step4.regenerate')}
                </button>
                <button
                  type="button"
                  onClick={downloadSrt}
                  className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  SRT
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto flex flex-col gap-2 pr-1">
              {subtitleBlocks.map((block, idx) => (
                <div
                  key={idx}
                  className="flex gap-2 items-start rounded-xl p-3"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <span className="text-xs font-bold text-slate-600 w-5 pt-0.5 shrink-0">{idx + 1}</span>
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <div className="flex gap-2 text-xs text-slate-400 font-mono">
                      <input
                        type="text"
                        value={formatTime(block.start)}
                        onChange={(e) => updateBlock(idx, 'start', e.target.value)}
                        className="w-20 rounded px-1.5 py-0.5 text-slate-300 focus:outline-none"
                      />
                      <span className="self-center text-slate-600">→</span>
                      <input
                        type="text"
                        value={formatTime(block.end)}
                        onChange={(e) => updateBlock(idx, 'end', e.target.value)}
                        className="w-20 rounded px-1.5 py-0.5 text-slate-300 focus:outline-none"
                      />
                    </div>
                    <input
                      type="text"
                      value={block.text}
                      onChange={(e) => updateBlock(idx, 'text', e.target.value)}
                      className="w-full rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </>
      )}

      {error && (
        <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(4)}
          className="px-5 py-3 btn-ghost-dark font-medium rounded-xl text-sm"
        >
          {t('step4.back')}
        </button>
        <button
          type="button"
          onClick={() => setStep(6)}
          disabled={subtitleBlocks.length === 0}
          className="flex-1 py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-40"
        >
          {t('step4.next')}
        </button>
        {subtitleBlocks.length === 0 && (
          <button
            type="button"
            onClick={() => setShowSkipModal(true)}
            className="px-5 py-3 btn-ghost-dark font-medium rounded-xl text-sm"
          >
            {t('step4.skip')}
          </button>
        )}
      </div>
    </div>

    {showSkipModal && (
      <ConfirmModal
        message={t('step4.skip_confirm')}
        onConfirm={() => { setShowSkipModal(false); setStep(6) }}
        onCancel={() => setShowSkipModal(false)}
      />
    )}
    </>
  )
}
