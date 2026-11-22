export default function Loading() {
  return (
    <div className="loading-shell" role="status" aria-live="polite" aria-label="Loading">
      <div className="loading-card">
        <div className="loading-brand"><span className="brand-mark">P</span></div>
        <div className="loading-bar"><span /></div>
        <p className="muted">Loading PSC MASTER...</p>
      </div>
    </div>
  )
}
