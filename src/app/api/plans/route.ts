// Public endpoint: returns canonical credit values for all plans and topup packages.
// Consumed by video-server at startup to keep TG-bot pricing in sync with types.ts.
// Adding a new plan or changing credit counts → edit src/lib/types.ts only.
import { PLAN_CREDITS, TOPUP_PACKAGES } from '@/lib/types'

export const dynamic = 'force-static'

const TG_TOPUP_KEYS = ['topup_500', 'topup_2000', 'topup_5000'] as const

export async function GET() {
  const topup_packages = TOPUP_PACKAGES.map((pkg, i) => ({
    tg_key:  TG_TOPUP_KEYS[i],
    credits: pkg.credits,
    price:   pkg.price,
    label:   pkg.label,
  }))

  return Response.json({ plan_credits: PLAN_CREDITS, topup_packages })
}
