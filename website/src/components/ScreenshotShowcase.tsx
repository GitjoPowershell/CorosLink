import { useInView } from "../hooks/useInView";
import overviewImg from "../../../docs/screenshots/overview.png";
import libraryImg from "../../../docs/screenshots/library.png";
import youtubeImg from "../../../docs/screenshots/youtube.png";
import spotifyImg from "../../../docs/screenshots/spotify.png";
import trainingHubImg from "../../../docs/screenshots/training-hub.png";

interface ShowcaseItem {
  title: string;
  description: string;
  bullets: string[];
  image: string;
  alt: string;
  reverse?: boolean;
}

const items: ShowcaseItem[] = [
  {
    title: "Overview — Dashboard at a glance",
    description:
      "Your home screen for watch status, library metrics, and quick actions.",
    bullets: [
      "Time-of-day greeting with live connection status",
      "Storage ring showing used, free, and 32 GB capacity",
      "Metric tiles for library count, watch tracks, and transfers",
      "Paste-a-link download with optional auto-transfer",
      "Recent downloads with per-track actions",
    ],
    image: overviewImg,
    alt: "Overview dashboard",
  },
  {
    title: "Library — Your local MP3 collection",
    description: "Organize downloads and sync them to your watch when ready.",
    bullets: [
      "Full library table with title, size, date, and sync status",
      "Transfer single tracks or transfer all at once",
      "Multi-select bulk delete to clean up your library",
    ],
    image: libraryImg,
    alt: "Media library",
    reverse: true,
  },
  {
    title: "YouTube — Browse and download in-app",
    description: "An embedded YouTube browser with one-tap MP3 downloads.",
    bullets: [
      "Back, forward, home, and search navigation",
      "Green MP3 buttons on video thumbnails",
      "Playlist download support on watch and playlist pages",
      "Background download queue with live progress",
    ],
    image: youtubeImg,
    alt: "YouTube browser",
  },
  {
    title: "Spotify — Sync playlists to your watch",
    description: "OAuth login and automatic YouTube matching for each track.",
    bullets: [
      "Browse owned and collaborative playlists",
      "Auto-match tracks via YouTube search",
      "Optional auto-transfer when connected over USB",
    ],
    image: spotifyImg,
    alt: "Spotify sync",
    reverse: true,
  },
  {
    title: "Training Hub — COROS analytics dashboard",
    description:
      "Fitness scores, recovery readiness, and race predictions on your desktop.",
    bullets: [
      "Summary tiles for Stamina, Recovery, Training Load, and Resting HR",
      "Recovery readiness ring with stamina overlay",
      "7-day charts for Training Load and HRV vs Baseline",
      "EvoLab fitness scores and race predictor",
      "Recent activities with detail panel and FIT export",
    ],
    image: trainingHubImg,
    alt: "Training Hub",
  },
];

function ShowcaseRow({ item }: { item: ShowcaseItem }) {
  const { ref, isVisible } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`showcase-item ${item.reverse ? "showcase-item--reverse" : ""} reveal ${isVisible ? "is-visible" : ""}`}
    >
      <div className="showcase-content">
        <h3>{item.title}</h3>
        <p>{item.description}</p>
        <ul className="showcase-list">
          {item.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </div>
      <div className="showcase-image">
        <div className="showcase-image-glow" aria-hidden="true" />
        <img src={item.image} alt={item.alt} loading="lazy" />
      </div>
    </div>
  );
}

export function ScreenshotShowcase() {
  return (
    <section className="section">
      <div className="container">
        {items.map((item) => (
          <ShowcaseRow key={item.title} item={item} />
        ))}
      </div>
    </section>
  );
}
