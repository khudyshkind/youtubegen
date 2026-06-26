'use strict'

// Lightweight Sentry init: no OTel auto-instrumentation, no Express patching.
// We call captureException() manually in catch blocks — no monkey-patching needed.
let Sentry

try {
  Sentry = require('@sentry/node')
  Sentry.init({
    dsn: process.env.SENTRY_DSN || '',
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [],
    debug: false,
  })
  console.log('[sentry] initialized, DSN present:', !!process.env.SENTRY_DSN)
} catch (e) {
  console.warn('[sentry] init failed, running without Sentry:', e.message)
  // No-op fallback so all captureException() calls are safe even if Sentry fails
  Sentry = {
    captureException: () => {},
    captureMessage: () => {},
    withScope: (fn) => fn({ setContext: () => {}, setUser: () => {} }),
    setupExpressErrorHandler: () => {},
    setUser: () => {},
    setContext: () => {},
  }
}

module.exports = Sentry
