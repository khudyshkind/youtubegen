'use client'

import { useEffect } from 'react'
import { useLang } from '@/hooks/useLang'

interface Props {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({ message, onConfirm, onCancel }: Props) {
  const { t } = useLang()

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: '#12131A', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-slate-300 leading-relaxed">{message}</p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 btn-ghost-dark font-medium rounded-xl text-sm"
          >
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-2.5 btn-gradient text-white font-semibold rounded-xl text-sm"
          >
            {t('btn.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
