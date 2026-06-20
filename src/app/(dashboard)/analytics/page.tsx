'use client'

import { useState, useEffect } from 'react'
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
  best_formats: Array<{ name: string; avg_views: number; examples?: string[] }>
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

interface RevenueResult {
  niche: string
  views: number
  country: string
  country_label: string
  rpm: { min: number; max: number; avg: number; niche_factor: string; explanation: string }
  monthly:   { min: number; max: number; avg: number }
  quarterly: { min: number; max: number; avg: number }
  biannual:  { min: number; max: number; avg: number }
  annual:    { min: number; max: number; avg: number }
}

interface CommentsResult {
  url: string
  topic: string
  source_label: string
  comments_count: number
  video_requests:       Array<{ request: string; count: number }>
  pain_points:          string[]
  unanswered_questions: string[]
  positive_reactions:   string[]
  negative_reactions:   string[]
  video_ideas:          Array<{ title: string; reason: string; based_on: string }>
  audience_portrait:    string
}

interface KeywordsResult {
  keyword: string
  lang: string
  total: number
  easy: number
  medium: number
  hard: number
  keywords: Array<{
    keyword: string
    difficulty: number
    potential: number
    competition: string
    avg_views: number
    video_count: number
    recommendation: string
  }>
  best_keywords:   string[]
  low_competition: string[]
  insights:        string
}

interface CompareChannelStat {
  id: string
  name: string
  subscribers: number
  total_views: number
  video_count: number
  avg_views: number
  upload_frequency: number
  engagement_rate: number
  recent_video_count: number
  top_videos:        Array<{ title: string; views: number; url: string; published_at: string }>
  common_tags:       string[]
  publish_days:      string[]
  content_strategy:  string
  winning_formula:   string
  strongest_metric:  string
  weakest_metric:    string
}

interface CompareResult {
  channels:         CompareChannelStat[]
  winner:           { overall: string; by_engagement: string; by_views: string; by_consistency: string }
  max_subscribers:  number
  max_avg_views:    number
  max_upload_freq:  number
  max_engagement:   number
  insights:         string[]
  recommendations:  string[]
  opportunities:    string[]
  steal_ideas:      Array<{ from_channel: string; idea: string; example_video: string }>
}

interface RisingStarsResult {
  topic: string
  total_found: number
  channels: Array<{
    channel_id: string
    name: string
    url: string
    created_at: string
    months_old: number
    subscribers: number
    monthly_growth_estimate: number
    video_count: number
    upload_frequency: number
    avg_views: number
    viral_ratio: number
    growth_reason: string
    strategy: string
    key_takeaway: string
  }>
  common_patterns: string[]
}

interface AnalyticsReport {
  id: string
  report_type: 'niche' | 'trends' | 'channel' | 'revenue' | 'comments' | 'keywords' | 'compare' | 'rising_stars'
  title: string
  query: string
  result: NicheResult | TrendResult | ChannelResult | RevenueResult | CommentsResult | KeywordsResult | CompareResult | RisingStarsResult
  created_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}К`
  return String(n)
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}М`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}К`
  return `$${n}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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

function PrintBtn({ title }: { title?: string }) {
  return (
    <button
      onClick={() => window.print()}
      title={title ?? 'Распечатать / сохранить как PDF'}
      className="no-print flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-colors"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
      </svg>
      Скачать PDF
    </button>
  )
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

// ─── Niche result renderer (shared between NicheTab and HistoryTab) ───────────

function NicheResultView({ result, cached, t, onCreateVideo }: {
  result: NicheResult
  cached: boolean
  t: (k: string) => string
  onCreateVideo: () => void
}) {
  return (
    <div className="analytics-result flex flex-col gap-5">
      <div className="no-print flex justify-between items-center">
        {cached && <p className="text-xs text-slate-500">{t('analytics.cached_note')}</p>}
        <div className="ml-auto"><PrintBtn /></div>
      </div>

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
                  {f.avg_views > 0 && <span className="text-xs text-slate-400">{fmtNum(f.avg_views)} просм.</span>}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

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

      <button onClick={onCreateVideo} className="no-print btn-gradient w-full py-3.5 rounded-xl text-sm font-semibold text-white">
        {t('analytics.create_video_btn')}
      </button>
    </div>
  )
}

// ─── Niche Tab ────────────────────────────────────────────────────────────────

function NicheTab({ externalResult, onClearExternal }: {
  externalResult?: NicheResult | null
  onClearExternal?: () => void
}) {
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

  const displayResult = externalResult ?? result

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
      {externalResult && (
        <button onClick={onClearExternal}
          className="no-print flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors self-start">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Новый анализ
        </button>
      )}

      {!externalResult && (
        <Card className="no-print">
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
      )}

      {loading && (
        <Card className="no-print">
          <ProgressSteps steps={NICHE_STEPS} current={progress} t={t} />
        </Card>
      )}

      {displayResult && (
        <NicheResultView
          result={displayResult}
          cached={!externalResult && cached}
          t={t}
          onCreateVideo={goToStudio}
        />
      )}
    </div>
  )
}

// ─── Trends Tab ───────────────────────────────────────────────────────────────

function TrendsTab({ externalResult, onClearExternal }: {
  externalResult?: TrendResult | null
  onClearExternal?: () => void
}) {
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

  const displayResult = externalResult ?? result

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
      {externalResult && (
        <button onClick={onClearExternal}
          className="no-print flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors self-start">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Новый анализ
        </button>
      )}

      {!externalResult && (
        <Card className="no-print">
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
      )}

      {loading && (
        <Card className="no-print">
          <ProgressSteps steps={TRENDS_STEPS} current={progress} t={t} />
        </Card>
      )}

      {displayResult && (
        <div className="analytics-result flex flex-col gap-4">
          <div className="no-print flex justify-between items-center">
            {!externalResult && cached && <p className="text-xs text-slate-500">{t('analytics.cached_note')}</p>}
            <div className="ml-auto"><PrintBtn /></div>
          </div>
          {(displayResult.trends ?? []).map((trend, i) => {
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
                  className="no-print w-full py-2.5 rounded-xl text-sm font-semibold text-violet-300 transition-all hover:text-white"
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

function ChannelTab({ externalResult, onClearExternal, initialChannel }: {
  externalResult?: ChannelResult | null
  onClearExternal?: () => void
  initialChannel?: string
}) {
  const { t } = useLang()
  const router = useRouter()
  const { setScriptParams, setStep } = useStudioStore()

  const [channel, setChannel] = useState(initialChannel ?? '')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(-1)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ChannelResult | null>(null)
  const [cached, setCached] = useState(false)

  const displayResult = externalResult ?? result

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
      {externalResult && (
        <button onClick={onClearExternal}
          className="no-print flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors self-start">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Новый анализ
        </button>
      )}

      {!externalResult && (
        <Card className="no-print">
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
      )}

      {loading && (
        <Card className="no-print">
          <ProgressSteps steps={CHANNEL_STEPS} current={progress} t={t} />
        </Card>
      )}

      {displayResult && (
        <div className="analytics-result flex flex-col gap-5">
          <div className="no-print flex justify-between items-center">
            {!externalResult && cached && <p className="text-xs text-slate-500">{t('analytics.cached_note')}</p>}
            <div className="ml-auto"><PrintBtn /></div>
          </div>

          <Card>
            <h2 className="text-lg font-bold text-white mb-4">{displayResult.channel_name}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: t('analytics.subscribers'), value: fmtNum(displayResult.overview?.subscribers ?? 0) },
                { label: t('analytics.total_views'), value: fmtNum(displayResult.overview?.total_views ?? 0) },
                { label: t('analytics.avg_views'), value: fmtNum(displayResult.overview?.avg_views ?? 0) },
                { label: t('analytics.upload_frequency'), value: displayResult.overview?.upload_frequency ?? '—' },
              ].map(m => (
                <div key={m.label}>
                  <p className="text-xs text-slate-500 mb-1">{m.label}</p>
                  <p className="text-base font-bold text-white">{m.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid sm:grid-cols-3 gap-4">
            <Card>
              <SectionTitle>{t('analytics.growth_trend')}</SectionTitle>
              <p className="text-xl font-bold"
                style={{ color: displayResult.growth_trend?.includes('Рас') ? '#4ade80' : displayResult.growth_trend?.includes('Пад') ? '#f87171' : '#facc15' }}>
                {displayResult.growth_trend}
              </p>
            </Card>
            <Card>
              <SectionTitle>{t('analytics.strengths')}</SectionTitle>
              <ul className="flex flex-col gap-1">
                {(displayResult.strengths ?? []).map((s, i) => (
                  <li key={i} className="text-sm text-green-300 flex gap-1.5"><span>✓</span>{s}</li>
                ))}
              </ul>
            </Card>
            <Card>
              <SectionTitle>{t('analytics.weaknesses')}</SectionTitle>
              <ul className="flex flex-col gap-1">
                {(displayResult.weaknesses ?? []).map((w, i) => (
                  <li key={i} className="text-sm text-red-300 flex gap-1.5"><span>✗</span>{w}</li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {displayResult.best_formats?.length > 0 && (
              <Card>
                <SectionTitle>{t('analytics.best_formats')}</SectionTitle>
                {displayResult.best_formats.map((f, i) => (
                  <div key={i} className="py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-white">{f.name}</span>
                      {f.avg_views > 0 && <span className="text-xs text-green-400">{fmtNum(f.avg_views)} просм.</span>}
                    </div>
                    {f.examples?.[0] && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{f.examples[0]}</p>}
                  </div>
                ))}
              </Card>
            )}
            {displayResult.worst_formats?.length > 0 && (
              <Card>
                <SectionTitle>{t('analytics.worst_formats')}</SectionTitle>
                {displayResult.worst_formats.map((f, i) => (
                  <div key={i} className="flex justify-between py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="text-sm text-white">{f.name}</span>
                    {f.avg_views > 0 && <span className="text-xs text-red-400">{fmtNum(f.avg_views)} просм.</span>}
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {displayResult.best_topics?.length > 0 && (
              <Card>
                <SectionTitle>{t('analytics.best_topics')}</SectionTitle>
                <ul className="flex flex-col gap-1.5">
                  {displayResult.best_topics.map((s, i) => (
                    <li key={i} className="text-sm text-white flex gap-2">
                      <span className="text-green-400">▲</span>{s}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {displayResult.worst_topics?.length > 0 && (
              <Card>
                <SectionTitle>{t('analytics.worst_topics')}</SectionTitle>
                <ul className="flex flex-col gap-1.5">
                  {displayResult.worst_topics.map((s, i) => (
                    <li key={i} className="text-sm text-slate-400 flex gap-2">
                      <span className="text-red-400">▼</span>{s}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {displayResult.top_videos?.length > 0 && (
            <Card>
              <SectionTitle>{t('analytics.top_videos')}</SectionTitle>
              {displayResult.top_videos.map((v, i) => (
                <a key={i} href={v.url} target="_blank" rel="noreferrer"
                  className="flex justify-between items-center py-2 hover:text-violet-300 transition-colors"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span className="text-sm text-white line-clamp-1 flex-1">{v.title}</span>
                  <span className="text-xs text-green-400 ml-3 shrink-0">{fmtNum(v.views)}</span>
                </a>
              ))}
            </Card>
          )}

          {displayResult.recommendations?.length > 0 && (
            <Card>
              <SectionTitle>{t('analytics.recommendations')}</SectionTitle>
              <ul className="flex flex-col gap-3">
                {displayResult.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-300">
                    <span className="text-violet-400 font-bold shrink-0">{i + 1}.</span>
                    {r}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <button onClick={() => goToStudio(displayResult.channel_name ? `видео в стиле канала ${displayResult.channel_name}` : 'видео на YouTube')}
            className="no-print btn-gradient w-full py-3.5 rounded-xl text-sm font-semibold text-white">
            {t('analytics.create_video_btn')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Revenue Tab ──────────────────────────────────────────────────────────────

function RevenueTab({
  externalResult,
  onClearExternal,
}: {
  externalResult: RevenueResult | null
  onClearExternal: () => void
}) {
  const [niche, setNiche] = useState('')
  const [views, setViews] = useState('')
  const [country, setCountry] = useState('mix')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RevenueResult | null>(null)

  const displayResult = externalResult ?? result

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analytics/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche, views: Number(views), country }),
      })
      const json = await res.json() as { ok: boolean; data?: RevenueResult; error?: string }
      if (!json.ok) { setError(json.error ?? 'Ошибка'); return }
      setResult(json.data!)
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {externalResult && (
        <button onClick={onClearExternal}
          className="no-print self-start flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
          ← Новый расчёт
        </button>
      )}

      {!externalResult && (
        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">Ниша канала</label>
              <input
                type="text"
                value={niche}
                onChange={e => setNiche(e.target.value)}
                placeholder="напр. Автомобили, Технологии, Кулинария..."
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">Просмотры в месяц</label>
              <input
                type="number"
                value={views}
                onChange={e => setViews(e.target.value)}
                placeholder="напр. 500000"
                min={1}
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">Страна аудитории</label>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{ background: 'rgba(30,27,75,0.8)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <option value="ru">🇷🇺 Россия</option>
                <option value="cis">🌍 СНГ</option>
                <option value="mix">🌐 Смешанная</option>
                <option value="eu">🇪🇺 Европа</option>
                <option value="us">🇺🇸 США</option>
              </select>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading || !niche || !views}
              className="btn-gradient py-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
              {loading
                ? <span className="flex items-center justify-center gap-2"><Spinner /> Рассчитываю...</span>
                : 'Рассчитать доход · −2 кр.'}
            </button>
          </form>
        </Card>
      )}

      {displayResult && (
        <div className="flex flex-col gap-4 analytics-result">
          <div className="flex justify-end"><PrintBtn /></div>

          {/* Main income card */}
          <Card>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Доход в месяц</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {fmtUSD(displayResult.monthly.min)}–{fmtUSD(displayResult.monthly.max)}
                </p>
                <p className="text-sm text-slate-400 mt-0.5">в среднем {fmtUSD(displayResult.monthly.avg)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">RPM</p>
                <p className="text-xl font-bold text-violet-300">${displayResult.rpm.min}–${displayResult.rpm.max}</p>
                <p className="text-xs text-slate-500 mt-0.5">{displayResult.rpm.niche_factor}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-500">
              <span>📺 {fmtNum(displayResult.views)} просм./мес</span>
              <span>·</span>
              <span>🌍 {displayResult.country_label}</span>
              <span>·</span>
              <span>📌 {displayResult.niche}</span>
            </div>
          </Card>

          {/* Projections grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '1 месяц',    d: displayResult.monthly },
              { label: '3 месяца',   d: displayResult.quarterly },
              { label: '6 месяцев',  d: displayResult.biannual },
              { label: '12 месяцев', d: displayResult.annual },
            ].map(({ label, d }) => (
              <div key={label} className="rounded-2xl p-4 flex flex-col gap-1"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-lg font-bold text-white">{fmtUSD(d.avg)}</p>
                <p className="text-xs text-slate-600">{fmtUSD(d.min)}–{fmtUSD(d.max)}</p>
              </div>
            ))}
          </div>

          {/* RPM explanation */}
          <Card>
            <h3 className="text-sm font-semibold text-white mb-2">Откуда такой RPM?</h3>
            <p className="text-sm text-slate-300 leading-relaxed">{displayResult.rpm.explanation}</p>
          </Card>

          {/* Factors */}
          <Card>
            <h3 className="text-sm font-semibold text-white mb-3">Что влияет на доход</h3>
            <div className="flex flex-col gap-2.5">
              {[
                { factor: 'Страна аудитории', impact: 'Высокое',  note: 'США/EU дают в 5–10× больше, чем RU/СНГ' },
                { factor: 'Ниша',             impact: 'Высокое',  note: 'Финансы и B2B имеют самый высокий RPM' },
                { factor: 'Сезонность',       impact: 'Среднее',  note: 'Q4 (окт–дек) обычно на 30–50% выше' },
                { factor: 'AdBlock',          impact: 'Среднее',  note: 'IT-ниши теряют до 30% показов рекламы' },
                { factor: 'Частота загрузок', impact: 'Низкое',   note: 'Влияет на рост, а не напрямую на RPM' },
              ].map(({ factor, impact, note }) => (
                <div key={factor} className="flex items-start gap-3 text-sm">
                  <span className="text-slate-300 w-36 shrink-0 text-xs">{factor}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                    impact === 'Высокое' ? 'text-red-300 bg-red-500/15' :
                    impact === 'Среднее' ? 'text-yellow-300 bg-yellow-500/15' :
                                           'text-green-300 bg-green-500/15'
                  }`}>{impact}</span>
                  <span className="text-slate-500 text-xs">{note}</span>
                </div>
              ))}
            </div>
          </Card>

          <p className="text-xs text-slate-600 text-center px-4">
            * Расчёт приблизительный. Реальный доход зависит от рекламодателей в нише, качества контента, типа устройств и сезона.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Comments Tab ────────────────────────────────────────────────────────────

function CommentsTab({
  externalResult,
  onClearExternal,
}: {
  externalResult: CommentsResult | null
  onClearExternal: () => void
}) {
  const router = useRouter()
  const { setScriptParams, setStep } = useStudioStore()
  const [url, setUrl] = useState('')
  const [count, setCount] = useState<50 | 100 | 200>(100)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CommentsResult | null>(null)

  const displayResult = externalResult ?? result

  function goToStudio(topic: string) {
    setScriptParams({ topic })
    setStep(1)
    router.push('/studio')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analytics/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, count }),
      })
      const json = await res.json() as { ok: boolean; data?: CommentsResult; error?: string }
      if (!json.ok) { setError(json.error ?? 'Ошибка'); return }
      setResult(json.data!)
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {externalResult && (
        <button onClick={onClearExternal}
          className="no-print self-start flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
          ← Новый анализ
        </button>
      )}

      {!externalResult && (
        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">URL видео или канала на YouTube</label>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... или https://www.youtube.com/@channel"
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">Количество комментариев для анализа</label>
              <div className="flex gap-2">
                {([50, 100, 200] as const).map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: count === n ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.06)',
                      color: count === n ? '#c4b5fd' : '#64748b',
                      border: count === n ? '1px solid rgba(124,58,237,0.5)' : '1px solid rgba(255,255,255,0.1)',
                    }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading || !url}
              className="btn-gradient py-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
              {loading
                ? <span className="flex items-center justify-center gap-2"><Spinner /> Анализирую комментарии...</span>
                : 'Анализировать · −4 кр.'}
            </button>
          </form>
        </Card>
      )}

      {displayResult && (
        <div className="flex flex-col gap-4 analytics-result">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{displayResult.topic}</p>
              <p className="text-xs text-slate-500 mt-0.5">Проанализировано {displayResult.comments_count} комментариев</p>
            </div>
            <PrintBtn />
          </div>

          {/* Video requests */}
          {displayResult.video_requests.length > 0 && (
            <Card>
              <SectionTitle>Аудитория просит снять</SectionTitle>
              <ul className="flex flex-col gap-2">
                {displayResult.video_requests.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="shrink-0">🎬</span>
                    <span className="text-slate-200">{r.request}</span>
                    {r.count > 1 && (
                      <span className="ml-auto shrink-0 text-xs text-violet-300 bg-violet-500/15 px-2 py-0.5 rounded-full">
                        {r.count} упом.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Video ideas (main block) */}
          {displayResult.video_ideas.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)' }}>
              <SectionTitle>Готовые идеи для видео</SectionTitle>
              <div className="flex flex-col gap-4">
                {displayResult.video_ideas.map((idea, i) => (
                  <div key={i} className="rounded-xl p-4 flex flex-col gap-2"
                    style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}>
                    <p className="text-sm font-semibold text-white">💡 {idea.title}</p>
                    <p className="text-xs text-slate-400"><span className="text-slate-500">Почему сработает: </span>{idea.reason}</p>
                    <p className="text-xs text-slate-600 italic">Из комментария: «{idea.based_on}»</p>
                    <button
                      onClick={() => goToStudio(idea.title)}
                      className="no-print self-start mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-violet-300 transition-all hover:text-white"
                      style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.35)' }}>
                      🎬 Создать это видео →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two-column: pain points + unanswered */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {displayResult.pain_points.length > 0 && (
              <Card>
                <SectionTitle>Боли аудитории</SectionTitle>
                <ul className="flex flex-col gap-2">
                  {displayResult.pain_points.map((p, i) => (
                    <li key={i} className="text-sm text-slate-300 flex gap-2">
                      <span className="shrink-0">😤</span>{p}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {displayResult.unanswered_questions.length > 0 && (
              <Card>
                <SectionTitle>Незакрытые вопросы</SectionTitle>
                <ul className="flex flex-col gap-2">
                  {displayResult.unanswered_questions.map((q, i) => (
                    <li key={i} className="text-sm text-slate-300 flex gap-2">
                      <span className="shrink-0">❓</span>{q}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {/* Two-column: positive + negative */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {displayResult.positive_reactions.length > 0 && (
              <Card>
                <SectionTitle>Что понравилось</SectionTitle>
                <ul className="flex flex-col gap-2">
                  {displayResult.positive_reactions.map((r, i) => (
                    <li key={i} className="text-sm text-slate-300 flex gap-2">
                      <span className="shrink-0">👍</span>{r}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {displayResult.negative_reactions.length > 0 && (
              <Card>
                <SectionTitle>Что не понравилось</SectionTitle>
                <ul className="flex flex-col gap-2">
                  {displayResult.negative_reactions.map((r, i) => (
                    <li key={i} className="text-sm text-slate-300 flex gap-2">
                      <span className="shrink-0">👎</span>{r}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {/* Audience portrait */}
          {displayResult.audience_portrait && (
            <Card>
              <SectionTitle>Портрет аудитории</SectionTitle>
              <p className="text-sm text-slate-300 leading-relaxed">
                👥 {displayResult.audience_portrait}
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Keywords Tab ────────────────────────────────────────────────────────────

function difficultyColor(d: number): { bg: string; color: string } {
  if (d <= 4) return { bg: 'rgba(34,197,94,0.1)',  color: '#4ade80' }
  if (d <= 7) return { bg: 'rgba(234,179,8,0.1)',  color: '#facc15' }
  return             { bg: 'rgba(239,68,68,0.1)',  color: '#f87171' }
}

function MiniBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(100, (value / 10) * 100)
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs" style={{ color }}>{value}/10</span>
    </div>
  )
}

function KeywordsTab({
  externalResult,
  onClearExternal,
}: {
  externalResult: KeywordsResult | null
  onClearExternal: () => void
}) {
  const router = useRouter()
  const { setScriptParams, setStep } = useStudioStore()
  const [keyword, setKeyword] = useState('')
  const [lang, setLang] = useState<'ru' | 'en'>('ru')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<KeywordsResult | null>(null)

  const displayResult = externalResult ?? result

  function goToStudio(topic: string) {
    setScriptParams({ topic })
    setStep(1)
    router.push('/studio')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analytics/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, lang }),
      })
      const json = await res.json() as { ok: boolean; data?: KeywordsResult; error?: string; code?: string }
      if (!json.ok) { setError(json.error ?? 'Ошибка'); return }
      setResult(json.data!)
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {externalResult && (
        <button onClick={onClearExternal}
          className="no-print self-start flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
          ← Новый анализ
        </button>
      )}

      {!externalResult && (
        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">Ключевое слово или тема</label>
              <input
                type="text"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder='Например: "автомобили", "личные финансы"'
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">Язык поиска</label>
              <div className="flex gap-2">
                {(['ru', 'en'] as const).map(l => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLang(l)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: lang === l ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.06)',
                      color: lang === l ? '#c4b5fd' : '#64748b',
                      border: lang === l ? '1px solid rgba(124,58,237,0.5)' : '1px solid rgba(255,255,255,0.1)',
                    }}>
                    {l === 'ru' ? '🇷🇺 Русский' : '🇺🇸 Английский'}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading || !keyword}
              className="btn-gradient py-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
              {loading
                ? <span className="flex items-center justify-center gap-2"><Spinner /> Ищу ключевые слова...</span>
                : 'Найти ключевые слова · −3 кр.'}
            </button>
          </form>
        </Card>
      )}

      {displayResult && (
        <div className="flex flex-col gap-4 analytics-result">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">«{displayResult.keyword}»</p>
              <p className="text-xs text-slate-500 mt-0.5">Найдено ключевых слов: {displayResult.total}</p>
            </div>
            <PrintBtn />
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-green-300 bg-green-500/15">
              🟢 Лёгкие: {displayResult.easy}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-yellow-300 bg-yellow-500/15">
              🟡 Средние: {displayResult.medium}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-red-300 bg-red-500/15">
              🔴 Сложные: {displayResult.hard}
            </span>
          </div>

          {/* Best keywords */}
          {displayResult.best_keywords.length > 0 && (
            <Card>
              <SectionTitle>Топ ключевые слова для старта</SectionTitle>
              <div className="flex flex-col gap-3">
                {displayResult.best_keywords.map((kw, i) => {
                  const item = displayResult.keywords.find(k => k.keyword === kw)
                  return (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-violet-400 shrink-0">🌟</span>
                        <span className="text-sm font-medium text-white truncate">{kw}</span>
                      </div>
                      {item && (
                        <div className="flex items-center gap-3 shrink-0 text-xs text-slate-400">
                          <span>Потенциал {item.potential}/10</span>
                          <span>·</span>
                          <span>Сложность {item.difficulty}/10</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Full keywords table */}
          <Card>
            <SectionTitle>Все ключевые слова</SectionTitle>
            <div className="flex flex-col gap-2">
              {displayResult.keywords.map((kw, i) => {
                const dc = difficultyColor(kw.difficulty)
                return (
                  <div key={i} className="rounded-xl p-3 flex flex-col gap-2"
                    style={{ background: dc.bg, border: `1px solid ${dc.color}22` }}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-white">{kw.keyword}</p>
                      <span className="text-xs shrink-0 px-2 py-0.5 rounded-full"
                        style={{ background: `${dc.color}22`, color: dc.color }}>
                        {kw.competition}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 w-16">Сложность</span>
                        <MiniBar value={kw.difficulty} color={dc.color} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 w-16">Потенциал</span>
                        <MiniBar value={kw.potential} color="#a78bfa" />
                      </div>
                    </div>
                    {kw.avg_views > 0 && (
                      <p className="text-xs text-slate-500">Ср. просмотры топ-5: {fmtNum(kw.avg_views)}</p>
                    )}
                    <p className="text-xs text-slate-400 italic">{kw.recommendation}</p>
                    <button
                      onClick={() => goToStudio(kw.keyword)}
                      className="no-print self-start flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-violet-300 hover:text-white transition-colors"
                      style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}>
                      🎬 Создать видео по этому запросу →
                    </button>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Low competition */}
          {displayResult.low_competition.length > 0 && (
            <Card>
              <SectionTitle>Ключевые слова с низкой конкуренцией</SectionTitle>
              <div className="flex flex-col gap-2">
                {displayResult.low_competition.map((kw, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 text-sm">🟢</span>
                      <span className="text-sm text-slate-200">{kw}</span>
                    </div>
                    <button
                      onClick={() => goToStudio(kw)}
                      className="no-print shrink-0 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                      🎬 Создать →
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Insights */}
          {displayResult.insights && (
            <Card>
              <SectionTitle>Вывод по нише</SectionTitle>
              <p className="text-sm text-slate-300 leading-relaxed">{displayResult.insights}</p>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Compare Tab ─────────────────────────────────────────────────────────────

function CompareTab({
  externalResult,
  onClearExternal,
}: {
  externalResult: CompareResult | null
  onClearExternal: () => void
}) {
  const router = useRouter()
  const { setScriptParams, setStep } = useStudioStore()
  const [inputs, setInputs] = useState(['', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompareResult | null>(null)

  const displayResult = externalResult ?? result

  function setInput(i: number, val: string) {
    setInputs(prev => { const n = [...prev]; n[i] = val; return n })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const channels = inputs.map(s => s.trim()).filter(Boolean)
    if (channels.length < 2) { setError('Введите минимум 2 канала'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analytics/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels }),
      })
      const json = await res.json() as { ok: boolean; data?: CompareResult; error?: string; code?: string }
      if (!json.ok) { setError(json.error ?? 'Ошибка'); return }
      setResult(json.data!)
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  // Normalize score 0-100 for radar bars
  function barPct(val: number, max: number): number {
    return max > 0 ? Math.round((val / max) * 100) : 0
  }

  const CHANNEL_COLORS = ['#a78bfa', '#34d399', '#fb923c']

  return (
    <div className="flex flex-col gap-6">
      {externalResult && (
        <button onClick={onClearExternal}
          className="no-print self-start flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
          ← Новое сравнение
        </button>
      )}

      {!externalResult && (
        <Card>
          <p className="text-xs text-slate-500 mb-4">Сравните до 3 каналов между собой</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {[
              { label: 'Ваш канал (или первый канал)', ph: 'URL, @handle или название' },
              { label: 'Конкурент 1', ph: 'URL, @handle или название' },
              { label: 'Конкурент 2 (необязательно)', ph: 'URL, @handle или название' },
            ].map(({ label, ph }, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-400">{label}</label>
                <input
                  type="text"
                  value={inputs[i]}
                  onChange={e => setInput(i, e.target.value)}
                  placeholder={ph}
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-violet-500/50"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                />
              </div>
            ))}
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading || inputs.filter(Boolean).length < 2}
              className="btn-gradient py-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
              {loading
                ? <span className="flex items-center justify-center gap-2"><Spinner /> Сравниваю каналы...</span>
                : 'Сравнить · −6 кр.'}
            </button>
          </form>
        </Card>
      )}

      {displayResult && (() => {
        const chs = displayResult.channels
        return (
          <div className="flex flex-col gap-4 analytics-result">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">
                {chs.map(c => c.name).join(' vs ')}
              </p>
              <PrintBtn />
            </div>

            {/* Winner badge */}
            {displayResult.winner.overall && (
              <div className="rounded-2xl p-4 text-center"
                style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)' }}>
                <p className="text-xs text-slate-400 mb-1">Победитель в общем зачёте</p>
                <p className="text-lg font-bold text-violet-300">🏆 {displayResult.winner.overall}</p>
              </div>
            )}

            {/* Comparison table */}
            <Card>
              <SectionTitle>Сравнение метрик</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left text-xs text-slate-500 pb-3 pr-4 font-medium">Метрика</th>
                      {chs.map((ch, i) => (
                        <th key={i} className="text-right text-xs pb-3 px-2 font-semibold"
                          style={{ color: CHANNEL_COLORS[i] }}>
                          {ch.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {[
                      {
                        label: 'Подписчики',
                        values: chs.map(c => fmtNum(c.subscribers)),
                        best: chs.reduce((bi, c, i) => c.subscribers > chs[bi].subscribers ? i : bi, 0),
                      },
                      {
                        label: 'Ср. просмотры',
                        values: chs.map(c => fmtNum(c.avg_views)),
                        best: chs.reduce((bi, c, i) => c.avg_views > chs[bi].avg_views ? i : bi, 0),
                      },
                      {
                        label: 'Видео/неделю',
                        values: chs.map(c => String(c.upload_frequency)),
                        best: chs.reduce((bi, c, i) => c.upload_frequency > chs[bi].upload_frequency ? i : bi, 0),
                      },
                      {
                        label: 'Вовлечённость',
                        values: chs.map(c => `${c.engagement_rate}%`),
                        best: chs.reduce((bi, c, i) => c.engagement_rate > chs[bi].engagement_rate ? i : bi, 0),
                      },
                      {
                        label: 'Всего видео',
                        values: chs.map(c => fmtNum(c.video_count)),
                        best: chs.reduce((bi, c, i) => c.video_count > chs[bi].video_count ? i : bi, 0),
                      },
                    ].map(row => (
                      <tr key={row.label}>
                        <td className="py-2.5 pr-4 text-slate-400 text-xs">{row.label}</td>
                        {row.values.map((val, i) => (
                          <td key={i} className="py-2.5 px-2 text-right">
                            <span className={row.best === i ? 'font-semibold text-white' : 'text-slate-400'}>
                              {val}{row.best === i ? ' 🏆' : ''}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Radar bars (visual comparison) */}
            <Card>
              <SectionTitle>Профиль каналов</SectionTitle>
              <div className="flex flex-col gap-4">
                {[
                  { label: 'Размер аудитории', vals: chs.map(c => barPct(c.subscribers, displayResult.max_subscribers)) },
                  { label: 'Средние просмотры', vals: chs.map(c => barPct(c.avg_views, displayResult.max_avg_views)) },
                  { label: 'Частота публикаций', vals: chs.map(c => barPct(c.upload_frequency, displayResult.max_upload_freq)) },
                  { label: 'Вовлечённость',      vals: chs.map(c => barPct(c.engagement_rate, displayResult.max_engagement)) },
                ].map(axis => (
                  <div key={axis.label}>
                    <p className="text-xs text-slate-500 mb-1.5">{axis.label}</p>
                    <div className="flex flex-col gap-1">
                      {chs.map((ch, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs w-24 truncate shrink-0" style={{ color: CHANNEL_COLORS[i] }}>
                            {ch.name}
                          </span>
                          <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            <div className="h-2 rounded-full transition-all"
                              style={{ width: `${axis.vals[i]}%`, background: CHANNEL_COLORS[i] }} />
                          </div>
                          <span className="text-xs text-slate-500 w-8 text-right">{axis.vals[i]}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Per-channel profile cards */}
            <div className="flex flex-col gap-3">
              {chs.map((ch, i) => (
                <div key={i} className="rounded-2xl p-4 flex flex-col gap-2"
                  style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${CHANNEL_COLORS[i]}33` }}>
                  <p className="text-sm font-semibold" style={{ color: CHANNEL_COLORS[i] }}>{ch.name}</p>
                  {ch.content_strategy && (
                    <p className="text-xs text-slate-300 leading-relaxed">📌 {ch.content_strategy}</p>
                  )}
                  {ch.winning_formula && (
                    <p className="text-xs text-violet-300">🏅 Формула успеха: {ch.winning_formula}</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-1">
                    {ch.strongest_metric && (
                      <span className="text-xs text-green-300 bg-green-500/10 px-2 py-0.5 rounded-full">💪 {ch.strongest_metric}</span>
                    )}
                    {ch.weakest_metric && (
                      <span className="text-xs text-red-300 bg-red-500/10 px-2 py-0.5 rounded-full">⚠ {ch.weakest_metric}</span>
                    )}
                    {ch.publish_days.length > 0 && (
                      <span className="text-xs text-slate-400 bg-white/5 px-2 py-0.5 rounded-full">📅 {ch.publish_days.join(', ')}</span>
                    )}
                  </div>
                  {ch.top_videos.length > 0 && (
                    <div className="mt-1">
                      <p className="text-xs text-slate-500 mb-1">Топ видео:</p>
                      <ul className="flex flex-col gap-1">
                        {ch.top_videos.slice(0, 3).map((v, j) => (
                          <li key={j} className="text-xs text-slate-400 flex gap-1.5 items-start">
                            <span className="text-slate-600 shrink-0">{j + 1}.</span>
                            <a href={v.url} target="_blank" rel="noopener noreferrer"
                              className="truncate hover:text-violet-300 transition-colors">
                              {v.title}
                            </a>
                            <span className="shrink-0 text-slate-600">{fmtNum(v.views)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Insights */}
            {displayResult.insights.length > 0 && (
              <Card>
                <SectionTitle>Что перенять у конкурентов</SectionTitle>
                <ul className="flex flex-col gap-2">
                  {displayResult.insights.map((ins, i) => (
                    <li key={i} className="text-sm text-slate-300 flex gap-2">
                      <span className="shrink-0 text-green-400">✅</span>{ins}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Recommendations */}
            {displayResult.recommendations.length > 0 && (
              <Card>
                <SectionTitle>Рекомендации</SectionTitle>
                <ul className="flex flex-col gap-2">
                  {displayResult.recommendations.map((r, i) => (
                    <li key={i} className="text-sm text-slate-300 flex gap-2">
                      <span className="text-violet-400 font-bold shrink-0">{i + 1}.</span>{r}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Opportunities */}
            {displayResult.opportunities.length > 0 && (
              <Card>
                <SectionTitle>Возможности</SectionTitle>
                <ul className="flex flex-col gap-2">
                  {displayResult.opportunities.map((op, i) => (
                    <li key={i} className="text-sm text-slate-300 flex gap-2">
                      <span className="shrink-0">🎯</span>{op}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Steal ideas */}
            {displayResult.steal_ideas.length > 0 && (
              <div className="rounded-2xl p-5" style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)' }}>
                <SectionTitle>💡 Идеи от конкурентов</SectionTitle>
                <div className="flex flex-col gap-4">
                  {displayResult.steal_ideas.map((idea, i) => {
                    const chIdx = chs.findIndex(c => c.name === idea.from_channel)
                    const color = chIdx >= 0 ? CHANNEL_COLORS[chIdx] : '#a78bfa'
                    return (
                      <div key={i} className="flex flex-col gap-2 rounded-xl p-3"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <p className="text-xs font-semibold" style={{ color }}>
                          От {idea.from_channel}
                        </p>
                        <p className="text-sm text-slate-200">{idea.idea}</p>
                        {idea.example_video && (
                          <p className="text-xs text-slate-500 italic">Пример: «{idea.example_video}»</p>
                        )}
                        <button
                          onClick={() => {
                            setScriptParams({ topic: idea.idea })
                            setStep(1)
                            router.push('/studio')
                          }}
                          className="no-print self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-300 hover:text-white transition-colors"
                          style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)' }}>
                          🎬 Создать похожее видео →
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─── History Tab ──────────────────────────────────────────────────────────────

// ─── Rising Stars ─────────────────────────────────────────────────────────────

function RisingStarsTab({
  externalResult,
  onClearExternal,
  onGoToChannel,
}: {
  externalResult?: RisingStarsResult | null
  onClearExternal?: () => void
  onGoToChannel: (channelUrl: string) => void
}) {
  const router = useRouter()
  const { setScriptParams, setStep } = useStudioStore()

  const [topic, setTopic] = useState('')
  const [subMin, setSubMin] = useState('1000')
  const [subMax, setSubMax] = useState('100000')
  const [monthsMax, setMonthsMax] = useState(12)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RisingStarsResult | null>(null)

  const displayResult = externalResult ?? result

  async function handleSearch() {
    if (!topic.trim()) { setError('Введите тему'); return }
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const res = await fetch('/api/analytics/rising-stars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          sub_min: parseInt(subMin) || 1000,
          sub_max: parseInt(subMax) || 100000,
          months_max: monthsMax,
        }),
      })
      const json = await res.json() as { ok: boolean; data?: RisingStarsResult; error?: string; code?: string }
      if (!json.ok) {
        setError(json.code === 'NO_CREDITS' ? 'Недостаточно кредитов' : (json.error ?? 'Ошибка'))
      } else {
        setResult(json.data!)
        void refreshCredits()
      }
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  function goToStudio() {
    setScriptParams({ topic: topic || (displayResult?.topic ?? '') })
    setStep(1)
    router.push('/studio')
  }

  return (
    <div className="flex flex-col gap-5">
      {externalResult && (
        <button onClick={onClearExternal}
          className="no-print self-start flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
          ← Новый поиск
        </button>
      )}

      {!externalResult && (
        <Card>
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Ниша / тема</label>
              <input
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && void handleSearch()}
                placeholder="Автомобили, Кулинария, Технологии..."
                className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Подписчиков от–до</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={subMin}
                  onChange={e => setSubMin(e.target.value)}
                  min={0}
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <span className="text-slate-500 text-sm">—</span>
                <input
                  type="number"
                  value={subMax}
                  onChange={e => setSubMax(e.target.value)}
                  min={0}
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Канал создан не позднее</label>
              <div className="flex gap-2">
                {([3, 6, 12, 0] as const).map(m => (
                  <button key={m} type="button" onClick={() => setMonthsMax(m)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: monthsMax === m ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${monthsMax === m ? 'rgba(124,58,237,0.6)' : 'rgba(255,255,255,0.1)'}`,
                      color: monthsMax === m ? '#c4b5fd' : '#94a3b8',
                    }}>
                    {m === 0 ? 'Любой' : `${m} мес`}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button onClick={() => void handleSearch()} disabled={loading}
              className="btn-gradient px-5 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? <Spinner /> : '🚀'}
              Найти восходящие каналы · −6 кр.
            </button>
          </div>
        </Card>
      )}

      {loading && (
        <Card>
          <div className="flex flex-col gap-3 py-2">
            {['Ищу каналы по теме...', 'Анализирую статистику...', 'Считаю метрики роста...', 'Анализирую паттерны (Claude)...'].map((step, i) => (
              <div key={i} className="flex items-center gap-3 text-sm" style={{ color: i === 0 ? '#a78bfa' : '#334155' }}>
                {i === 0 ? <Spinner /> : <span className="w-4 h-4" />}
                {step}
              </div>
            ))}
          </div>
        </Card>
      )}

      {displayResult && (
        <div className="flex flex-col gap-4 analytics-result">
          <div className="rounded-2xl p-4 text-center"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)' }}>
            <p className="text-base font-bold text-violet-300">
              🚀 Найдено {displayResult.total_found} восходящих каналов в нише «{displayResult.topic}»
            </p>
          </div>

          {displayResult.total_found === 0 && (
            <Card>
              <p className="text-sm text-slate-400 text-center py-4">
                По заданным критериям каналов не найдено. Попробуйте расширить диапазон подписчиков или увеличить период.
              </p>
            </Card>
          )}

          {displayResult.channels.map((ch, i) => (
            <div key={i} className="rounded-2xl p-5 flex flex-col gap-3"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-white">🚀 {ch.name}</h3>
                  <a href={ch.url} target="_blank" rel="noreferrer"
                    className="text-xs text-violet-400 hover:text-violet-300 transition-colors truncate block mt-0.5">
                    {ch.url}
                  </a>
                </div>
                <span className="text-2xl font-bold shrink-0"
                  style={{ color: ch.viral_ratio >= 5 ? '#4ade80' : ch.viral_ratio >= 2 ? '#facc15' : '#94a3b8' }}>
                  {ch.viral_ratio}×
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { icon: '📅', label: 'Возраст', value: `${ch.months_old} мес.` },
                  { icon: '👥', label: 'Подписчики', value: `${fmtNum(ch.subscribers)} (~${fmtNum(ch.monthly_growth_estimate)}/мес)` },
                  { icon: '🎬', label: 'Видео', value: `${ch.video_count}${ch.upload_frequency > 0 ? ` (${ch.upload_frequency}/нед)` : ''}` },
                  { icon: '👁', label: 'Ср. просмотры', value: fmtNum(ch.avg_views) },
                ].map(stat => (
                  <div key={stat.label} className="flex flex-col gap-0.5">
                    <p className="text-xs text-slate-500">{stat.icon} {stat.label}</p>
                    <p className="text-sm font-semibold text-white">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2 rounded-xl p-3"
                style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)' }}>
                <p className="text-xs text-slate-300">
                  <span className="text-amber-400">💡</span> <strong>Причина роста:</strong> {ch.growth_reason}
                </p>
                <p className="text-xs text-slate-300">
                  <span className="text-blue-400">🎯</span> <strong>Стратегия:</strong> {ch.strategy}
                </p>
                <p className="text-xs text-slate-300">
                  <span className="text-green-400">✅</span> <strong>Что перенять:</strong> {ch.key_takeaway}
                </p>
              </div>

              <button
                onClick={() => onGoToChannel(ch.url)}
                className="no-print self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                📊 Детальный анализ канала →
              </button>
            </div>
          ))}

          {displayResult.common_patterns.length > 0 && (
            <Card>
              <SectionTitle>Общие паттерны успеха</SectionTitle>
              <ul className="flex flex-col gap-2">
                {displayResult.common_patterns.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-300">
                    <span className="text-violet-400 shrink-0">📌</span>{p}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <button onClick={goToStudio}
            className="no-print btn-gradient w-full py-3.5 rounded-xl text-sm font-semibold text-white">
            🎬 Создать видео в этой нише →
          </button>
        </div>
      )}
    </div>
  )
}

const REPORT_ICONS: Record<string, string> = {
  niche: '🔍',
  trends: '🔥',
  channel: '📊',
  revenue: '💰',
  comments: '💬',
  keywords: '🔎',
  compare: '⚡',
  rising_stars: '🚀',
}

function HistoryTab({ onOpen }: { onOpen: (report: AnalyticsReport) => void }) {
  const [reports, setReports] = useState<AnalyticsReport[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { void loadReports() }, [])

  async function loadReports() {
    setLoading(true)
    try {
      const res = await fetch('/api/analytics/reports')
      const json = await res.json() as { ok: boolean; reports?: AnalyticsReport[] }
      if (json.ok) setReports(json.reports ?? [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await fetch('/api/analytics/reports', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setReports(prev => prev.filter(r => r.id !== id))
    } catch {
      // ignore
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
        <span className="ml-2 text-sm text-slate-400">Загрузка истории...</span>
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <p className="text-4xl">📋</p>
        <p className="text-slate-400 text-sm">История отчётов пуста</p>
        <p className="text-slate-600 text-xs">Проведите анализ ниши, трендов или канала — он сохранится автоматически</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500 text-right">{reports.length} / 20 отчётов сохранено</p>
      {reports.map(report => (
        <div key={report.id} className="rounded-2xl p-4 flex items-center gap-4"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-2xl shrink-0">{REPORT_ICONS[report.report_type] ?? '📋'}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{report.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{fmtDate(report.created_at)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onOpen(report)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-violet-300 transition-all hover:text-white"
              style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>
              Открыть
            </button>
            <button
              onClick={() => void handleDelete(report.id)}
              disabled={deletingId === report.id}
              className="px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {deletingId === report.id ? <Spinner /> : '🗑'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'niche' | 'trends' | 'channel' | 'revenue' | 'comments' | 'keywords' | 'compare' | 'rising_stars' | 'history'

export default function AnalyticsPage() {
  const { t } = useLang()
  const [tab, setTab] = useState<Tab>('niche')
  const [openedReport, setOpenedReport] = useState<AnalyticsReport | null>(null)
  const [pendingChannelQuery, setPendingChannelQuery] = useState<string | null>(null)

  function handleOpenReport(report: AnalyticsReport) {
    setOpenedReport(report)
    setTab(report.report_type)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function clearOpenedReport() {
    setOpenedReport(null)
  }

  function handleGoToChannel(channelUrl: string) {
    setPendingChannelQuery(channelUrl)
    setTab('channel')
    clearOpenedReport()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'niche',         label: t('analytics.tab_niche') },
    { id: 'trends',        label: t('analytics.tab_trends') },
    { id: 'channel',       label: t('analytics.tab_channel') },
    { id: 'revenue',       label: t('analytics.tab_revenue') },
    { id: 'comments',      label: t('analytics.tab_comments') },
    { id: 'keywords',      label: t('analytics.tab_keywords') },
    { id: 'compare',       label: t('analytics.tab_compare') },
    { id: 'rising_stars',  label: t('analytics.tab_rising_stars') },
    { id: 'history',       label: t('analytics.tab_history') },
  ]

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          aside, nav, .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          .analytics-result > * { background: white !important; border-color: #e2e8f0 !important; color: black !important; }
          .analytics-result h3, .analytics-result p, .analytics-result span, .analytics-result td, .analytics-result th { color: black !important; }
          .analytics-result a { color: #3b82f6 !important; }
          @page { margin: 1cm; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 no-print">
          <h1 className="text-2xl font-bold text-white mb-1">{t('analytics.title')}</h1>
          <p className="text-slate-400 text-sm">{t('analytics.subtitle')}</p>
        </div>

        {/* Print header (only visible on print) */}
        <div className="hidden print:block mb-6">
          <h1 className="text-2xl font-bold">YouTubeGen — Отчёт аналитики</h1>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>

        {/* Tabs */}
        <div className="no-print flex gap-1 mb-6 p-1 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {TABS.map(({ id, label }) => (
            <button key={id} onClick={() => { setTab(id); if (id !== openedReport?.report_type) clearOpenedReport() }}
              className="flex-1 py-2.5 px-2 rounded-lg text-xs sm:text-sm font-medium transition-all"
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
        {tab === 'niche' && (
          <NicheTab
            externalResult={openedReport?.report_type === 'niche' ? openedReport.result as NicheResult : null}
            onClearExternal={clearOpenedReport}
          />
        )}
        {tab === 'trends' && (
          <TrendsTab
            externalResult={openedReport?.report_type === 'trends' ? openedReport.result as TrendResult : null}
            onClearExternal={clearOpenedReport}
          />
        )}
        {tab === 'channel' && (
          <ChannelTab
            externalResult={openedReport?.report_type === 'channel' ? openedReport.result as ChannelResult : null}
            onClearExternal={clearOpenedReport}
            initialChannel={pendingChannelQuery ?? undefined}
          />
        )}
        {tab === 'revenue' && (
          <RevenueTab
            externalResult={openedReport?.report_type === 'revenue' ? openedReport.result as RevenueResult : null}
            onClearExternal={clearOpenedReport}
          />
        )}
        {tab === 'comments' && (
          <CommentsTab
            externalResult={openedReport?.report_type === 'comments' ? openedReport.result as CommentsResult : null}
            onClearExternal={clearOpenedReport}
          />
        )}
        {tab === 'keywords' && (
          <KeywordsTab
            externalResult={openedReport?.report_type === 'keywords' ? openedReport.result as KeywordsResult : null}
            onClearExternal={clearOpenedReport}
          />
        )}
        {tab === 'compare' && (
          <CompareTab
            externalResult={openedReport?.report_type === 'compare' ? openedReport.result as CompareResult : null}
            onClearExternal={clearOpenedReport}
          />
        )}
        {tab === 'rising_stars' && (
          <RisingStarsTab
            externalResult={openedReport?.report_type === 'rising_stars' ? openedReport.result as RisingStarsResult : null}
            onClearExternal={clearOpenedReport}
            onGoToChannel={handleGoToChannel}
          />
        )}
        {tab === 'history' && <HistoryTab onOpen={handleOpenReport} />}
      </div>
    </>
  )
}
