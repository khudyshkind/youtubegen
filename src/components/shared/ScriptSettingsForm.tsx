'use client'

import { useRef, useEffect, useState } from 'react'
import { useLang } from '@/hooks/useLang'
import { SCRIPT_LANGUAGES } from '@/lib/languages'
import { CREDIT_COSTS } from '@/lib/types'
import type { ScriptLanguage, ScriptModel, NarrativeStyle, ToneType, AudienceType, HookType } from '@/lib/types'

// ─── Sub-components (exported so Step1Topic can tree-shake them) ────────────

export function LanguageSelect({ value, onChange }: { value: ScriptLanguage; onChange: (v: ScriptLanguage) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const selected = SCRIPT_LANGUAGES.find(l => l.code === value)!
  const filtered = SCRIPT_LANGUAGES.filter(l => l.name.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F8FAFC' }}
      >
        <span>{selected.flag} {selected.name}</span>
        <svg className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl overflow-hidden" style={{ background: '#13131A', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}>
          <div className="p-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍" autoFocus />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map(lang => (
              <button
                key={lang.code}
                type="button"
                onClick={() => { onChange(lang.code); setOpen(false); setSearch('') }}
                className="w-full text-left px-4 py-2 text-sm transition-colors"
                style={lang.code === value ? { background: 'rgba(124,58,237,0.2)', color: '#A78BFA' } : { color: '#CBD5E1' }}
                onMouseEnter={e => { if (lang.code !== value) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                onMouseLeave={e => { if (lang.code !== value) e.currentTarget.style.background = '' }}
              >
                {lang.flag} {lang.name}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-4 py-3 text-sm text-slate-500 text-center">—</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-2">
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
        <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform" style={{ transform: checked ? 'translateX(24px)' : 'translateX(4px)' }} />
      </button>
    </div>
  )
}

export function SelectRow<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value as T)} className="w-full px-4 py-2.5 rounded-xl text-sm">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="py-2 px-2 rounded-xl border-2 text-xs font-medium transition-all"
      style={selected
        ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.15)', color: '#A78BFA' }
        : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#64748B' }
      }
    >
      {children}
    </button>
  )
}

// ─── Settings shape ────────────────────────────────────────────────────────────

export interface ScriptSettings {
  language: ScriptLanguage
  duration_minutes: number
  model: ScriptModel
  narrative_style: NarrativeStyle
  tone: ToneType
  target_audience: AudienceType
  hook: boolean
  hook_type: HookType
  cta: boolean
  scene_markers: boolean
  pauses: boolean
}

export const DEFAULT_SCRIPT_SETTINGS: ScriptSettings = {
  language: 'ru',
  duration_minutes: 5,
  model: 'claude-sonnet',
  narrative_style: 'storytelling',
  tone: 'neutral',
  target_audience: 'wide',
  hook: true,
  hook_type: 'question',
  cta: true,
  scene_markers: false,
  pauses: false,
}

const MODELS_BASE: { value: ScriptModel; key: 'standard' | 'enhanced' | 'alternative'; credits: number }[] = [
  { value: 'claude-sonnet', key: 'standard',    credits: CREDIT_COSTS.script_sonnet },
  { value: 'claude-opus',   key: 'enhanced',    credits: CREDIT_COSTS.script_opus   },
  { value: 'gpt-4o',        key: 'alternative', credits: CREDIT_COSTS.script_gpt    },
]

const DURATION_OPTIONS = [1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 50, 60, 70]

// ─── Main form ─────────────────────────────────────────────────────────────────

interface ScriptSettingsFormProps {
  value: ScriptSettings
  onChange: (patch: Partial<ScriptSettings>) => void
}

export default function ScriptSettingsForm({ value, onChange }: ScriptSettingsFormProps) {
  const { t } = useLang()

  const MODELS = MODELS_BASE.map(m => ({
    ...m,
    label: t(`model.${m.key}` as const),
    desc: t(`model.${m.key}_desc` as const),
  }))

  const NARRATIVE_STYLES: { value: NarrativeStyle; label: string }[] = [
    { value: 'storytelling',   label: t('style.storytelling')   },
    { value: 'science',        label: t('style.science')        },
    { value: 'documentary',    label: t('style.documentary')    },
    { value: 'conversational', label: t('style.conversational') },
    { value: 'children',       label: t('style.children')       },
  ]

  const TONES: { value: ToneType; label: string }[] = [
    { value: 'neutral',   label: t('tone.neutral')   },
    { value: 'emotional', label: t('tone.emotional') },
    { value: 'humorous',  label: t('tone.humorous')  },
    { value: 'dramatic',  label: t('tone.dramatic')  },
    { value: 'inspiring', label: t('tone.inspiring') },
  ]

  const AUDIENCES: { value: AudienceType; label: string }[] = [
    { value: 'children', label: t('audience.children') },
    { value: 'teens',    label: t('audience.teens')    },
    { value: 'wide',     label: t('audience.wide')     },
    { value: 'adults',   label: t('audience.adults')   },
  ]

  const HOOK_TYPES: { value: HookType; label: string }[] = [
    { value: 'question',    label: t('hook.question')    },
    { value: 'statistic',   label: t('hook.statistic')   },
    { value: 'story',       label: t('hook.story')       },
    { value: 'provocation', label: t('hook.provocation') },
  ]

  const selectedModel = MODELS.find(m => m.value === value.model)!

  return (
    <div className="flex flex-col gap-5">
      {/* Language + Duration */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1.5">{t('step1.language')}</label>
          <LanguageSelect value={value.language} onChange={v => onChange({ language: v })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1.5">{t('step1.duration')}</label>
          <select
            value={value.duration_minutes}
            onChange={e => onChange({ duration_minutes: Number(e.target.value) })}
            className="w-full px-4 py-2.5 rounded-xl text-sm"
          >
            {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} {t('step1.min')}</option>)}
          </select>
        </div>
      </div>

      {/* Model */}
      <div>
        <label className="block text-sm font-medium text-slate-400 mb-2">{t('step1.quality')}</label>
        <div className="grid grid-cols-3 gap-2">
          {MODELS.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => onChange({ model: m.value })}
              className="text-left px-3 py-3 rounded-xl transition-all"
              style={value.model === m.value
                ? { border: '2px solid #7C3AED', background: 'rgba(124,58,237,0.1)' }
                : { border: '2px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }
              }
            >
              <p className="text-xs font-semibold text-slate-200 leading-tight">{m.label}</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-tight">{m.desc}</p>
              <p className={`text-xs font-bold mt-1 ${value.model === m.value ? 'text-violet-400' : 'text-slate-600'}`}>
                −{m.credits} {t('step1.credits_suffix')}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Style + Tone */}
      <div className="grid grid-cols-2 gap-4">
        <SelectRow label={t('step1.style')} value={value.narrative_style} options={NARRATIVE_STYLES} onChange={v => onChange({ narrative_style: v })} />
        <SelectRow label={t('step1.tone')} value={value.tone} options={TONES} onChange={v => onChange({ tone: v })} />
      </div>

      {/* Audience */}
      <div>
        <label className="block text-sm font-medium text-slate-400 mb-2">{t('step1.audience')}</label>
        <div className="grid grid-cols-4 gap-2">
          {AUDIENCES.map(a => (
            <Pill key={a.value} selected={value.target_audience === a.value} onClick={() => onChange({ target_audience: a.value })}>{a.label}</Pill>
          ))}
        </div>
      </div>

      {/* Toggles */}
      <div
        className="rounded-xl px-4 divide-y"
        style={{ border: '1px solid rgba(255,255,255,0.08)', '--divide-color': 'rgba(255,255,255,0.06)' } as React.CSSProperties}
      >
        <Toggle checked={value.hook} onChange={v => onChange({ hook: v })} label={t('step1.hook')} hint={t('step1.hook_hint')} />
        {value.hook && (
          <div className="py-2">
            <p className="text-xs font-medium text-slate-400 mb-1.5">{t('step1.hook_type')}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {HOOK_TYPES.map(h => (
                <button
                  key={h.value}
                  type="button"
                  onClick={() => onChange({ hook_type: h.value })}
                  className="py-1.5 text-xs rounded-lg border transition-all"
                  style={value.hook_type === h.value
                    ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.12)', color: '#A78BFA', fontWeight: 600 }
                    : { borderColor: 'rgba(255,255,255,0.08)', color: '#64748B' }
                  }
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <Toggle checked={value.cta} onChange={v => onChange({ cta: v })} label={t('step1.cta')} hint={t('step1.cta_hint')} />
        <Toggle checked={value.scene_markers} onChange={v => onChange({ scene_markers: v })} label={t('step1.scene_markers')} hint={t('step1.scene_hint')} />
        <Toggle checked={value.pauses} onChange={v => onChange({ pauses: v })} label={t('step1.pauses')} hint={t('step1.pauses_hint')} />
      </div>

      {/* Cost notice */}
      <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
        <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-slate-400">
          {t('step1.credits_label')} <strong className="text-violet-400">{selectedModel.credits} {t('step1.credits_suffix')}</strong>{' '}({selectedModel.label})
        </p>
      </div>
    </div>
  )
}
