import { useInView } from "../hooks/useInView";
import { useSpotlight } from "../hooks/useSpotlight";

const cards = [
  {
    title: "Local music storage",
    description:
      "Downloads and your MP3 library live in the Electron user data directory on your machine — SQLite database plus files on disk.",
  },
  {
    title: "Spotify tokens stay local",
    description:
      "OAuth tokens are stored in your local SQLite database after login. They are never sent anywhere except Spotify.",
  },
  {
    title: "COROS login scope",
    description:
      "Your COROS email and password authenticate with COROS servers. Activity data is fetched on demand and not synced elsewhere.",
  },
  {
    title: "No cloud backend",
    description:
      "CorosLink does not run its own backend or upload your files. Everything stays on your machine unless you choose to sync.",
  },
];

export function Privacy() {
  const { ref, isVisible } = useInView<HTMLDivElement>();
  const onSpotlight = useSpotlight();

  return (
    <section className="section">
      <div className="container">
        <span className="section-label">Privacy</span>
        <h2 className="section-title">Your data stays yours</h2>
        <p className="section-subtitle">
          Local-first by design. Only download media you have the rights or
          permission to download.
        </p>
        <div
          ref={ref}
          className={`privacy-grid reveal-stagger ${isVisible ? "is-visible" : ""}`}
        >
          {cards.map((card) => (
            <article
              key={card.title}
              className="privacy-card glass-card spotlight"
              onPointerMove={onSpotlight}
            >
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
