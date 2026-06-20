'use client'

import { useState, useEffect, useRef } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import type { SubtitleBlock } from '@/lib/types'
import { refreshCredits } from '@/lib/refresh-credits'
import { useLang } from '@/hooks/useLang'

type DownloadState = 'idle' | 'loading' | 'done' | 'error'
type RenderState = 'idle' | 'loading' | 'done' | 'error'

const TRANSITIONS_BASE = [
  { id: 'cut',        icon: '✂️'  },
  { id: 'fade',       icon: '🌅'  },
  { id: 'slideleft',  icon: '⬅️'  },
  { id: 'slideright', icon: '➡️'  },
  { id: 'slideup',    icon: '⬆️'  },
  { id: 'dissolve',   icon: '💧'  },
  { id: 'circleopen', icon: '⭕'  },
  { id: 'wipeleft',   icon: '🔲'  },
] as const

const EFFECTS_BASE = [
  { id: 'film_grain', icon: '🎞'  },
  { id: 'ken_burns',  icon: '🎬'  },
  { id: 'vignette',   icon: '⚫'  },
  { id: 'haze',       icon: '🌫'  },
  { id: 'grayscale',  icon: '🩶'  },
  { id: 'cinematic',  icon: '🎥'  },
  { id: 'lens_flare', icon: '✨'  },
  { id: 'vhs',        icon: '📼'  },
] as const

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div>
        <p className="text-sm font-medium text-slate-300">{label}</p>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0"
        style={{ background: checked ? '#7C3AED' : 'rgba(255,255,255,0.1)' }}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
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

export default function Step6Video() {
  const {
    audioUrl, sceneImages, subtitleBlocks, subtitleStyle,
    scriptParams, imageInterval, projectId, videoUrl,
    setVideoUrl, setStep,
  } = useStudioStore()

  const { t } = useLang()

  const TRANSITIONS = TRANSITIONS_BASE.map((tr) => ({ ...tr, label: t(`trans.${tr.id}` as const) }))
  const EFFECTS = EFFECTS_BASE.map((ef) => ({ ...ef, label: t(`effect.${ef.id}` as const) }))

  const [downloadState, setDownloadState] = useState<DownloadState>('idle')
  const [downloadError, setDownloadError] = useState('')
  const [renderState, setRenderState] = useState<RenderState>(videoUrl ? 'done' : 'idle')
  const [renderError, setRenderError] = useState('')
  const [burnIn, setBurnIn] = useState(true)
  const [transition, setTransition] = useState('cut')
  const [transitionDuration, setTransitionDuration] = useState(0.5)
  const [effects, setEffects] = useState<string[]>([])
  const [transitionOpen, setTransitionOpen] = useState(false)
  const [effectsOpen, setEffectsOpen] = useState(false)
  const transitionRef = useRef<HTMLDivElement>(null)
  const effectsRef = useRef<HTMLDivElement>(null)

  const hasAudio = !!audioUrl
  const hasImages = sceneImages.length > 0
  const hasSubs = subtitleBlocks.length > 0

  function toggleEffect(id: string) {
    setEffects((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (transitionRef.current && !transitionRef.current.contains(e.target as Node)) setTransitionOpen(false)
      if (effectsRef.current && !effectsRef.current.contains(e.target as Node)) setEffectsOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  function downloadSrt() {
    const content = toSrt(subtitleBlocks)
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'subtitles.srt'; a.click()
    URL.revokeObjectURL(url)
  }

  const assetsSummary = [
    { label: t('step6.audio_label'),  ready: hasAudio,  value: hasAudio  ? t('step6.ready') : null },
    { label: t('step6.images_label'), ready: hasImages, value: hasImages ? `${sceneImages.length} ${t('step6.scenes_count')}` : null },
    { label: t('step6.subs_label'),   ready: hasSubs,   value: hasSubs   ? `${subtitleBlocks.length} ${t('step6.blocks_count')}` : null },
  ]

  async function handleDownload() {
    if (!audioUrl) return
    setDownloadState('loading')
    setDownloadError('')
    try {
      const res = await fetch('/api/generate/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_url: audioUrl,
          scene_images: sceneImages,
          subtitle_blocks: subtitleBlocks,
          topic: scriptParams.topic,
          image_interval: imageInterval,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${scriptParams.topic.slice(0, 40) || 'project'}_assets.zip`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setDownloadState('done')
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err))
      setDownloadState('error')
    }
  }

  async function handleRender() {
    if (!audioUrl || !hasImages || !projectId) return
    setRenderState('loading')
    setRenderError('')
    try {
      const images = sceneImages
        .filter((img) => img.url)
        .map((img) => ({ url: img.url!, timecode_start: img.timecode_start, timecode_end: img.timecode_end }))

      const res = await fetch('/api/generate/video/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          audio_url: audioUrl,
          image_interval: imageInterval,
          images,
          subtitle_blocks: hasSubs ? subtitleBlocks : undefined,
          subtitle_style: hasSubs ? { ...subtitleStyle, burnIn } : undefined,
          transition,
          transition_duration: transitionDuration,
          effects,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
      setVideoUrl(json.data.video_url)
      void refreshCredits()
      setRenderState('done')
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err))
      setRenderState('error')
    }
  }

  const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{t('step6.title')}</h2>
        <p className="text-sm text-slate-500">{t('step6.subtitle')}</p>
      </div>

      {/* Assets checklist */}
      <div className="rounded-xl p-4" style={cardStyle}>
        <p className="text-sm font-medium text-slate-300 mb-3">{t('step6.ready_assets')}</p>
        <div className="flex flex-col gap-2">
          {assetsSummary.map((asset) => (
            <div key={asset.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center"
                  style={asset.ready
                    ? { background: '#10B981', boxShadow: '0 0 8px rgba(16,185,129,0.4)' }
                    : { background: 'rgba(255,255,255,0.08)' }
                  }
                >
                  {asset.ready && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-slate-300">{asset.label}</span>
              </div>
              <span className={`text-xs ${asset.ready ? 'text-green-400' : 'text-slate-600'}`}>
                {asset.ready ? asset.value : t('step6.not_ready')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Audio preview */}
      {audioUrl && (
        <div
          className="rounded-xl p-4"
          style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-200">{t('step6.voiceover')}</p>
            <a
              href={audioUrl}
              download="audio.mp3"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
            >
              {t('step6.download_mp3')}
            </a>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} className="w-full" />
        </div>
      )}

      {/* Scene images grid */}
      {sceneImages.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
        >
          <p className="text-sm font-semibold text-slate-200 mb-3">
            {t('step6.images_label')} ({sceneImages.length})
          </p>
          <div className="grid grid-cols-3 gap-2">
            {sceneImages.map((img) =>
              img.url ? (
                <a key={img.scene_index} href={img.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={`${t('studio.step5')} ${img.scene_index + 1}`}
                    className="w-full aspect-video object-cover rounded-lg hover:opacity-80 transition-opacity"
                  />
                </a>
              ) : null
            )}
          </div>
        </div>
      )}

      {/* Subtitle settings */}
      {hasSubs ? (
        <div
          className="rounded-xl p-4 flex flex-col gap-1"
          style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
        >
          <p className="text-sm font-semibold text-slate-200 mb-1">{t('step6.subs_settings')}</p>
          <Toggle
            checked={burnIn}
            onChange={setBurnIn}
            label={t('step6.burn_subs')}
            hint={t('step6.burn_hint')}
          />
          <div className="pt-3 mt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <button
              type="button"
              onClick={downloadSrt}
              className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {t('step6.download_srt')}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-4 flex items-start gap-3" style={cardStyle}>
          <span className="text-xl shrink-0">💬</span>
          <div>
            <p className="text-sm font-medium text-slate-300">{t('step6.no_subs')}</p>
            <p className="text-xs text-slate-500 mt-0.5 mb-2">
              {t('step6.no_subs_desc')}
            </p>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
            >
              {t('step6.step4_link')}
            </button>
          </div>
        </div>
      )}

      {/* Transitions block */}
      {hasImages && (
        <div className="rounded-xl p-4" style={cardStyle}>
          <p className="text-sm font-semibold text-slate-200 mb-3">{t('step6.transitions')}</p>
          <div className="relative" ref={transitionRef}>
            <button
              type="button"
              onClick={() => setTransitionOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#CBD5E1' }}
            >
              <span className="flex items-center gap-2">
                <span>{TRANSITIONS.find((tr) => tr.id === transition)?.icon}</span>
                <span>{TRANSITIONS.find((tr) => tr.id === transition)?.label}</span>
              </span>
              <span style={{ color: '#64748B', fontSize: '0.65rem', display: 'inline-block', transform: transitionOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </button>
            {transitionOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-50"
                style={{ background: 'rgba(15,12,35,0.98)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                {TRANSITIONS.map((tr) => (
                  <button
                    key={tr.id}
                    type="button"
                    onClick={() => { setTransition(tr.id); setTransitionOpen(false) }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors"
                    style={{
                      background: transition === tr.id ? 'rgba(124,58,237,0.2)' : 'transparent',
                      color: transition === tr.id ? '#C4B5FD' : '#94A3B8',
                    }}
                  >
                    <span>{tr.icon}</span>
                    <span>{tr.label}</span>
                    {transition === tr.id && <span className="ml-auto text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {transition !== 'cut' && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-slate-500">{t('step6.speed')}</span>
              {([0.3, 0.5, 1] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setTransitionDuration(d)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                  style={transitionDuration === d
                    ? { background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)', color: '#C4B5FD' }
                    : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748B' }
                  }
                >
                  {d}с
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Effects block */}
      {hasImages && (
        <div className="rounded-xl p-4" style={cardStyle}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-200">{t('step6.effects')}</p>
            {effects.length > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ color: '#FBD34D', background: 'rgba(251,211,77,0.1)', border: '1px solid rgba(251,211,77,0.2)' }}
              >
                {t('step6.effects_warning')}
              </span>
            )}
          </div>
          <div className="relative" ref={effectsRef}>
            <button
              type="button"
              onClick={() => setEffectsOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: effects.length > 0 ? '1px solid rgba(124,58,237,0.4)' : '1px solid rgba(255,255,255,0.12)',
                color: effects.length > 0 ? '#C4B5FD' : '#CBD5E1',
              }}
            >
              <span>
                {effects.length === 0
                  ? t('step6.no_effects')
                  : `${t('step6.effects_selected')}: ${effects.length}`}
              </span>
              <span style={{ color: '#64748B', fontSize: '0.65rem', display: 'inline-block', transform: effectsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </button>
            {effectsOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-50"
                style={{ background: 'rgba(15,12,35,0.98)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                {EFFECTS.map((e) => {
                  const active = effects.includes(e.id)
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => toggleEffect(e.id)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors"
                      style={{
                        background: active ? 'rgba(124,58,237,0.2)' : 'transparent',
                        color: active ? '#C4B5FD' : '#94A3B8',
                      }}
                    >
                      <span className="text-base">{e.icon}</span>
                      <span>{e.label}</span>
                      <span
                        className="ml-auto w-4 h-4 rounded flex items-center justify-center text-xs shrink-0"
                        style={{
                          border: `1px solid ${active ? '#7C3AED' : 'rgba(255,255,255,0.2)'}`,
                          background: active ? 'rgba(124,58,237,0.4)' : 'transparent',
                          color: '#C4B5FD',
                        }}
                      >
                        {active ? '✓' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Auto-render MP4 block */}
      <div
        className="rounded-xl p-6 transition-all"
        style={
          renderState === 'done'
            ? { border: '2px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.06)' }
            : renderState === 'error'
            ? { border: '2px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }
            : renderState === 'loading'
            ? { border: '2px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.06)' }
            : { border: '2px solid rgba(124,58,237,0.25)', background: 'rgba(124,58,237,0.05)' }
        }
      >
        {renderState === 'idle' && (
          <>
            <div className="flex items-start gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}
              >
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 10l4.553-2.278A1 1 0 0121 8.684v6.632a1 1 0 01-1.447.894L15 14M4 8h8a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-100">{t('step6.mp4_title')}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t('step6.mp4_desc')}
                  {hasSubs && burnIn ? ` + ${t('step6.subs_label').toLowerCase()}` : ''}
                  {transition !== 'cut' ? ` + ${TRANSITIONS.find((tr) => tr.id === transition)?.label}` : ''}
                  {effects.length > 0 ? ` + ${effects.length} ${t('step6.effects').toLowerCase()}` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRender}
              disabled={!hasAudio || !hasImages}
              className="w-full py-2.5 btn-gradient disabled:opacity-40 text-white font-semibold rounded-xl text-sm"
            >
              {t('step6.render_btn')}
            </button>
            {(!hasAudio || !hasImages) && (
              <p className="text-xs text-slate-500 mt-2 text-center">
                {!hasAudio ? t('step6.no_audio_hint') : t('step6.no_images_hint')}
              </p>
            )}
          </>
        )}

        {renderState === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-2">
            <svg className="w-8 h-8 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm font-semibold text-blue-300">{t('step6.rendering')}</p>
            <p className="text-xs text-blue-400">{t('step6.render_hint')}</p>
          </div>
        )}

        {renderState === 'done' && videoUrl && (
          <>
            <p className="text-sm font-semibold text-green-400 mb-3">{t('step6.video_done')}</p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              controls
              src={videoUrl}
              className="w-full rounded-lg mb-3"
              style={{ border: '1px solid rgba(16,185,129,0.3)' }}
            />
            <div className="flex gap-2">
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                download="video.mp4"
                className="flex-1 py-2 text-center text-white font-semibold rounded-xl text-sm transition-colors"
                style={{ background: 'linear-gradient(135deg, #10B981, #059669)', boxShadow: '0 4px 16px rgba(16,185,129,0.3)' }}
              >
                {t('step6.download_mp4')}
              </a>
              <button
                type="button"
                onClick={() => setRenderState('idle')}
                className="px-4 py-2 btn-ghost-dark rounded-xl text-sm"
              >
                {t('step6.reassemble')}
              </button>
            </div>
          </>
        )}

        {renderState === 'error' && (
          <>
            <p className="text-sm font-semibold text-red-400 mb-1">{t('step6.render_error')}</p>
            <p className="text-xs text-red-400 mb-3">{renderError}</p>
            <button
              type="button"
              onClick={() => setRenderState('idle')}
              className="px-4 py-2 text-white font-medium rounded-xl text-xs transition-colors"
              style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              {t('step6.try_again')}
            </button>
          </>
        )}
      </div>

      {/* Download ZIP block */}
      <div
        className="rounded-xl p-6 text-center transition-all"
        style={
          downloadState === 'done'
            ? { border: '2px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.06)' }
            : downloadState === 'error'
            ? { border: '2px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }
            : { border: '2px dashed rgba(255,255,255,0.1)' }
        }
      >
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
          style={
            downloadState === 'done'
              ? { background: 'rgba(16,185,129,0.15)' }
              : downloadState === 'error'
              ? { background: 'rgba(239,68,68,0.12)' }
              : { background: 'rgba(255,255,255,0.06)' }
          }
        >
          {downloadState === 'loading' ? (
            <svg className="w-6 h-6 text-slate-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : downloadState === 'done' ? (
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : downloadState === 'error' ? (
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
        </div>

        {downloadState === 'idle' && (
          <>
            <p className="text-sm font-semibold text-slate-200 mb-1">{t('step6.zip_title')}</p>
            <p className="text-xs text-slate-500 mb-4">
              {t('step6.mp4_desc')}
            </p>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!hasAudio}
              className="px-5 py-2.5 text-white font-semibold rounded-xl text-sm disabled:opacity-40 transition-colors"
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            >
              {t('step6.zip_btn')}
            </button>
            {!hasAudio && (
              <p className="text-xs text-slate-600 mt-2">{t('step6.no_audio_hint')}</p>
            )}
          </>
        )}

        {downloadState === 'loading' && (
          <>
            <p className="text-sm font-semibold text-slate-200 mb-1">{t('step6.zip_loading')}</p>
            <p className="text-xs text-slate-500">{t('msg.loading')}</p>
          </>
        )}

        {downloadState === 'done' && (
          <>
            <p className="text-sm font-semibold text-green-400 mb-1">{t('step6.zip_done')}</p>
            <p className="text-xs text-slate-500 mb-3">README.txt</p>
            <button
              type="button"
              onClick={() => setDownloadState('idle')}
              className="text-xs text-slate-500 hover:text-slate-300 underline transition-colors"
            >
              {t('step6.zip_again')}
            </button>
          </>
        )}

        {downloadState === 'error' && (
          <>
            <p className="text-sm font-semibold text-red-400 mb-1">{t('step6.zip_error')}</p>
            <p className="text-xs text-red-400 mb-3">{downloadError}</p>
            <button
              type="button"
              onClick={() => setDownloadState('idle')}
              className="px-4 py-2 text-white font-medium rounded-xl text-xs transition-colors"
              style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              {t('step6.try_again')}
            </button>
          </>
        )}
      </div>

      {/* What's included in ZIP */}
      {downloadState === 'idle' && (
        <div
          className="rounded-xl p-4"
          style={{ background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.15)' }}
        >
          <p className="text-xs font-semibold text-blue-300 mb-2">{t('step6.zip_contents')}</p>
          <ul className="flex flex-col gap-1">
            {[
              ['audio.mp3', t('step6.audio_label')],
              [`scene_01.jpg...`, t('step6.images_label')],
              hasSubs ? ['subtitles.srt', t('step6.subs_label')] : null,
              hasImages ? ['timing.txt', 'timecodes'] : null,
              ['README.txt', 'CapCut, DaVinci, Premiere'],
            ]
              .filter(Boolean)
              .map((item) => (
                <li key={(item as string[])[0]} className="flex gap-2 text-xs">
                  <span className="font-mono font-medium text-blue-300 shrink-0">{(item as string[])[0]}</span>
                  <span className="text-blue-400">— {(item as string[])[1]}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(5)}
          className="px-5 py-3 btn-ghost-dark font-medium rounded-xl text-sm"
        >
          {t('step6.back')}
        </button>
        <button
          type="button"
          onClick={() => setStep(7)}
          className="flex-1 py-3 btn-gradient text-white font-semibold rounded-xl text-sm"
        >
          {t('step6.next')}
        </button>
      </div>
    </div>
  )
}
