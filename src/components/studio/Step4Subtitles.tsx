'use client'

import { useRef, useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import type { SubtitleBlock, SubtitleFont, SubtitleSize, SubtitlePosition, SubtitleAnimation } from '@/lib/types'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec % 1) * 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

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
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
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

// ─── Chip selector ─────────────────────────────────────────────────────────────

function ChipSelector<T extends string>({
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
      <p className="text-sm font-medium text-gray-700 mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border-2 transition-all ${
              value === o.value
                ? 'border-red-400 bg-red-50 text-red-600'
                : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── SRT export ────────────────────────────────────────────────────────────────

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

// ─── SRT parser ────────────────────────────────────────────────────────────────

function parseSrt(text: string): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = []
  const entries = text.trim().split(/\n\s*\n/)
  for (const entry of entries) {
    const lines = entry.trim().split('\n')
    if (lines.length < 3) continue
    const timeLine = lines.find((l) => l.includes('-->'))
    if (!timeLine) continue
    const [startStr, endStr] = timeLine.split(/\s*-->\s*/)
    const parseTime = (s: string) => {
      const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/)
      if (!m) return 0
      return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 1000
    }
    const textLines = lines.slice(lines.indexOf(timeLine) + 1).join(' ').trim()
    if (!textLines) continue
    blocks.push({ start: parseTime(startStr), end: parseTime(endStr), text: textLines })
  }
  return blocks
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Step4Subtitles() {
  const {
    audioUrl, projectId, scriptParams, subtitleBlocks, subtitleStyle,
    setSubtitleBlocks, setSubtitleStyle, setStep,
  } = useStudioStore()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [srtUploadError, setSrtUploadError] = useState('')
  const srtFileRef = useRef<HTMLInputElement>(null)

  function handleSrtUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSrtUploadError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const blocks = parseSrt(text)
      if (blocks.length === 0) {
        setSrtUploadError('Не удалось распознать субтитры в файле. Проверьте формат SRT.')
        return
      }
      setSubtitleBlocks(blocks)
    }
    reader.onerror = () => setSrtUploadError('Не удалось прочитать файл')
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  async function handleGenerate() {
    if (!audioUrl) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: audioUrl, project_id: projectId, language: scriptParams.language }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError('Недостаточно кредитов.')
          return
        }
        throw new Error(json.error)
      }
      setSubtitleBlocks(json.data.subtitle_blocks)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации субтитров')
    } finally {
      setLoading(false)
    }
  }

  function updateBlock(idx: number, field: keyof SubtitleBlock, raw: string) {
    const updated = subtitleBlocks.map((b, i) => {
      if (i !== idx) return b
      if (field === 'text') return { ...b, text: raw }
      const num = parseFloat(raw)
      if (!isNaN(num)) return { ...b, [field]: num }
      return b
    })
    setSubtitleBlocks(updated)
  }

  function downloadSrt() {
    const content = toSrt(subtitleBlocks)
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'subtitles.srt'; a.click()
    URL.revokeObjectURL(url)
  }

  const fontLabels: Record<SubtitleFont, string> = { sans: 'Без засечек', serif: 'С засечками', mono: 'Моноширинный' }
  const sizeLabels: Record<SubtitleSize, string> = { small: 'Маленький', medium: 'Средний', large: 'Крупный' }
  const posLabels: Record<SubtitlePosition, string> = { top: 'Вверху', center: 'По центру', bottom: 'Внизу' }
  const animLabels: Record<SubtitleAnimation, string> = { none: 'Нет', fade: 'Плавно', slide: 'Скольжение' }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Шаг 4: Субтитры</h2>
        <p className="text-sm text-gray-500">Автоматическая транскрибация через Whisper</p>
      </div>

      {/* Generate */}
      {subtitleBlocks.length === 0 ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-3">
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <p className="text-sm text-gray-600">
              Распознаёт речь и создаёт блоки субтитров с тайм-кодами
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !audioUrl}
            className="w-full py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Транскрибация... (30–60 сек)
              </>
            ) : (
              '📝 Создать субтитры (−3 кр.)'
            )}
          </button>
          {!audioUrl && (
            <p className="text-xs text-gray-400 text-center">Сначала сгенерируйте аудио на шаге 3</p>
          )}

          {/* Upload SRT */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => srtFileRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-300 text-gray-600 text-xs font-medium rounded-xl hover:bg-gray-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Загрузить .srt файл
            </button>
            <input
              ref={srtFileRef}
              type="file"
              accept=".srt,text/plain"
              className="hidden"
              onChange={handleSrtUpload}
            />
          </div>

          {srtUploadError && (
            <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{srtUploadError}</p>
          )}
        </div>
      ) : (
        <>
          {/* Subtitle blocks editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">{subtitleBlocks.length} блоков субтитров</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  className="text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors"
                >
                  ↺ Перегенерировать
                </button>
                <button
                  type="button"
                  onClick={downloadSrt}
                  className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  SRT
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto flex flex-col gap-2 pr-1">
              {subtitleBlocks.map((block, idx) => (
                <div key={idx} className="flex gap-2 items-start bg-gray-50 rounded-xl p-3">
                  <span className="text-xs font-bold text-gray-400 w-5 pt-0.5 shrink-0">{idx + 1}</span>
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <div className="flex gap-2 text-xs text-gray-500 font-mono">
                      <input
                        type="text"
                        value={formatTime(block.start)}
                        onChange={(e) => updateBlock(idx, 'start', e.target.value)}
                        className="w-20 bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-red-400"
                      />
                      <span className="self-center">→</span>
                      <input
                        type="text"
                        value={formatTime(block.end)}
                        onChange={(e) => updateBlock(idx, 'end', e.target.value)}
                        className="w-20 bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-red-400"
                      />
                    </div>
                    <input
                      type="text"
                      value={block.text}
                      onChange={(e) => updateBlock(idx, 'text', e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-red-400"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Style settings */}
          <div className="border border-gray-200 rounded-xl p-4 flex flex-col gap-4">
            <p className="text-sm font-semibold text-gray-900">Настройки стиля</p>

            <div className="grid grid-cols-2 gap-4">
              <ChipSelector
                label="Шрифт"
                value={subtitleStyle.font}
                options={(Object.keys(fontLabels) as SubtitleFont[]).map((k) => ({ value: k, label: fontLabels[k] }))}
                onChange={(v) => setSubtitleStyle({ font: v })}
              />
              <ChipSelector
                label="Размер"
                value={subtitleStyle.size}
                options={(Object.keys(sizeLabels) as SubtitleSize[]).map((k) => ({ value: k, label: sizeLabels[k] }))}
                onChange={(v) => setSubtitleStyle({ size: v })}
              />
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Цвет текста</p>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={subtitleStyle.color}
                  onChange={(e) => setSubtitleStyle({ color: e.target.value })}
                  className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer"
                />
                <span className="text-sm text-gray-600 font-mono">{subtitleStyle.color}</span>
              </div>
            </div>

            <ChipSelector
              label="Позиция"
              value={subtitleStyle.position}
              options={(Object.keys(posLabels) as SubtitlePosition[]).map((k) => ({ value: k, label: posLabels[k] }))}
              onChange={(v) => setSubtitleStyle({ position: v })}
            />

            <ChipSelector
              label="Анимация"
              value={subtitleStyle.animation}
              options={(Object.keys(animLabels) as SubtitleAnimation[]).map((k) => ({ value: k, label: animLabels[k] }))}
              onChange={(v) => setSubtitleStyle({ animation: v })}
            />

            <div className="divide-y divide-gray-100">
              <Toggle
                checked={subtitleStyle.background}
                onChange={(v) => setSubtitleStyle({ background: v })}
                label="Фон под текстом"
                hint="Полупрозрачная подложка для лучшей читаемости"
              />
              <Toggle
                checked={subtitleStyle.burnIn}
                onChange={(v) => setSubtitleStyle({ burnIn: v })}
                label="Вшить в видео"
                hint="Иначе субтитры экспортируются отдельным SRT файлом"
              />
            </div>
          </div>
        </>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(3)}
          className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => setStep(5)}
          disabled={subtitleBlocks.length === 0}
          className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-200 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Далее: Иллюстрации →
        </button>
        {subtitleBlocks.length === 0 && (
          <button
            type="button"
            onClick={() => setStep(5)}
            className="px-5 py-3 border border-gray-300 text-gray-500 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
          >
            Пропустить
          </button>
        )}
      </div>
    </div>
  )
}
