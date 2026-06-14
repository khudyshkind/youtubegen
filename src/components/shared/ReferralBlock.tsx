'use client'

import { useState, useEffect } from 'react'

interface Props {
  referralCode: string
  referralCount: number
  referralCreditsEarned: number
}

export default function ReferralBlock({ referralCode, referralCount, referralCreditsEarned }: Props) {
  const [copied, setCopied] = useState(false)
  const [referralUrl, setReferralUrl] = useState(
    `https://youtubegen.vercel.app/auth/register?ref=${referralCode}`
  )

  useEffect(() => {
    setReferralUrl(`${window.location.origin}/auth/register?ref=${referralCode}`)
  }, [referralCode])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = referralUrl
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background: 'linear-gradient(135deg, rgba(124,58,237,0.1), rgba(37,99,235,0.06))',
        border: '1px solid rgba(124,58,237,0.25)',
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl"
          style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.3)' }}
        >
          🎁
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-100 mb-1">Пригласи друга — получи кредиты</h3>
          <p className="text-sm text-slate-400 mb-4">
            За каждого друга который зарегистрируется по вашей ссылке —{' '}
            <strong className="text-violet-400">вы получаете 20 кредитов</strong>,{' '}
            друг получает <strong className="text-violet-400">+5 кредитов</strong> бонусом к стартовым 20.
          </p>

          {/* Referral link block */}
          <div className="flex items-center gap-2 mb-4">
            <div
              className="flex-1 min-w-0 rounded-xl px-3 py-2.5 flex items-center gap-2"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(124,58,237,0.2)' }}
            >
              <code className="text-xs text-slate-400 truncate flex-1">{referralUrl}</code>
              <span
                className="shrink-0 text-xs font-mono font-bold px-2 py-0.5 rounded-md"
                style={{ background: 'rgba(124,58,237,0.2)', color: '#A78BFA' }}
              >
                {referralCode}
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={copied
                ? { background: '#10B981', color: '#fff' }
                : { background: 'linear-gradient(135deg, #7C3AED, #2563EB)', color: '#fff', boxShadow: '0 4px 16px rgba(124,58,237,0.3)' }
              }
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  Скопировано!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Скопировать
                </>
              )}
            </button>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-extrabold text-violet-400">{referralCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">приглашено</p>
            </div>
            <div className="w-px h-8" style={{ background: 'rgba(124,58,237,0.3)' }} />
            <div className="text-center">
              <p className="text-2xl font-extrabold text-violet-400">{referralCreditsEarned}</p>
              <p className="text-xs text-slate-500 mt-0.5">кредитов заработано</p>
            </div>
            {referralCount === 0 && (
              <p className="text-xs text-slate-600 italic">
                Поделитесь ссылкой и получайте кредиты за каждого нового пользователя
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
