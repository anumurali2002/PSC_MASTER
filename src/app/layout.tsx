import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PSC MASTER',
  description: 'Kerala PSC practice portal'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
