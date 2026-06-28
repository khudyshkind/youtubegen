'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useStudioStore } from '@/lib/studio-store'
import { useLang } from '@/hooks/useLang'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/types'
import type { Lang } from '@/lib/i18n'

function LangSwitcher() {
  const { lang, setLang } = useLang()

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

  return (
    <div
      className="flex items-center rounded-lg overflow-hidden text-xs font-semibold"
      style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}
    >
      {(['ru', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchLang(l)}
          className="px-2.5 py-1.5 transition-all uppercase"
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
  )
}

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [creditsFlash, setCreditsFlash] = useState(false)
  const storeCredits = useStudioStore((s) => s.credits)
  const setStoreCredits = useStudioStore((s) => s.setCredits)
  const prevCreditsRef = useRef<number | null>(null)
  const { t, setLang } = useLang()

  const supabase = createClient()
  const displayCredits = storeCredits ?? profile?.credits ?? null

  useEffect(() => {
    if (storeCredits === null) return
    if (prevCreditsRef.current !== null && storeCredits < prevCreditsRef.current) {
      setCreditsFlash(true)
      const timer = setTimeout(() => setCreditsFlash(false), 600)
      prevCreditsRef.current = storeCredits
      return () => clearTimeout(timer)
    }
    prevCreditsRef.current = storeCredits
  }, [storeCredits])

  async function fetchCredits() {
    try {
      const res = await fetch('/api/profile')
      if (!res.ok) return
      const json: { ok: boolean; credits?: number; preferred_lang?: string } = await res.json()
      if (json.ok && typeof json.credits === 'number') {
        setStoreCredits(json.credits)
      }
      if (json.ok && json.preferred_lang && ['ru', 'en'].includes(json.preferred_lang)) {
        setLang(json.preferred_lang as Lang)
      }
    } catch {}
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_, session) => {
        const currentUser = session?.user ?? null
        setUser(currentUser)

        if (currentUser) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single()
          const p = data as Profile | null
          setProfile(p)
          if (p && typeof p.credits === 'number') setStoreCredits(p.credits)
          if (p?.preferred_lang && ['ru', 'en'].includes(p.preferred_lang)) {
            setLang(p.preferred_lang as Lang)
          }
        } else {
          setProfile(null)
        }
      }
    )
    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return
    const interval = setInterval(fetchCredits, 10_000)
    return () => clearInterval(interval)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSignOut() {
    setMenuOpen(false)
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  if (pathname.startsWith('/auth/')) return null

  const isLanding = pathname === '/'

  return (
    <header
      className="sticky top-0 z-50 transition-all duration-300"
      style={{
        background: 'rgba(10,10,15,0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link
            href={user ? '/dashboard' : '/'}
            className="flex items-center gap-2 text-xl font-bold hover:opacity-80 transition-opacity"
          >
            <span
              className="text-2xl"
              style={{
                background: 'linear-gradient(135deg, #A78BFA, #60A5FA)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              ▶
            </span>
            <span className="gradient-text">YouTubeGen</span>
          </Link>

          {/* Right side */}
          {user ? (
            <div className="flex items-center gap-3">
              {/* Credits badge */}
              <div
                className="hidden sm:flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors"
                style={{
                  background: creditsFlash ? 'rgba(239,68,68,0.15)' : 'rgba(124,58,237,0.15)',
                  border: creditsFlash ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(124,58,237,0.35)',
                  color: creditsFlash ? '#FCA5A5' : '#A78BFA',
                  boxShadow: creditsFlash ? '0 0 14px rgba(239,68,68,0.2)' : '0 0 14px rgba(124,58,237,0.2)',
                  transition: 'background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s',
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span
                  style={{
                    display: 'inline-block',
                    animation: creditsFlash ? 'credits-shake 0.3s ease' : 'none',
                  }}
                >
                  {displayCredits !== null ? `${displayCredits} ${t('nav.credits_suffix')}` : '—'}
                </span>
              </div>

              {/* Lang switcher */}
              <LangSwitcher />

              {/* User menu */}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-white/5 transition-colors text-sm"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-medium text-xs overflow-hidden shrink-0"
                    style={{
                      background: 'rgba(124,58,237,0.2)',
                      border: '1px solid rgba(124,58,237,0.4)',
                      color: '#A78BFA',
                    }}
                  >
                    {profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (profile?.full_name ?? user.email ?? '?')[0].toUpperCase()
                    )}
                  </div>
                  <span className="hidden sm:block text-slate-300 max-w-32 truncate">
                    {profile?.full_name ?? user.email}
                  </span>
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown */}
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-52 rounded-xl py-1 z-50"
                    style={{
                      background: 'rgba(13,13,22,0.97)',
                      backdropFilter: 'blur(24px)',
                      WebkitBackdropFilter: 'blur(24px)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
                    }}
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <div className="px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                      <p className="text-xs text-slate-500">{t('nav.balance')}</p>
                      <p className="text-sm font-semibold text-violet-400">
                        {displayCredits ?? 0} {t('billing.credits_unit')}
                      </p>
                    </div>

                    <Link
                      href="/billing"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      {t('nav.billing')}
                    </Link>

                    <Link
                      href="/settings"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {t('nav.settings')}
                    </Link>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: '4px' }}>
                      <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        {t('nav.logout')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Guest */
            <div className="flex items-center gap-3">
              {isLanding && (
                <nav className="hidden md:flex items-center gap-6 mr-2">
                  <a href="/#how-it-works" className="text-sm text-slate-400 hover:text-white transition-colors">
                    {t('nav.how_it_works')}
                  </a>
                  <a href="/#pricing" className="text-sm text-slate-400 hover:text-white transition-colors">
                    {t('nav.pricing')}
                  </a>
                  <a href="/#faq" className="text-sm text-slate-400 hover:text-white transition-colors">
                    {t('nav.faq')}
                  </a>
                </nav>
              )}
              <LangSwitcher />
              <Link
                href="/auth/login"
                className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
              >
                {t('nav.login')}
              </Link>
              <Link href="/auth/register" className="btn-gradient px-4 py-2 text-white text-sm font-semibold rounded-xl">
                {t('nav.register')}
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
