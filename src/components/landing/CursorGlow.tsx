'use client'

import { useEffect, useRef } from 'react'

export default function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if ('ontouchstart' in window) return

    const el = ref.current
    if (!el) return

    el.style.opacity = '1'

    const target = { x: -300, y: -300 }
    const cur = { x: -300, y: -300 }
    let raf: number

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t

    const tick = () => {
      cur.x = lerp(cur.x, target.x, 0.09)
      cur.y = lerp(cur.y, target.y, 0.09)
      el.style.transform = `translate(${cur.x - 200}px, ${cur.y - 200}px)`
      raf = requestAnimationFrame(tick)
    }

    const onMove = (e: MouseEvent) => {
      target.x = e.clientX
      target.y = e.clientY
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={ref}
      className="fixed top-0 left-0 pointer-events-none z-[9998] opacity-0"
      style={{
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, rgba(124,58,237,0.06) 45%, transparent 70%)',
        willChange: 'transform',
      }}
    />
  )
}
