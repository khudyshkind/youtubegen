'use client'

import { useState, useEffect, useRef } from 'react'

interface Props {
  to: number
  suffix?: string
  duration?: number
  className?: string
}

export default function AnimatedCounter({ to, suffix = '', duration = 1500, className = '' }: Props) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(to)
      return
    }

    const el = ref.current
    if (!el) return

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true
          const t0 = performance.now()
          const tick = (now: number) => {
            const progress = Math.min((now - t0) / duration, 1)
            const eased = 1 - (1 - progress) ** 3
            setCount(Math.round(eased * to))
            if (progress < 1) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
          obs.unobserve(el)
        }
      },
      { threshold: 0.5 },
    )

    obs.observe(el)
    return () => obs.disconnect()
  }, [to, duration])

  return (
    <span ref={ref} className={className}>
      {count}{suffix}
    </span>
  )
}
