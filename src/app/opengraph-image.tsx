import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Lefiro — AI video for YouTube'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0A0F',
          position: 'relative',
        }}
      >
        {/* subtle radial glow */}
        <div
          style={{
            position: 'absolute',
            width: 800,
            height: 800,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at center, rgba(124,58,237,0.18) 0%, transparent 70%)',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
          }}
        />

        {/* wordmark */}
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: '-2px',
            background: 'linear-gradient(135deg, #a78bfa 0%, #6366f1 60%, #818cf8 100%)',
            backgroundClip: 'text',
            color: 'transparent',
            display: 'flex',
            marginBottom: 24,
          }}
        >
          Lefiro
        </div>

        {/* tagline */}
        <div
          style={{
            fontSize: 28,
            color: '#94a3b8',
            letterSpacing: '0.5px',
            display: 'flex',
          }}
        >
          AI video for YouTube · 10 minutes
        </div>

        {/* bottom accent line */}
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            width: 80,
            height: 3,
            borderRadius: 2,
            background: 'linear-gradient(90deg, #7c3aed, #6366f1)',
            display: 'flex',
          }}
        />
      </div>
    ),
    { ...size },
  )
}
