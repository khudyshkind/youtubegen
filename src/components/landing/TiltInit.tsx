'use client'

import { useEffect } from 'react'

export default function TiltInit() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if ('ontouchstart' in window) return

    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-tilt]'))
    const cleanup: Array<() => void> = []

    cards.forEach((card) => {
      card.style.willChange = 'transform'
      card.style.transition = 'transform 0.15s ease-out, box-shadow 0.3s ease, border-color 0.3s ease, background 0.3s ease'
      card.style.overflow = 'hidden'

      // Shine overlay
      const shine = document.createElement('div')
      shine.style.cssText =
        'position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity 0.3s ease;'
      card.style.position = 'relative'
      card.appendChild(shine)

      const onMove = (e: MouseEvent) => {
        const r = card.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width - 0.5   // −0.5 … 0.5
        const y = (e.clientY - r.top) / r.height - 0.5
        card.style.transform =
          `perspective(900px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) scale(1.02)`
        shine.style.opacity = '1'
        shine.style.background = `radial-gradient(circle at ${(x + 0.5) * 100}% ${(y + 0.5) * 100}%, rgba(255,255,255,0.07), transparent 65%)`
      }

      const onLeave = () => {
        card.style.transform = 'perspective(900px) rotateY(0deg) rotateX(0deg) scale(1)'
        shine.style.opacity = '0'
      }

      card.addEventListener('mousemove', onMove)
      card.addEventListener('mouseleave', onLeave)

      cleanup.push(() => {
        card.removeEventListener('mousemove', onMove)
        card.removeEventListener('mouseleave', onLeave)
        if (card.contains(shine)) card.removeChild(shine)
      })
    })

    return () => cleanup.forEach((fn) => fn())
  }, [])

  return null
}
