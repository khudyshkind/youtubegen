'use client'

import { useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'

const VOICES = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'Ж', desc: 'Мягкий, спокойный' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'Ж', desc: 'Нейтральный, чёткий' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'Ж', desc: 'Энергичный, уверенный' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'Ж', desc: 'Молодой, живой' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'М', desc: 'Спокойный, глубокий' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', gender: 'М', desc: 'Уверенный, мощный' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'М', desc: 'Нейтральный, ровный' },
  { id: 'ODq5zmih8GrVes37Dy9', name: 'Patrick', gender: 'М', desc: 'Глубокий, авторитетный' },
]

export default function Step3Voice() {
  const {
    script,
    projectId,
    voiceId,
    audioUrl,
    subtitleBlocks,
    setVoiceId,
    setAudioUrl,
    setSubtitleBlocks,
    setStep,
  } = useStudioStore()

  const [selectedVoice, setSelectedVoice] = useState(voiceId || VOICES[0].id)
  const [stability, setStability] = useState(0.5)
  const [loadingAudio, setLoadingAudio] = useState(false)
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerateAudio() {
    if (!script) return
    setError('')
    setLoadingAudio(true)
    try {
      const res = await fetch('/api/generate/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: script,
          voice_id: selectedVoice,
          project_id: projectId,
          stability,
          similarity_boost: 0.75,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError('Недостаточно кредитов для озвучки.')
          return
        }
        throw new Error(json.error)
      }
      setVoiceId(selectedVoice)
      setAudioUrl(json.data.audio_url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации аудио')
    } finally {
      setLoadingAudio(false)
    }
  }

  async function handleGenerateSubtitles() {
    if (!audioUrl) return
    setError('')
    setLoadingSubs(true)
    try {
      const res = await fetch('/api/generate/subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: audioUrl, project_id: projectId }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setSubtitleBlocks(json.data.subtitle_blocks)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации субтитров')
    } finally {
      setLoadingSubs(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 3: Озвучка</h2>
        <p className="text-sm text-gray-500">
          Выберите голос и сгенерируйте аудио
        </p>
      </div>

      {/* Voice grid */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Голос</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {VOICES.map((voice) => (
            <button
              key={voice.id}
              type="button"
              onClick={() => setSelectedVoice(voice.id)}
              className={`text-left px-3 py-2.5 rounded-xl border-2 transition-all ${
                selectedVoice === voice.id
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                  voice.gender === 'Ж' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'
                }`}>
                  {voice.gender}
                </span>
                <span className="text-sm font-semibold text-gray-900">{voice.name}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{voice.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Stability slider */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-sm font-medium text-gray-700">Стабильность голоса</p>
          <span className="text-sm text-gray-500">{Math.round(stability * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={stability}
          onChange={(e) => setStability(Number(e.target.value))}
          className="w-full accent-red-500"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>Выразительно</span>
          <span>Стабильно</span>
        </div>
      </div>

      {/* Generate audio */}
      <button
        type="button"
        onClick={handleGenerateAudio}
        disabled={loadingAudio}
        className="w-full py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loadingAudio ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Озвучка... (может занять минуту)
          </>
        ) : audioUrl ? (
          '↺ Перегенерировать аудио (−5 кр./мин)'
        ) : (
          '🎙 Озвучить сценарий (−5 кр./мин)'
        )}
      </button>

      {/* Audio player */}
      {audioUrl && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Готовое аудио</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} className="w-full" />
        </div>
      )}

      {/* Subtitles */}
      {audioUrl && (
        <div className="border border-dashed border-gray-300 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Субтитры</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {subtitleBlocks.length > 0
                  ? `${subtitleBlocks.length} блоков готово ✓`
                  : 'Автоматическая транскрибация (−3 кр.)'}
              </p>
            </div>
            {subtitleBlocks.length === 0 && (
              <button
                type="button"
                onClick={handleGenerateSubtitles}
                disabled={loadingSubs}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                {loadingSubs ? 'Генерация...' : 'Создать субтитры'}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(2)}
          className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => setStep(4)}
          disabled={!audioUrl}
          className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-200 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Далее: Иллюстрации →
        </button>
      </div>
    </div>
  )
}
