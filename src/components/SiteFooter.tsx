import Link from 'next/link'

export default function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <p className="site-footer-brand">PSC MASTER</p>
          <p className="muted tiny">Kerala PSC practice portal for authorized learners and administrators.</p>
        </div>
        <nav className="site-footer-links" aria-label="Footer">
          <Link href="/about">About Us</Link>
          <Link href="/contact">Contact Us</Link>
          <Link href="/privacy-policy">Privacy Policy</Link>
        </nav>
      </div>
      <p className="site-footer-copy tiny muted">© {year} PSC MASTER. All rights reserved.</p>
    </footer>
  )
}
