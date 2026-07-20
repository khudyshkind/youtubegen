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

const SYNC_ENGINES: AudioEngine[] = ['elevenlabs', 'openai', 'google', 'apihost']

const OPENAI_VOICES = [
  { id: 'alloy',   label: 'Alloy'   },
  { id: 'echo',    label: 'Echo'    },
  { id: 'fable',   label: 'Fable'   },
  { id: 'onyx',    label: 'Onyx'    },
  { id: 'nova',    label: 'Nova'    },
  { id: 'shimmer', label: 'Shimmer' },
]

const CHAR_LIMIT = 8000

interface ElevenVoice { voice_id: string; name: string }
interface GoogleVoice { name: string; languageCodes: string[]; gender: string | null }
interface ApihostVoiceItem { voice_id: string; name: string; type: ApihostVoiceType }

function TtsContent() {
  const { t, lang } = useLang()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  const [text, setText] = useState('')
  const [engine, setEngine] = useState<AudioEngine>('elevenlabs')
  const [voiceId, setVoiceId] = useState('')
  const [apihostType, setApihostType] = useState<ApihostVoiceType>('standard')
  const [outputLang, setOutputLang] = useState('ru')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')

  // Voice lists
  const [elevenVoices, setElevenVoices] = useState<ElevenVoice[]>([])
  const [googleVoices, setGoogleVoices] = useState<GoogleVoice[]>([])
  const [apihostVoices, setApihostVoices] = useState<ApihostVoiceItem[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)

  // Load ?run= restore
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

  // Load voices when engine changes
  useEffect(() => {
    if (engine === 'openai') { setVoiceId('alloy'); return }
    setVoicesLoading(true)
    setVoiceId('')

    if (engine === 'elevenlabs') {
      fetch(`/api/voices?language=${outputLang}`)
        .then(r => r.json())
        .then(json => {
          const voices: ElevenVoice[] = json.data?.voices ?? []
          setElevenVoices(voices)
          if (voices[0]) setVoiceId(voices[0].voice_id)
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
          const voices: ApihostVoiceItem[] = (json.data?.voices ?? []).map((v: { voice_id: string; name: string; type?: string }) => ({
            voice_id: v.voice_id,
            name: v.name,
            type: (v.type ?? 'standard') as ApihostVoiceType,
          }))
          setApihostVoices(voices)
          if (voices[0]) { setVoiceId(voices[0].voice_id); setApihostType(voices[0].type) }
        })
        .catch(() => {})
        .finally(() => setVoicesLoading(false))
    }
  }, [engine, outputLang]) // eslint-disable-line react-hooks/exhaustive-deps

  const chars = text.length
  const cost = chars > 0 ? audioCost(chars, engine, engine === 'apihost' ? apihostType : undefined) : 0
  const costPer1000 = cost > 0 ? Math.round((cost / Math.ceil(chars / 1000))) : 0

  async function handleGenerate() {
    if (!text.trim()) { setError(t('tools.err_empty')); return }
    if (!voiceId) { setError('Выберите голос'); return }
    if (chars > CHAR_LIMIT) { setError(`Лимит ${CHAR_LIMIT} символов`); return }
    setError('')
    setAudioUrl('')
    setSavedId(null)
    setSaveError('')
    setGenerating(true)

    try {
      const res = await fetch('/api/generate/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine,
          text,
          voice_id: voiceId,
          tool_run: true,
          own_script: true,
          script_lang: outputLang,
          apihost_voice_type: apihostType,
        }),
      })
      if (res.status === 504 || res.status === 524) throw new Error(t('tools.err_timeout'))
      const json: { ok: boolean; data?: { audio_url: string; tool_run_id?: string }; error?: string; code?: string } = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(json.error ?? t('tools.err_gen'))
      }
      setAudioUrl(json.data!.audio_url)
      if (json.data?.tool_run_id) setSavedId(json.data.tool_run_id)
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setGenerating(false)
    }
  }

  const engineBtnStyle = (e: AudioEngine) => e === engine
    ? { background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.5)', color: '#a78bfa' }
    : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b' }

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.tts_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.tts_subtitle')}</p>
      </div>

      <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

        {/* Engine selector */}
        <div>
          <label className="text-xs font-medium text-slate-400 block mb-2">{t('tools.tts_engine_label')}</label>
          <div className="flex flex-wrap gap-2">
            {SYNC_ENGINES.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => setEngine(e)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={engineBtnStyle(e)}
              >
                {ENGINE_DISPLAY[e]?.name ?? e}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-1">{ENGINE_DISPLAY[engine]?.descRu ?? ''}</p>
        </div>

        {/* Language + voice */}
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.output_lang')}</label>
            <select
              value={outputLang}
              onChange={e => setOutputLang(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <option value="ru" className="bg-slate-900">🇷🇺 Русский</option>
              <option value="en" className="bg-slate-900">🇬🇧 English</option>
              <option value="de" className="bg-slate-900">🇩🇪 Deutsch</option>
              <option value="es" className="bg-slate-900">🇪🇸 Español</option>
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.tts_voice_label')}</label>
            {engine === 'openai' ? (
              <select
                value={voiceId}
                onChange={e => setVoiceId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {OPENAI_VOICES.map(v => (
                  <option key={v.id} value={v.id} className="bg-slate-900">{v.label}</option>
                ))}
              </select>
            ) : voicesLoading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
                <SpinnerIcon className="w-3 h-3 animate-spin" /> Загрузка голосов...
              </div>
            ) : engine === 'elevenlabs' ? (
              <select
                value={voiceId}
                onChange={e => setVoiceId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {elevenVoices.map(v => (
                  <option key={v.voice_id} value={v.voice_id} className="bg-slate-900">{v.name}</option>
                ))}
              </select>
            ) : engine === 'google' ? (
              <select
                value={voiceId}
                onChange={e => setVoiceId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {googleVoices.map(v => (
                  <option key={v.name} value={v.name} className="bg-slate-900">{v.name} {v.gender === 'F' ? '♀' : v.gender === 'M' ? '♂' : ''}</option>
                ))}
              </select>
            ) : (
              <select
                value={voiceId}
                onChange={e => {
                  setVoiceId(e.target.value)
                  const found = apihostVoices.find(v => v.voice_id === e.target.value)
                  if (found) setApihostType(found.type)
                }}
                className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {apihostVoices.map(v => (
                  <option key={v.voice_id} value={v.voice_id} className="bg-slate-900">{v.name} ({v.type})</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Text input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-400">{t('tools.input_label')}</label>
            <span className={`text-xs ${chars > CHAR_LIMIT ? 'text-red-400' : 'text-slate-600'}`}>
              {chars} / {CHAR_LIMIT} {t('tools.chars')}
              {cost > 0 && <span className="ml-2 text-slate-500">· {cost} кр. (~{costPer1000}/1000 симв.)</span>}
            </span>
          </div>
          <textarea
            rows={10}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t('tools.tts_input_ph')}
            className="w-full px-4 py-3 rounded-xl text-sm resize-y leading-relaxed"
          />
        </div>

        {/* Generate button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || chars === 0 || chars > CHAR_LIMIT}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
        >
          {generating ? (
            <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.tts_generating')}</>
          ) : (
            <>{t('tools.tts_gen_btn')} · −{cost || '?'} {t('nav.credits_suffix')}</>
          )}
        </button>

        {error && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Result */}
        {audioUrl && (
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-400">
                {t('tools.tts_result_label')}
                {savedId && <span className="ml-2 text-green-500">{t('tools.saved')}</span>}
                {saveError && <span className="ml-2 text-red-400">{saveError}</span>}
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

export default function TtsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Загрузка...</div>}>
      <TtsContent />
    </Suspense>
  )
}
