'use client'

import { useStudioStore } from '@/lib/studio-store'

export default function Step5Video() {
  const { audioUrl, sceneImages, subtitleBlocks, scriptParams, setStep } = useStudioStore()

  const assetsSummary = [
    { label: 'Аудио', ready: !!audioUrl, value: audioUrl },
    { label: 'Субтитры', ready: subtitleBlocks.length > 0, value: subtitleBlocks.length > 0 ? `${subtitleBlocks.length} блоков` : null },
    { label: 'Иллюстрации', ready: sceneImages.length > 0, value: sceneImages.length > 0 ? `${sceneImages.length} изображений` : null },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 5: Видео</h2>
        <p className="text-sm text-gray-500">
          Сборка финального видео из всех материалов
        </p>
      </div>

      {/* Assets summary */}
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

      {/* Download individual assets */}
      <div className="flex flex-col gap-3">
        {audioUrl && (
          <div className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700">🎙 Аудио</p>
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

        {sceneImages.length > 0 && (
          <div className="border border-gray-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">
              🎨 Иллюстрации ({sceneImages.length})
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
      </div>

      {/* Video assembly (coming soon) */}
      <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
        <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-700 mb-1">Сборка видео</p>
        <p className="text-xs text-gray-500 mb-3">
          Автоматическая сборка MP4 из аудио + иллюстраций + субтитров скоро будет доступна
        </p>
        <span className="inline-block px-3 py-1 bg-gray-100 text-gray-500 text-xs font-medium rounded-full">
          Скоро
        </span>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(4)}
          className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => setStep(6)}
          className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Далее: SEO →
        </button>
      </div>
    </div>
  )
}
