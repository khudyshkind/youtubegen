'use client'

import { type FormEvent, useRef, useState, useEffect } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import type { ScriptLanguage, ScriptModel, NarrativeStyle, ToneType, AudienceType, HookType } from '@/lib/types'

// ─── Data ──────────────────────────────────────────────────────────────────────

const LANGUAGES: { code: ScriptLanguage; name: string; flag: string }[] = [
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'हिंदी', flag: '🇮🇳' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
  { code: 'no', name: 'Norsk', flag: '🇳🇴' },
  { code: 'da', name: 'Dansk', flag: '🇩🇰' },
  { code: 'fi', name: 'Suomi', flag: '🇫🇮' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'cs', name: 'Čeština', flag: '🇨🇿' },
  { code: 'ro', name: 'Română', flag: '🇷🇴' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { code: 'el', name: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'he', name: 'עברית', flag: '🇮🇱' },
  { code: 'th', name: 'ภาษาไทย', flag: '🇹🇭' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
]

const MODELS: { value: ScriptModel; label: string; desc: string; credits: number }[] = [
  { value: 'claude-sonnet', label: 'Claude Sonnet', desc: 'Баланс скорости и качества', credits: 10 },
  { value: 'claude-opus', label: 'Claude Opus', desc: 'Максимальное качество', credits: 20 },
  { value: 'gpt-4o', label: 'GPT-4o', desc: 'Альтернативный стиль', credits: 12 },
]

const NARRATIVE_STYLES: { value: NarrativeStyle; label: string }[] = [
  { value: 'storytelling', label: 'Сторителлинг' },
  { value: 'science', label: 'Научпоп' },
  { value: 'documentary', label: 'Документальный' },
  { value: 'conversational', label: 'Разговорный' },
  { value: 'children', label: 'Детский' },
]

const TONES: { value: ToneType; label: string }[] = [
  { value: 'neutral', label: 'Нейтральный' },
  { value: 'emotional', label: 'Эмоциональный' },
  { value: 'humorous', label: 'С юмором' },
  { value: 'dramatic', label: 'Драматичный' },
  { value: 'inspiring', label: 'Воодушевляющий' },
]

const AUDIENCES: { value: AudienceType; label: string }[] = [
  { value: 'children', label: 'Дети' },
  { value: 'teens', label: 'Подростки' },
  { value: 'wide', label: 'Широкая' },
  { value: 'adults', label: 'Взрослые' },
]

const HOOK_TYPES: { value: HookType; label: string }[] = [
  { value: 'question', label: 'Вопрос' },
  { value: 'statistic', label: 'Статистика' },
  { value: 'story', label: 'История' },
  { value: 'provocation', label: 'Провокация' },
]

const DURATION_OPTIONS = [1, 2, 3, 5, 7, 10, 15, 20]

// ─── Language dropdown ─────────────────────────────────────────────────────────

function LanguageSelect({
  value,
  onChange,
}: {
  value: ScriptLanguage
  onChange: (v: ScriptLanguage) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selected = LANGUAGES.find((l) => l.code === value)!
  const filtered = LANGUAGES.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase())
  )

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
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 bg-white hover:border-gray-400 transition-colors"
      >
        <span>
          {selected.flag} {selected.name}
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск языка..."
              className="w-full px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => { onChange(lang.code); setOpen(false); setSearch('') }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  lang.code === value
                    ? 'bg-red-50 text-red-600 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {lang.flag} {lang.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400 text-center">Не найдено</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Toggle ────────────────────────────────────────────────────────────────────

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
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-red-500' : 'bg-gray-200'
        }`}
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

// ─── Select row ────────────────────────────────────────────────────────────────

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Step1Topic() {
  const { scriptParams, setScriptParams, setStep, setProjectId, projectId } = useStudioStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedModel = MODELS.find((m) => m.value === scriptParams.model)!

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!scriptParams.topic.trim()) { setError('Введите тему видео'); return }

    if (projectId) { setStep(2); return }

    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: scriptParams.topic.trim(),
          duration_minutes: scriptParams.duration_minutes,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Ошибка создания проекта')
      setProjectId(json.data.project.id)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 1: Тема и параметры</h2>
        <p className="text-sm text-gray-500">Настройте видео перед генерацией сценария</p>
      </div>

      {/* Topic */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Тема видео <span className="text-red-500">*</span>
        </label>
        <textarea
          rows={3}
          required
          value={scriptParams.topic}
          onChange={(e) => setScriptParams({ topic: e.target.value })}
          placeholder="Например: Почему птиц не бьёт током на проводах"
          className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </div>

      {/* Language + Duration */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Язык</label>
          <LanguageSelect
            value={scriptParams.language}
            onChange={(v) => setScriptParams({ language: v })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Длительность</label>
          <select
            value={scriptParams.duration_minutes}
            onChange={(e) => setScriptParams({ duration_minutes: Number(e.target.value) })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d} value={d}>{d} мин</option>
            ))}
          </select>
        </div>
      </div>

      {/* AI Model */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Модель ИИ</label>
        <div className="grid grid-cols-3 gap-2">
          {MODELS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setScriptParams({ model: m.value })}
              className={`text-left px-3 py-3 rounded-xl border-2 transition-all ${
                scriptParams.model === m.value
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="text-xs font-semibold text-gray-900 leading-tight">{m.label}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-tight">{m.desc}</p>
              <p className={`text-xs font-bold mt-1 ${
                scriptParams.model === m.value ? 'text-red-500' : 'text-gray-500'
              }`}>
                −{m.credits} кр.
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Narrative style + Tone */}
      <div className="grid grid-cols-2 gap-4">
        <SelectRow
          label="Стиль повествования"
          value={scriptParams.narrative_style}
          options={NARRATIVE_STYLES}
          onChange={(v) => setScriptParams({ narrative_style: v })}
        />
        <SelectRow
          label="Тон"
          value={scriptParams.tone}
          options={TONES}
          onChange={(v) => setScriptParams({ tone: v })}
        />
      </div>

      {/* Target audience */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Целевая аудитория</label>
        <div className="grid grid-cols-4 gap-2">
          {AUDIENCES.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => setScriptParams({ target_audience: a.value })}
              className={`py-2 px-2 rounded-xl border-2 text-xs font-medium transition-all ${
                scriptParams.target_audience === a.value
                  ? 'border-red-400 bg-red-50 text-red-600'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toggles */}
      <div className="border border-gray-200 rounded-xl px-4 divide-y divide-gray-100">
        {/* Hook */}
        <Toggle
          checked={scriptParams.hook}
          onChange={(v) => setScriptParams({ hook: v })}
          label="Крюк в начале"
          hint="Захватывающее вступление чтобы удержать зрителя"
        />
        {scriptParams.hook && (
          <div className="py-2">
            <p className="text-xs font-medium text-gray-600 mb-1.5">Тип крюка</p>
            <div className="grid grid-cols-2 gap-1.5">
              {HOOK_TYPES.map((h) => (
                <button
                  key={h.value}
                  type="button"
                  onClick={() => setScriptParams({ hook_type: h.value })}
                  className={`py-1.5 text-xs rounded-lg border transition-all ${
                    scriptParams.hook_type === h.value
                      ? 'border-red-400 bg-red-50 text-red-600 font-medium'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <Toggle
          checked={scriptParams.cta}
          onChange={(v) => setScriptParams({ cta: v })}
          label="Призыв к действию"
          hint="Подписаться, поставить лайк, написать комментарий"
        />
        <Toggle
          checked={scriptParams.scene_markers}
          onChange={(v) => setScriptParams({ scene_markers: v })}
          label="Метки сцен"
          hint="[СЦЕНА 1], [СЦЕНА 2]... для удобства монтажа"
        />
        <Toggle
          checked={scriptParams.pauses}
          onChange={(v) => setScriptParams({ pauses: v })}
          label="Паузы между абзацами"
          hint="[ПАУЗА] — ориентир для диктора"
        />
      </div>

      {/* Cost notice */}
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-amber-700">
          Генерация сценария: <strong>{selectedModel.credits} кредитов</strong> ({selectedModel.label})
        </p>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

      <button
        type="submit"
        disabled={loading || !scriptParams.topic.trim()}
        className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-semibold rounded-xl text-sm transition-colors"
      >
        {loading ? 'Создание...' : 'Далее: Сценарий →'}
      </button>
    </form>
  )
}
