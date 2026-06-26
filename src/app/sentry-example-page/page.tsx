'use client'

import * as Sentry from '@sentry/nextjs'
import { useState } from 'react'

export default function SentryExamplePage() {
  const [sent, setSent] = useState(false)

  function triggerClientError() {
    Sentry.captureException(new Error('[sentry-test] Client-side test error'))
    setSent(true)
  }

  async function triggerServerError() {
    await fetch('/api/sentry-example-api')
    setSent(true)
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 40 }}>
      <h1>Sentry Test Page</h1>
      <p>Click to send a test error to Sentry.</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button onClick={triggerClientError} style={{ padding: '8px 16px' }}>
          Trigger Client Error
        </button>
        <button onClick={triggerServerError} style={{ padding: '8px 16px' }}>
          Trigger Server Error
        </button>
      </div>
      {sent && <p style={{ color: 'green', marginTop: 16 }}>Error sent — check Sentry Issues.</p>}
    </main>
  )
}
