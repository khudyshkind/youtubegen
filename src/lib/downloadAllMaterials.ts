import JSZip from 'jszip'
import { useStudioStore } from './studio-store'
import type { SeoData, SubtitleBlock, SceneImage } from './types'

function buildSrt(blocks: SubtitleBlock[]): string {
  function srtTime(sec: number) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    const ms = Math.round((sec % 1) * 1000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
  }
  return blocks.map((b, i) =>
    `${i + 1}\n${srtTime(b.start)} --> ${srtTime(b.end)}\n${b.text}\n`
  ).join('\n')
}

function buildCsv(scenes: SceneImage[]): string {
  const sorted = [...scenes].sort((a, b) => a.scene_index - b.scene_index)
  const padLen = Math.max(2, String(sorted.length).length)
  const pad = (n: number) => String(n + 1).padStart(padLen, '0')
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const header = ['Scene', 'Start Time', 'End Time', 'Prompt', 'Suggested Filename']
  const rows = sorted.map((img) => {
    const num = pad(img.scene_index)
    return [num, img.timecode_start ?? '', img.timecode_end ?? '', img.prompt ?? '', `scene_${num}.jpg`]
  })
  return '﻿' + [header, ...rows].map((row) => row.map(esc).join(',')).join('\r\n')
}

function buildSeoText(seo: SeoData): string {
  // seo.description may or may not contain hashtags depending on whether the project
  // was freshly generated (appendHashtags called client-side) or loaded from DB
  // (description stored without hashtags). Strip any trailing hashtag line, then
  // always append from the reliable seo.hashtags array.
  const hashtags: string[] = seo.hashtags ?? []
  const trimmed = seo.description.trimEnd()
  const lastNl = trimmed.lastIndexOf('\n')
  const lastLine = lastNl >= 0 ? trimmed.slice(lastNl + 1).trim() : trimmed
  const descBody = lastLine.length > 0 && lastLine.split(/\s+/).every((w) => w.startsWith('#'))
    ? trimmed.slice(0, lastNl >= 0 ? lastNl : 0).trimEnd()
    : trimmed

  const lines: string[] = []
  lines.push('Название:', seo.title)
  if (seo.title_alt) lines.push('', 'Альтернативный заголовок:', seo.title_alt)
  lines.push('', 'Описание (вставить в поле "Описание" на YouTube):')
  lines.push(descBody)
  if (hashtags.length > 0) lines.push('', hashtags.join(' '))
  if (seo.tags.length > 0) {
    lines.push('', 'Теги (вставить в отдельное поле "Теги" при загрузке на YouTube):', seo.tags.join(', '))
  }
  return lines.join('\n')
}

export async function downloadAllMaterials(opts: { seo?: SeoData | null } = {}): Promise<void> {
  const { sceneImages, script, audioUrl, subtitleBlocks, scriptParams } = useStudioStore.getState()
  const seo = opts.seo ?? null

  const zip = new JSZip()

  if (script) {
    zip.file('script.txt', script)
  }

  if (seo) {
    zip.file('seo.txt', buildSeoText(seo))
  }

  if (subtitleBlocks.length > 0) {
    zip.file('subtitles.srt', buildSrt(subtitleBlocks))
  }

  if (sceneImages.length > 0) {
    const sorted = [...sceneImages].sort((a, b) => a.scene_index - b.scene_index)
    const padLen = Math.max(2, String(sorted.length).length)
    const pad = (n: number) => String(n + 1).padStart(padLen, '0')
    const imagesFolder = zip.folder('images')!

    const results = await Promise.all(
      sorted.map(async (img) => {
        if (!img.url) return null
        try {
          const res = await fetch(img.url)
          const blob = await res.blob()
          return { blob, name: `scene_${pad(img.scene_index)}.jpg` }
        } catch {
          return null
        }
      })
    )
    for (const item of results) {
      if (item) imagesFolder.file(item.name, item.blob)
    }
  }

  if (audioUrl) {
    try {
      const res = await fetch(audioUrl)
      const blob = await res.blob()
      const ext = audioUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'mp3'
      zip.file(`audio.${ext}`, blob)
    } catch {
      // skip if audio fetch fails
    }
  }

  const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const safeName = (scriptParams.topic || 'project')
    .replace(/[^\wа-яА-ЯёЁ\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(content)
  a.download = `${safeName}_materials.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}
