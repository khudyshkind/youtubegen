'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLang } from '@/hooks/useLang'
import { useStudioStore } from '@/lib/studio-store'
import { refreshCredits } from '@/lib/refresh-credits'

// ─── Types ───────────────────────────────────────────────────────────────────

interface NicheResult {
  competition: { score: number; level: string; reason: string }
  potential: { trend: string; growth: string; reason: string }
  rpm: { min: number; max: number; currency: string }
  subniches: Array<{ name: string; competition: string; potential: string }>
  monetization: { videos_per_week_1: string; videos_per_week_2: string; videos_per_week_3: string }
  best_time: { days: string[]; hours: string }
  top_formats: Array<{ name: string; avg_views: number }>
  top_channels: Array<{ name: string; subscribers: number; videos: number; avg_views: number }>
  top_videos: Array<{ title: string; views: number; channel: string; url: string }>
  recommendations: string[]
}

interface TrendResult {
  trends: Array<{
    topic: string
    reason: string
    urgency: string
    video_ideas: string[]
    example_videos: Array<{ title: string; views: number; url: string }>
  }>
}

interface ChannelResult {
  channel_name: string
  overview: { subscribers: number; total_views: number; avg_views: number; upload_frequency: string }
  best_formats: Array<{ name: string; avg_views: number; examples: string[] }>
  worst_formats: Array<{ name: string; avg_views: number }>
  best_topics: string[]
  worst_topics: string[]
  growth_trend: string
  strengths: string[]
  weaknesses: string[]
  recommendations: string[]
  top_videos: Array<{ title: string; views: number; url: string }>
  worst_videos: Array<{ title: string; views: number; url: string }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}К`
  return String(n)
}

function competitionColor(level: string): { bg: string; color: string } {
  const l = level.toLowerCase()
  if (l.includes('низ') || l.includes('low')) return { bg: 'rgba(34,197,94,0.15)', color: '#4ade80' }
  if (l.includes('сред') || l.includes('med')) return { bg: 'rgba(234,179,8,0.15)', color: '#facc15' }
  return { bg: 'rgba(239,68,68,0.15)', color: '#f87171' }
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, (score / 10) * 100)
  const color = score <= 3 ? '#4ade80' : score <= 6 ? '#facc15' : '#f87171'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-sm font-bold" style={{ color }}>{score}/10</span>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl p-5 ${className}`}
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">{children}</h3>
}

// ─── Progress stepper ─────────────────────────────────────────────────────────

const NICHE_STEPS = ['progress_channels', 'progress_stats', 'progress_videos', 'progress_ai', 'progress_report']
const TRENDS_STEPS = ['progress_videos', 'progress_stats', 'progress_ai', 'progress_report']
const CHANNEL_STEPS = ['progress_channels', 'progress_stats', 'progress_videos', 'progress_ai', 'progress_report']

function ProgressSteps({ steps, current, t }: { steps: string[]; current: number; t: (k: string) => string }) {
  return (
    <div className="flex flex-col gap-2 py-4">
      {steps.map((s, i) => (
        <div key={s} className={`flex items-center gap-3 text-sm transition-all ${i < current ? 'text-green-400' : i === current ? 'text-violet-300' : 'text-slate-600'}`}>
          <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs"
            style={{ background: i < current ? 'rgba(74,222,128,0.2)' : i === current ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.05)' }}>
            {i < current ? '✓' : i === current ? <Spinner /> : String(i + 1)}
          </span>
          {t(`analytics.${s}`)}
        </div>
      ))}
    </div>
  )
}

// ─── Niche Tab ────────────────────────────────────────────────────────────────

function NicheTab() {
  const { t } = useLang()
  const router = useRouter()
  const { setScriptParams, setStep } = useStudioStore()

  const [topic, setTopic] = useState('')
  const [country, setCountry] = useState('RU')
  const [lang, setLang] = useState('ru')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(-1)
  const [error, setError] = useState('')
  const [result, setResult] = useState<NicheResult | null>(null)
  const [cached, setCached] = useState(false)

  async function handleAnalyze() {
    if (!topic.trim()) { setError(t('analytics.err_topic')); return }
    setError(''); setResult(null); setLoading(true); setProgress(0)

    const steps = NICHE_STEPS
    let p = 0
    const timer = setInterval(() => {
      p = Math.min(p + 1, steps.length - 1)
      setProgress(p)
    }, 4000)

    try {
      const res = await fetch('/api/analytics/niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, country, lang }),
      })
      const json = await res.json() as { ok: boolean; data?: NicheResult; cached?: boolean; error?: string; code?: string }
      if (!json.ok) {
        setError(json.code === 'NO_CREDITS' ? t('analytics.err_credits') : (json.error ?? t('analytics.err_general')))
      } else {
        setResult(json.data ?? null)
        setCached(json.cached ?? false)
        void refreshCredits()
      }
    } catch {
      setError(t('analytics.err_general'))
    } finally {
      clearInterval(timer)
      setLoading(false)
      setProgress(-1)
    }
  }

  function goToStudio() {
    setScriptParams({ topic })
    setStep(1)
    router.push('/studio')
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Form */}
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('analytics.niche_topic_label')}</label>
            <input
              value={topic} onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && void handleAnalyze()}
              placeholder={t('analytics.niche_topic_ph')}
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-violet-500/50"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-32">
              <label className="block text-xs text-slate-400 mb-1.5">{t('analytics.country_label')}</label>
              <select value={country} onChange={e => setCountry(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <option value="RU">{t('analytics.country_ru')}</option>
                <option value="UA">{t('analytics.country_ua')}</option>
                <option value="KZ">{t('analytics.country_kz')}</option>
                <option value="US">{t('analytics.country_world')}</option>
              </select>
            </div>
            <div className="flex-1 min-w-32">
              <label className="block text-xs text-slate-400 mb-1.5">{t('analytics.lang_label')}</label>
              <select value={lang} onChange={e => setLang(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <option value="ru">{t('analytics.lang_ru')}</option>
                <option value="en">{t('analytics.lang_en')}</option>
              </select>
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={() => void handleAnalyze()} disabled={loading}
            className="btn-gradient px-5 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Spinner /> : null}
            {t('analytics.analyze_btn')} · {t('analytics.niche_cost')}
          </button>
        </div>
      </Card>

      {/* Progress */}
      {loading && (
        <Card>
          <ProgressSteps steps={NICHE_STEPS} current={progress} t={t} />
        </Card>
      )}

      {/* Results */}
      {result && (
        <div className="flex flex-col gap-5">
          {cached && (
            <p className="text-xs text-slate-500 text-center">{t('analytics.cached_note')}</p>
          )}

          {/* Metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <p className="text-xs text-slate-500 mb-1">{t('analytics.competition')}</p>
              <p className="text-lg font-bold text-white mb-1">{result.competition.level}</p>
              <ScoreBar score={result.competition.score} />
              <p className="text-xs text-slate-500 mt-2 line-clamp-2">{result.competition.reason}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500 mb-1">{t('analytics.trend')}</p>
              <p className="text-lg font-bold text-green-400">{result.potential.trend}</p>
              <p className="text-2xl font-bold text-white">{result.potential.growth}</p>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{result.potential.reason}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500 mb-1">{t('analytics.rpm')}</p>
              <p className="text-2xl font-bold text-white">${result.rpm.min}–{result.rpm.max}</p>
              <p className="text-xs text-slate-500 mt-1">{result.rpm.currency} за 1000 просмотров</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500 mb-1">{t('analytics.monetization')}</p>
              <p className="text-sm font-semibold text-violet-300">{t('analytics.per_week_2')}</p>
              <p className="text-lg font-bold text-white">{result.monetization.videos_per_week_2}</p>
            </Card>
          </div>

          {/* Monetization breakdown */}
          <Card>
            <SectionTitle>{t('analytics.monetization')}</SectionTitle>
            <div className="flex flex-col gap-2">
              {[
                { label: t('analytics.per_week_1'), value: result.monetization.videos_per_week_1 },
                { label: t('analytics.per_week_2'), value: result.monetization.videos_per_week_2 },
                { label: t('analytics.per_week_3'), value: result.monetization.videos_per_week_3 },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center py-2"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span className="text-sm text-slate-400">{row.label}</span>
                  <span className="text-sm font-semibold text-white">{row.value}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Sub-niches */}
          {result.subniches?.length > 0 && (
            <Card>
              <SectionTitle>{t('analytics.subniches')}</SectionTitle>
              <div className="flex flex-col gap-2">
                {result.subniches.map((sn, i) => {
                  const { bg, color } = competitionColor(sn.competition)
                  return (
                    <div key={i} className="flex items-center justify-between gap-3 py-2"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span className="text-sm text-white">{sn.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: bg, color }}>{sn.competition}</span>
                        <span className="text-xs text-slate-400">{sn.potential}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Best time + formats */}
          <div className="grid sm:grid-cols-2 gap-4">
            {result.best_time && (
              <Card>
                <SectionTitle>{t('analytics.best_time')}</SectionTitle>
                <p className="text-white font-semibold">{result.best_time.days?.join(', ')}</p>
                <p className="text-slate-400 text-sm mt-1">{result.best_time.hours}</p>
              </Card>
            )}
            {result.top_formats?.length > 0 && (
              <Card>
                <SectionTitle>{t('analytics.top_formats')}</SectionTitle>
                <div className="flex flex-col gap-1.5">
                  {result.top_formats.map((f, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-sm text-white">{f.name}</span>
                      <span className="text-xs text-slate-400">{fmtNum(f.avg_views)} просм.</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* Top channels */}
          {result.top_channels?.length > 0 && (
            <Card>
              <SectionTitle>{t('analytics.top_channels')}</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th className="text-left pb-2">{t('analytics.channel_col')}</th>
                      <th className="text-right pb-2">{t('analytics.subscribers')}</th>
                      <th className="text-right pb-2">{t('analytics.videos_count')}</th>
                      <th className="text-right pb-2">{t('analytics.avg_views')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.top_channels.map((ch, i) => (
                      <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <td className="py-2 text-white font-medium">{ch.name}</td>
                        <td className="py-2 text-right text-slate-300">{fmtNum(ch.subscribers)}</td>
                        <td className="py-2 text-right text-slate-300">{fmtNum(ch.videos)}</td>
                        <td className="py-2 text-right text-slate-300">{fmtNum(ch.avg_views)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Top videos */}
          {result.top_videos?.length > 0 && (
            <Card>
              <SectionTitle>{t('analytics.top_videos')}</SectionTitle>
              <div className="flex flex-col gap-2">
                {result.top_videos.map((v, i) => (
                  <a key={i} href={v.url} target="_blank" rel="noreferrer"
                    className="flex justify-between items-center gap-3 py-2 hover:text-violet-300 transition-colors"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="text-sm text-white line-clamp-1 flex-1">{v.title}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-slate-400">{v.channel}</span>
                      <span className="text-xs font-semibold text-slate-300">{fmtNum(v.views)}</span>
                    </div>
                  </a>
                ))}
              </div>
            </Card>
          )}

          {/* Recommendations */}
          {result.recommendations?.length > 0 && (
            <Card>
              <SectionTitle>{t('analytics.recommendations')}</SectionTitle>
              <ul className="flex flex-col gap-2">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-300">
                    <span className="text-violet-400 shrink-0 font-bold">{i + 1}.</span>
                    {r}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* CTA */}
          <button onClick={goToStudio}
            className="btn-gradient w-full py-3.5 rounded-xl text-sm font-semibold text-white">
            {t('analytics.create_video_btn')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Trends Tab ───────────────────────────────────────────────────────────────

function TrendsTab() {
  const { t } = useLang()
  const router = useRouter()
  const { setScriptParams, setStep } = useStudioStore()

  const [topic, setTopic] = useState('')
  const [period, setPeriod] = useState('week')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(-1)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TrendResult | null>(null)
  const [cached, setCached] = useState(false)

  async function handleFind() {
    if (!topic.trim()) { setError(t('analytics.err_topic')); return }
    setError(''); setResult(null); setLoading(true); setProgress(0)

    let p = 0
    const timer = setInterval(() => {
      p = Math.min(p + 1, TRENDS_STEPS.length - 1)
      setProgress(p)
    }, 3500)

    try {
      const res = await fetch('/api/analytics/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, period }),
      })
      const json = await res.json() as { ok: boolean; data?: TrendResult; cached?: boolean; error?: string; code?: string }
      if (!json.ok) {
        setError(json.code === 'NO_CREDITS' ? t('analytics.err_credits') : (json.error ?? t('analytics.err_general')))
      } else {
        setResult(json.data ?? null)
        setCached(json.cached ?? false)
        void refreshCredits()
      }
    } catch {
      setError(t('analytics.err_general'))
    } finally {
      clearInterval(timer)
      setLoading(false)
      setProgress(-1)
    }
  }

  function goToStudio(ideaTopic: string) {
    setScriptParams({ topic: ideaTopic })
    setStep(1)
    router.push('/studio')
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('analytics.niche_topic_label')}</label>
            <input
              value={topic} onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && void handleFind()}
              placeholder={t('analytics.trends_topic_ph')}
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-violet-500/50"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">{t('analytics.period_label')}</label>
            <div className="flex gap-2">
              {['week', 'month'].map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                  style={{
                    background: period === p ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${period === p ? 'rgba(124,58,237,0.6)' : 'rgba(255,255,255,0.1)'}`,
                    color: period === p ? '#c4b5fd' : '#94a3b8',
                  }}>
                  {p === 'week' ? t('analytics.period_week') : t('analytics.period_month')}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={() => void handleFind()} disabled={loading}
            className="btn-gradient px-5 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Spinner /> : '🔥'}
            {t('analytics.find_trends_btn')} · {t('analytics.trends_cost')}
          </button>
        </div>
      </Card>

      {loading && (
        <Card>
          <ProgressSteps steps={TRENDS_STEPS} current={progress} t={t} />
        </Card>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          {cached && <p className="text-xs text-slate-500 text-center">{t('analytics.cached_note')}</p>}
          {(result.trends ?? []).map((trend, i) => {
            const isUrgent = trend.urgency?.toLowerCase().includes('срочно') || trend.urgency?.toLowerCase().includes('urgent')
            return (
              <Card key={i}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h3 className="text-base font-bold text-white">🔥 {trend.topic}</h3>
                  <span className="text-xs px-2 py-1 rounded-full font-semibold shrink-0"
                    style={{
                      background: isUrgent ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
                      color: isUrgent ? '#f87171' : '#facc15',
                    }}>
                    {isUrgent ? t('analytics.urgent') : t('analytics.can_wait')}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mb-4">{trend.reason}</p>

                {trend.video_ideas?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">{t('analytics.trend_ideas')}</p>
                    <ul className="flex flex-col gap-1.5">
                      {trend.video_ideas.map((idea, j) => (
                        <li key={j} className="flex items-start gap-2">
                          <span className="text-violet-400 text-xs mt-0.5">💡</span>
                          <span className="text-sm text-slate-300">{idea}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {trend.example_videos?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">{t('analytics.example_videos')}</p>
                    {trend.example_videos.map((v, j) => (
                      <a key={j} href={v.url} target="_blank" rel="noreferrer"
                        className="flex justify-between items-center py-1.5 hover:text-violet-300 transition-colors">
                        <span className="text-sm text-slate-300 line-clamp-1 flex-1">{v.title}</span>
                        <span className="text-xs text-slate-400 ml-3 shrink-0">{fmtNum(v.views)} просм.</span>
                      </a>
                    ))}
                  </div>
                )}

                <button onClick={() => goToStudio(trend.topic)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-violet-300 transition-all hover:text-white"
                  style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>
                  {t('analytics.create_video_btn')}
                </button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Channel Tab ──────────────────────────────────────────────────────────────

function ChannelTab() {
  const { t } = useLang()
  const router = useRouter()
  const { setScriptParams, setStep } = useStudioStore()

  const [channel, setChannel] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(-1)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ChannelResult | null>(null)
  const [cached, setCached] = useState(false)

  async function handleAnalyze() {
    if (!channel.trim()) { setError(t('analytics.err_channel')); return }
    setError(''); setResult(null); setLoading(true); setProgress(0)

    let p = 0
    const timer = setInterval(() => {
      p = Math.min(p + 1, CHANNEL_STEPS.length - 1)
      setProgress(p)
    }, 5000)

    try {
      const res = await fetch('/api/analytics/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      })
      const json = await res.json() as { ok: boolean; data?: ChannelResult; cached?: boolean; error?: string; code?: string }
      if (!json.ok) {
        setError(json.code === 'NO_CREDITS' ? t('analytics.err_credits') : (json.error ?? t('analytics.err_general')))
      } else {
        setResult(json.data ?? null)
        setCached(json.cached ?? false)
        void refreshCredits()
      }
    } catch {
      setError(t('analytics.err_general'))
    } finally {
      clearInterval(timer)
      setLoading(false)
      setProgress(-1)
    }
  }

  function goToStudio(topic: string) {
    setScriptParams({ topic })
    setStep(1)
    router.push('/studio')
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('analytics.channel_input_label')}</label>
            <input
              value={channel} onChange={e => setChannel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && void handleAnalyze()}
              placeholder={t('analytics.channel_input_ph')}
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-violet-500/50"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={() => void handleAnalyze()} disabled={loading}
            className="btn-gradient px-5 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Spinner /> : '📊'}
            {t('analytics.analyze_channel_btn')} · {t('analytics.channel_cost')}
          </button>
        </div>
      </Card>

      {loading && (
        <Card>
          <ProgressSteps steps={CHANNEL_STEPS} current={progress} t={t} />
        </Card>
      )}

      {result && (
        <div className="flex flex-col gap-5">
          {cached && <p className="text-xs text-slate-500 text-center">{t('analytics.cached_note')}</p>}

          {/* Channel header */}
          <Card>
            <h2 className="text-lg font-bold text-white mb-4">{result.channel_name}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: t('analytics.subscribers'), value: fmtNum(result.overview?.subscribers ?? 0) },
                { label: t('analytics.total_views'), value: fmtNum(result.overview?.total_views ?? 0) },
                { label: t('analytics.avg_views'), value: fmtNum(result.overview?.avg_views ?? 0) },
                { label: t('analytics.upload_frequency'), value: result.overview?.upload_frequency ?? '—' },
              ].map(m => (
                <div key={m.label}>
                  <p className="text-xs text-slate-500 mb-1">{m.label}</p>
                  <p className="text-base font-bold text-white">{m.value}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Growth trend */}
          <div className="grid sm:grid-cols-3 gap-4">
            <Card>
              <SectionTitle>{t('analytics.growth_trend')}</SectionTitle>
              <p className="text-xl font-bold"
                style={{ color: result.growth_trend?.includes('Рас') ? '#4ade80' : result.growth_trend?.includes('Пад') ? '#f87171' : '#facc15' }}>
                {result.growth_trend}
              </p>
            </Card>
            <Card>
              <SectionTitle>{t('analytics.strengths')}</SectionTitle>
              <ul className="flex flex-col gap-1">
                {(result.strengths ?? []).map((s, i) => (
                  <li key={i} className="text-sm text-green-300 flex gap-1.5"><span>✓</span>{s}</li>
                ))}
              </ul>
            </Card>
            <Card>
              <SectionTitle>{t('analytics.weaknesses')}</SectionTitle>
              <ul className="flex flex-col gap-1">
                {(result.weaknesses ?? []).map((w, i) => (
                  <li key={i} className="text-sm text-red-300 flex gap-1.5"><span>✗</span>{w}</li>
                ))}
              </ul>
            </Card>
          </div>

          {/* Best/worst formats */}
          <div className="grid sm:grid-cols-2 gap-4">
            {result.best_formats?.length > 0 && (
              <Card>
                <SectionTitle>{t('analytics.best_formats')}</SectionTitle>
                {result.best_formats.map((f, i) => (
                  <div key={i} className="py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-white">{f.name}</span>
                      <span className="text-xs text-green-400">{fmtNum(f.avg_views)} просм.</span>
                    </div>
                    {f.examples?.[0] && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{f.examples[0]}</p>}
                  </div>
                ))}
              </Card>
            )}
            {result.worst_formats?.length > 0 && (
              <Card>
                <SectionTitle>{t('analytics.worst_formats')}</SectionTitle>
                {result.worst_formats.map((f, i) => (
                  <div key={i} className="flex justify-between py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="text-sm text-white">{f.name}</span>
                    <span className="text-xs text-red-400">{fmtNum(f.avg_views)} просм.</span>
                  </div>
                ))}
              </Card>
            )}
          </div>

          {/* Topics */}
          <div className="grid sm:grid-cols-2 gap-4">
            {result.best_topics?.length > 0 && (
              <Card>
                <SectionTitle>{t('analytics.best_topics')}</SectionTitle>
                <ul className="flex flex-col gap-1.5">
                  {result.best_topics.map((s, i) => (
                    <li key={i} className="text-sm text-white flex gap-2">
                      <span className="text-green-400">▲</span>{s}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {result.worst_topics?.length > 0 && (
              <Card>
                <SectionTitle>{t('analytics.worst_topics')}</SectionTitle>
                <ul className="flex flex-col gap-1.5">
                  {result.worst_topics.map((s, i) => (
                    <li key={i} className="text-sm text-slate-400 flex gap-2">
                      <span className="text-red-400">▼</span>{s}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {/* Top videos */}
          {result.top_videos?.length > 0 && (
            <Card>
              <SectionTitle>{t('analytics.top_videos')}</SectionTitle>
              {result.top_videos.map((v, i) => (
                <a key={i} href={v.url} target="_blank" rel="noreferrer"
                  className="flex justify-between items-center py-2 hover:text-violet-300 transition-colors"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span className="text-sm text-white line-clamp-1 flex-1">{v.title}</span>
                  <span className="text-xs text-green-400 ml-3 shrink-0">{fmtNum(v.views)}</span>
                </a>
              ))}
            </Card>
          )}

          {/* Recommendations */}
          {result.recommendations?.length > 0 && (
            <Card>
              <SectionTitle>{t('analytics.recommendations')}</SectionTitle>
              <ul className="flex flex-col gap-3">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-300">
                    <span className="text-violet-400 font-bold shrink-0">{i + 1}.</span>
                    {r}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* CTA */}
          <button onClick={() => goToStudio(result.channel_name ? `видео в стиле канала ${result.channel_name}` : 'видео на YouTube')}
            className="btn-gradient w-full py-3.5 rounded-xl text-sm font-semibold text-white">
            {t('analytics.create_video_btn')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'niche' | 'trends' | 'channel'

export default function AnalyticsPage() {
  const { t } = useLang()
  const [tab, setTab] = useState<Tab>('niche')

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'niche',   label: t('analytics.tab_niche') },
    { id: 'trends',  label: t('analytics.tab_trends') },
    { id: 'channel', label: t('analytics.tab_channel') },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">{t('analytics.title')}</h1>
        <p className="text-slate-400 text-sm">{t('analytics.subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all"
            style={{
              background: tab === id ? 'rgba(124,58,237,0.35)' : 'transparent',
              color: tab === id ? '#c4b5fd' : '#64748b',
              border: tab === id ? '1px solid rgba(124,58,237,0.5)' : '1px solid transparent',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'niche'   && <NicheTab />}
      {tab === 'trends'  && <TrendsTab />}
      {tab === 'channel' && <ChannelTab />}
    </div>
  )
}
