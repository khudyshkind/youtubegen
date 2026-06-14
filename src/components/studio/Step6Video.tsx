'use client'

import { useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import type { SubtitleBlock } from '@/lib/types'
import { refreshCredits } from '@/lib/refresh-credits'

type DownloadState = 'idle' | 'loading' | 'done' | 'error'
type RenderState = 'idle' | 'loading' | 'done' | 'error'

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

  const [downloadState, setDownloadState] = useState<DownloadState>('idle')
  const [downloadError, setDownloadError] = useState('')
  const [renderState, setRenderState] = useState<RenderState>(videoUrl ? 'done' : 'idle')
  const [renderError, setRenderError] = useState('')
  const [burnIn, setBurnIn] = useState(true)

  const hasAudio = !!audioUrl
  const hasImages = sceneImages.length > 0
  const hasSubs = subtitleBlocks.length > 0

  function downloadSrt() {
    const content = toSrt(subtitleBlocks)
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'subtitles.srt'; a.click()
    URL.revokeObjectURL(url)
  }

  const assetsSummary = [
    { label: 'Аудио MP3', ready: hasAudio, value: hasAudio ? 'готово' : null },
    { label: 'Иллюстрации', ready: hasImages, value: hasImages ? `${sceneImages.length} сцен` : null },
    { label: 'Субтитры', ready: hasSubs, value: hasSubs ? `${subtitleBlocks.length} блоков` : null },
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Шаг 6: Сборка видео</h2>
        <p className="text-sm text-slate-500">
          Соберите готовый MP4 автоматически или скачайте исходники для монтажа вручную
        </p>
      </div>

      {/* Assets checklist */}
      <div
        className="rounded-xl p-4"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <p className="text-sm font-medium text-slate-300 mb-3">Готовые материалы</p>
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
                {asset.ready ? asset.value : 'не готово'}
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
            <p className="text-sm font-semibold text-slate-200">Озвучка</p>
            <a
              href={audioUrl}
              download="audio.mp3"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
            >
              Скачать MP3 ↓
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
            Иллюстрации ({sceneImages.length})
          </p>
          <div className="grid grid-cols-3 gap-2">
            {sceneImages.map((img) =>
              img.url ? (
                <a key={img.scene_index} href={img.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={`Сцена ${img.scene_index + 1}`}
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
          <p className="text-sm font-semibold text-slate-200 mb-1">Настройки субтитров</p>
          <Toggle
            checked={burnIn}
            onChange={setBurnIn}
            label="Добавить субтитры в видео"
            hint="Субтитры будут вшиты прямо в MP4 по тайм-кодам"
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
              Скачать SRT файл отдельно
            </button>
          </div>
        </div>
      ) : (
        <div
          className="rounded-xl p-4 flex items-start gap-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <span className="text-xl shrink-0">💬</span>
          <div>
            <p className="text-sm font-medium text-slate-300">Субтитры не добавлены</p>
            <p className="text-xs text-slate-500 mt-0.5 mb-2">
              Вернитесь на шаг субтитров чтобы добавить их в видео
            </p>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
            >
              ← Шаг 4: Субтитры
            </button>
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
                <p className="text-sm font-semibold text-slate-100">Автосборка MP4</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  FFmpeg соберёт видео 1280×720 с озвучкой
                  {hasSubs && burnIn ? ', вшитыми субтитрами' : ''}
                  {' '}и готовый файл появится прямо здесь
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRender}
              disabled={!hasAudio || !hasImages}
              className="w-full py-2.5 btn-gradient disabled:opacity-40 text-white font-semibold rounded-xl text-sm"
            >
              Собрать MP4 — 2 кредита
            </button>
            {(!hasAudio || !hasImages) && (
              <p className="text-xs text-slate-500 mt-2 text-center">
                {!hasAudio ? 'Сначала сгенерируйте озвучку' : 'Сначала добавьте иллюстрации'}
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
            <p className="text-sm font-semibold text-blue-300">Собираем видео...</p>
            <p className="text-xs text-blue-400">FFmpeg кодирует H.264 1280×720. Обычно 1–3 минуты.</p>
          </div>
        )}

        {renderState === 'done' && videoUrl && (
          <>
            <p className="text-sm font-semibold text-green-400 mb-3">Видео готово!</p>
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
                Скачать MP4 ↓
              </a>
              <button
                type="button"
                onClick={() => setRenderState('idle')}
                className="px-4 py-2 btn-ghost-dark rounded-xl text-sm"
              >
                Пересобрать
              </button>
            </div>
          </>
        )}

        {renderState === 'error' && (
          <>
            <p className="text-sm font-semibold text-red-400 mb-1">Ошибка сборки</p>
            <p className="text-xs text-red-400 mb-3">{renderError}</p>
            <button
              type="button"
              onClick={() => setRenderState('idle')}
              className="px-4 py-2 text-white font-medium rounded-xl text-xs transition-colors"
              style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              Попробовать снова
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
            <p className="text-sm font-semibold text-slate-200 mb-1">Скачать исходники</p>
            <p className="text-xs text-slate-500 mb-4">
              ZIP-архив с аудио, иллюстрациями, субтитрами SRT,<br />
              тайм-кодами и инструкцией для монтажа
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
              Скачать ZIP
            </button>
            {!hasAudio && (
              <p className="text-xs text-slate-600 mt-2">Сначала сгенерируйте озвучку</p>
            )}
          </>
        )}

        {downloadState === 'loading' && (
          <>
            <p className="text-sm font-semibold text-slate-200 mb-1">Подготовка архива...</p>
            <p className="text-xs text-slate-500">Собираем файлы, это займёт несколько секунд</p>
          </>
        )}

        {downloadState === 'done' && (
          <>
            <p className="text-sm font-semibold text-green-400 mb-1">Архив скачан!</p>
            <p className="text-xs text-slate-500 mb-3">Откройте ZIP и следуйте инструкции README.txt</p>
            <button
              type="button"
              onClick={() => setDownloadState('idle')}
              className="text-xs text-slate-500 hover:text-slate-300 underline transition-colors"
            >
              Скачать снова
            </button>
          </>
        )}

        {downloadState === 'error' && (
          <>
            <p className="text-sm font-semibold text-red-400 mb-1">Ошибка загрузки</p>
            <p className="text-xs text-red-400 mb-3">{downloadError}</p>
            <button
              type="button"
              onClick={() => setDownloadState('idle')}
              className="px-4 py-2 text-white font-medium rounded-xl text-xs transition-colors"
              style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              Попробовать снова
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
          <p className="text-xs font-semibold text-blue-300 mb-2">Что входит в архив</p>
          <ul className="flex flex-col gap-1">
            {[
              ['audio.mp3', 'озвучка сценария'],
              ['scene_01.jpg, scene_02.jpg...', 'пронумерованные иллюстрации'],
              hasSubs ? ['subtitles.srt', 'субтитры для импорта'] : null,
              hasImages ? ['timing.txt', 'тайм-коды каждой иллюстрации'] : null,
              ['README.txt', 'инструкция для CapCut, DaVinci, Premiere'],
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
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => setStep(7)}
          className="flex-1 py-3 btn-gradient text-white font-semibold rounded-xl text-sm"
        >
          Далее: SEO →
        </button>
      </div>
    </div>
  )
}
