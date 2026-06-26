export function TrustStrip() {
  return (
    <section className="trust-strip">
      <div className="container trust-strip-inner">
        <div className="trust-badge">
          <span className="trust-badge-icon">mac</span>
          macOS
        </div>
        <div className="trust-divider" aria-hidden="true" />
        <div className="trust-badge">
          <span className="trust-badge-icon">win</span>
          Windows
        </div>
        <div className="trust-divider" aria-hidden="true" />
        <div className="trust-badge">
          <span className="trust-badge-icon">🔒</span>
          Local-first data
        </div>
        <div className="trust-divider" aria-hidden="true" />
        <div className="trust-badge">
          <span className="trust-badge-icon">★</span>
          Free &amp; open source
        </div>
      </div>
    </section>
  );
}
