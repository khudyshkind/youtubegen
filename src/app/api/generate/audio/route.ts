import { NextRequest, NextResponse } from 'next/server'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'

interface AudioRequest {
  text: string
  voice_id: string
  project_id?: string
  stability?: number
  similarity_boost?: number
}

// Estimate duration: ~130 words per minute
function estimateMinutes(text: string): number {
  const words = text.trim().split(/\s+/).length
  return Math.ceil(words / 130)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Необходима авторизация' },
        { status: 401 }
      )
    }

    const body: AudioRequest = await request.json()
    const { text, voice_id, project_id, stability = 0.5, similarity_boost = 0.75 } = body

    const minutes = estimateMinutes(text)
    const creditCost = minutes * 5

    const check = await requireCredits(user.id, 'voice')
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY })
    const audioStream = await elevenlabs.textToSpeech.convert(voice_id, {
      text,
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability,
        similarityBoost: similarity_boost,
      },
    })

    // ReadableStream → Buffer
    const reader = (audioStream as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const audioBuffer = Buffer.concat(chunks)

    // Upload to Supabase Storage
    const serviceClient = createServiceClient()
    const storagePath = `${user.id}/${project_id ?? 'tmp'}/audio.mp3`

    const { error: uploadError } = await serviceClient.storage
      .from('audio')
      .upload(storagePath, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      })

    if (uploadError) {
      return NextResponse.json(
        { ok: false, error: 'Ошибка загрузки аудио' },
        { status: 500 }
      )
    }

    const { data: { publicUrl } } = serviceClient.storage
      .from('audio')
      .getPublicUrl(storagePath)

    await spendCredits(user.id, creditCost, 'voice', project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({
          audio_url: publicUrl,
          voice_id,
          status: 'generating_subtitles',
        })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { audio_url: publicUrl, minutes } })
  } catch (error) {
    console.error('[generate/audio]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка генерации аудио' },
      { status: 500 }
    )
  }
}
