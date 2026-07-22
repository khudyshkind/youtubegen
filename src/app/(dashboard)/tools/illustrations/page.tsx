import { createServerSupabase } from '@/lib/supabase-server'
import type { SceneImage } from '@/lib/types'
import IllustrationsTool from './IllustrationsTool'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ run?: string }>
}

export default async function IllustrationsPage({ searchParams }: PageProps) {
  const { run } = await searchParams

  let initialImages: SceneImage[] = []
  let initialTitle = ''
  let initialScript = ''
  let restoredMeta: { engine: string; style_value: string; custom_style: string } | null = null
  let restoredId: string | null = null

  if (run) {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      const { data } = await supabase
        .from('projects')
        .select('id, title, script, scene_images, topic')
        .eq('id', run)
        .eq('user_id', user.id)
        .eq('image_style', 'image-illustrations')
        .single()

      if (data) {
        restoredId = data.id as string
        initialTitle = (data.title as string | null) ?? ''
        initialScript = (data.script as string | null) ?? ''
        initialImages = (data.scene_images as SceneImage[] | null) ?? []

        // Parse metadata from topic JSON (stored in init route)
        if (data.topic) {
          try {
            const meta = JSON.parse(data.topic as string)
            restoredMeta = {
              engine: meta.engine ?? 'flux_schnell',
              style_value: meta.style_value ?? '',
              custom_style: meta.custom_style ?? '',
            }
          } catch {
            // topic is not JSON (legacy project) — ignore
          }
        }
      }
    }
  }

  return (
    <IllustrationsTool
      initialImages={initialImages}
      initialTitle={initialTitle}
      initialScript={initialScript}
      restoredMeta={restoredMeta}
      restoredId={restoredId}
    />
  )
}
