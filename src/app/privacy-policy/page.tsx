import type { Metadata } from 'next'
import Link from 'next/link'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for PSC MASTER, describing how account, practice, and exam data is handled within the portal.',
  alternates: { canonical: '/privacy-policy' }
}

export default function PrivacyPolicyPage() {
  return (
    <main className="info-page">
      <div className="info-shell">
        <Link href="/" className="text-button info-back">← Back to home</Link>
        <article className="info-card">
          <p className="eyebrow">PRIVACY POLICY</p>
          <h1>Privacy Policy</h1>
          <p className="info-lead">This policy describes how PSC MASTER handles information within this private practice portal. It applies to authorized users who access the application.</p>
          <section className="info-section">
            <h2>Information used by the portal</h2>
            <ul>
              <li><strong>Account information:</strong> name, email address, role, and authentication data needed to sign in.</li>
              <li><strong>Learning activity:</strong> practice attempts, exam submissions, scores, and revision data.</li>
              <li><strong>Admin-managed content:</strong> questions, exams, and uploaded files managed by administrators.</li>
            </ul>
          </section>
          <section className="info-section">
            <h2>How information is used</h2>
            <p>Information is used to provide access, deliver practice and exam features, calculate results, show revision items, and support administrative management. Individual learner answers are intended for the learner&apos;s own review and are not exposed through the admin user summary.</p>
          </section>
          <section className="info-section">
            <h2>Storage and access</h2>
            <p>The application uses configured infrastructure services for authentication, database storage, and optional file uploads. Access should be limited to authorized users. Administrators are responsible for managing accounts and content appropriately.</p>
          </section>
          <section className="info-section">
            <h2>Data requests</h2>
            <p>For account, data, or privacy-related requests, contact your portal administrator. This page is a general application policy and does not replace legal advice or organization-specific privacy requirements.</p>
          </section>
        </article>
              <SiteFooter />
      </div>
    </main>
  )
}
