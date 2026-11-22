import type { Metadata } from 'next'
import Link from 'next/link'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Contact information guidance for PSC MASTER users and administrators.',
  alternates: { canonical: '/contact' }
}

export default function ContactPage() {
  return (
    <main className="info-page">
      <div className="info-shell">
        <Link href="/" className="text-button info-back">← Back to home</Link>
        <article className="info-card">
          <p className="eyebrow">CONTACT</p>
          <h1>Contact Us</h1>
          <p className="info-lead">PSC MASTER is a private practice portal. For account access, password help, question bank issues, or exam-related support, please contact your portal administrator.</p>
          <section className="info-section">
            <h2>For learners</h2>
            <ul>
              <li>Account access or sign-in issues: contact your administrator.</li>
              <li>Missing exams or assigned papers: contact your administrator.</li>
              <li>Question or content concerns: report them to your administrator for review.</li>
            </ul>
          </section>
          <section className="info-section">
            <h2>For administrators</h2>
            <p>Administrators manage users, question content, and exam assignments through the admin area. For deployment, database, or infrastructure changes, use your organization&apos;s normal technical support process.</p>
          </section>
          <p className="note">This page does not publish personal contact details because they are not configured in the application.</p>
        </article>
              <SiteFooter />
      </div>
    </main>
  )
}
