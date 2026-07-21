'use client'

import { Suspense, useState, useMemo, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useLang } from '@/hooks/useLang'

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const refCode = searchParams.get('ref') ?? ''

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const supabase = useMemo(() => createClient(), [])
  const { t } = useLang()

  async function acceptLegal() {
    try {
      await fetch('/api/legal/accept', { method: 'POST' })
    } catch {
      console.warn('[register] legal/accept failed (best-effort)')
    }
  }

  async function applyReferralClient(userId: string) {
    if (!refCode) return
    try {
      await fetch('/api/referral/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_code: refCode, new_user_id: userId }),
      })
    } catch {
      // referral is best-effort — don't block registration
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      setLoading(false)
      return
    }

    // Build the callback URL, carrying ?ref= so the server-side callback can apply it
    const callbackUrl = refCode
      ? `${window.location.origin}/auth/callback?ref=${encodeURIComponent(refCode)}`
      : `${window.location.origin}/auth/callback`

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: callbackUrl,
      },
    })

    if (authError) {
      console.error('[register] authError:', authError)
      if (authError.message === 'User already registered') {
        setError('Пользователь с таким email уже существует')
      } else {
        setError(`Ошибка: ${authError.message}`)
      }
      setLoading(false)
      return
    }

    // Email confirmation disabled — session returned immediately
    if (data.session && data.user) {
      await applyReferralClient(data.user.id)
      await acceptLegal()
      router.push('/dashboard')
      router.refresh()
      return
    }

    // Email confirmation required — referral will be applied in callback
    setSuccess(true)
    setLoading(false)
  }

  async function handleGoogleRegister() {
    setError('')
    const callbackUrl = refCode
      ? `${window.location.origin}/auth/callback?ref=${encodeURIComponent(refCode)}`
      : `${window.location.origin}/auth/callback`

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl },
    })
    if (authError) setError('Ошибка регистрации через Google')
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Проверьте почту</h2>
            <p className="text-gray-600 text-sm">
              Мы отправили письмо на <strong>{email}</strong>. Перейдите по ссылке в письме для активации аккаунта.
            </p>
            <Link
              href="/auth/login"
              className="mt-6 inline-block text-sm text-red-500 hover:text-red-600 font-medium"
            >
              ← Вернуться ко входу
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-2xl font-bold text-gray-900">
            Lefiro
          </Link>
          <p className="mt-2 text-gray-600">Создайте аккаунт бесплатно</p>
        </div>

        {refCode && (
          <div className="mb-4 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-sm text-violet-700 text-center">
            {t('auth.ref_bonus_note')}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

          {/* Google OAuth — hidden unless NEXT_PUBLIC_SHOW_GOOGLE_AUTH=true */}
          {process.env.NEXT_PUBLIC_SHOW_GOOGLE_AUTH === 'true' && (
            <>
              <button
                type="button"
                onClick={handleGoogleRegister}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Зарегистрироваться через Google
              </button>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-white px-3 text-gray-500">или</span>
                </div>
              </div>
            </>
          )}

          {/* Registration form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Имя
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
                placeholder="Иван Иванов"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Пароль
                <span className="text-gray-400 font-normal ml-1">(минимум 6 символов)</span>
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-red-500 cursor-pointer shrink-0"
              />
              <span className="text-xs text-gray-500 leading-relaxed">
                Регистрируясь, я принимаю{' '}
                <a href="/offer" target="_blank" rel="noopener noreferrer" className="text-red-500 hover:underline">Договор публичной оферты</a>,{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-red-500 hover:underline">Пользовательское соглашение</a>{' '}
                и даю согласие на{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-red-500 hover:underline">обработку персональных данных</a>
              </span>
            </label>

            <button
              type="submit"
              disabled={loading || !agreed}
              className="w-full py-3 px-4 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-medium rounded-xl text-sm transition-colors"
            >
              {loading ? 'Регистрация...' : 'Создать аккаунт'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-600 mt-6">
          Уже есть аккаунт?{' '}
          <Link href="/auth/login" className="text-red-500 hover:text-red-600 font-medium">
            Войдите
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  )
}
