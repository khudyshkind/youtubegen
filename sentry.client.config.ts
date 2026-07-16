import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: (process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').replace(/^﻿/, '').trim() || undefined,

  // 10% tracing in production, 100% locally
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Replay: capture 10% of sessions, 100% of sessions with errors
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: false,
    }),
  ],

  debug: false,
})
