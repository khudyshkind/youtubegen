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

  const [ytKey, setYtKey] = useState('')
  const [ytKeyValidating, setYtKeyValidating] = useState(false)
  const [ytKeyError, setYtKeyError] = useState('')
  const [ytKeyConnected, setYtKeyConnected] = useState(!!profile?.encrypted_yt_key)
  const [showYtGuide, setShowYtGuide] = useState(false)

  const [tgLinked, setTgLinked] = useState(!!profile?.telegram_chat_id)
  const [tgBusy, setTgBusy] = useState(false)
  const [tgError, setTgError] = useState('')

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

  async function handleSaveYtKey() {
    setYtKeyValidating(true)
    setYtKeyError('')
    try {
      const res = await fetch('/api/settings/save-yt-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: ytKey.trim() }),
      })
      const json = await res.json() as { ok: boolean; code?: string; error?: string }
      if (!json.ok) {
        const code = json.code ?? ''
        if (code === 'invalid_format') setYtKeyError(t('settings.yt_api_key_error_format'))
        else if (code === 'invalid_key') setYtKeyError(t('settings.yt_api_key_error_invalid'))
        else if (code === 'quota_exceeded') setYtKeyError(t('settings.yt_api_key_error_quota'))
        else if (code === 'key_restricted') setYtKeyError(t('settings.yt_api_key_error_restricted'))
        else setYtKeyError(json.error ?? 'Error')
      } else {
        setYtKeyConnected(true)
        setYtKey('')
      }
    } catch {
      setYtKeyError('Network error')
    } finally {
      setYtKeyValidating(false)
    }
  }

  async function handleDeleteYtKey() {
    setYtKeyValidating(true)
    try {
      await fetch('/api/settings/save-yt-key', { method: 'DELETE' })
      setYtKeyConnected(false)
    } catch {}
    finally {
      setYtKeyValidating(false)
    }
  }

  async function handleConnectTelegram() {
    setTgBusy(true)
    setTgError('')
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' })
      const json = await res.json() as { ok: boolean; link?: string; error?: string }
      if (!json.ok) { setTgError(json.error ?? 'Error'); return }
      window.open(json.link!, '_blank', 'noopener')
    } catch {
      setTgError('Network error')
    } finally {
      setTgBusy(false)
    }
  }

  async function handleDisconnectTelegram() {
    setTgBusy(true)
    setTgError('')
    try {
      const res = await fetch('/api/telegram/link', { method: 'DELETE' })
      const json = await res.json() as { ok: boolean; error?: string }
      if (!json.ok) { setTgError(json.error ?? 'Error'); return }
      setTgLinked(false)
    } catch {
      setTgError('Network error')
    } finally {
      setTgBusy(false)
    }
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

        {/* 3. YouTube API Key (BYOK) */}
        <div id="yt-key-guide" className="rounded-2xl p-6 flex flex-col gap-4" style={cardStyle}>
          <div>
            <h2 className="text-base font-semibold text-slate-100">{t('settings.yt_api_key')}</h2>
            <p className="text-xs text-slate-500 mt-1">{t('settings.yt_api_key_desc')}</p>
          </div>

          <div
            className="flex items-center gap-2 text-xs rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa' }}
          >
            <span>🔑</span>
            <span>{t('settings.yt_api_key_discount')}</span>
          </div>

          {ytKeyConnected ? (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-sm font-medium" style={{ color: '#34d399' }}>{t('settings.yt_api_key_saved')}</span>
              <button
                type="button"
                onClick={() => void handleDeleteYtKey()}
                disabled={ytKeyValidating}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
              >
                {ytKeyValidating ? '…' : t('settings.yt_api_key_delete')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <input
                type="password"
                value={ytKey}
                onChange={(e) => setYtKey(e.target.value)}
                placeholder={t('settings.yt_api_key_placeholder')}
                autoComplete="off"
                spellCheck={false}
                className={inputCls}
                style={inputStyle}
              />
              {ytKeyError && (
                <p className="text-xs text-red-400">{ytKeyError}</p>
              )}
              <button
                type="button"
                onClick={() => void handleSaveYtKey()}
                disabled={ytKeyValidating || !ytKey.trim()}
                className="self-start px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                style={{ background: 'rgba(124,58,237,0.25)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }}
              >
                {ytKeyValidating ? t('settings.yt_api_key_validating') : t('settings.yt_api_key_validate')}
              </button>
            </div>
          )}

          <p className="text-xs text-slate-600">{t('settings.yt_api_key_warning')}</p>

          {/* Step-by-step guide */}
          <button
            type="button"
            onClick={() => setShowYtGuide(v => !v)}
            className="flex items-center gap-1.5 text-xs transition-colors self-start"
            style={{ color: '#7c3aed' }}
          >
            <svg className={`w-3 h-3 transition-transform ${showYtGuide ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {lang === 'en' ? 'How to get a YouTube API key' : 'Как получить YouTube API-ключ'}
          </button>

          {showYtGuide && (
            <div className="rounded-xl p-4 flex flex-col gap-3 text-xs"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {lang === 'en' ? (
                <>
                  <p className="text-slate-400 font-medium">Step-by-step: Google Cloud Console</p>
                  <ol className="flex flex-col gap-2.5 text-slate-400 list-none">
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">1.</span><span>Open <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline">console.cloud.google.com</a></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">2.</span><span>Click the project selector at the top (next to "Google Cloud") → <strong className="text-slate-300">New Project</strong> → enter a name → <strong className="text-slate-300">Create</strong></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">3.</span><span>Left sidebar → <strong className="text-slate-300">APIs &amp; Services</strong> → <strong className="text-slate-300">Library</strong></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">4.</span><span>Search <strong className="text-slate-300">YouTube Data API v3</strong> → click it → <strong className="text-slate-300">Enable</strong></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">5.</span><span>Left sidebar → <strong className="text-slate-300">APIs &amp; Services</strong> → <strong className="text-slate-300">Credentials</strong></span></li>
                    <li className="flex gap-2">
                      <span className="text-violet-400 font-bold shrink-0">6.</span>
                      <span>Click <strong className="text-slate-300">+ Create Credentials</strong> at the top of the page.
                        <ul className="flex flex-col gap-1.5 mt-1.5 ml-1 list-none">
                          <li className="flex gap-1.5"><span className="shrink-0 text-slate-500">•</span><span>If a <strong className="text-slate-300">dropdown menu</strong> appears — choose <strong className="text-slate-300">API key</strong>. The key is created immediately.</span></li>
                          <li className="flex gap-1.5"><span className="shrink-0 text-slate-500">•</span><span>If a <strong className="text-slate-300">wizard</strong> opens asking <em>"Which API are you using?"</em> — select <strong className="text-slate-300">YouTube Data API v3</strong>, then under <em>"What data will you be accessing?"</em> choose <strong className="text-slate-300">Public data</strong> and click <strong className="text-slate-300">Next</strong>. <span className="text-slate-500">(Public data creates an API key; User data creates an OAuth client, which won&apos;t work here.)</span></span></li>
                        </ul>
                      </span>
                    </li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">7.</span><span>Copy the key — it starts with <code className="text-amber-300">AIza</code></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">8.</span><span>Do <strong className="text-red-400">not</strong> set HTTP referrer or IP restrictions — our servers must be able to use the key without restrictions</span></li>
                  </ol>
                  <div className="rounded-lg px-3 py-2 text-slate-400 mt-1" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <strong className="text-amber-300">Default quota:</strong> 10,000 units/day. Sub-niche search uses ~2,300 units per run (≈ 4 runs/day). If you need more, request a quota increase in Google Cloud Console.
                  </div>
                </>
              ) : (
                <>
                  <p className="text-slate-400 font-medium">Пошаговая инструкция: Google Cloud Console</p>
                  <ol className="flex flex-col gap-2.5 text-slate-400 list-none">
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">1.</span><span>Откройте <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline">console.cloud.google.com</a></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">2.</span><span>Нажмите на выбор проекта вверху (рядом с «Google Cloud») → <strong className="text-slate-300">Новый проект</strong> → введите название → <strong className="text-slate-300">Создать</strong></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">3.</span><span>Боковое меню → <strong className="text-slate-300">API и сервисы</strong> → <strong className="text-slate-300">Библиотека</strong></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">4.</span><span>Найдите <strong className="text-slate-300">YouTube Data API v3</strong> → нажмите → <strong className="text-slate-300">Включить</strong></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">5.</span><span>Боковое меню → <strong className="text-slate-300">API и сервисы</strong> → <strong className="text-slate-300">Учётные данные</strong></span></li>
                    <li className="flex gap-2">
                      <span className="text-violet-400 font-bold shrink-0">6.</span>
                      <span>Нажмите <strong className="text-slate-300">+ Создать учётные данные</strong> вверху страницы.
                        <ul className="flex flex-col gap-1.5 mt-1.5 ml-1 list-none">
                          <li className="flex gap-1.5"><span className="shrink-0 text-slate-500">•</span><span>Если открылось <strong className="text-slate-300">выпадающее меню</strong> — выберите <strong className="text-slate-300">Ключ API</strong>. Ключ создастся сразу.</span></li>
                          <li className="flex gap-1.5"><span className="shrink-0 text-slate-500">•</span><span>Если открылся <strong className="text-slate-300">мастер</strong> с вопросом <em>«Which API are you using?»</em> — выберите <strong className="text-slate-300">YouTube Data API v3</strong>, затем в разделе <em>«What data will you be accessing?»</em> отметьте <strong className="text-slate-300">Public data</strong> и нажмите <strong className="text-slate-300">Next</strong>. <span className="text-slate-500">(Public data создаёт API-ключ; User data создаёт OAuth-клиент — он не подойдёт.)</span></span></li>
                        </ul>
                      </span>
                    </li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">7.</span><span>Скопируйте ключ — он начинается с <code className="text-amber-300">AIza</code></span></li>
                    <li className="flex gap-2"><span className="text-violet-400 font-bold shrink-0">8.</span><span><strong className="text-red-400">Не устанавливайте</strong> ограничения по IP-адресам или HTTP-реферерам — наши серверы должны использовать ключ без ограничений</span></li>
                  </ol>
                  <div className="rounded-lg px-3 py-2 text-slate-400 mt-1" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <strong className="text-amber-300">Квота по умолчанию:</strong> 10 000 единиц в день. Один прогон поиска подниш занимает ~2 300 единиц (≈ 4 прогона в день). Если нужно больше — запросите увеличение квоты в Google Cloud Console.
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 4. Telegram notifications */}
        <div className="rounded-2xl p-6 flex flex-col gap-4" style={cardStyle}>
          <div>
            <h2 className="text-base font-semibold text-slate-100">Telegram-уведомления</h2>
            <p className="text-xs text-slate-500 mt-1">
              Бот пришлёт сообщение, когда иллюстрации, озвучка или видео будут готовы.
            </p>
          </div>

          {tgLinked ? (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-sm font-medium" style={{ color: '#34d399' }}>✓ Подключено</span>
              <button
                type="button"
                onClick={() => void handleDisconnectTelegram()}
                disabled={tgBusy}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
              >
                {tgBusy ? '…' : 'Отвязать'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => void handleConnectTelegram()}
                disabled={tgBusy}
                className="self-start flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                style={{ background: 'rgba(124,58,237,0.25)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }}
              >
                {tgBusy ? '…' : '✈️ Подключить Telegram'}
              </button>
              <p className="text-xs text-slate-600">
                Откроется бот Lefiro — нажмите Start, и привязка завершится автоматически.
              </p>
            </div>
          )}

          {tgError && <p className="text-xs text-red-400">{tgError}</p>}
        </div>

        {/* 5. Appearance */}
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
