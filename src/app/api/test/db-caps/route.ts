/**
 * TEMPORARY — delete after capability check. Secret: dbcaps-2026-z7w2
 * Checks: pg_net installed? vault available? current_setting works?
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  if (req.headers.get('x-test-secret') !== 'dbcaps-2026-z7w2') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const svc = createServiceClient()

  async function sql<T = Record<string, unknown>[]>(query: string): Promise<{ data: T | null; error: string | null }> {
    const { data, error } = await (svc as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{data: T | null; error: {message: string} | null}> })
      .rpc('exec_sql', { query })
    return { data, error: error?.message ?? null }
  }

  // Direct queries via supabase-js
  const results: Record<string, unknown> = {}

  // 1. pg_net installed?
  {
    const { data, error } = await svc
      .from('pg_catalog.pg_extension' as never)
      .select('extname, extversion')
      .eq('extname', 'pg_net')
    results.pg_net = error ? `error: ${error.message}` : data
  }

  // 2. vault extension available?
  {
    const { data, error } = await svc
      .from('pg_catalog.pg_extension' as never)
      .select('extname, extversion')
      .eq('extname', 'supabase_vault')
    results.vault_ext = error ? `error: ${error.message}` : data
  }

  // 3. vault.secrets table accessible?
  {
    const { data, error } = await svc
      .from('vault.secrets' as never)
      .select('id')
      .limit(1)
    results.vault_secrets_read = error ? `error: ${error.message}` : 'ok'
  }

  // 4. net._http_response accessible? (pg_net result log)
  {
    const { data, error } = await svc
      .from('net._http_response' as never)
      .select('id, status_code, created')
      .order('created', { ascending: false })
      .limit(5)
    results.net_http_response = error ? `error: ${error.message}` : data
  }

  // 5. Can we call a pg_net function directly via RPC?
  {
    const { data, error } = await svc.rpc('net_version' as never)
    results.net_rpc_version = error ? `error: ${error.message}` : data
  }

  return NextResponse.json({ ok: true, results })
}
