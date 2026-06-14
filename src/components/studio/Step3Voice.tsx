'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import type { VoiceStyleType } from '@/lib/types'
import { refreshCredits } from '@/lib/refresh-credits'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ApiVoice {
  voice_id: string
  name: string
  preview_url: string | null
  gender: 'M' | 'F' | null
  description: string | null
  accent: string | null
  language: string | null
  is_own: boolean
}

// ─── Voice styles ───────────────────────────────────────────────────────────────

const VOICE_STYLES: { value: VoiceStyleType; label: string }[] = [
  { value: 'neutral',        label: 'Нейтральный' },
  { value: 'conversational', label: 'Разговорный' },
  { value: 'documentary',   label: 'Документальный' },
  { value: 'emotional',     label: 'Эмоциональный' },
]

const LANGUAGE_OPTIONS = [
  { value: 'ru', label: '🇷🇺 Русский' },
  { value: 'en', label: '🇬🇧 English' },
  { value: 'es', label: '🇪🇸 Español' },
  { value: 'de', label: '🇩🇪 Deutsch' },
  { value: 'fr', label: '🇫🇷 Français' },
  { value: '',   label: '🌐 Все языки' },
] as const

// ─── Voice dropdown ─────────────────────────────────────────────────────────────

function VoiceDropdown({
  value,
  voices,
  loading: voicesLoading,
  genderFilter,
  onChange,
  onPreview,
  previewingId,
}: {
  value: string
  voices: ApiVoice[]
  loading: boolean
  genderFilter: 'all' | 'M' | 'F'
  onChange: (id: string) => void
  onPreview: (id: string) => void
  previewingId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selected = voices.find((v) => v.voice_id === value)

  const filtered = voices.filter((v) => {
    const matchGender = genderFilter === 'all' || v.gender === genderFilter || v.gender === null
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      v.name.toLowerCase().includes(q) ||
      (v.description ?? '').toLowerCase().includes(q) ||
      (v.accent ?? '').toLowerCase().includes(q)
    return matchGender && matchSearch
  })

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const genderBadge = (gender: 'M' | 'F' | null) => {
    if (!gender) return null
    return (
      <span
        className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
        style={gender === 'F'
          ? { background: 'rgba(236,72,153,0.15)', color: '#F472B6' }
          : { background: 'rgba(59,130,246,0.15)', color: '#60A5FA' }
        }
      >
        {gender === 'F' ? 'Ж' : 'М'}
      </span>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F8FAFC' }}
      >
        {voicesLoading ? (
          <span className="text-slate-500 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Загрузка голосов...
          </span>
        ) : selected ? (
          <span className="flex items-center gap-2 min-w-0">
            {genderBadge(selected.gender)}
            <span className="font-medium shrink-0 text-slate-200">{selected.name}</span>
            {selected.accent && <span className="text-slate-500 text-xs shrink-0">{selected.accent}</span>}
            {selected.description && (
              <span className="text-slate-500 text-xs truncate">— {selected.description}</span>
            )}
          </span>
        ) : (
          <span className="text-slate-500">Выберите голос...</span>
        )}
        <svg
          className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ml-2 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-xl overflow-hidden"
          style={{ background: '#13131A', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}
        >
          <div className="p-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Поиск... (${voices.length} голосов)`}
              autoFocus
            />
          </div>

          <div className="max-h-72 overflow-y-auto">
            {voicesLoading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-slate-500 text-sm">
                <svg className="w-4 h-4 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Загрузка...
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500 text-center">Не найдено</p>
            ) : (
              filtered.map((voice) => {
                const isPreviewing = previewingId === voice.voice_id
                const isSelected = voice.voice_id === value
                return (
                  <div
                    key={voice.voice_id}
                    className="flex items-center justify-between px-3 py-2 transition-colors"
                    style={isSelected ? { background: 'rgba(124,58,237,0.12)' } : {}}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = '' }}
                  >
                    <button
                      type="button"
                      onClick={() => { onChange(voice.voice_id); setOpen(false); setSearch('') }}
                      className="flex items-center gap-2 flex-1 text-left min-w-0"
                    >
                      {genderBadge(voice.gender)}
                      <span className={`text-sm font-medium shrink-0 ${isSelected ? 'text-violet-400' : 'text-slate-200'}`}>
                        {voice.name}
                      </span>
                      {voice.accent && (
                        <span className="text-xs text-slate-500 shrink-0">{voice.accent}</span>
                      )}
                      {voice.description && (
                        <span className="text-xs text-slate-600 truncate">— {voice.description}</span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onPreview(voice.voice_id) }}
                      disabled={isPreviewing}
                      title="Прослушать"
                      className="shrink-0 ml-2 p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-default"
                      style={{ color: '#475569' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#A78BFA'; e.currentTarget.style.background = 'rgba(124,58,237,0.12)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.background = '' }}
                    >
                      {isPreviewing ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {!voicesLoading && (
            <div className="px-4 py-2 text-xs text-slate-600 text-right" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
              {filtered.length} из {voices.length} голосов
              {filtered.length < voices.length && ` · попробуйте изменить поиск`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Slider ────────────────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, step, onChange, leftLabel, rightLabel, format,
}: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; leftLabel?: string; rightLabel?: string
  format?: (v: number) => string
}) {
  const display = format ? format(value) : `${Math.round(value * 100)}%`
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-sm font-medium text-slate-300">{label}</p>
        <span className="text-sm text-violet-400">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-xs text-slate-600 mt-1">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  )
}

// ─── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({
  checked, onChange, label, hint,
}: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string
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
        <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(24px)' : 'translateX(4px)' }} />
      </button>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Step3Voice() {
  const {
    script, projectId, voiceSettings, audioUrl,
    setVoiceSettings, setAudioUrl, setStep,
  } = useStudioStore()

  const [voices, setVoices] = useState<ApiVoice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(true)
  const [voicesError, setVoicesError] = useState('')
  const [voiceLanguage, setVoiceLanguage] = useState('ru')
  const [genderFilter, setGenderFilter] = useState<'all' | 'M' | 'F'>('all')
  const [loading, setLoading] = useState(false)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const audioFileRef = useRef<HTMLInputElement>(null)

  function loadVoices(lang: string) {
    setVoicesLoading(true)
    setVoicesError('')
    setVoices([])  // clear old list so stale results never show during filter change
    const url = lang ? `/api/voices?language=${encodeURIComponent(lang)}` : '/api/voices'
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && Array.isArray(json.data?.voices)) {
          setVoices(json.data.voices as ApiVoice[])
          if (json.data.voices.length === 0) {
            setVoicesError('Голоса для этого языка не найдены')
          }
        } else {
          setVoicesError(json.error ?? 'Не удалось загрузить список голосов')
        }
      })
      .catch(() => setVoicesError('Ошибка сети при загрузке голосов'))
      .finally(() => setVoicesLoading(false))
  }

  useEffect(() => { loadVoices(voiceLanguage) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleLanguageChange(lang: string) {
    setVoiceLanguage(lang)
    loadVoices(lang)
  }

  async function handlePreview(voiceId: string) {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
    }
    if (previewingId === voiceId) { setPreviewingId(null); return }

    setPreviewingId(voiceId)
    try {
      const voice = voices.find((v) => v.voice_id === voiceId)
      const directUrl = voice?.preview_url ?? null

      if (directUrl) {
        const audio = new Audio(directUrl)
        currentAudioRef.current = audio
        audio.onended = () => { setPreviewingId(null); currentAudioRef.current = null }
        audio.onerror = () => { setPreviewingId(null); currentAudioRef.current = null }
        await audio.play()
      } else {
        const res = await fetch('/api/voice-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_id: voiceId }),
        })
        if (!res.ok) throw new Error(`preview ${res.status}`)
        const blob = await res.blob()
        const blobUrl = URL.createObjectURL(blob)
        const audio = new Audio(blobUrl)
        currentAudioRef.current = audio
        audio.onended = () => { setPreviewingId(null); URL.revokeObjectURL(blobUrl); currentAudioRef.current = null }
        audio.onerror = () => { setPreviewingId(null); URL.revokeObjectURL(blobUrl); currentAudioRef.current = null }
        await audio.play()
      }
    } catch (err) {
      console.warn('[voice-preview]', err instanceof Error ? err.message : err)
      setPreviewingId(null)
    }
  }

  const handleAudioUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!projectId) { setUploadError('Сначала создайте проект (шаг 1)'); return }
    setUploadError('')
    setUploading(true)
    try {
      const signRes = await fetch('/api/upload/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'audio', project_id: projectId, content_type: file.type || 'audio/mpeg' }),
      })
      const signJson = await signRes.json()
      if (!signJson.ok) throw new Error(signJson.error)
      const { signed_url, access_url } = signJson.data
      const uploadRes = await fetch(signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'audio/mpeg' },
        body: file,
      })
      if (!uploadRes.ok) throw new Error('Ошибка загрузки файла на сервер')
      setAudioUrl(access_url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Ошибка загрузки аудио')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }, [projectId, setAudioUrl])

  async function handleGenerateAudio() {
    if (!script) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: script,
          voice_id: voiceSettings.voiceId,
          project_id: projectId,
          stability: voiceSettings.stability,
          similarity_boost: voiceSettings.similarityBoost,
          speech_rate: voiceSettings.speechRate,
          voice_style: voiceSettings.style,
          clarity_boost: voiceSettings.clarityBoost,
          paragraph_pauses: voiceSettings.paragraphPauses,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError('Недостаточно кредитов для озвучки.'); return }
        throw new Error(json.error)
      }
      setAudioUrl(json.data.audio_url)
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации аудио')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Шаг 3: Озвучка</h2>
        <p className="text-sm text-slate-500">
          Выберите голос и настройте параметры
          {!voicesLoading && voices.length > 0 && (
            <span className="ml-1 text-slate-600">· {voices.length} голосов</span>
          )}
        </p>
      </div>

      {/* Voices load error */}
      {voicesError && !voicesLoading && (
        <div
          className="flex items-start gap-3 rounded-xl px-4 py-3"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-red-400">Не удалось загрузить голоса</p>
            <p className="text-xs text-red-500/70 mt-0.5">{voicesError}</p>
          </div>
          <button
            type="button"
            onClick={() => loadVoices(voiceLanguage)}
            className="shrink-0 text-xs text-red-400 hover:text-red-300 font-medium underline transition-colors"
          >
            Повторить
          </button>
        </div>
      )}

      {/* Language filter */}
      <div>
        <p className="text-sm font-medium text-slate-300 mb-2">Язык голоса</p>
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleLanguageChange(opt.value)}
              disabled={voicesLoading}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border-2 transition-all disabled:opacity-50"
              style={
                voiceLanguage === opt.value
                  ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
                  : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#64748B' }
              }
            >
              {voicesLoading && voiceLanguage === opt.value ? (
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  {opt.label}
                </span>
              ) : opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Gender filter */}
      <div>
        <p className="text-sm font-medium text-slate-300 mb-2">Пол голоса</p>
        <div className="inline-flex rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          {(['all', 'F', 'M'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGenderFilter(g)}
              className="px-4 py-2 text-sm font-medium transition-colors"
              style={
                genderFilter === g
                  ? { background: '#7C3AED', color: '#fff' }
                  : { color: '#64748B' }
              }
            >
              {g === 'all' ? 'Все' : g === 'F' ? 'Женский' : 'Мужской'}
            </button>
          ))}
        </div>
      </div>

      {/* Voice selector */}
      <div>
        <p className="text-sm font-medium text-slate-300 mb-2">Голос</p>
        <VoiceDropdown
          value={voiceSettings.voiceId}
          voices={voices}
          loading={voicesLoading}
          genderFilter={genderFilter}
          onChange={(id) => setVoiceSettings({ voiceId: id })}
          onPreview={handlePreview}
          previewingId={previewingId}
        />
      </div>

      {/* Voice style */}
      <div>
        <p className="text-sm font-medium text-slate-300 mb-2">Стиль озвучки</p>
        <div className="grid grid-cols-4 gap-2">
          {VOICE_STYLES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setVoiceSettings({ style: s.value })}
              className="py-2 text-xs font-medium rounded-xl border-2 transition-all"
              style={
                voiceSettings.style === s.value
                  ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
                  : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#64748B' }
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sliders */}
      <div className="flex flex-col gap-4">
        <Slider
          label="Скорость речи"
          value={voiceSettings.speechRate}
          min={0.5} max={2.0} step={0.05}
          onChange={(v) => setVoiceSettings({ speechRate: v })}
          leftLabel="Медленно" rightLabel="Быстро"
          format={(v) => `${v.toFixed(2)}×`}
        />
        <Slider
          label="Стабильность"
          value={voiceSettings.stability}
          min={0} max={1} step={0.05}
          onChange={(v) => setVoiceSettings({ stability: v })}
          leftLabel="Выразительно" rightLabel="Стабильно"
        />
        <Slider
          label="Схожесть с оригиналом"
          value={voiceSettings.similarityBoost}
          min={0} max={1} step={0.05}
          onChange={(v) => setVoiceSettings({ similarityBoost: v })}
          leftLabel="Свободно" rightLabel="Точно"
        />
      </div>

      {/* Extra toggles */}
      <div className="rounded-xl px-4 divide-y" style={{ border: '1px solid rgba(255,255,255,0.08)', '--divide-color': 'rgba(255,255,255,0.06)' } as React.CSSProperties}>
        <Toggle
          checked={voiceSettings.clarityBoost}
          onChange={(v) => setVoiceSettings({ clarityBoost: v })}
          label="Улучшение чёткости"
          hint="Speaker boost для более чёткого звука"
        />
        <Toggle
          checked={voiceSettings.paragraphPauses}
          onChange={(v) => setVoiceSettings({ paragraphPauses: v })}
          label="Паузы между абзацами"
          hint="Небольшая пауза при смене абзаца"
        />
      </div>

      {/* Generate button */}
      <button
        type="button"
        onClick={handleGenerateAudio}
        disabled={loading || uploading || !voiceSettings.voiceId || voicesLoading}
        className="w-full py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Озвучка... (может занять минуту)
          </>
        ) : audioUrl ? (
          '↺ Перегенерировать аудио (−2 кр.)'
        ) : (
          '🎙 Озвучить сценарий (−2 кр.)'
        )}
      </button>

      {/* Upload own audio / skip */}
      {!loading && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => audioFileRef.current?.click()}
            disabled={uploading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-slate-400 text-xs font-medium rounded-xl hover:text-slate-200 disabled:opacity-50 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
          >
            {uploading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Загрузка...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Загрузить .mp3/.wav
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStep(4)}
            className="flex items-center gap-1 py-2 px-3 text-slate-500 text-xs font-medium rounded-xl hover:text-slate-300 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.07)' }}
          >
            Пропустить →
          </button>
          <input
            ref={audioFileRef}
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp3,.mp3,.wav"
            className="hidden"
            onChange={handleAudioUpload}
          />
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-red-400 rounded-xl px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.15)' }}>
          {uploadError}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}

      {/* Audio result */}
      {audioUrl && (
        <div
          className="rounded-xl p-4 flex flex-col gap-3"
          style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)' }}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-200">Готовое аудио</p>
            <a
              href={audioUrl}
              download="audio.mp3"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Скачать MP3
            </a>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} className="w-full" />
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(2)}
          className="px-5 py-3 btn-ghost-dark font-medium rounded-xl text-sm"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => setStep(4)}
          disabled={!audioUrl}
          className="flex-1 py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-40"
        >
          Далее: Субтитры →
        </button>
      </div>
    </div>
  )
}
