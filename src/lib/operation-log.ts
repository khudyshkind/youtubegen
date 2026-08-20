import { createServiceClient } from './supabase-server'

export interface StartOpLogOpts {
  userId: string
  projectId?: string | null
  opType: string
  provider?: string | null
}

export interface FinishOpLogOpts {
  status: 'done' | 'failed'
  creditsSpent?: number
  creditsRefunded?: number
  errorText?: string | null
}

export async function startOpLog(opts: StartOpLogOpts): Promise<string | null> {
  try {
    const svc = createServiceClient()
    const { data, error } = await svc
      .from('operation_log')
      .insert({
        user_id: opts.userId,
        project_id: opts.projectId ?? null,
        op_type: opts.opType,
        provider: opts.provider ?? null,
        status: 'running',
      })
      .select('id')
      .single()
    if (error) {
      console.error('[operation-log] start error:', error.message)
      return null
    }
    return (data as { id: string }).id
  } catch (e) {
    console.error('[operation-log] start error:', e instanceof Error ? e.message : String(e))
    return null
  }
}

export async function finishOpLog(id: string | null, opts: FinishOpLogOpts): Promise<void> {
  if (!id) return
  try {
    const svc = createServiceClient()
    await svc
      .from('operation_log')
      .update({
        status: opts.status,
        completed_at: new Date().toISOString(),
        credits_spent: opts.creditsSpent ?? 0,
        credits_refunded: opts.creditsRefunded ?? 0,
        error_text: opts.errorText ?? null,
      })
      .eq('id', id)
  } catch (e) {
    console.error('[operation-log] finish error:', e instanceof Error ? e.message : String(e))
  }
}
