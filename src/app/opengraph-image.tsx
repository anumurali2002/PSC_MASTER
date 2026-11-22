import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'
export const alt = 'PSC MASTER'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px',
          background: 'linear-gradient(135deg, #17312d 0%, #176b55 55%, #e8f3ef 180%)',
          color: '#fff',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 96, height: 96, borderRadius: 28, background: '#fff', color: '#176b55', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, fontWeight: 900 }}>P</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: -2 }}>PSC MASTER</div>
            <div style={{ fontSize: 30, color: '#d8ebe4' }}>Kerala PSC Practice Portal</div>
          </div>
        </div>
        <div style={{ marginTop: 48, fontSize: 34, color: '#edf7f3', maxWidth: 900, lineHeight: 1.35 }}>
          Practice MCQs, complete assigned exams, and track your preparation progress.
        </div>
      </div>
    ),
    size
  )
}
