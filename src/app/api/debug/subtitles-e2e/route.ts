export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'
import { randomUUID } from 'crypto'

// Minimal valid 1-second WAV (8kHz, 8-bit mono, silence).
// Whisper accepts WAV and will return empty transcript (or single empty segment) for silence.
function buildSilentWav(): Buffer {
  const sampleRate = 8000
  const numSamples = sampleRate
  const dataSize = numSamples
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)   // PCM
  buf.writeUInt16LE(1, 22)   // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate, 28) // byteRate
  buf.writeUInt16LE(1, 32)   // blockAlign
  buf.writeUInt16LE(8, 34)   // bitsPerSample
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  buf.fill(128, 44)           // silence = 0x80 in unsigned 8-bit
  return buf
}

export async function GET() {
  const log: Record<string, unknown> = {}
  const testPath = `test/subtitles-e2e/${randomUUID()}.wav`
  const svc = createServiceClient()

  // ── Step 1: createSignedUploadUrl ──────────────────────────────────────────
  const { data: uploadData, error: uploadErr } = await svc.storage
    .from('audio')
    .createSignedUploadUrl(testPath)

  if (uploadErr || !uploadData?.signedUrl) {
    return NextResponse.json({ ok: false, step: 'createSignedUploadUrl', error: uploadErr?.message, log })
  }
  log.step1_upload_url = 'OK'

  // ── Step 2: createSignedUrl (this is what was previously not error-checked) ─
  const { data: readData, error: readErr } = await svc.storage
    .from('audio')
    .createSignedUrl(testPath, 900)

  log.step2_read_url_err = readErr?.message ?? null
  log.step2_access_url_empty = !readData?.signedUrl
  log.step2_access_url_prefix = readData?.signedUrl?.slice(0, 80) ?? '(empty)'

  if (readErr || !readData?.signedUrl) {
    log.conclusion = 'BUG #1 confirmed: createSignedUrl failed, access_url would have been empty string'
    return NextResponse.json({ ok: false, step: 'createSignedUrl', error: readErr?.message, log })
  }

  const accessUrl = readData.signedUrl

  // ── Step 3: Upload silent WAV via signed upload URL ──────────────────────
  const wavBuf = buildSilentWav()
  const uploadRes = await fetch(uploadData.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array(wavBuf),
  })
  log.step3_put_status = uploadRes.status
  log.step3_put_ok = uploadRes.ok

  if (!uploadRes.ok) {
    await svc.storage.from('audio').remove([testPath])
    return NextResponse.json({ ok: false, step: 'PUT upload', status: uploadRes.status, log })
  }

  // ── Step 4: Call Railway /transcribe ─────────────────────────────────────
  const railwayUrl = env('RAILWAY_VIDEO_SERVER_URL').replace(/\/$/, '')
  const railwaySecret = env('RAILWAY_API_SECRET')

  let transcribeStatus = 0
  let transcribeBody: unknown = null

  try {
    const transcribeRes = await fetch(`${railwayUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-secret': railwaySecret },
      body: JSON.stringify({ audio_url: accessUrl, language: 'ru' }),
      signal: AbortSignal.timeout(60_000),
    })
    transcribeStatus = transcribeRes.status
    transcribeBody = await transcribeRes.json().catch(() => transcribeRes.text())
    log.step4_railway_status = transcribeStatus
    log.step4_railway_ok = transcribeRes.ok
    log.step4_railway_body = transcribeBody
  } catch (e) {
    log.step4_railway_error = e instanceof Error ? e.message : String(e)
  }

  // ── Step 5: Cleanup test file ─────────────────────────────────────────────
  const { error: delErr } = await svc.storage.from('audio').remove([testPath])
  log.step5_cleanup = delErr ? `FAIL: ${delErr.message}` : 'OK'

  const railwayOk = (transcribeBody as { ok?: boolean })?.ok === true
  log.conclusion = railwayOk
    ? 'BUG #1 was the cause. After fix createSignedUrl succeeds (access_url non-empty) and Railway transcribes successfully.'
    : `Railway failed: HTTP ${transcribeStatus} — see step4_railway_body for exact error`

  return NextResponse.json({ ok: railwayOk, log })
}

export async function DELETE() {
  return NextResponse.json({ ok: true, message: 'Delete the file /src/app/api/debug/subtitles-e2e/route.ts manually' })
}
