'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLang } from '@/hooks/useLang'
import { useLangStore } from '@/lib/lang-store'
import { createClient } from '@/lib/supabase'
import type { Profile } from '@/lib/types'
import type { Lang } from '@/lib/i18n'

interface Props {
  profile: Profile | null
}

export default function SettingsClient({ profile }: Props) {
  const { t } = useLang()
  const { lang, setLang } = useLangStore()
  const router = useRouter()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  async function handleSaveProfile() {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, avatar_url: avatarUrl }),
      })
      const json: { ok: boolean; error?: string } = await res.json()
      if (!json.ok) {
        setSaveError(json.error ?? 'Error')
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function switchLang(l: Lang) {
    setLang(l)
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferred_lang: l }),
      })
    } catch {}
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const initials = (profile?.full_name ?? profile?.email ?? '?')[0].toUpperCase()
  const planDisplay = profile?.plan
    ? profile.plan.charAt(0).toUpperCase() + profile.plan.slice(1)
    : 'Free'

  const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
  const inputCls = 'w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-violet-500/50'
  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">{t('settings.title')}</h1>
      </div>

      <div className="flex flex-col gap-5">

        {/* 1. Profile */}
        <div className="rounded-2xl p-6 flex flex-col gap-5" style={cardStyle}>
          <h2 className="text-base font-semibold text-slate-100">{t('settings.profile')}</h2>

          {/* Avatar preview */}
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold overflow-hidden shrink-0"
              style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', color: '#A78BFA' }}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={avatarUrl}
                  src={avatarUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                initials
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{profile?.full_name ?? profile?.email}</p>
              <p className="text-xs text-slate-500">{profile?.email}</p>
            </div>
          </div>

          {/* Full name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              {t('settings.display_name')}
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={60}
              className={inputCls}
              style={inputStyle}
            />
          </div>

          {/* Email (readonly) */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              {t('settings.email')}
            </label>
            <input
              type="email"
              value={profile?.email ?? ''}
              disabled
              className={inputCls + ' opacity-50 cursor-not-allowed'}
              style={inputStyle}
            />
            <p className="text-xs text-slate-600 mt-1">{t('settings.email_readonly')}</p>
          </div>

          {/* Avatar URL */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              {t('settings.avatar_url')}
            </label>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              className={inputCls}
              style={inputStyle}
            />
          </div>

          {saveError && (
            <p className="text-sm text-red-400">{saveError}</p>
          )}

          <button
            type="button"
            onClick={() => void handleSaveProfile()}
            disabled={saving}
            className="self-start px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={
              saved
                ? { background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399' }
                : { background: 'rgba(124,58,237,0.25)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }
            }
          >
            {saved ? t('settings.saved') : saving ? '…' : t('settings.save')}
          </button>
        </div>

        {/* 2. Language */}
        <div className="rounded-2xl p-6 flex flex-col gap-4" style={cardStyle}>
          <h2 className="text-base font-semibold text-slate-100">{t('settings.language')}</h2>
          <div
            className="flex items-center rounded-lg overflow-hidden text-sm font-semibold self-start"
            style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}
          >
            {(['ru', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => void switchLang(l)}
                className="px-5 py-2.5 transition-all uppercase"
                style={
                  lang === l
                    ? { background: 'rgba(124,58,237,0.6)', color: '#fff' }
                    : { color: '#94a3b8' }
                }
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Appearance */}
        <div className="rounded-2xl p-6 flex flex-col gap-4" style={cardStyle}>
          <h2 className="text-base font-semibold text-slate-100">{t('settings.appearance')}</h2>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <span className="text-sm text-slate-400">{t('settings.theme')}</span>
            <div className="flex items-center gap-2">
              <div
                className="flex items-center rounded-lg overflow-hidden text-sm font-medium opacity-40 cursor-not-allowed select-none"
                style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}
              >
                <span className="px-4 py-2 text-slate-400">
                  {lang === 'en' ? '🌙 Dark' : '🌙 Тёмная'}
                </span>
                <span className="px-4 py-2 text-slate-400" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
                  {lang === 'en' ? '☀️ Light' : '☀️ Светлая'}
                </span>
              </div>
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }}
              >
                {t('settings.coming_soon')}
              </span>
            </div>
          </div>
        </div>

        {/* 4. Account */}
        <div className="rounded-2xl p-6 flex flex-col gap-4" style={cardStyle}>
          <h2 className="text-base font-semibold text-slate-100">{t('settings.account')}</h2>

          <div
            className="flex items-center justify-between py-3"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
          >
            <span className="text-sm text-slate-400">{t('settings.current_plan')}</span>
            <span className="text-sm font-semibold text-slate-200">{planDisplay}</span>
          </div>

          <Link
            href="/billing"
            className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)', color: '#c4b5fd' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            {t('settings.manage_billing')}
          </Link>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '16px' }}>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t('settings.sign_out')}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
