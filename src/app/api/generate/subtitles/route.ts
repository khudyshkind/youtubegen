import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import type { SubtitleBlock } from '@/lib/types'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface SubtitlesRequest {
  audio_url: string
  project_id?: string
}

interface WhisperSegment {
  start: number
  end: number
  text: string
}

interface WhisperVerboseResponse {
  text: string
  segments: WhisperSegment[]
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

    const check = await requireCredits(user.id, 'subtitles')
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    const { audio_url, project_id }: SubtitlesRequest = await request.json()

    // Download audio from storage
    const audioResponse = await fetch(audio_url)
    if (!audioResponse.ok) {
      return NextResponse.json(
        { ok: false, error: 'Не удалось загрузить аудиофайл' },
        { status: 400 }
      )
    }

    const audioBuffer = await audioResponse.arrayBuffer()
    const audioFile = new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' })

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
      language: 'ru',
    }) as unknown as WhisperVerboseResponse

    const subtitle_blocks: SubtitleBlock[] = (transcription.segments ?? []).map(
      (seg) => ({
        start: Math.round(seg.start * 100) / 100,
        end: Math.round(seg.end * 100) / 100,
        text: seg.text.trim(),
      })
    )

    await spendCredits(user.id, 3, 'subtitles', project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({
          subtitle_blocks,
          status: 'generating_images',
        })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { subtitle_blocks } })
  } catch (error) {
    console.error('[generate/subtitles]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка генерации субтитров' },
      { status: 500 }
    )
  }
}
