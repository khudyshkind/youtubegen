import { NextResponse } from 'next/server'

export async function GET() {
  throw new Error('[sentry-test] Server-side test error')
  return NextResponse.json({ ok: true })
}
