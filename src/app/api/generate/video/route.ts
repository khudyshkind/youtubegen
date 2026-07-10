import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { createServerSupabase } from '@/lib/supabase-server'
import type { SubtitleBlock, SceneImage } from '@/lib/types'

export const maxDuration = 120

interface VideoRequest {
  project_id?: string
  audio_url: string
  scene_images: SceneImage[]
  subtitle_blocks: SubtitleBlock[]
  topic: string
  image_interval?: number
}

function padTime(n: number, len = 2) {
  return String(n).padStart(len, '0')
}

function formatHms(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${padTime(h)}:${padTime(m)}:${padTime(s)}`
}

function formatSrtTime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${padTime(h)}:${padTime(m)}:${padTime(s)},${padTime(ms, 3)}`
}

function buildSrt(blocks: SubtitleBlock[]): string {
  return blocks
    .map((b, i) => `${i + 1}\n${formatSrtTime(b.start)} --> ${formatSrtTime(b.end)}\n${b.text}`)
    .join('\n\n') + '\n'
}

function buildTiming(images: SceneImage[], blocks: SubtitleBlock[], topic: string, intervalSec: number): string {
  const totalDuration =
    blocks.length > 0
      ? Math.ceil(blocks[blocks.length - 1].end)
      : images.length * intervalSec

  const rows = images.map((_, i) => {
    const start = i * intervalSec
    // Last scene runs until the end of audio
    const end = i === images.length - 1 ? totalDuration : (i + 1) * intervalSec
    const num = String(i + 1).padStart(2, '0')
    return `scene_${num}.jpg    ${formatHms(start)} → ${formatHms(end)}`
  })

  return [
    `Lefiro — Тайм-коды иллюстраций`,
    `====================================`,
    `Тема: ${topic}`,
    `Иллюстраций: ${images.length}`,
    `Смена каждые: ${intervalSec} секунд`,
    `Длительность аудио: ~${formatHms(totalDuration)}`,
    ``,
    ...rows,
    ``,
    `Примечание: тайм-коды рассчитаны по интервалу ${intervalSec} сек.`,
    `Скорректируйте в редакторе по ощущению ритма.`,
  ].join('\n')
}

function buildReadme(topic: string): string {
  return `Lefiro — Инструкция по финальному монтажу
==============================================
Тема видео: ${topic}

СОДЕРЖИМОЕ АРХИВА
-----------------
audio.mp3        — озвучка сценария
scene_01.jpg     — иллюстрации сцен (нумерованные)
scene_02.jpg
...
subtitles.srt    — субтитры (импортируются в редактор)
timing.txt       — тайм-коды для расстановки иллюстраций


СБОРКА В CAPCUT (Desktop / мобильный)
--------------------------------------
1. Создайте новый проект 16:9 (1920×1080)
2. Добавьте audio.mp3 как основную аудиодорожку
3. Добавьте изображения scene_01.jpg, scene_02.jpg...
   строго по порядку номеров на видеодорожку
4. Длительность каждого изображения задайте по timing.txt
5. Текст → Импорт субтитров → выберите subtitles.srt
6. Экспорт → MP4, 1080p, 30fps


СБОРКА В DAVINCI RESOLVE (Desktop)
------------------------------------
1. File → New Project → Timeline → 1920×1080, 25fps
2. File → Import → Media — выберите все файлы из архива
3. Перетащите audio.mp3 на аудиодорожку (A1)
4. Перетащите изображения на V1 в порядке нумерации
5. Задайте длительность клипов согласно timing.txt
6. File → Import → Subtitles → subtitles.srt
7. Deliver → YouTube Master → Render All


СБОРКА В PREMIERE PRO (Desktop)
---------------------------------
1. Новая последовательность 1920×1080, 25fps
2. Импортируйте все файлы через File → Import
3. Расставьте изображения на V1 согласно timing.txt
4. Разместите audio.mp3 на A1
5. Captions → Import Captions → subtitles.srt
6. File → Export → Media → H.264, YouTube 1080p HD


Успехов с монтажом!
`
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: VideoRequest = await request.json()
    const { audio_url, scene_images, subtitle_blocks, topic, image_interval } = body
    const intervalSec = Math.max(3, Math.min(30, image_interval ?? 10))

    if (!audio_url) {
      return NextResponse.json({ ok: false, error: 'audio_url обязателен' }, { status: 400 })
    }

    const zip = new JSZip()

    // Fetch and add audio
    const audioRes = await fetch(audio_url)
    if (audioRes.ok) {
      zip.file('audio.mp3', await audioRes.arrayBuffer())
      console.log('[generate/video] audio.mp3 added')
    } else {
      console.warn('[generate/video] Could not fetch audio:', audioRes.status)
    }

    // Fetch and add scene images.
    // Use array position (i+1) for filenames — not img.scene_index — so scene_01.jpg
    // is always the first element regardless of how scene_index was stored.
    const images = scene_images ?? []
    console.log(`[generate/video] images count: ${images.length}`, images.map((img, i) => ({
      arrayPos: i,
      scene_index: img.scene_index,
      hasUrl: !!img.url,
    })))

    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const num = String(i + 1).padStart(2, '0')
      if (!img.url) {
        console.warn(`[generate/video] scene_${num}.jpg skipped — url is null (array pos ${i}, scene_index ${img.scene_index})`)
        continue
      }
      try {
        const imgRes = await fetch(img.url)
        console.log(`[generate/video] scene_${num}.jpg fetch status: ${imgRes.status}`)
        if (imgRes.ok) {
          zip.file(`scene_${num}.jpg`, await imgRes.arrayBuffer())
          console.log(`[generate/video] scene_${num}.jpg added`)
        } else {
          console.warn(`[generate/video] scene_${num}.jpg fetch failed: ${imgRes.status}`)
        }
      } catch (err) {
        console.warn(`[generate/video] scene_${num}.jpg exception:`, err)
      }
    }

    // Add SRT subtitles
    const blocks = subtitle_blocks ?? []
    if (blocks.length > 0) {
      zip.file('subtitles.srt', buildSrt(blocks))
    }

    // Add timing guide
    if (images.length > 0) {
      zip.file('timing.txt', buildTiming(images, blocks, topic ?? '', intervalSec))
    }

    // Add assembly instructions
    zip.file('README.txt', buildReadme(topic ?? ''))

    const zipBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const safeTopic = (topic ?? 'project').replace(/[^a-zа-яёА-ЯЁ0-9_\- ]/gi, '').trim().slice(0, 40) || 'project'

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeTopic)}_assets.zip`,
        'Content-Length': zipBuffer.byteLength.toString(),
      },
    })
  } catch (error) {
    console.error('[generate/video]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка создания архива' }, { status: 500 })
  }
}
