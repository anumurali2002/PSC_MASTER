import type { Metadata } from 'next'
import Link from 'next/link'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'About Us',
  description: 'Learn about PSC MASTER, a private Kerala PSC practice portal focused on structured preparation and progress tracking.',
  alternates: { canonical: '/about' }
}

export default function AboutPage() {
  return (
    <main className="info-page">
      <div className="info-shell">
        <Link href="/" className="text-button info-back">← Back to home</Link>
        <article className="info-card">
          <p className="eyebrow">ABOUT PSC MASTER</p>
          <h1>A focused space for Kerala PSC preparation</h1>
          <p className="info-lead">PSC MASTER is a private practice portal designed to help learners prepare through topic-wise MCQs, assigned examinations, revision, and measurable progress.</p>
          <section className="info-section">
            <h2>What the portal provides</h2>
            <ul>
              <li>Topic-wise practice from an organized question bank.</li>
              <li>Administrator-assigned examinations with individual papers.</li>
              <li>Revision support for questions answered incorrectly.</li>
              <li>Progress visibility through attempts, accuracy, and results.</li>
            </ul>
          </section>
          <section className="info-section">
            <h2>How it is used</h2>
            <p>Learners use PSC MASTER to practice and review their performance. Administrators manage the question bank, users, and examinations. The portal is intended for authorized users and guided preparation, not public self-registration.</p>
          </section>
        </article>
              <SiteFooter />
      </div>
    </main>
  )
}
