import { useInView } from "../hooks/useInView";
import { useSpotlight } from "../hooks/useSpotlight";

const pillars = [
  {
    icon: "♫",
    title: "Media Manager",
    description:
      "Download MP3s from YouTube or sync Spotify playlists. Organize your library and transfer tracks in one click.",
  },
  {
    icon: "⌚",
    title: "USB Watch Sync",
    description:
      "Connect your Pace Pro over USB and copy music directly to the watch. No official SDK — just simple file transfer.",
  },
  {
    icon: "📊",
    title: "Training Hub",
    description:
      "Log in with your COROS account to view fitness scores, recovery readiness, race predictions, and activity details.",
  },
];

export function FeaturePillars() {
  const { ref, isVisible } = useInView<HTMLDivElement>();
  const onSpotlight = useSpotlight();

  return (
    <section id="features" className="section">
      <div className="container">
        <span className="section-label">Features</span>
        <h2 className="section-title">Everything your Pace Pro needs</h2>
        <p className="section-subtitle">
          Music management and training analytics together — three integrated
          workflows in one beautiful desktop app.
        </p>
        <div
          ref={ref}
          className={`pillars-grid reveal-stagger ${isVisible ? "is-visible" : ""}`}
        >
          {pillars.map((pillar) => (
            <article
              key={pillar.title}
              className="pillar-card glass-card spotlight"
              onPointerMove={onSpotlight}
            >
              <div className="pillar-icon" aria-hidden="true">
                {pillar.icon}
              </div>
              <h3>{pillar.title}</h3>
              <p>{pillar.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
