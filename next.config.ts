import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  // Include the font file in the serverless function bundle for /api/generate/thumbnail
  outputFileTracingIncludes: {
    '/api/generate/thumbnail': ['./public/fonts/Montserrat-Black.ttf'],
  },
}

export default withSentryConfig(nextConfig, {
  org: 'youtubegen',
  project: 'youtubegen-nextjs',

  // Suppress verbose build output
  silent: !process.env.CI,

  // Upload source maps only when SENTRY_AUTH_TOKEN is set
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Hide source map JS files from browser devtools
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Automatically tree-shake Sentry logger statements in production
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors
  automaticVercelMonitors: true,
})
