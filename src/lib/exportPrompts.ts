import { useStudioStore } from './studio-store'

export function exportPrompts(): void {
  const { sceneImages: scenes, scriptParams: params } = useStudioStore.getState()
  if (scenes.length === 0) return

  const sorted = [...scenes].sort((a, b) => a.scene_index - b.scene_index)
  const padLen = Math.max(2, String(sorted.length).length)
  const pad = (n: number) => String(n + 1).padStart(padLen, '0')
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`

  const header = ['Scene', 'Start Time', 'End Time', 'Prompt', 'Suggested Filename']
  const rows = sorted.map((img) => {
    const num = pad(img.scene_index)
    return [num, img.timecode_start ?? '', img.timecode_end ?? '', img.prompt ?? '', `scene_${num}.jpg`]
  })
  const csv = [header, ...rows].map((row) => row.map(esc).join(',')).join('\r\n')

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  const safeTopic = params.topic.replace(/[^\wа-яА-ЯёЁ\s-]/g, '').replace(/\s+/g, '_').slice(0, 50)
  a.download = `${safeTopic}_image_prompts.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}
