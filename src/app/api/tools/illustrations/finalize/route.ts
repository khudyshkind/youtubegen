// Called by the client after SSE generation completes.
// Resets image_style to the routing slug (overwritten by /api/generate/images during gen)
// and marks the project completed.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

interface FinalizeRequest {
  project_id: string
  credits_spent: number
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { project_id, credits_spent }: FinalizeRequest = await request.json()
    if (!project_id) {
      return NextResponse.json({ ok: false, error: 'project_id обязателен' }, { status: 400 })
    }

    const { error } = await supabase
      .from('projects')
      .update({
        status: 'completed',
        image_style: 'image-illustrations',  // restore routing slug after generate/images overwrites it
        credits_spent: credits_spent ?? 0,
      })
      .eq('id', project_id)
      .eq('user_id', user.id)

    if (error) {
      console.error('[illustrations/finalize]', error.message)
      return NextResponse.json({ ok: false, error: 'Ошибка финализации' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[illustrations/finalize]', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
