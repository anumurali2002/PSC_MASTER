import type { Metadata, Viewport } from 'next'
import './globals.css'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'PSC MASTER | Kerala PSC Practice Portal',
    template: '%s | PSC MASTER'
  },
  description: 'PSC MASTER is a private Kerala PSC practice portal for topic-wise MCQ practice, assigned examinations, revision, and progress tracking.',
  applicationName: 'PSC MASTER',
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/'
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'PSC MASTER',
    title: 'PSC MASTER | Kerala PSC Practice Portal',
    description: 'Private Kerala PSC practice portal for topic-wise MCQ practice, assigned exams, revision, and progress tracking.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'PSC MASTER' }]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PSC MASTER | Kerala PSC Practice Portal',
    description: 'Private Kerala PSC practice portal for topic-wise MCQ practice, assigned exams, revision, and progress tracking.',
    images: ['/opengraph-image']
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' }
    ],
    apple: [{ url: '/apple-icon', sizes: '180x180', type: 'image/png' }]
  },
  robots: {
    index: true,
    follow: true
  }
}

export const viewport: Viewport = {
  themeColor: '#176b55',
  width: 'device-width',
  initialScale: 1
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
