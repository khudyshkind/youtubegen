import { createServerSupabase } from '@/lib/supabase-server'
import SubtitlesTool from './SubtitlesTool'
import type { SubtitleBlock } from '@/lib/types'

// Force dynamic so searchParams are always fresh (page reads auth cookies + DB)
export const dynamic = 'force-dynamic'

export default async function SubtitlesPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>
}) {
  const { run: runId = null } = await searchParams

  let initialBlocks: SubtitleBlock[] = []
  let initialTitle = 'subtitles'
  let restoredId: string | null = null

  if (runId) {
    try {
      const supabase = await createServerSupabase()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data } = await supabase
          .from('projects')
          .select('subtitle_blocks, title')
          .eq('id', runId)
          .eq('user_id', user.id)
          .single()

        const blocks = data?.subtitle_blocks as SubtitleBlock[] | null
        if (Array.isArray(blocks) && blocks.length > 0) {
          initialBlocks = blocks
          initialTitle = (data?.title as string | null) ?? 'subtitles'
          restoredId = runId
        }
      }
    } catch {
      // Best-effort: if server fetch fails, page loads as fresh (user can re-generate)
    }
  }

  return (
    <SubtitlesTool
      initialBlocks={initialBlocks}
      initialTitle={initialTitle}
      restoredId={restoredId}
    />
  )
}
