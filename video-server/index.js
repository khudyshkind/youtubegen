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
    const { audio_url, images, subtitle_blocks, subtitle_style, project_id } = req.body

    if (!audio_url || !Array.isArray(images) || !images.length || !project_id) {
      return res.status(400).json({ ok: false, error: 'Missing audio_url, images, or project_id' })
    }

    // Download audio
    const audioPath = path.join(tmpDir, 'audio.mp3')
    await downloadFile(audio_url, audioPath)

    // Download all scene images in sequence
    const imagePaths = []
    for (let i = 0; i < images.length; i++) {
      const imgPath = path.join(tmpDir, `img_${String(i).padStart(3, '0')}.jpg`)
      await downloadFile(images[i].url, imgPath)
      imagePaths.push(imgPath)
    }

    // Build concat.txt using timecodes for image durations
    const concatLines = []
    for (let i = 0; i < images.length; i++) {
      const start = parseSecs(images[i].timecode_start)
      const end = parseSecs(images[i].timecode_end)
      const duration = Math.max(1, end - start)
      concatLines.push(`file '${imagePaths[i]}'`)
      concatLines.push(`duration ${duration}`)
    }
    // Repeat last frame to prevent concat demuxer end-of-stream glitch
    concatLines.push(`file '${imagePaths[imagePaths.length - 1]}'`)
    const concatPath = path.join(tmpDir, 'concat.txt')
    fs.writeFileSync(concatPath, concatLines.join('\n'))

    // Build -vf filter chain
    let vfChain =
      'scale=1280:720:force_original_aspect_ratio=decrease,' +
      'pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1'

    if (subtitle_blocks?.length && subtitle_style?.burnIn) {
      const srtPath = path.join(tmpDir, 'subs.srt')
      fs.writeFileSync(srtPath, blocksToSrt(subtitle_blocks))

      const sizeMap = { small: 18, medium: 22, large: 28 }
      const alignMap = { top: 8, center: 5, bottom: 2 }
      const fontSize = sizeMap[subtitle_style.size] ?? 22
      const alignment = alignMap[subtitle_style.position] ?? 2
      const colour = hexToAss(subtitle_style.color)
      const bg = subtitle_style.background

      // Escape colon in absolute path for FFmpeg vf syntax
      const escaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
      let forceStyle = `FontSize=${fontSize},PrimaryColour=${colour},Alignment=${alignment},Outline=1`
      if (bg) forceStyle += ',BorderStyle=3,BackColour=&H80000000'

      vfChain += `,subtitles='${escaped}':force_style='${forceStyle}'`
    }

    const outputPath = path.join(tmpDir, 'output.mp4')

    await new Promise((resolve, reject) => {
      const args = [
        '-f', 'concat', '-safe', '0', '-i', concatPath,
        '-i', audioPath,
        '-vf', vfChain,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-shortest',
        '-y', outputPath,
      ]

      execFile('ffmpeg', args, { maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
        if (err) {
          console.error('[ffmpeg stderr]', stderr.slice(-1000))
          reject(new Error(`FFmpeg: ${stderr.slice(-300)}`))
        } else {
          resolve()
        }
      })
    })

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
