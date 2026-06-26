'use strict'
const Sentry = require('@sentry/node')

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  integrations: [Sentry.expressIntegration()],
  debug: false,
})

module.exports = Sentry
