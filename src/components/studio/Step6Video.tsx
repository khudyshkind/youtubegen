'use client'

import { useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'

type DownloadState = 'idle' | 'loading' | 'done' | 'error'
type RenderState = 'idle' | 'loading' | 'done' | 'error'

export default function Step6Video() {
  const {
    audioUrl,
    sceneImages,
    subtitleBlocks,
    subtitleStyle,
    scriptParams,
    imageInterval,
    projectId,
    videoUrl,
    setVideoUrl,
    setStep,
  } = useStudioStore()

  const [downloadState, setDownloadState] = useState<DownloadState>('idle')
  const [downloadError, setDownloadError] = useState('')
  const [renderState, setRenderState] = useState<RenderState>(videoUrl ? 'done' : 'idle')
  const [renderError, setRenderError] = useState('')

  const hasAudio = !!audioUrl
  const hasImages = sceneImages.length > 0
  const hasSubs = subtitleBlocks.length > 0

  const assetsSummary = [
    { label: 'Аудио MP3', ready: hasAudio, value: hasAudio ? 'готово' : null },
    {
      label: 'Иллюстрации',
      ready: hasImages,
      value: hasImages ? `${sceneImages.length} сцен` : null,
    },
    {
      label: 'Субтитры',
      ready: hasSubs,
      value: hasSubs ? `${subtitleBlocks.length} блоков` : null,
    },
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
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setDownloadState('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setDownloadError(msg)
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
        .map((img) => ({
          url: img.url!,
          timecode_start: img.timecode_start,
          timecode_end: img.timecode_end,
        }))

      const res = await fetch('/api/generate/video/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          audio_url: audioUrl,
          images,
          subtitle_blocks: hasSubs ? subtitleBlocks : undefined,
          subtitle_style: hasSubs ? subtitleStyle : undefined,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
      }

      setVideoUrl(json.data.video_url)
      setRenderState('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRenderError(msg)
      setRenderState('error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 6: Сборка видео</h2>
        <p className="text-sm text-gray-500">
          Соберите готовый MP4 автоматически или скачайте исходники для монтажа вручную
        </p>
      </div>

      {/* Assets checklist */}
      <div className="bg-gray-50 rounded-xl p-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Готовые материалы</p>
        <div className="flex flex-col gap-2">
          {assetsSummary.map((asset) => (
            <div key={asset.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
                  asset.ready ? 'bg-green-500' : 'bg-gray-300'
                }`}>
                  {asset.ready && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-gray-700">{asset.label}</span>
              </div>
              <span className="text-xs text-gray-500">
                {asset.ready ? asset.value : 'не готово'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Audio preview */}
      {audioUrl && (
        <div className="border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-700">Озвучка</p>
            <a
              href={audioUrl}
              download="audio.mp3"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-red-500 hover:text-red-600 font-medium"
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
        <div className="border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">
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

      {/* ── Auto-render MP4 block ─────────────────────────────── */}
      <div className={`rounded-xl border-2 p-6 transition-colors ${
        renderState === 'done'
          ? 'border-green-300 bg-green-50'
          : renderState === 'error'
          ? 'border-red-200 bg-red-50'
          : renderState === 'loading'
          ? 'border-blue-200 bg-blue-50'
          : 'border-indigo-200 bg-indigo-50'
      }`}>
        {renderState === 'idle' && (
          <>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 10l4.553-2.278A1 1 0 0121 8.684v6.632a1 1 0 01-1.447.894L15 14M4 8h8a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Автосборка MP4</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  FFmpeg соберёт видео 1280×720 с озвучкой
                  {hasSubs && subtitleStyle.burnIn ? ', вшитыми субтитрами' : ''}
                  {' '}и готовый файл появится прямо здесь
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRender}
              disabled={!hasAudio || !hasImages}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors"
            >
              Собрать MP4 — 2 кредита
            </button>
            {(!hasAudio || !hasImages) && (
              <p className="text-xs text-gray-400 mt-2 text-center">
                {!hasAudio ? 'Сначала сгенерируйте озвучку' : 'Сначала добавьте иллюстрации'}
              </p>
            )}
          </>
        )}

        {renderState === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-2">
            <svg className="w-8 h-8 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm font-semibold text-blue-700">Собираем видео...</p>
            <p className="text-xs text-blue-500">FFmpeg кодирует H.264 1280×720. Обычно 1–3 минуты.</p>
          </div>
        )}

        {renderState === 'done' && videoUrl && (
          <>
            <p className="text-sm font-semibold text-green-700 mb-3">Видео готово!</p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              controls
              src={videoUrl}
              className="w-full rounded-lg border border-green-200 mb-3"
            />
            <div className="flex gap-2">
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                download="video.mp4"
                className="flex-1 py-2 text-center bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl text-sm transition-colors"
              >
                Скачать MP4 ↓
              </a>
              <button
                type="button"
                onClick={() => { setRenderState('idle') }}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                Пересобрать
              </button>
            </div>
          </>
        )}

        {renderState === 'error' && (
          <>
            <p className="text-sm font-semibold text-red-600 mb-1">Ошибка сборки</p>
            <p className="text-xs text-red-500 mb-3">{renderError}</p>
            <button
              type="button"
              onClick={() => setRenderState('idle')}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl text-xs transition-colors"
            >
              Попробовать снова
            </button>
          </>
        )}
      </div>

      {/* ── Download ZIP block ────────────────────────────────── */}
      <div className={`rounded-xl border-2 p-6 text-center transition-colors ${
        downloadState === 'done'
          ? 'border-green-300 bg-green-50'
          : downloadState === 'error'
          ? 'border-red-200 bg-red-50'
          : 'border-dashed border-gray-200'
      }`}>
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 ${
          downloadState === 'done' ? 'bg-green-100' : downloadState === 'error' ? 'bg-red-100' : 'bg-gray-100'
        }`}>
          {downloadState === 'loading' ? (
            <svg className="w-6 h-6 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : downloadState === 'done' ? (
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : downloadState === 'error' ? (
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
        </div>

        {downloadState === 'idle' && (
          <>
            <p className="text-sm font-semibold text-gray-700 mb-1">Скачать исходники</p>
            <p className="text-xs text-gray-500 mb-4">
              ZIP-архив с аудио, иллюстрациями, субтитрами SRT,<br />
              тайм-кодами и инструкцией для монтажа
            </p>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!hasAudio}
              className="px-5 py-2.5 bg-gray-700 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors"
            >
              Скачать ZIP
            </button>
            {!hasAudio && (
              <p className="text-xs text-gray-400 mt-2">Сначала сгенерируйте озвучку</p>
            )}
          </>
        )}

        {downloadState === 'loading' && (
          <>
            <p className="text-sm font-semibold text-gray-700 mb-1">Подготовка архива...</p>
            <p className="text-xs text-gray-500">Собираем файлы, это займёт несколько секунд</p>
          </>
        )}

        {downloadState === 'done' && (
          <>
            <p className="text-sm font-semibold text-green-700 mb-1">Архив скачан!</p>
            <p className="text-xs text-gray-500 mb-3">
              Откройте ZIP и следуйте инструкции README.txt
            </p>
            <button
              type="button"
              onClick={() => setDownloadState('idle')}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Скачать снова
            </button>
          </>
        )}

        {downloadState === 'error' && (
          <>
            <p className="text-sm font-semibold text-red-600 mb-1">Ошибка загрузки</p>
            <p className="text-xs text-red-500 mb-3">{downloadError}</p>
            <button
              type="button"
              onClick={() => setDownloadState('idle')}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl text-xs transition-colors"
            >
              Попробовать снова
            </button>
          </>
        )}
      </div>

      {/* What's included in ZIP */}
      {downloadState === 'idle' && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-800 mb-2">Что входит в архив</p>
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
                <li key={(item as string[])[0]} className="flex gap-2 text-xs text-blue-700">
                  <span className="font-mono font-medium shrink-0">{(item as string[])[0]}</span>
                  <span className="text-blue-500">— {(item as string[])[1]}</span>
                </li>
              ))}
          </ul>
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
          onClick={() => setStep(7)}
          className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Далее: SEO →
        </button>
      </div>
    </div>
  )
}
