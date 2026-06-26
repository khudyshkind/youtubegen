'use client'

import * as Sentry from '@sentry/nextjs'
import { useState } from 'react'

export default function SentryExamplePage() {
  const [log, setLog] = useState<string[]>([])

  function triggerClientError() {
    const id = Sentry.captureException(new Error('[sentry-test] Client-side test error'))
    setLog((p) => [...p, `Client error sent — event ID: ${id}`])
  }

  async function triggerServerError() {
    const res = await fetch('/api/sentry-example-api')
    setLog((p) => [...p, `Server API responded: HTTP ${res.status}`])
  }

  return (
    <div style={{ padding: 40, color: '#e2e8f0', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Sentry Test Page</h1>
      <p style={{ color: '#94a3b8', marginBottom: 24 }}>
        Trigger test errors to verify Sentry is capturing events.
      </p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button
          onClick={triggerClientError}
          style={{ padding: '8px 18px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
        >
          Trigger Client Error
        </button>
        <button
          onClick={triggerServerError}
          style={{ padding: '8px 18px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
        >
          Trigger Server Error
        </button>
      </div>
      {log.map((line, i) => (
        <p key={i} style={{ color: '#4ade80', fontFamily: 'monospace', margin: '4px 0' }}>✓ {line}</p>
      ))}
    </div>
  )
}
