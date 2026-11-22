import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PSC MASTER',
    short_name: 'PSC MASTER',
    description: 'Kerala PSC practice portal for MCQ practice, exams, revision, and progress tracking.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f8fa',
    theme_color: '#176b55',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' }
    ]
  }
}
