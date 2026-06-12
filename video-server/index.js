'use strict'
const express = require('express')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')

const app = express()
app.use(express.json({ limit: '2mb' }))

const API_SECRET = process.env.RAILWAY_API_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function verifySecret(req, res, next) {
  if (!API_SECRET || req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }
  next()
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} downloading ${url}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    })
    req.on('error', (err) => {
      fs.unlink(destPath, () => {})
      reject(err)
    })
  })
}

function parseSecs(timecode) {
  const parts = String(timecode || '0').split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

function hexToAss(hex) {
  // #RRGGBB → &H00BBGGRR (ASS subtitle color, reversed)
  const h = (hex || '#FFFFFF').replace('#', '')
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  return `&H00${b}${g}${r}`.toUpperCase()
}

function blocksToSrt(blocks) {
  function fmt(s) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    const ms = Math.round((s % 1) * 1000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`
  }
  return blocks
    .map((b, i) => `${i + 1}\n${fmt(b.start)} --> ${fmt(b.end)}\n${b.text}`)
    .join('\n\n')
}

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/render', verifySecret, async (req, res) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytgen-'))

  try {
    const { audio_url, images, subtitle_blocks, subtitle_style, project_id, image_interval } = req.body

    if (!audio_url || !Array.isArray(images) || !images.length || !project_id) {
      return res.status(400).json({ ok: false, error: 'Missing audio_url, images, or project_id' })
    }

    console.log('[render] project_id:', project_id)
    console.log('[render] images count:', images.length)
    console.log('[render] subtitle_blocks count:', subtitle_blocks?.length ?? 0)
    console.log('[render] subtitle_style:', JSON.stringify(subtitle_style ?? null))

    // Fallback duration per image when timecodes are absent
    const defaultDuration = Math.max(1, Number(image_interval) || 10)

    // Download audio
    const audioPath = path.join(tmpDir, 'audio.mp3')
    await downloadFile(audio_url, audioPath)

    // Normalize loudness to -14 LUFS (YouTube standard) — fixes ElevenLabs volume drift on long texts
    const audioNormPath = path.join(tmpDir, 'audio_norm.mp3')
    let finalAudioPath = audioPath
    try {
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', audioPath,
          '-filter:a', 'loudnorm=I=-14:LRA=7:TP=-1',
          '-ar', '44100',
          '-y', audioNormPath,
        ], { maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr.slice(-300)))
          else resolve()
        })
      })
      finalAudioPath = audioNormPath
      console.log('[audio] loudnorm applied →', audioNormPath)
    } catch (normErr) {
      console.warn('[audio] loudnorm failed, using original:', normErr.message)
    }

    // Download all scene images in sequence
    const imagePaths = []
    for (let i = 0; i < images.length; i++) {
      const imgPath = path.join(tmpDir, `img_${String(i).padStart(3, '0')}.jpg`)
      await downloadFile(images[i].url, imgPath)
      imagePaths.push(imgPath)
    }

    // Get exact audio duration via ffprobe
    const audioDuration = await new Promise((resolve, reject) => {
      execFile('ffprobe', [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        finalAudioPath,
      ], (err, stdout) => {
        if (err) reject(new Error(`ffprobe failed: ${err.message}`))
        else resolve(parseFloat(stdout.trim()))
      })
    })

    // Compute per-image durations
    const durations = images.map((img) => {
      const hasTc = img.timecode_start && img.timecode_end
      return hasTc
        ? Math.max(1, parseSecs(img.timecode_end) - parseSecs(img.timecode_start))
        : defaultDuration
    })

    // Extend last image to cover any remaining audio
    const totalImagesDuration = durations.reduce((a, b) => a + b, 0)
    if (totalImagesDuration < audioDuration) {
      durations[durations.length - 1] += audioDuration - totalImagesDuration
    }

    // Build concat.txt (last path repeated without duration — FFmpeg concat demuxer requirement)
    const concatLines = []
    for (let i = 0; i < imagePaths.length; i++) {
      concatLines.push(`file '${imagePaths[i]}'`)
      concatLines.push(`duration ${durations[i]}`)
    }
    concatLines.push(`file '${imagePaths[imagePaths.length - 1]}'`)
    const concatPath = path.join(tmpDir, 'concat.txt')
    fs.writeFileSync(concatPath, concatLines.join('\n'))

    const tempNoSubsPath = path.join(tmpDir, 'temp_no_subs.mp4')
    const outputPath = path.join(tmpDir, 'output.mp4')

    // Pass 1 — assemble video from images + audio, no subtitles
    const vfBase =
      'scale=1280:720:force_original_aspect_ratio=decrease,' +
      'pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1'

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-f', 'concat', '-safe', '0', '-i', concatPath,
        '-i', finalAudioPath,
        '-vf', vfBase,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-t', String(audioDuration),
        '-y', tempNoSubsPath,
      ], { maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(`FFmpeg pass 1: ${stderr.slice(-400)}`))
        else resolve()
      })
    })

    // Pass 2 — burn subtitles onto the assembled video (timecodes come from SRT, not image cuts)
    const shouldBurnSubs = !!(subtitle_blocks?.length && subtitle_style?.burnIn)
    console.log('[render] pass2 will run:', shouldBurnSubs,
      '| blocks:', subtitle_blocks?.length ?? 0,
      '| burnIn:', subtitle_style?.burnIn ?? false)

    if (shouldBurnSubs) {
      const srtPath = path.join(tmpDir, 'subs.srt')
      const srtContent = blocksToSrt(subtitle_blocks)
      fs.writeFileSync(srtPath, srtContent)
      console.log('[render] SRT written, first 200 chars:', srtContent.slice(0, 200))

      const sizeMap = { small: 18, medium: 22, large: 28 }
      const alignMap = { top: 8, center: 5, bottom: 2 }
      const fontSize = sizeMap[subtitle_style.size] ?? 22
      const alignment = alignMap[subtitle_style.position] ?? 2
      const colour = hexToAss(subtitle_style.color)
      const bg = subtitle_style.background

      const escaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
      let forceStyle = `FontName=Liberation Sans,FontSize=${fontSize},PrimaryColour=${colour},OutlineColour=&H000000,Outline=2,Bold=1,Alignment=${alignment}`
      if (bg) forceStyle += ',BorderStyle=3,BackColour=&H80000000'

      const pass2Args = [
        '-i', tempNoSubsPath,
        '-vf', `subtitles='${escaped}':force_style='${forceStyle}'`,
        '-c:a', 'copy',
        '-y', outputPath,
      ]
      console.log('[render] pass2 ffmpeg args:', pass2Args.join(' '))

      try {
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', pass2Args,
            { maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
              if (err) reject(new Error(`FFmpeg pass 2 (subtitles): ${stderr.slice(-400)}`))
              else resolve()
            })
        })
        console.log('[ffmpeg] subtitle pass 2 complete')
      } catch (subsErr) {
        console.warn('[ffmpeg] subtitle burn-in failed, using video without subtitles:', subsErr.message)
        fs.renameSync(tempNoSubsPath, outputPath)
      }
    } else {
      console.log('[render] pass2 skipped — no subtitles or burnIn=false')
      fs.renameSync(tempNoSubsPath, outputPath)
    }

    // Upload MP4 to Supabase Storage via REST API (no SDK, no WebSocket)
    const fileBuffer = fs.readFileSync(outputPath)
    const storagePath = `${project_id}/output.mp4`
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/videos/${storagePath}`

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'video/mp4',
        'x-upsert': 'true',
      },
      body: fileBuffer,
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      throw new Error(`Supabase upload failed ${uploadRes.status}: ${errText}`)
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/videos/${storagePath}`
    return res.json({ ok: true, video_url: publicUrl })
  } catch (err) {
    console.error('[/render]', err)
    return res.status(500).json({ ok: false, error: err.message })
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

const PORT = parseInt(process.env.PORT || '3001', 10)
app.listen(PORT, () => console.log(`ytgen-video-server on :${PORT}`))
