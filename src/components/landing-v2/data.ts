import { SCRIPT_LANGUAGES }  from '@/lib/languages'
import { STUDIO_STEPS }       from '@/lib/content-config'
import { IMAGE_COUNT_MAX }    from '@/lib/types'
import type { Lang } from '@/lib/i18n'

/**
 * Russian/English noun pluralization.
 * forms: [one, few, many] — for RU; EN uses forms[0] (one) and forms[1] (other).
 * Examples (RU): 1→forms[0], 2→forms[1], 5→forms[2], 11→forms[2], 21→forms[0]
 */
export function pluralize(n: number, lang: Lang, forms: [string, string, string]): string {
  if (lang === 'en') return n === 1 ? forms[0] : forms[1]
  const mod100 = n % 100
  const mod10  = n % 10
  if (mod100 >= 11 && mod100 <= 19) return forms[2]
  if (mod10 === 1) return forms[0]
  if (mod10 >= 2 && mod10 <= 4) return forms[1]
  return forms[2]
}

export { IMAGE_COUNT_MAX }

export const SCRIPT_LANGUAGE_COUNT   = SCRIPT_LANGUAGES.length  // 28
export const STUDIO_STEP_COUNT       = STUDIO_STEPS.length       // 8

// SecretVoicer CATALOG — src/app/api/voices/secretvoicer/route.ts:47
export const SV_VOICES_TOTAL = 101

// Default image interval — src/lib/studio-store.ts:159
export const DEFAULT_IMAGE_INTERVAL_SEC = 10

export const DISPLAY_PLANS = ['free', 'basic', 'starter', 'pro'] as const
export type DisplayPlan = (typeof DISPLAY_PLANS)[number]

export const PIPE_DESC_KEYS = [
  'v2.pipe_desc1', 'v2.pipe_desc2', 'v2.pipe_desc3', 'v2.pipe_desc4',
  'v2.pipe_desc5', 'v2.pipe_desc6', 'v2.pipe_desc7', 'v2.pipe_desc8',
] as const

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW_IMAGES — SINGLE REPLACEMENT POINT.
// Run the SQL query below in Supabase SQL Editor and paste the URL column here:
//
//   SELECT
//     p.id, p.topic,
//     img->>'url' AS url,
//     p.created_at
//   FROM projects p,
//     jsonb_array_elements(p.scene_images) AS img
//   WHERE
//     p.scene_images IS NOT NULL
//     AND jsonb_array_length(p.scene_images) > 0
//     AND img->>'url' IS NOT NULL
//     AND img->>'url' != ''
//     AND (img->>'nsfw_blocked')::boolean IS NOT TRUE
//   ORDER BY p.created_at DESC
//   LIMIT 30;
//
// When empty — colored placeholder frames are shown.
// ─────────────────────────────────────────────────────────────────────────────
export const PREVIEW_IMAGES: string[] = [
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/0a36d9f6-9699-474d-bece-b267b7bda125/scene_schnell_97.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/1822d72c-1bd2-45d7-952a-48407e356bed/scene_schnell_16.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/1b5bb38c-c09f-4261-a6fe-a35ee082e9c5/scene_schnell_67.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/254c4058-4cde-4d7a-8c21-c1a5bd619f68/scene_schnell_30.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/354e47de-2761-4324-a4de-d7dfa57b71e6/scene_ss_2.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/3608b725-e997-4fa3-b166-31357f57257f/scene_ss_2.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/3cf85528-1c30-4eac-b367-e3a860dbf4d5/scene_schnell_172.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/3eb7c17c-dcf5-4fa9-9df3-21ee434cbe55/scene_schnell_29.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/418616e8-cf54-40b2-87e0-207bd49c2149/scene_schnell_70.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/49a3d993-90b7-4fd9-84be-04123c173fd5/scene_nano_14.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/515e263c-9d69-4d44-b54d-3d81561a6be5/scene_schnell_271.jpg',
  'https://wugzjpgmiptkaaqdworx.supabase.co/storage/v1/object/public/images/1bc974fa-10d8-4e26-962d-0cd75eacfb64/52e4c225-cae3-4d32-8467-92127f266bf8/scene_schnell_40.jpg',
]

// ─────────────────────────────────────────────────────────────────────────────
// SHOWCASE — local files from public/showcase/ (optimised by Next.js Image)
// Hero background = first image (priority); rest = lazy
// ─────────────────────────────────────────────────────────────────────────────
export const SHOWCASE_IMAGES = [
  { src: '/showcase/gen_1622905.png', label: 'Flat 2D doodle' },  // 170 K — hero bg
  { src: '/showcase/gen_1622908.png', label: 'Photorealistic' },
  { src: '/showcase/gen_1622909.png', label: 'Photorealistic' },
  { src: '/showcase/gen_1622910.png', label: 'Photorealistic' },
  { src: '/showcase/gen_1622911.png', label: 'Photorealistic' },
  { src: '/showcase/gen_1622912.png', label: 'Photorealistic' },
  { src: '/showcase/gen_1622913.png', label: 'Cartoon style' },
  { src: '/showcase/gen_1622957.png', label: 'AI Generated' },   // CTA bg (last)
] as const

export const HERO_IMG     = SHOWCASE_IMAGES[0]
export const CTA_IMG      = SHOWCASE_IMAGES[SHOWCASE_IMAGES.length - 1]
export const PROCESS_IMGS = SHOWCASE_IMAGES.slice(1, 7)   // 6 images for process grid
export const REEL_IMGS    = SHOWCASE_IMAGES.slice(1, 7)   // 6 images for bento reel (skip hero bg)

// Process section script lines — 8 keys matching STUDIO_STEPS count
export const PROCESS_LINE_KEYS = [
  'v2.process_line1', 'v2.process_line2', 'v2.process_line3', 'v2.process_line4',
  'v2.process_line5', 'v2.process_line6', 'v2.process_line7', 'v2.process_line8',
] as const

// Pre-filled textarea — ~130 words → duration=1 min, imgCount=6
export const SAMPLE_SCRIPT = `Представьте: каждый день вы публикуете новое видео на YouTube — без монтажёра, без копирайтера и без дизайнера. Именно это делает Lefiro.

Вы просто вводите тему — и искусственный интеллект немедленно пишет профессиональный сценарий за тридцать секунд. Выбираете голос из ста вариантов — и нейросеть озвучивает ваш текст на любом из двадцати восьми языков. Субтитры расставляются автоматически по точным тайм-кодам аудиодорожки. Для каждой сцены видео генерируются уникальные иллюстрации в формате шестнадцать на девять.

Финальный шаг — автоматическая сборка видеоролика в Full HD с аудиодорожкой, вшитыми субтитрами и полным SEO-пакетом: цепляющим заголовком, подробным описанием и тегами под алгоритм YouTube.

Весь процесс занимает не больше десяти минут. Lefiro берёт на себя всё техническое — вам остаётся только придумать тему и нажать кнопку.`

// Bento grid — 5 items, 3 sizes: large / medium / small
export const BENTO_ITEMS = [
  { size: 'large',  nameKey: 'v2.works_item1_name', descKey: 'v2.works_item1_desc', hue: 215 },
  { size: 'medium', nameKey: 'v2.works_item2_name', descKey: 'v2.works_item2_desc', hue: 32  },
  { size: 'small',  nameKey: 'v2.works_item3_name', descKey: 'v2.works_item3_desc', hue: 142 },
  { size: 'small',  nameKey: 'v2.works_item4_name', descKey: 'v2.works_item4_desc', hue: 270 },
  { size: 'small',  nameKey: 'v2.works_item5_name', descKey: 'v2.works_item5_desc', hue: 190 },
] as const
