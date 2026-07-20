'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/hooks/useLang'
import { refreshCredits } from '@/lib/refresh-credits'
import { audioCost, CREDIT_COSTS, ENGINE_DISPLAY } from '@/lib/types'
import type { AudioEngine, ApihostVoiceType } from '@/lib/types'

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}
function PlayIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
}
function StopIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" /></svg>
}

// All 6 engines in display order (secretvoicer = Voice Standard, voicer = Voice Pro)
const ALL_ENGINES: AudioEngine[] = ['secretvoicer', 'elevenlabs', 'voicer', 'openai', 'apihost', 'google']

interface EngineCardMeta { voices: string; langs: string; price: string; available: boolean; async: boolean }
const ENGINE_CARD_META: Record<string, EngineCardMeta> = {
  secretvoicer: { voices: '101 голос',     langs: 'RU/EN/ES/PT',   price: `${CREDIT_COSTS.audio_secretvoicer_per_1000} кр / 1000 симв`,   available: true,  async: true  },
  elevenlabs:   { voices: '321 голос',     langs: '28 языков',      price: `${CREDIT_COSTS.audio_elevenlabs_per_1000} кр / 1000 симв`,   available: true,  async: false },
  voicer:       { voices: '101 голос',     langs: 'мультиязычный', price: `${CREDIT_COSTS.audio_voicer_per_1000} кр / 1000 симв`,       available: true,  async: true  },
  openai:       { voices: '6 голосов',     langs: 'мультиязычный', price: `${CREDIT_COSTS.audio_openai_per_1000} кр / 1000 симв`,       available: true,  async: false },
  apihost:      { voices: '3000+ голосов', langs: '83 языка',       price: `${CREDIT_COSTS.audio_apihost_basic_per_1000}–${CREDIT_COSTS.audio_apihost_studio_per_1000} кр / 1000 симв`, available: true, async: false },
  google:       { voices: '100+ голосов',  langs: 'мультиязычный', price: `${CREDIT_COSTS.audio_google_per_1000} кр / 1000 симв`,       available: false, async: false },
}

const VOICE_STYLES = [
  { key: 'neutral',        label: 'Нейтральный'   },
  { key: 'conversational', label: 'Разговорный'   },
  { key: 'documentary',   label: 'Документальный' },
  { key: 'emotional',     label: 'Эмоциональный'  },
]

const OPENAI_VOICES = [
  { id: 'alloy',   label: 'Alloy',   gender: null as 'M' | 'F' | null },
  { id: 'echo',    label: 'Echo',    gender: 'M' as const },
  { id: 'fable',   label: 'Fable',   gender: 'M' as const },
  { id: 'onyx',    label: 'Onyx',    gender: 'M' as const },
  { id: 'nova',    label: 'Nova',    gender: 'F' as const },
  { id: 'shimmer', label: 'Shimmer', gender: 'F' as const },
]

interface NormVoice      { voice_id: string; name: string; preview_url: string | null; gender: 'M' | 'F' | null }
interface GoogleVoice    { name: string; languageCodes: string[]; gender: 'M' | 'F' | null }
interface ApihostVoiceItem { voice_id: string; name: string; type: ApihostVoiceType; preview_url: string | null }
type GenderFilter = 'all' | 'M' | 'F'

// Engines that support ElevenLabs-style voice settings (style, stability, similarity, speed)
const ELEVEN_SETTINGS_ENGINES: AudioEngine[] = ['secretvoicer', 'elevenlabs', 'voicer']
// Engines with speed slider only
const SPEED_ONLY_ENGINES: AudioEngine[] = ['openai']
// Engines using secretvoicer voice list (same ElevenLabs voice IDs)
const SV_VOICE_ENGINES: AudioEngine[] = ['secretvoicer', 'voicer']

function TtsContent() {
  const { t, lang } = useLang()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  const [text, setText]               = useState('')
  const [engine, setEngine]           = useState<AudioEngine>('secretvoicer')
  const [voiceId, setVoiceId]         = useState('')
  const [apihostType, setApihostType] = useState<ApihostVoiceType>('standard')
  const [outputLang, setOutputLang]   = useState('ru')
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all')
  const [voiceStyle, setVoiceStyle]   = useState('neutral')
  const [stability, setStability]     = useState(0.5)
  const [similarity, setSimilarity]   = useState(0.75)
  const [speed, setSpeed]             = useState(1.0)
  const [generating, setGenerating]   = useState(false)
  const [processing, setProcessing]   = useState(false)   // async poll in progress
  const [pollId, setPollId]           = useState<string | null>(null)
  const [error, setError]             = useState('')
  const [audioUrl, setAudioUrl]       = useState('')
  const [savedId, setSavedId]         = useState<string | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null)

  const [svVoices, setSvVoices]         = useState<NormVoice[]>([])       // secretvoicer + voicer
  const [elevenVoices, setElevenVoices] = useState<NormVoice[]>([])
  const [googleVoices, setGoogleVoices] = useState<GoogleVoice[]>([])
  const [apihostVoices, setApihostVoices] = useState<ApihostVoiceItem[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)

  const audioRef   = useRef<HTMLAudioElement>(null)
  const previewRef = useRef<HTMLAudioElement>(null)

  // Restore from ?run=
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        const p = json.data?.project
        if (json.ok && p?.audio_url) {
          setAudioUrl(p.audio_url)
          setText(p.topic ?? '')
          setSavedId(runId)
        }
      })
      .catch(() => {})
  }, [runId])

  // Poll for audio_url when async synthesis is in progress
  useEffect(() => {
    if (!pollId || !processing) return
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/projects/${pollId}`)
        const j = await r.json()
        const p = j.data?.project
        if (!j.ok || !p) return
        if (p.audio_url) {
          setAudioUrl(p.audio_url)
          setProcessing(false)
          setPollId(null)
          void refreshCredits()
        } else if (p.status === 'failed') {
          setError('Синтез не удался — попробуйте ещё раз')
          setProcessing(false)
          setPollId(null)
        }
      } catch { /* network error — keep polling */ }
    }, 4000)
    return () => clearInterval(timer)
  }, [pollId, processing])

  // Load voices when engine or language changes
  useEffect(() => {
    setGenderFilter('all')
    setPreviewUrl(null)
    setPreviewPlaying(false)
    if (previewRef.current) { previewRef.current.pause(); previewRef.current.src = '' }

    if (engine === 'openai') { setVoiceId('alloy'); return }
    setVoicesLoading(true)
    setVoiceId('')

    if (SV_VOICE_ENGINES.includes(engine)) {
      fetch(`/api/voices/secretvoicer?language=${outputLang}`)
        .then(r => r.json())
        .then(json => {
          const voices: NormVoice[] = json.data?.voices ?? []
          setSvVoices(voices)
          if (voices[0]) { setVoiceId(voices[0].voice_id); setPreviewUrl(voices[0].preview_url ?? null) }
        })
        .catch(() => {})
        .finally(() => setVoicesLoading(false))
    } else if (engine === 'elevenlabs') {
      fetch(`/api/voices?language=${outputLang}`)
        .then(r => r.json())
        .then(json => {
          const voices: NormVoice[] = json.data?.voices ?? []
          setElevenVoices(voices)
          if (voices[0]) { setVoiceId(voices[0].voice_id); setPreviewUrl(voices[0].preview_url ?? null) }
        })
        .catch(() => {})
        .finally(() => setVoicesLoading(false))
    } else if (engine === 'google') {
      const langCode = outputLang === 'ru' ? 'ru-RU' : outputLang === 'en' ? 'en-US' : outputLang
      fetch(`/api/voices/google?language=${langCode}`)
        .then(r => r.json())
        .then(json => {
          const voices: GoogleVoice[] = json.data?.voices ?? []
          setGoogleVoices(voices)
          if (voices[0]) setVoiceId(voices[0].name)
        })
        .catch(() => {})
        .finally(() => setVoicesLoading(false))
    } else if (engine === 'apihost') {
      fetch('/api/voices/apihost')
        .then(r => r.json())
        .then(json => {
          const voices: ApihostVoiceItem[] = (json.data?.voices ?? []).map((v: { voice_id: string; name: string; type?: string; preview_url?: string | null }) => ({
            voice_id: v.voice_id, name: v.name,
            type: (v.type ?? 'standard') as ApihostVoiceType, preview_url: v.preview_url ?? null,
          }))
          setApihostVoices(voices)
          if (voices[0]) { setVoiceId(voices[0].voice_id); setApihostType(voices[0].type); setPreviewUrl(voices[0].preview_url ?? null) }
        })
        .catch(() => {})
        .finally(() => setVoicesLoading(false))
    }
  }, [engine, outputLang]) // eslint-disable-line react-hooks/exhaustive-deps

  // Current voice list for render
  const currentVoices: NormVoice[] = SV_VOICE_ENGINES.includes(engine) ? svVoices : elevenVoices
  const filteredVoices = genderFilter === 'all' ? currentVoices : currentVoices.filter(v => v.gender === genderFilter)
  const filteredGoogle = genderFilter === 'all' ? googleVoices : googleVoices.filter(v => v.gender === genderFilter)
  const showGenderFilter = engine === 'elevenlabs' || SV_VOICE_ENGINES.includes(engine) || engine === 'google'

  const chars = text.length
  const cost = chars > 0 ? audioCost(chars, engine, engine === 'apihost' ? apihostType : undefined) : 0
  const ratePerK = engine === 'apihost'
    ? `${CREDIT_COSTS[`audio_apihost_${apihostType}_per_1000` as keyof typeof CREDIT_COSTS]} кр / 1000`
    : `${audioCost(1000, engine)} кр / 1000`

  function onVoiceChange(id: string) {
    setVoiceId(id)
    if (SV_VOICE_ENGINES.includes(engine)) {
      const v = svVoices.find(v => v.voice_id === id)
      setPreviewUrl(v?.preview_url ?? null)
    } else if (engine === 'elevenlabs') {
      const v = elevenVoices.find(v => v.voice_id === id)
      setPreviewUrl(v?.preview_url ?? null)
    } else if (engine === 'apihost') {
      const v = apihostVoices.find(v => v.voice_id === id)
      if (v) { setApihostType(v.type); setPreviewUrl(v.preview_url ?? null) }
    }
    stopPreview()
  }

  function stopPreview() {
    if (previewRef.current) { previewRef.current.pause(); previewRef.current.src = '' }
    setPreviewPlaying(false)
  }

  function togglePreview() {
    if (!previewUrl) return
    if (previewPlaying) { stopPreview(); return }
    if (previewRef.current) {
      previewRef.current.src = previewUrl
      previewRef.current.play().catch(() => {})
      setPreviewPlaying(true)
      previewRef.current.onended = () => setPreviewPlaying(false)
    }
  }

  async function handleGenerate() {
    if (!text.trim()) { setError(t('tools.err_empty')); return }
    if (!voiceId) { setError('Выберите голос'); return }
    setError('')
    setAudioUrl('')
    setSavedId(null)
    setProcessing(false)
    setPollId(null)
    setGenerating(true)

    try {
      const body: Record<string, unknown> = {
        engine, text, voice_id: voiceId,
        tool_run: true, own_script: true, script_lang: outputLang,
        apihost_voice_type: apihostType,
      }
      if (ELEVEN_SETTINGS_ENGINES.includes(engine)) {
        body.stability        = stability
        body.similarity_boost = similarity
        body.voice_style      = voiceStyle
        body.speech_rate      = speed
      }
      if (SPEED_ONLY_ENGINES.includes(engine)) {
        body.speech_rate = speed
      }

      const res = await fetch('/api/generate/audio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (res.status === 504 || res.status === 524) throw new Error(t('tools.err_timeout'))
      const json: {
        ok: boolean
        data?: { audio_url?: string; tool_run_id?: string; processing?: boolean }
        error?: string; code?: string
      } = await res.json()

      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(json.error ?? t('tools.err_gen'))
      }

      if (json.data?.processing && json.data.tool_run_id) {
        // Async engine dispatched to Railway — start polling
        setSavedId(json.data.tool_run_id)
        setPollId(json.data.tool_run_id)
        setProcessing(true)
      } else if (json.data?.audio_url) {
        // Sync engine — immediate result
        setAudioUrl(json.data.audio_url)
        if (json.data.tool_run_id) setSavedId(json.data.tool_run_id)
        void refreshCredits()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setGenerating(false)
    }
  }

  const engineActive = (e: AudioEngine) => e === engine
  const engineStyle  = (e: AudioEngine, available: boolean) => {
    if (!available) return { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', opacity: 0.45, cursor: 'not-allowed' }
    return engineActive(e)
      ? { background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.55)' }
      : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }
  }

  const showElevenSettings = ELEVEN_SETTINGS_ENGINES.includes(engine)
  const showSpeedOnly      = SPEED_ONLY_ENGINES.includes(engine)
  const isAsync            = ENGINE_CARD_META[engine]?.async ?? false

  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-6 py-8">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={previewRef} style={{ display: 'none' }} />

      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.tts_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.tts_subtitle')}</p>
      </div>

      <div className="rounded-2xl p-6 flex flex-col gap-6" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

        {/* Engine cards 3×2 */}
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t('tools.tts_engine_label')}</p>
          <div className="grid grid-cols-3 gap-2.5">
            {ALL_ENGINES.map(e => {
              const meta = ENGINE_CARD_META[e]!
              const disp = ENGINE_DISPLAY[e]!
              const active = engineActive(e)
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => meta.available && setEngine(e)}
                  disabled={!meta.available}
                  className="flex flex-col gap-1.5 p-4 rounded-xl text-left transition-all"
                  style={engineStyle(e, meta.available)}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-sm font-semibold ${active ? 'text-violet-300' : 'text-slate-200'}`}>{disp.name}</span>
                    {!meta.available && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.08)', color: '#64748b' }}>Скоро</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 leading-snug">{disp.descRu}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-slate-500">{meta.voices}</span>
                    <span className="text-slate-700">·</span>
                    <span className="text-[10px] text-slate-500">{meta.langs}</span>
                  </div>
                  <p className={`text-[11px] font-medium mt-0.5 ${active ? 'text-violet-400' : 'text-slate-500'}`}>{meta.price}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Language + gender filter */}
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.tts_lang_label')}</label>
            <select
              value={outputLang}
              onChange={e => setOutputLang(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <option value="ru" className="bg-slate-900">🇷🇺 Русский</option>
              <option value="en" className="bg-slate-900">🇬🇧 English</option>
              <option value="de" className="bg-slate-900">🇩🇪 Deutsch</option>
              <option value="es" className="bg-slate-900">🇪🇸 Español</option>
              <option value="fr" className="bg-slate-900">🇫🇷 Français</option>
              <option value="it" className="bg-slate-900">🇮🇹 Italiano</option>
              <option value="pt" className="bg-slate-900">🇵🇹 Português</option>
            </select>
          </div>
          {showGenderFilter && (
            <div className="min-w-[140px]">
              <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.tts_gender_label')}</label>
              <div className="flex gap-1">
                {(['all', 'M', 'F'] as GenderFilter[]).map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGenderFilter(g)}
                    className="flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-all"
                    style={genderFilter === g
                      ? { background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.5)', color: '#a78bfa' }
                      : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b' }
                    }
                  >
                    {g === 'all' ? 'Все' : g === 'M' ? '♂ М' : '♀ Ж'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Voice selector + preview */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-400">{t('tools.tts_voice_label')}</label>
            {previewUrl && (
              <button
                type="button"
                onClick={togglePreview}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-all"
                style={previewPlaying
                  ? { borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.1)', color: '#34d399' }
                  : { borderColor: 'rgba(255,255,255,0.12)', color: '#64748b' }
                }
              >
                {previewPlaying ? <StopIcon className="w-3 h-3" /> : <PlayIcon className="w-3 h-3" />}
                {t('tools.tts_preview')}
              </button>
            )}
          </div>

          {engine === 'openai' ? (
            <select
              value={voiceId}
              onChange={e => onVoiceChange(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {OPENAI_VOICES.map(v => (
                <option key={v.id} value={v.id} className="bg-slate-900">
                  {v.gender === 'M' ? '♂ ' : v.gender === 'F' ? '♀ ' : ''}{v.label}
                </option>
              ))}
            </select>
          ) : voicesLoading ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs text-slate-500" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <SpinnerIcon className="w-3 h-3 animate-spin" /> Загрузка голосов...
            </div>
          ) : engine === 'google' ? (
            <select
              value={voiceId}
              onChange={e => onVoiceChange(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {(filteredGoogle.length ? filteredGoogle : googleVoices).map(v => (
                <option key={v.name} value={v.name} className="bg-slate-900">
                  {v.gender === 'M' ? '♂ ' : v.gender === 'F' ? '♀ ' : ''}{v.name}
                </option>
              ))}
            </select>
          ) : engine === 'apihost' ? (
            <select
              value={voiceId}
              onChange={e => onVoiceChange(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {apihostVoices.map(v => (
                <option key={v.voice_id} value={v.voice_id} className="bg-slate-900">{v.name} ({v.type})</option>
              ))}
            </select>
          ) : (
            // secretvoicer, elevenlabs, voicer — all use NormVoice with gender
            <select
              value={voiceId}
              onChange={e => onVoiceChange(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {(filteredVoices.length ? filteredVoices : currentVoices).map(v => (
                <option key={v.voice_id} value={v.voice_id} className="bg-slate-900">
                  {v.gender === 'M' ? '♂ ' : v.gender === 'F' ? '♀ ' : ''}{v.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Voice style (secretvoicer, elevenlabs, voicer) */}
        {showElevenSettings && (
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-2">{t('tools.tts_style_label')}</label>
            <div className="flex flex-wrap gap-2">
              {VOICE_STYLES.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setVoiceStyle(s.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={voiceStyle === s.key
                    ? { background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.5)', color: '#a78bfa' }
                    : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b' }
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sliders */}
        {(showElevenSettings || showSpeedOnly) && (
          <div className="flex flex-col gap-4">
            <SliderRow
              label={t('tools.tts_speed_label')}
              value={speed} min={0.7} max={1.2} step={0.05}
              leftLabel={t('tools.tts_slow')} rightLabel={t('tools.tts_fast')}
              valueDisplay={`${speed.toFixed(2)}×`}
              onChange={setSpeed}
            />
            {showElevenSettings && (
              <>
                <SliderRow
                  label={t('tools.tts_stability_label')}
                  value={stability} min={0} max={1} step={0.05}
                  leftLabel={t('tools.tts_expressive')} rightLabel={t('tools.tts_stable')}
                  valueDisplay={`${Math.round(stability * 100)}%`}
                  onChange={setStability}
                />
                <SliderRow
                  label={t('tools.tts_similarity_label')}
                  value={similarity} min={0} max={1} step={0.05}
                  leftLabel={t('tools.tts_free')} rightLabel={t('tools.tts_precise')}
                  valueDisplay={`${Math.round(similarity * 100)}%`}
                  onChange={setSimilarity}
                />
              </>
            )}
          </div>
        )}

        {/* Text input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-400">{t('tools.tts_text_label')}</label>
            <span className="text-xs text-slate-600">
              {chars > 0 && <>{chars} симв. · </>}
              <span className={cost > 0 ? 'text-slate-400' : 'text-slate-600'}>{cost} кр.</span>
              {chars > 0 && <span className="ml-1 text-slate-600">(~{ratePerK})</span>}
            </span>
          </div>
          <textarea
            rows={10}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t('tools.tts_input_ph')}
            className="w-full px-4 py-3 rounded-xl text-sm resize-y leading-relaxed"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', outline: 'none' }}
          />
          {isAsync && (
            <p className="text-[11px] text-slate-600 mt-1.5">
              ⏱ Этот движок генерирует в фоне — результат появится через 1–3 мин после запуска
            </p>
          )}
        </div>

        {/* Generate button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || processing || chars === 0}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
        >
          {generating ? (
            <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.tts_generating')}</>
          ) : (
            <>{t('tools.tts_gen_btn')}{cost > 0 ? ` · −${cost} ${t('nav.credits_suffix')}` : ''}</>
          )}
        </button>

        {error && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Async processing indicator */}
        {processing && (
          <div className="rounded-xl px-4 py-4 flex items-center gap-3" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)' }}>
            <SpinnerIcon className="w-5 h-5 animate-spin text-violet-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-violet-300">{t('tools.tts_processing')}</p>
              <p className="text-xs text-slate-500 mt-0.5">{t('tools.tts_processing_hint')}</p>
            </div>
            {savedId && (
              <span className="ml-auto text-xs text-slate-600">{t('tools.saved')}</span>
            )}
          </div>
        )}

        {/* Result */}
        {audioUrl && (
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between">
              <p className="text.xs font-medium text-slate-400">
                {t('tools.tts_result_label')}
                {savedId && <span className="ml-2 text-green-500">{t('tools.saved')}</span>}
              </p>
              <a
                href={audioUrl}
                download="tts-audio.mp3"
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
                style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}
              >
                ↓ {t('tools.tts_download')}
              </a>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio ref={audioRef} src={audioUrl} controls className="w-full" style={{ colorScheme: 'dark' }} />
          </div>
        )}
      </div>
    </div>
  )
}

function SliderRow({
  label, value, min, max, step, leftLabel, rightLabel, valueDisplay, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number
  leftLabel: string; rightLabel: string; valueDisplay: string; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <span className="text-xs font-medium text-violet-400">{valueDisplay}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-violet-500"
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-slate-600">{leftLabel}</span>
        <span className="text-[10px] text-slate-600">{rightLabel}</span>
      </div>
    </div>
  )
}

export default function TtsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Загрузка...</div>}>
      <TtsContent />
    </Suspense>
  )
}
