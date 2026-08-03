'use client'

import { useEffect } from 'react'

const UTM_SS_KEY = 'lefiro_utm'
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign'] as const

export default function UtmCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const found: Record<string, string> = {}
    for (const k of UTM_PARAMS) {
      const v = params.get(k)
      if (v) found[k] = v
    }
    if (Object.keys(found).length > 0) {
      sessionStorage.setItem(UTM_SS_KEY, JSON.stringify(found))
    }
  }, [])
  return null
}
