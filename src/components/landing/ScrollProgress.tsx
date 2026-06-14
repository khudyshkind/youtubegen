'use client'

import { useState, useEffect } from 'react'

export default function ScrollProgress() {
  const [pct, setPct] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY
      const total = document.documentElement.scrollHeight - window.innerHeight
      setPct(total > 0 ? (scrolled / total) * 100 : 0)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px]" style={{ background: 'rgba(255,255,255,0.05)' }}>
      <div
        className="h-full"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(to right, #7C3AED, #2563EB, #EC4899)',
          transition: 'width 0.1s linear',
        }}
      />
    </div>
  )
}
