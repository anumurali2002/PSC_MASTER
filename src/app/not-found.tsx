import Link from 'next/link'
import SiteFooter from '@/components/SiteFooter'

export default function NotFound() {
  return (
    <main className="info-page">
      <div className="info-shell">
        <article className="info-card not-found-card">
          <p className="eyebrow">404 ERROR</p>
          <div className="not-found-visual" aria-hidden="true">
            <span>4</span>
            <span className="not-found-orbit">0</span>
            <span>4</span>
          </div>
          <h1>Page not found</h1>
          <p className="info-lead">The page you are looking for does not exist or may have been moved.</p>
          <div className="not-found-actions">
            <Link href="/" className="primary">Back to Home</Link>
            <Link href="/contact" className="secondary">Contact</Link>
          </div>
        </article>
              <SiteFooter />
      </div>
    </main>
  )
}
