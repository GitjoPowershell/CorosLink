import { useInView } from "../hooks/useInView";

const musicPath = ["YouTube", "Spotify", "yt-dlp + ffmpeg", "SQLite", "USB Music", "Pace Pro"];
const trainingPath = ["COROS account", "teamapi.coros.com", "Training Hub"];

export function HowItWorks() {
  const { ref, isVisible } = useInView<HTMLDivElement>();

  return (
    <section id="how-it-works" className="section">
      <div className="container">
        <span className="section-label">Architecture</span>
        <h2 className="section-title">How it works</h2>
        <p className="section-subtitle">
          Two independent data paths — USB for music, COROS APIs for training. No
          cloud backend, no third-party sync.
        </p>
        <div
          ref={ref}
          className={`flow-diagram reveal-stagger ${isVisible ? "is-visible" : ""}`}
        >
          <div className="flow-path glass-card">
            <h3>Music sync</h3>
            <div className="flow-steps">
              {musicPath.map((step, i) => (
                <span key={step}>
                  {i > 0 && <span className="flow-arrow" aria-hidden="true">→</span>}
                  <span className="flow-step">{step}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flow-path glass-card">
            <h3>Training Hub</h3>
            <div className="flow-steps">
              {trainingPath.map((step, i) => (
                <span key={step}>
                  {i > 0 && <span className="flow-arrow" aria-hidden="true">→</span>}
                  <span className="flow-step">{step}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
