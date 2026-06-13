'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    try {
      await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setLoading(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleDelete}
          disabled={loading}
          className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? '...' : 'Да'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2 py-1 border border-gray-300 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Нет
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Удалить проект"
      className="shrink-0 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  )
}
