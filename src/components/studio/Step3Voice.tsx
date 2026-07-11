'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useStudioStore, stampAudioUrl } from '@/lib/studio-store'
import type { VoiceStyleType, AudioEngine, ApihostVoiceType } from '@/lib/types'
import { CREDIT_COSTS, audioCost } from '@/lib/types'
import { refreshCredits } from '@/lib/refresh-credits'
import { confirmRegenIfCompleted } from '@/lib/confirm-regen'
import { useLang } from '@/hooks/useLang'
import type { ApihostVoice } from '@/app/api/voices/apihost/route'

// ─── Constants ──────────────────────────────────────────────────────────────────

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

interface GoogleVoice {
  name: string
  languageCodes: string[]
  gender: 'M' | 'F' | null
  isWavenet: boolean
}

const EL_LANGUAGE_OPTIONS_BASE = [
  { value: 'ru', label: '🇷🇺 Русский' },
  { value: 'en', label: '🇬🇧 English' },
  { value: 'es', label: '🇪🇸 Español' },
  { value: 'de', label: '🇩🇪 Deutsch' },
  { value: 'fr', label: '🇫🇷 Français' },
] as const

const APIHOST_LANG_OPTIONS = [
  { value: 'ru-RU', label: '🇷🇺 Русский' },
  { value: 'en-US', label: '🇺🇸 English (US)' },
  { value: 'en-GB', label: '🇬🇧 English (UK)' },
  { value: 'de-DE', label: '🇩🇪 Deutsch' },
  { value: 'fr-FR', label: '🇫🇷 Français' },
  { value: 'es-ES', label: '🇪🇸 Español' },
  { value: 'it-IT', label: '🇮🇹 Italiano' },
  { value: 'uk-UA', label: '🇺🇦 Українська' },
]

const APIHOST_RATE: Record<ApihostVoiceType, number> = {
  basic:    CREDIT_COSTS.audio_apihost_basic_per_1000,
  standard: CREDIT_COSTS.audio_apihost_standard_per_1000,
  pro:      CREDIT_COSTS.audio_apihost_pro_per_1000,
  studio:   CREDIT_COSTS.audio_apihost_studio_per_1000,
}

const APIHOST_TYPE_COLORS: Record<ApihostVoiceType, { color: string; bg: string; border: string }> = {
  basic:    { color: '#34D399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)'  },
  standard: { color: '#60A5FA', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.3)'  },
  pro:      { color: '#A78BFA', bg: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.3)'  },
  studio:   { color: '#FBB04D', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)'  },
}

const APIHOST_TYPE_ICONS: Record<ApihostVoiceType, string> = {
  basic: '🟢', standard: '🔵', pro: '🟣', studio: '⭐',
}

function mapAudioError(raw: string, t: (k: string) => string): { headline: string; detail: string | null } {
  if (/maintenance_mode|HTTP 503|Service Unavailable/i.test(raw)) {
    return { headline: t('step3.err_provider_maintenance'), detail: raw }
  }
  if (/HTTP \d{3}|Voicer|Error:|failed:|is empty|sync-only/i.test(raw) && !/[А-Яа-яЁё]/u.test(raw)) {
    return { headline: t('step3.err_provider_generic'), detail: raw }
  }
  return { headline: raw, detail: null }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function VoiceDropdown({
  value, voices, loading: voicesLoading, genderFilter, onChange, onPreview, previewingId,
}: {
  value: string; voices: ApiVoice[]; loading: boolean; genderFilter: 'all' | 'M' | 'F'
  onChange: (id: string) => void; onPreview: (id: string) => void; previewingId: string | null
}) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selected = voices.find((v) => v.voice_id === value)
  const filtered = voices.filter((v) => {
    const matchGender = genderFilter === 'all' || v.gender === genderFilter || v.gender === null
    const q = search.toLowerCase()
    const matchSearch = !q || v.name.toLowerCase().includes(q) ||
      (v.description ?? '').toLowerCase().includes(q) || (v.accent ?? '').toLowerCase().includes(q)
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
      <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
        style={gender === 'F' ? { background: 'rgba(236,72,153,0.15)', color: '#F472B6' } : { background: 'rgba(59,130,246,0.15)', color: '#60A5FA' }}>
        {gender === 'F' ? 'Ж' : 'М'}
      </span>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F8FAFC' }}>
        {voicesLoading ? (
          <span className="text-slate-500 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {t('step3.voices_loading')}
          </span>
        ) : selected ? (
          <span className="flex items-center gap-2 min-w-0">
            {genderBadge(selected.gender)}
            <span className="font-medium truncate text-slate-200">{selected.name}</span>
            {selected.accent && <span className="text-slate-500 text-xs">{selected.accent}</span>}
            {selected.description && <span className="text-slate-500 text-xs truncate">— {selected.description}</span>}
          </span>
        ) : (
          <span className="text-slate-500">{t('step3.select_voice')}</span>
        )}
        <svg className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ml-2 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl overflow-hidden"
          style={{ background: '#13131A', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}>
          <div className="p-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={`${t('step3.select_voice')} (${voices.length})`} autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500 text-center">{t('step3.no_voices')}</p>
            ) : filtered.map((voice) => {
              const isPreviewing = previewingId === voice.voice_id
              const isSelected = voice.voice_id === value
              return (
                <div key={voice.voice_id} className="flex items-center justify-between px-3 py-2 transition-colors"
                  style={isSelected ? { background: 'rgba(124,58,237,0.12)' } : {}}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = '' }}>
                  <button type="button" onClick={() => { onChange(voice.voice_id); setOpen(false); setSearch('') }}
                    className="flex items-center gap-2 flex-1 text-left min-w-0">
                    {genderBadge(voice.gender)}
                    <span className={`text-sm font-medium shrink-0 ${isSelected ? 'text-violet-400' : 'text-slate-200'}`}>{voice.name}</span>
                    {voice.accent && <span className="text-xs text-slate-500 shrink-0">{voice.accent}</span>}
                    {voice.description && <span className="text-xs text-slate-600 truncate">— {voice.description}</span>}
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); onPreview(voice.voice_id) }}
                    disabled={isPreviewing} title={t('step3.play')}
                    className="shrink-0 ml-2 p-1.5 rounded-lg transition-colors disabled:opacity-40"
                    style={{ color: '#475569' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#A78BFA'; e.currentTarget.style.background = 'rgba(124,58,237,0.12)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.background = '' }}>
                    {isPreviewing ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
          {!voicesLoading && (
            <div className="px-4 py-2 text-xs text-slate-600 text-right"
              style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
              {filtered.length} / {voices.length}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ApihostVoiceDropdown({
  value, voices, loading, langFilter, typeFilter, genderFilter, noPreviewIds, onChange, onPreview, previewingId,
}: {
  value: string; voices: ApihostVoice[]; loading: boolean
  langFilter: string; typeFilter: ApihostVoiceType | 'all'
  genderFilter: 'all' | 'male' | 'female'
  noPreviewIds: Set<string>
  onChange: (voice: ApihostVoice) => void
  onPreview: (e: React.MouseEvent, voice: ApihostVoice) => void
  previewingId: string | null
}) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selected = voices.find((v) => v.voice_id === value)
  const filtered = voices.filter((v) => {
    const matchLang = !langFilter || v.lang.toLowerCase().startsWith(langFilter.toLowerCase())
    const matchType = typeFilter === 'all' || v.voice_type === typeFilter
    const matchGender = genderFilter === 'all' || v.gender === genderFilter || v.gender === null
    const q = search.toLowerCase()
    const matchSearch = !q || v.name.toLowerCase().includes(q)
    return matchLang && matchType && matchGender && matchSearch
  })

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const typeBadge = (vt: ApihostVoiceType) => {
    const c = APIHOST_TYPE_COLORS[vt]
    return (
      <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: c.bg, color: c.color }}>
        {APIHOST_TYPE_ICONS[vt]} {t(`apihost.${vt}` as const)}
      </span>
    )
  }

  const genderBadge = (gender: 'male' | 'female' | null) => {
    if (!gender) return null
    return (
      <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
        style={gender === 'female' ? { background: 'rgba(236,72,153,0.15)', color: '#F472B6' } : { background: 'rgba(59,130,246,0.15)', color: '#60A5FA' }}>
        {gender === 'female' ? 'Ж' : 'М'}
      </span>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F8FAFC' }}>
        {loading ? (
          <span className="text-slate-500 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {t('step3.voices_loading')}
          </span>
        ) : selected ? (
          <span className="flex items-center gap-2 min-w-0 flex-wrap">
            {typeBadge(selected.voice_type)}
            {genderBadge(selected.gender)}
            <span className="font-medium text-slate-200">{selected.name}</span>
            <span className="text-slate-500 text-xs">{selected.lang}</span>
          </span>
        ) : (
          <span className="text-slate-500">{t('step3.select_voice')}</span>
        )}
        <svg className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ml-2 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl overflow-hidden"
          style={{ background: '#13131A', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}>
          <div className="p-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={`${t('step3.select_voice')} (${filtered.length})`} autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500 text-center">{t('step3.no_voices')}</p>
            ) : filtered.map((voice) => {
              const isSelected = voice.voice_id === value
              const isPreviewing = previewingId === voice.voice_id
              const c = APIHOST_TYPE_COLORS[voice.voice_type]
              return (
                <div key={voice.voice_id}
                  className="flex items-center justify-between px-3 py-2 transition-colors"
                  style={isSelected ? { background: 'rgba(124,58,237,0.12)' } : {}}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = '' }}>
                  <button type="button" onClick={() => { onChange(voice); setOpen(false); setSearch('') }}
                    className="flex items-center gap-2 flex-1 text-left min-w-0">
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: c.bg, color: c.color }}>
                      {APIHOST_TYPE_ICONS[voice.voice_type]}
                    </span>
                    {genderBadge(voice.gender)}
                    <span className={`text-sm font-medium shrink-0 ${isSelected ? 'text-violet-400' : 'text-slate-200'}`}>{voice.name}</span>
                    <span className="text-xs text-slate-600 truncate">{voice.lang}</span>
                  </button>
                  {!noPreviewIds.has(voice.voice_id) && (
                    <button type="button" onClick={(e) => onPreview(e, voice)}
                      disabled={isPreviewing}
                      title={t('apihost.preview_title')}
                      className="shrink-0 ml-2 p-1.5 rounded-lg transition-colors disabled:opacity-40"
                      style={{ color: '#475569' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#A78BFA'; e.currentTarget.style.background = 'rgba(124,58,237,0.12)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.background = '' }}>
                      {isPreviewing ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      )}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="px-4 py-2 text-xs text-slate-600 text-right"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
            {filtered.length} / {voices.length}
          </div>
        </div>
      )}
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, leftLabel, rightLabel, format }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; leftLabel?: string; rightLabel?: string; format?: (v: number) => string
}) {
  const display = format ? format(value) : `${Math.round(value * 100)}%`
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-sm font-medium text-slate-300">{label}</p>
        <span className="text-sm text-violet-400">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-xs text-slate-600 mt-1">
          <span>{leftLabel}</span><span>{rightLabel}</span>
        </div>
      )}
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div>
        <p className="text-sm font-medium text-slate-300">{label}</p>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0"
        style={{ background: checked ? '#7C3AED' : 'rgba(255,255,255,0.1)' }}>
        <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(24px)' : 'translateX(4px)' }} />
      </button>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Step3Voice() {
  const { script, projectId, voiceSettings, audioUrl, subtitleBlocks, ownScript, scriptParams, setVoiceSettings, setAudioUrl, setStep, setAudioCostEstimate } = useStudioStore()
  const { t } = useLang()

  const ENGINES: { id: AudioEngine; medal: string; name: string; quality: string; meta: string; costLabel: string; soon?: boolean; premiumOnly?: boolean }[] = [
    { id: 'secretvoicer', medal: '✨', name: 'Voice Standard',    quality: t('voice.sv_desc'),        meta: t('voice.sv_meta'),      costLabel: `${CREDIT_COSTS.audio_secretvoicer_per_1000} ${t('step3.cr_per_k')}` },
    { id: 'elevenlabs',   medal: '🥇', name: 'Voice Studio',     quality: t('voice.el_desc'),        meta: t('voice.el_meta'),      costLabel: `${CREDIT_COSTS.audio_elevenlabs_per_1000} ${t('step3.cr_per_k')}` },
    { id: 'voicer',       medal: '💎', name: 'Voice Pro',         quality: t('voice.el_desc'),        meta: t('voice.voicer_meta'), costLabel: `${CREDIT_COSTS.audio_voicer_per_1000} ${t('step3.cr_per_k')}`, premiumOnly: true },
    { id: 'openai',       medal: '🥈', name: 'Voice Plus',        quality: t('voice.openai_quality'), meta: t('voice.openai_meta'), costLabel: `${CREDIT_COSTS.audio_openai_per_1000} ${t('step3.cr_per_k')}` },
    { id: 'apihost',      medal: '🏠', name: 'Voice Lite',        quality: t('voice.apihost_quality'),meta: t('voice.apihost_meta'),costLabel: t('voice.apihost_cost') },
    { id: 'google',       medal: '🥉', name: 'Voice Global',      quality: t('voice.google_quality'), meta: t('voice.google_meta'), costLabel: `${CREDIT_COSTS.audio_google_per_1000} ${t('step3.cr_per_k')}`, soon: true },
  ]

  const OPENAI_VOICES = [
    { id: 'alloy',   label: 'Alloy',   desc: t('voice.alloy_desc')   },
    { id: 'echo',    label: 'Echo',    desc: t('voice.echo_desc')    },
    { id: 'fable',   label: 'Fable',   desc: t('voice.fable_desc')   },
    { id: 'onyx',    label: 'Onyx',    desc: t('voice.onyx_desc')    },
    { id: 'nova',    label: 'Nova',    desc: t('voice.nova_desc')    },
    { id: 'shimmer', label: 'Shimmer', desc: t('voice.shimmer_desc') },
  ]

  const VOICE_STYLES: { value: VoiceStyleType; label: string }[] = [
    { value: 'neutral',        label: t('voice.style_neutral')        },
    { value: 'conversational', label: t('voice.style_conversational') },
    { value: 'documentary',    label: t('voice.style_documentary')    },
    { value: 'emotional',      label: t('voice.style_emotional')      },
  ]

  const LANG_ALL = { value: '', label: t('step3.lang_all') }
  const EL_LANGUAGE_OPTIONS = [...EL_LANGUAGE_OPTIONS_BASE, LANG_ALL]
  const GOOGLE_LANGUAGE_OPTIONS = [...EL_LANGUAGE_OPTIONS_BASE, LANG_ALL]

  // Engine — default depends on plan: free → secretvoicer, paid → elevenlabs
  const [engine, setEngine] = useState<AudioEngine>('secretvoicer')
  const [planLoading, setPlanLoading] = useState(true)
  const [userPlan, setUserPlan] = useState<string>('free')
  const engineTouchedRef = useRef(false)

  // SecretVoicer voices
  const [svVoices, setSvVoices] = useState<ApiVoice[]>([])
  const [svVoicesLoading, setSvVoicesLoading] = useState(false)
  const [svVoicesError, setSvVoicesError] = useState('')
  const [svVoiceId, setSvVoiceId] = useState('')

  // ElevenLabs voices
  const [voices, setVoices] = useState<ApiVoice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [voicesError, setVoicesError] = useState('')
  const [voiceLanguage, setVoiceLanguage] = useState('ru')
  const [genderFilter, setGenderFilter] = useState<'all' | 'M' | 'F'>('all')
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  // OpenAI
  const [openaiVoice, setOpenaiVoice] = useState('nova')

  // Google
  const [googleVoices, setGoogleVoices] = useState<GoogleVoice[]>([])
  const [googleVoice, setGoogleVoice] = useState('')
  const [googleVoicesLoading, setGoogleVoicesLoading] = useState(false)
  const [googleVoicesError, setGoogleVoicesError] = useState('')
  const [googleLanguage, setGoogleLanguage] = useState('ru')

  // APIHOST
  const [apihostVoices, setApihostVoices] = useState<ApihostVoice[]>([])
  const [apihostVoicesLoading, setApihostVoicesLoading] = useState(false)
  const [apihostVoicesError, setApihostVoicesError] = useState('')
  const [apihostVoiceId, setApihostVoiceId] = useState('')
  const [apihostVoiceType, setApihostVoiceType] = useState<ApihostVoiceType>('standard')
  const [apihostLang, setApihostLang] = useState('ru-RU')
  const [apihostTypeFilter, setApihostTypeFilter] = useState<ApihostVoiceType | 'all'>('all')
  const [apihostGenderFilter, setApihostGenderFilter] = useState<'all' | 'male' | 'female'>('all')
  const [apihostSpeechRate, setApihostSpeechRate] = useState(1.0)
  const [apihostPitch, setApihostPitch] = useState(1.0)
  const [noPreviewIds, setNoPreviewIds] = useState<Set<string>>(() => new Set())
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  // Generation
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const audioFileRef = useRef<HTMLInputElement>(null)
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollTickRef  = useRef<(() => Promise<void>) | null>(null)

  // Generation polling state
  const [audioPolling, setAudioPolling] = useState(false)
  const [audioProgress, setAudioProgress] = useState<number | null>(null)
  const [audioJobStatus, setAudioJobStatus] = useState<string | null>(null)

  // Dynamic cost
  const scriptChars = script?.length ?? 0
  const cost = engine === 'apihost'
    ? audioCost(scriptChars, 'apihost', apihostVoiceType)
    : Math.max(1, audioCost(scriptChars, engine))

  // Sync to store so StepWizard panel shows the same value as the cost block here
  useEffect(() => {
    setAudioCostEstimate(scriptChars > 0 ? cost : null)
    return () => { setAudioCostEstimate(null) }
  }, [cost, scriptChars]) // eslint-disable-line react-hooks/exhaustive-deps

  // APIHOST voice-language mismatch detection.
  // Script is considered Russian if >15% of non-space chars are Cyrillic.
  const apihostSelectedVoice = engine === 'apihost'
    ? apihostVoices.find((v) => v.voice_id === apihostVoiceId) ?? null
    : null
  const scriptIsRu = engine === 'apihost' && !!script &&
    ((script.match(/[Ѐ-ӿ]/g) ?? []).length / Math.max(1, script.replace(/\s/g, '').length)) > 0.15
  const voiceIsRu = apihostSelectedVoice?.lang.toLowerCase().startsWith('ru') ?? false
  const apihostLangMismatch = !!apihostSelectedVoice && scriptIsRu !== voiceIsRu

  // Load SecretVoicer voices
  function loadSvVoices() {
    setSvVoicesLoading(true)
    setSvVoicesError('')
    fetch('/api/voices/secretvoicer?language=ru')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && Array.isArray(json.data?.voices)) {
          setSvVoices(json.data.voices as ApiVoice[])
          if (json.data.voices.length > 0 && !svVoiceId) setSvVoiceId(json.data.voices[0].voice_id)
        } else {
          setSvVoicesError(json.error ?? t('step3.voices_error'))
        }
      })
      .catch(() => setSvVoicesError(t('step3.voices_error')))
      .finally(() => setSvVoicesLoading(false))
  }

  // Load ElevenLabs voices
  function loadVoices(lang: string) {
    setVoicesLoading(true)
    setVoicesError('')
    setVoices([])
    const url = lang ? `/api/voices?language=${encodeURIComponent(lang)}` : '/api/voices'
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && Array.isArray(json.data?.voices)) {
          setVoices(json.data.voices as ApiVoice[])
          if (json.data.voices.length === 0) setVoicesError(t('step3.voices_error'))
        } else {
          setVoicesError(json.error ?? t('step3.voices_error'))
        }
      })
      .catch(() => setVoicesError(t('step3.voices_error')))
      .finally(() => setVoicesLoading(false))
  }

  // Load Google voices
  function loadGoogleVoices(lang: string) {
    setGoogleVoicesLoading(true)
    setGoogleVoicesError('')
    setGoogleVoices([])
    const url = lang ? `/api/voices/google?language=${encodeURIComponent(lang)}` : '/api/voices/google'
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && Array.isArray(json.data?.voices)) {
          setGoogleVoices(json.data.voices as GoogleVoice[])
          if (json.data.voices.length > 0 && !googleVoice) setGoogleVoice(json.data.voices[0].name)
        } else {
          setGoogleVoicesError(json.error ?? t('step3.voices_error'))
        }
      })
      .catch(() => setGoogleVoicesError(t('step3.voices_error')))
      .finally(() => setGoogleVoicesLoading(false))
  }

  // Load APIHOST voices
  function loadApihostVoices() {
    setApihostVoicesLoading(true)
    setApihostVoicesError('')
    fetch('/api/voices/apihost')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && Array.isArray(json.data?.voices)) {
          setApihostVoices(json.data.voices as ApihostVoice[])
          if (json.data.voices.length === 0) setApihostVoicesError(t('step3.voices_error'))
        } else {
          setApihostVoicesError(json.error ?? t('step3.voices_error'))
        }
      })
      .catch(() => setApihostVoicesError(t('step3.voices_error')))
      .finally(() => setApihostVoicesLoading(false))
  }

  useEffect(() => { loadSvVoices() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch plan to unlock premium engines (Voicer). SecretVoicer is default for all plans.
  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((json: { ok: boolean; plan?: string }) => {
        if (json.ok && json.plan) {
          setUserPlan(json.plan)
        }
      })
      .catch(() => {})
      .finally(() => setPlanLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (engine === 'secretvoicer' && svVoices.length === 0 && !svVoicesLoading) {
      loadSvVoices()
    }
    if ((engine === 'elevenlabs' || engine === 'voicer') && voices.length === 0 && !voicesLoading) {
      loadVoices(voiceLanguage)
    }
    if (engine === 'google' && googleVoices.length === 0 && !googleVoicesLoading) {
      loadGoogleVoices(googleLanguage)
    }
    if (engine === 'apihost' && apihostVoices.length === 0 && !apihostVoicesLoading) {
      loadApihostVoices()
    }
  }, [engine]) // eslint-disable-line react-hooks/exhaustive-deps

  function startAudioPolling(jobId: string) {
    setAudioPolling(true)
    setAudioProgress(null)
    setAudioJobStatus(null)
    const tick = async () => {
      try {
        const res = await fetch(`/api/generate/audio/status?job_id=${jobId}`)
        const json = await res.json() as {
          ok: boolean; status?: string; progress?: number | null
          result_url?: string | null; error?: string | null
        }
        if (!res.ok || !json.ok) return

        if (json.status && json.status !== 'completed' && json.status !== 'failed') {
          setAudioJobStatus(json.status)
        }
        // Only show progress percentage when the worker actually advances beyond 0
        if (typeof json.progress === 'number' && json.progress > 0) setAudioProgress(json.progress)

        if (json.status === 'completed' && json.result_url) {
          clearInterval(pollRef.current!); pollRef.current = null; pollTickRef.current = null
          setAudioPolling(false); setAudioProgress(null); setAudioJobStatus(null); setLoading(false)
          setAudioUrl(stampAudioUrl(json.result_url, Date.now())); void refreshCredits()
        } else if (json.status === 'failed') {
          clearInterval(pollRef.current!); pollRef.current = null; pollTickRef.current = null
          setAudioPolling(false); setAudioProgress(null); setAudioJobStatus(null); setLoading(false)
          setError(json.error ?? 'Ошибка синтеза')
        }
      } catch (_) {}
    }
    pollTickRef.current = tick
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => { void tick() }, 3000)
  }

  // Stop polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // Immediate tick when tab becomes visible — catches "finished in background"
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && pollTickRef.current) {
        void pollTickRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Resume polling after page reload if a job is still in-progress
  useEffect(() => {
    if (!projectId || audioUrl) return
    fetch(`/api/generate/audio/status?project_id=${projectId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; status?: string; job_id?: string; result_url?: string | null }) => {
        if (!json.ok) return
        if (json.status === 'completed' && json.result_url) {
          setAudioUrl(stampAudioUrl(json.result_url, Date.now()))
        } else if ((json.status === 'pending' || json.status === 'processing') && json.job_id) {
          setLoading(true)
          startAudioPolling(json.job_id)
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleELLanguageChange(lang: string) {
    setVoiceLanguage(lang)
    // If switching to a specific language, clear voice_id if the selected voice's
    // language doesn't match — prevents stale voice_id showing as "Select voice"
    // while still being used on Generate. (ElevenLabs is multilingual so no audio
    // quality impact, but the UI desync is confusing.)
    if (lang && voiceSettings.voiceId) {
      const currentVoice = voices.find((v) => v.voice_id === voiceSettings.voiceId)
      if (currentVoice?.language &&
          !currentVoice.language.toLowerCase().startsWith(lang.toLowerCase())) {
        setVoiceSettings({ voiceId: '' })
      }
    }
    loadVoices(lang)
  }

  function handleGoogleLanguageChange(lang: string) {
    setGoogleLanguage(lang)
    loadGoogleVoices(lang)
  }

  async function handleApihostPreview(e: React.MouseEvent, voice: ApihostVoice) {
    e.stopPropagation()
    if (!voice.preview_url) return
    if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null }
    if (previewingId === voice.voice_id) { setPreviewingId(null); return }
    setPreviewingId(voice.voice_id)
    try {
      const audio = new Audio(voice.preview_url)
      previewAudioRef.current = audio
      audio.onended = () => { setPreviewingId(null); previewAudioRef.current = null }
      audio.onerror = () => {
        setPreviewingId(null)
        previewAudioRef.current = null
        setNoPreviewIds((prev) => new Set(prev).add(voice.voice_id))
      }
      await audio.play()
    } catch (err) {
      console.warn('[apihost-preview]', err instanceof Error ? err.message : err)
      setPreviewingId(null)
    }
  }

  async function handlePreview(voiceId: string) {
    if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null }
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
    if (!projectId) { setUploadError(t('step3.err_project')); return }
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
      if (!uploadRes.ok) throw new Error(t('step3.err_upload'))
      setAudioUrl(stampAudioUrl(access_url, Date.now()))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('step3.err_upload'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }, [projectId, setAudioUrl])

  async function handleSvPreview(voiceId: string) {
    if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null }
    if (previewingId === voiceId) { setPreviewingId(null); return }
    const voice = svVoices.find((v) => v.voice_id === voiceId)
    if (!voice?.preview_url) { setPreviewingId(null); return }
    setPreviewingId(voiceId)
    try {
      const audio = new Audio(voice.preview_url)
      currentAudioRef.current = audio
      audio.onended = () => { setPreviewingId(null); currentAudioRef.current = null }
      audio.onerror = () => { setPreviewingId(null); currentAudioRef.current = null }
      await audio.play()
    } catch {
      setPreviewingId(null)
    }
  }

  async function handleGenerateAudio() {
    if (!script) return
    if (!confirmRegenIfCompleted(t('regen_confirm.message'))) return
    setError('')
    setLoading(true)
    try {
      const voiceIdToUse =
        engine === 'secretvoicer' ? svVoiceId :
        engine === 'openai' ? openaiVoice :
        engine === 'google' ? googleVoice :
        engine === 'apihost' ? apihostVoiceId :
        voiceSettings.voiceId

      const res = await fetch('/api/generate/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine,
          text: script,
          voice_id: voiceIdToUse,
          project_id: projectId,
          own_script: ownScript,
          script_lang: scriptParams.language,
          ...((engine === 'elevenlabs' || engine === 'secretvoicer' || engine === 'voicer') ? {
            stability: voiceSettings.stability,
            similarity_boost: voiceSettings.similarityBoost,
            speech_rate: voiceSettings.speechRate,
            voice_style: voiceSettings.style,
          } : {}),
          ...(engine === 'elevenlabs' ? {
            clarity_boost: voiceSettings.clarityBoost,
          } : {}),
          ...(engine === 'apihost' ? {
            apihost_voice_type: apihostVoiceType,
            apihost_lang: apihostLang,
            speech_rate: apihostSpeechRate,
            apihost_pitch: apihostPitch,
          } : {}),
        }),
      })
      if (!res.ok) {
        if (res.status === 504 || res.status === 524) {
          throw new Error('Синтез занял слишком долго. Попробуйте текст короче или другой движок.')
        }
        const errText = await res.text().catch(() => '')
        let errMsg: string | undefined
        try { errMsg = (JSON.parse(errText) as { error?: string }).error } catch { /* not JSON */ }
        throw new Error(errMsg || `Ошибка сервера (${res.status})`)
      }
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('step3.err_credits')); return }
        throw new Error(json.error)
      }
      if (json.job_id) {
        startAudioPolling(json.job_id as string)
        return
      }
      setAudioUrl(stampAudioUrl(json.data.audio_url, Date.now()))
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('step3.err_audio'))
    } finally {
      if (!pollRef.current) setLoading(false)
    }
  }

  const canGenerate = !loading && !uploading && !!script && (
    engine === 'secretvoicer' ? !!svVoiceId && !svVoicesLoading :
    engine === 'elevenlabs'   ? !!voiceSettings.voiceId && !voicesLoading :
    engine === 'voicer'       ? !!voiceSettings.voiceId && !voicesLoading :
    engine === 'openai'       ? !!openaiVoice :
    engine === 'apihost'      ? !!apihostVoiceId && !apihostVoicesLoading :
    !!googleVoice
  )

  // All engines are visible; premium-only ones (voicer) are locked (disabled) for free users
  const visibleEngines = ENGINES

  const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{t('step3.title')}</h2>
        <p className="text-sm text-slate-500">{t('step3.subtitle')}</p>
      </div>

      {/* Engine selection — 2×2 grid */}
      <div>
        <p className="text-sm font-medium text-slate-300 mb-2">{t('step3.engine')}</p>
        {planLoading ? (
          <div className="grid grid-cols-2 gap-2">
            {ENGINES.map((eng) => (
              <div key={eng.id} className="h-[72px] rounded-xl animate-pulse"
                style={{ background: 'rgba(255,255,255,0.04)', border: '2px solid rgba(255,255,255,0.06)' }} />
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-2">
          {visibleEngines.map((eng) => {
            const isPremiumLocked = !!eng.premiumOnly && userPlan === 'free'
            return (
            <button
              key={eng.id}
              type="button"
              onClick={() => { if (!eng.soon && !isPremiumLocked) { engineTouchedRef.current = true; setEngine(eng.id) } }}
              disabled={!!eng.soon || isPremiumLocked}
              className="relative flex flex-col gap-1 p-3 rounded-xl text-left transition-all disabled:cursor-not-allowed"
              style={eng.soon || isPremiumLocked
                ? { background: 'rgba(255,255,255,0.02)', border: '2px solid rgba(255,255,255,0.05)', opacity: isPremiumLocked ? 0.65 : 0.5 }
                : engine === eng.id
                ? { background: 'rgba(124,58,237,0.15)', border: '2px solid rgba(124,58,237,0.5)' }
                : { background: 'rgba(255,255,255,0.03)', border: '2px solid rgba(255,255,255,0.07)' }
              }
            >
              {eng.soon && (
                <span className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(255,255,255,0.08)', color: '#64748B' }}>
                  {t('step3.soon')}
                </span>
              )}
              {isPremiumLocked && (
                <span className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }}>
                  🔒 Платный
                </span>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-base">{eng.medal}</span>
                <span className={`text-xs font-bold ${engine === eng.id && !eng.soon && !isPremiumLocked ? 'text-violet-300' : 'text-slate-400'}`}>{eng.name}</span>
              </div>
              <p className="text-xs text-slate-500">{eng.quality}</p>
              <p className="text-xs text-slate-600">{eng.meta}</p>
              {!eng.soon && (
                <p className={`text-xs font-semibold mt-0.5 ${engine === eng.id && !isPremiumLocked ? 'text-violet-400' : 'text-slate-500'}`}>
                  {eng.costLabel}
                </p>
              )}
            </button>
            )
          })}
        </div>
        )}
      </div>

      {/* Dynamic cost display */}
      {scriptChars > 0 && engine !== 'apihost' && (
        <div className="rounded-xl px-4 py-3 flex items-center justify-between"
          style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
          <div className="flex items-center gap-2 text-sm">
            <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-slate-400">{t('step3.your_text')}</span>
            <span className="text-slate-200 font-medium">{scriptChars.toLocaleString()} {t('step3.chars')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">{t('step3.cost')}</span>
            <span className="text-sm font-bold text-violet-400">{cost} {t('nav.credits_suffix')}</span>
          </div>
        </div>
      )}

      {/* ── SecretVoicer voices ── */}
      {engine === 'secretvoicer' && (
        <>
          {svVoicesError && !svVoicesLoading && (
            <div className="flex items-start gap-3 rounded-xl px-4 py-3"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-red-400">{t('step3.voices_error')}</p>
                <p className="text-xs text-red-500/70 mt-0.5">{svVoicesError}</p>
              </div>
              <button type="button" onClick={loadSvVoices}
                className="shrink-0 text-xs text-red-400 hover:text-red-300 font-medium underline transition-colors">
                {t('step3.retry')}
              </button>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-300">{t('step3.voice')}</p>
              {svVoiceId && !svVoicesLoading && (
                <button type="button"
                  onClick={() => void handleSvPreview(svVoiceId)}
                  disabled={!!previewingId}
                  className="flex items-center gap-1.5 text-xs transition-colors disabled:opacity-40"
                  style={{ color: previewingId === svVoiceId ? '#A78BFA' : '#64748B' }}
                  onMouseEnter={(e) => { if (!previewingId) e.currentTarget.style.color = '#CBD5E1' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = previewingId === svVoiceId ? '#A78BFA' : '#64748B' }}
                >
                  {previewingId === svVoiceId ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  )}
                  {t('step3.listen')}
                </button>
              )}
            </div>
            <VoiceDropdown
              value={svVoiceId}
              voices={svVoices}
              loading={svVoicesLoading}
              genderFilter={genderFilter}
              onChange={setSvVoiceId}
              onPreview={handleSvPreview}
              previewingId={previewingId}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">{t('step3.voice_style')}</p>
            <div className="grid grid-cols-4 gap-2">
              {VOICE_STYLES.map((s) => (
                <button key={s.value} type="button" onClick={() => setVoiceSettings({ style: s.value })}
                  className="py-2 text-xs font-medium rounded-xl border-2 transition-all"
                  style={voiceSettings.style === s.value
                    ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
                    : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#64748B' }
                  }>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Slider label={t('step3.speed')} value={voiceSettings.speechRate} min={0.5} max={2.0} step={0.05}
              onChange={(v) => setVoiceSettings({ speechRate: v })} leftLabel={t('step3.slow')} rightLabel={t('step3.fast')}
              format={(v) => `${v.toFixed(2)}×`} />
            <Slider label={t('step3.stability')} value={voiceSettings.stability} min={0} max={1} step={0.05}
              onChange={(v) => setVoiceSettings({ stability: v })} leftLabel={t('step3.expressive')} rightLabel={t('step3.stable')} />
            <Slider label={t('step3.similarity')} value={voiceSettings.similarityBoost} min={0} max={1} step={0.05}
              onChange={(v) => setVoiceSettings({ similarityBoost: v })} leftLabel={t('step3.free')} rightLabel={t('step3.exact')} />
          </div>
        </>
      )}

      {/* ── ElevenLabs / Voicer (Premium) voices ── */}
      {(engine === 'elevenlabs' || engine === 'voicer') && (
        <>
          {engine === 'voicer' && (
            <div className="rounded-xl p-3 flex flex-col gap-1.5"
              style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
              <div className="flex items-center gap-2.5">
                <span className="text-base">💎</span>
                <p className="text-xs text-violet-300/90">Профессиональные голоса через премиум-сервер. Качество выше, стоимость ниже.</p>
              </div>
              <p className="text-xs text-violet-400/70 pl-7">⏱ Синтез занимает 2–4 минуты — не закрывайте вкладку.</p>
            </div>
          )}
          {voicesError && !voicesLoading && (
            <div className="flex items-start gap-3 rounded-xl px-4 py-3"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-red-400">{t('step3.voices_error')}</p>
                <p className="text-xs text-red-500/70 mt-0.5">{voicesError}</p>
              </div>
              <button type="button" onClick={() => loadVoices(voiceLanguage)}
                className="shrink-0 text-xs text-red-400 hover:text-red-300 font-medium underline transition-colors">
                {t('step3.retry')}
              </button>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">{t('step3.voice_lang')}</p>
            <div className="flex flex-wrap gap-2">
              {EL_LANGUAGE_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" onClick={() => handleELLanguageChange(opt.value)}
                  disabled={voicesLoading}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium border-2 transition-all disabled:opacity-50"
                  style={voiceLanguage === opt.value
                    ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
                    : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#64748B' }
                  }>
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

          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">{t('step3.gender')}</p>
            <div className="inline-flex rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              {(['all', 'F', 'M'] as const).map((g) => (
                <button key={g} type="button" onClick={() => setGenderFilter(g)}
                  className="px-4 py-2 text-sm font-medium transition-colors"
                  style={genderFilter === g ? { background: '#7C3AED', color: '#fff' } : { color: '#64748B' }}>
                  {g === 'all' ? t('step3.gender_all') : g === 'F' ? t('step3.gender_f') : t('step3.gender_m')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-300">
                {t('step3.voice')}{!voicesLoading && voices.length > 0 && <span className="ml-1 text-slate-600 font-normal">· {voices.length}</span>}
              </p>
              {voiceSettings.voiceId && !voicesLoading && (
                <button type="button"
                  onClick={() => void handlePreview(voiceSettings.voiceId)}
                  disabled={!!previewingId}
                  className="flex items-center gap-1.5 text-xs transition-colors disabled:opacity-40"
                  style={{ color: previewingId === voiceSettings.voiceId ? '#A78BFA' : '#64748B' }}
                  onMouseEnter={(e) => { if (!previewingId) e.currentTarget.style.color = '#CBD5E1' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = previewingId === voiceSettings.voiceId ? '#A78BFA' : '#64748B' }}
                >
                  {previewingId === voiceSettings.voiceId ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  )}
                  {t('step3.listen')}
                </button>
              )}
            </div>
            <VoiceDropdown
              value={voiceSettings.voiceId} voices={voices} loading={voicesLoading}
              genderFilter={genderFilter} onChange={(id) => setVoiceSettings({ voiceId: id })}
              onPreview={handlePreview} previewingId={previewingId} />
          </div>

          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">{t('step3.voice_style')}</p>
            <div className="grid grid-cols-4 gap-2">
              {VOICE_STYLES.map((s) => (
                <button key={s.value} type="button" onClick={() => setVoiceSettings({ style: s.value })}
                  className="py-2 text-xs font-medium rounded-xl border-2 transition-all"
                  style={voiceSettings.style === s.value
                    ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
                    : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#64748B' }
                  }>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Slider label={t('step3.speed')} value={voiceSettings.speechRate} min={0.5} max={2.0} step={0.05}
              onChange={(v) => setVoiceSettings({ speechRate: v })} leftLabel={t('step3.slow')} rightLabel={t('step3.fast')}
              format={(v) => `${v.toFixed(2)}×`} />
            <Slider label={t('step3.stability')} value={voiceSettings.stability} min={0} max={1} step={0.05}
              onChange={(v) => setVoiceSettings({ stability: v })} leftLabel={t('step3.expressive')} rightLabel={t('step3.stable')} />
            <Slider label={t('step3.similarity')} value={voiceSettings.similarityBoost} min={0} max={1} step={0.05}
              onChange={(v) => setVoiceSettings({ similarityBoost: v })} leftLabel={t('step3.free')} rightLabel={t('step3.exact')} />
          </div>

          {engine === 'elevenlabs' && (
            <div className="rounded-xl px-4 divide-y" style={{ border: '1px solid rgba(255,255,255,0.08)', '--divide-color': 'rgba(255,255,255,0.06)' } as React.CSSProperties}>
              <Toggle checked={voiceSettings.clarityBoost} onChange={(v) => setVoiceSettings({ clarityBoost: v })}
                label={t('step3.clarity')} hint={t('step3.clarity_hint')} />
            </div>
          )}
        </>
      )}

      {/* ── OpenAI voices ── */}
      {engine === 'openai' && (
        <div>
          <p className="text-sm font-medium text-slate-300 mb-2">{t('step3.voice')}</p>
          <div className="grid grid-cols-3 gap-2">
            {OPENAI_VOICES.map((v) => (
              <button key={v.id} type="button" onClick={() => setOpenaiVoice(v.id)}
                className="flex flex-col gap-0.5 p-3 rounded-xl text-left transition-all"
                style={openaiVoice === v.id
                  ? { background: 'rgba(124,58,237,0.15)', border: '2px solid rgba(124,58,237,0.5)' }
                  : { background: 'rgba(255,255,255,0.03)', border: '2px solid rgba(255,255,255,0.07)' }
                }>
                <span className={`text-sm font-semibold ${openaiVoice === v.id ? 'text-violet-300' : 'text-slate-200'}`}>{v.label}</span>
                <span className="text-xs text-slate-500">{v.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── APIHOST voices ── */}
      {engine === 'apihost' && (
        <div className="flex flex-col gap-4">
          {/* Info block */}
          <div className="rounded-xl p-4 flex flex-col gap-2.5"
            style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)' }}>
            <p className="text-xs font-semibold text-blue-400">{t('apihost.info_title')}</p>
            <div className="flex flex-col gap-1.5">
              {(['basic', 'standard', 'pro', 'studio'] as const).map((vt) => (
                <div key={vt} className="flex items-center gap-2">
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
                    style={{ background: APIHOST_TYPE_COLORS[vt].bg, color: APIHOST_TYPE_COLORS[vt].color }}>
                    {APIHOST_TYPE_ICONS[vt]} {t(`apihost.${vt}` as const)}
                  </span>
                  <span className="text-xs text-slate-500">—</span>
                  <span className="text-xs text-slate-400">
                    {APIHOST_RATE[vt]} {t('step3.cr_per_k')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Language filter */}
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">{t('apihost.lang_label')}</p>
            <div className="flex flex-wrap gap-2">
              {APIHOST_LANG_OPTIONS.map((opt) => (
                <button key={opt.value} type="button"
                  onClick={() => {
                    setApihostLang(opt.value)
                    // If the current voice won't appear under the new filter, clear it so
                    // the UI doesn't show "Select voice" while a stale voice_id is still set.
                    const notInNewFilter = apihostVoiceId && !apihostVoices.some(
                      (v) => v.voice_id === apihostVoiceId && v.lang.toLowerCase().startsWith(opt.value.toLowerCase())
                    )
                    if (notInNewFilter) setApihostVoiceId('')
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium border-2 transition-all"
                  style={apihostLang === opt.value
                    ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
                    : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#64748B' }
                  }>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Voice type filter */}
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">{t('apihost.type_filter')}</p>
            <div className="flex flex-wrap gap-2">
              {(['all', 'basic', 'standard', 'pro'] as const).map((vt) => {
                const isAll = vt === 'all'
                const active = apihostTypeFilter === vt
                const c = isAll ? null : APIHOST_TYPE_COLORS[vt]
                return (
                  <button key={vt} type="button" onClick={() => setApihostTypeFilter(vt)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold border-2 transition-all flex items-center gap-1"
                    style={active
                      ? { borderColor: c?.border ?? '#7C3AED', background: c?.bg ?? 'rgba(124,58,237,0.12)', color: c?.color ?? '#A78BFA' }
                      : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#64748B' }
                    }>
                    {!isAll && <span>{APIHOST_TYPE_ICONS[vt]}</span>}
                    {isAll ? t('apihost.all_types') : t(`apihost.${vt}` as const)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Gender filter */}
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">{t('step3.gender')}</p>
            <div className="inline-flex rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              {(['all', 'female', 'male'] as const).map((g) => (
                <button key={g} type="button" onClick={() => setApihostGenderFilter(g)}
                  className="px-4 py-2 text-sm font-medium transition-colors"
                  style={apihostGenderFilter === g ? { background: '#7C3AED', color: '#fff' } : { color: '#64748B' }}>
                  {g === 'all' ? t('step3.gender_all') : g === 'female' ? t('step3.gender_f') : t('step3.gender_m')}
                </button>
              ))}
            </div>
          </div>

          {/* Voices error */}
          {apihostVoicesError && !apihostVoicesLoading && (
            <div className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-xs text-red-400">{apihostVoicesError}</p>
              <button type="button" onClick={loadApihostVoices}
                className="text-xs text-red-400 hover:text-red-300 font-medium underline ml-2">{t('step3.retry')}</button>
            </div>
          )}

          {/* Voice dropdown */}
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">
              {t('step3.voice')}
              {!apihostVoicesLoading && apihostVoices.length > 0 && (
                <span className="ml-1 text-slate-600 font-normal">· {apihostVoices.length}</span>
              )}
            </p>
            <ApihostVoiceDropdown
              value={apihostVoiceId}
              voices={apihostVoices}
              loading={apihostVoicesLoading}
              langFilter={apihostLang}
              typeFilter={apihostTypeFilter}
              genderFilter={apihostGenderFilter}
              noPreviewIds={noPreviewIds}
              onChange={(v) => {
                setApihostVoiceId(v.voice_id)
                setApihostVoiceType(v.voice_type)
                setApihostLang(v.lang)
              }}
              onPreview={handleApihostPreview}
              previewingId={previewingId}
            />
          </div>

          {/* Speed & pitch sliders */}
          <div className="flex flex-col gap-4">
            <Slider label={t('step3.speed')} value={apihostSpeechRate} min={0.5} max={2.0} step={0.05}
              onChange={(v) => setApihostSpeechRate(v)} leftLabel={t('step3.slow')} rightLabel={t('step3.fast')}
              format={(v) => `${v.toFixed(2)}×`} />
            <Slider label={t('apihost.pitch')} value={apihostPitch} min={0.5} max={2.0} step={0.05}
              onChange={(v) => setApihostPitch(v)} leftLabel={t('apihost.pitch_low')} rightLabel={t('apihost.pitch_high')}
              format={(v) => `${v.toFixed(2)}×`} />
          </div>

          {/* Voice cost note */}
          <div className="rounded-xl px-4 py-3 text-xs text-slate-500"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            ℹ️ {t('apihost.voice_cost_note')}
          </div>
        </div>
      )}

      {/* ── Google voices ── */}
      {engine === 'google' && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">{t('step3.voice_lang')}</p>
            <div className="flex flex-wrap gap-2">
              {GOOGLE_LANGUAGE_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" onClick={() => handleGoogleLanguageChange(opt.value)}
                  disabled={googleVoicesLoading}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium border-2 transition-all disabled:opacity-50"
                  style={googleLanguage === opt.value
                    ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }
                    : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#64748B' }
                  }>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {googleVoicesError && (
            <div className="rounded-xl px-4 py-3 text-xs text-red-400"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              {googleVoicesError}
              <button type="button" onClick={() => loadGoogleVoices(googleLanguage)} className="ml-2 underline">{t('step3.retry')}</button>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">
              {t('step3.voice')}{!googleVoicesLoading && googleVoices.length > 0 && <span className="ml-1 text-slate-600 font-normal">· {googleVoices.length}</span>}
            </p>
            {googleVoicesLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
                <svg className="w-4 h-4 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t('step3.voices_loading')}
              </div>
            ) : (
              <select
                value={googleVoice}
                onChange={(e) => setGoogleVoice(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F8FAFC' }}
              >
                {googleVoices.length === 0 ? (
                  <option value="" disabled>{t('step3.no_voices')}</option>
                ) : (
                  googleVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} {v.isWavenet ? '(WaveNet)' : ''} {v.gender === 'F' ? '· Ж' : v.gender === 'M' ? '· М' : ''}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>

          <div className="rounded-xl px-4 py-3" style={cardStyle}>
            <p className="text-xs text-slate-500">
              Google WaveNet — {t('voice.google_quality')}. Standard — base voices. {CREDIT_COSTS.audio_google_per_1000} {t('step3.cr_per_k')}.
            </p>
          </div>
        </div>
      )}

      {/* Voice-language mismatch warning (APIHOST only) */}
      {apihostLangMismatch && apihostSelectedVoice && (
        <div className="rounded-xl px-4 py-3 flex flex-col gap-2"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <p className="text-xs font-semibold text-amber-400">
            ⚠️ Несоответствие языка голоса и текста
          </p>
          <p className="text-xs text-amber-300/80">
            Голос <span className="font-medium text-amber-300">{apihostSelectedVoice.name}</span>{' '}
            ({apihostSelectedVoice.lang}) выбран для{' '}
            {voiceIsRu ? 'русского' : 'другого'} языка, но сценарий{' '}
            {scriptIsRu ? 'на русском' : 'не на русском'}.{' '}
            Озвучка может звучать некорректно.
          </p>
          <button
            type="button"
            onClick={() => {
              const targetLang = scriptIsRu ? 'ru-RU' : apihostSelectedVoice.lang
              setApihostLang(targetLang)
              setApihostVoiceId('')
            }}
            className="self-start text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: 'rgba(245,158,11,0.15)', color: '#FBB04D', border: '1px solid rgba(245,158,11,0.4)' }}>
            {scriptIsRu ? '🇷🇺 Выбрать русский голос' : '🌐 Выбрать подходящий голос'}
          </button>
        </div>
      )}

      {/* Subtitle staleness warning */}
      {subtitleBlocks.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl px-4 py-3"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-xs text-amber-400/90">{t('voice.subs_exist_warning')}</p>
        </div>
      )}

      {/* Generate button */}
      <button
        type="button"
        onClick={handleGenerateAudio}
        disabled={!canGenerate}
        className="w-full py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {engine === 'secretvoicer'
              ? `${t('voice.sv_synthesizing')} — ${scriptChars.toLocaleString()} ${t('step3.chars')}`
              : engine === 'voicer'
              ? `${t('voice.sv_synthesizing')} — ${scriptChars.toLocaleString()} ${t('step3.chars')}`
              : t('step3.generating')}
          </>
        ) : audioUrl ? (
          `↺ ${t('step2.regenerate')} · −${cost} ${t('nav.credits_suffix')}`
        ) : (
          `🎙 ${t('step3.generate_btn')} · −${cost} ${t('nav.credits_suffix')}`
        )}
      </button>

      {audioPolling && (
        <div className="flex flex-col items-center gap-0.5 -mt-2">
          <p className="text-xs text-violet-400/80 text-center">
            {audioProgress !== null && audioProgress > 0
              ? `${t('voice.sv_processing')} — ${audioProgress}%`
              : audioJobStatus === 'pending'
              ? t('voice.sv_queue')
              : t('voice.sv_processing')}
          </p>
          <p className="text-xs text-slate-500 text-center">{t('voice.sv_background_ok')}</p>
        </div>
      )}

      {/* APIHOST dynamic cost breakdown */}
      {engine === 'apihost' && scriptChars > 0 && (
        <p className="text-xs text-slate-500 text-center -mt-2">
          {(() => {
            const rate = APIHOST_RATE[apihostVoiceType]
            const voiceName = apihostVoiceId
              ? (apihostVoices.find((v) => v.voice_id === apihostVoiceId)?.name ?? '?')
              : null
            return [
              `${t('step3.your_text')} ${scriptChars.toLocaleString()} ${t('step3.chars')}`,
              voiceName ? `${t('step3.voice')}: ${voiceName} (${t(`apihost.${apihostVoiceType}` as const)})` : null,
              `${t('step3.cost')} ${cost} ${t('nav.credits_suffix')} (${rate} ${t('step3.cr_per_k')}, ${t('apihost.min_note')})`,
            ].filter(Boolean).join(' · ')
          })()}
        </p>
      )}

      {/* Upload / skip */}
      {!loading && (
        <div className="flex gap-2">
          <button type="button" onClick={() => audioFileRef.current?.click()} disabled={uploading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-slate-400 text-xs font-medium rounded-xl hover:text-slate-200 disabled:opacity-50 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
            {uploading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t('step3.uploading')}
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {t('step3.upload_audio')}
              </>
            )}
          </button>
          <button type="button" onClick={() => setStep(5)}
            className="flex items-center gap-1 py-2 px-3 text-slate-500 text-xs font-medium rounded-xl hover:text-slate-300 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            {t('step3.skip')}
          </button>
          <input ref={audioFileRef} type="file" accept="audio/mpeg,audio/wav,audio/mp3,.mp3,.wav"
            className="hidden" onChange={handleAudioUpload} />
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-red-400 rounded-xl px-3 py-2"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.15)' }}>
          {uploadError}
        </p>
      )}

      {error && (() => {
        const { headline, detail } = mapAudioError(error, t)
        return (
          <div
            className="flex flex-col gap-1.5 rounded-xl px-4 py-3"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <p className="text-sm text-red-400">{headline}</p>
            {detail && <p className="text-xs text-red-700/60 font-mono break-all">{detail}</p>}
          </div>
        )
      })()}

      {/* Audio result */}
      {audioUrl && (
        <div className="rounded-xl p-4 flex flex-col gap-3"
          style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)' }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-200">{t('step3.uploaded')}</p>
            <a href={audioUrl} download="audio.mp3" target="_blank" rel="noopener noreferrer"
              className="text-xs text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {t('step6.download_mp3')}
            </a>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} className="w-full" />
        </div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={() => setStep(3)} className="px-5 py-3 btn-ghost-dark font-medium rounded-xl text-sm">
          {t('step3.back')}
        </button>
        <button type="button" onClick={() => setStep(5)} disabled={!audioUrl}
          className="flex-1 py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-40">
          {t('step3.next')}
        </button>
      </div>
    </div>
  )
}
