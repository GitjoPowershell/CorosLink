import { useEffect, useState } from "react";
import { useInView } from "../hooks/useInView";
import { useSpotlight } from "../hooks/useSpotlight";

const RELEASES_URL = "https://github.com/JunAkerBuilds/CorosLink/releases";
const API_URL = "https://api.github.com/repos/JunAkerBuilds/CorosLink/releases/latest";

interface ReleaseAssets {
  macUrl: string | null;
  winUrl: string | null;
  version: string | null;
}

export function Download() {
  const { ref: headerRef, isVisible: headerVisible } = useInView<HTMLDivElement>();
  const { ref: cardsRef, isVisible: cardsVisible } = useInView<HTMLDivElement>();
  const onSpotlight = useSpotlight();
  const [assets, setAssets] = useState<ReleaseAssets>({
    macUrl: null,
    winUrl: null,
    version: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchRelease() {
      try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error("No release");
        const data = await res.json();
        if (cancelled) return;

        const macAsset = data.assets?.find((a: { name: string }) =>
          a.name.endsWith(".dmg"),
        );
        const winAsset = data.assets?.find((a: { name: string }) =>
          a.name.endsWith(".exe"),
        );

        setAssets({
          macUrl: macAsset?.browser_download_url ?? null,
          winUrl: winAsset?.browser_download_url ?? null,
          version: data.tag_name ?? null,
        });
      } catch {
        if (!cancelled) {
          setAssets({ macUrl: null, winUrl: null, version: null });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRelease();
    return () => {
      cancelled = true;
    };
  }, []);

  const macHref = assets.macUrl ?? RELEASES_URL;
  const winHref = assets.winUrl ?? RELEASES_URL;

  return (
    <section id="download" className="section download-section">
      <div className="container" ref={headerRef}>
        <span className="section-label">Get started</span>
        <h2 className={`section-title reveal ${headerVisible ? "is-visible" : ""}`}>
          Download CorosLink
        </h2>
        <p className="section-subtitle">
          Free for macOS and Windows. Connect your Pace Pro over USB and start
          syncing music in minutes.
        </p>
        <div
          ref={cardsRef}
          className={`download-cards reveal-stagger ${cardsVisible ? "is-visible" : ""}`}
        >
          <a
            href={macHref}
            className="download-card glass-card btn spotlight"
            target="_blank"
            rel="noopener noreferrer"
            onPointerMove={onSpotlight}
          >
            <span className="download-card-icon" aria-hidden="true">{"\uF8FF"}</span>
            <h3>macOS</h3>
            <p>
              {loading
                ? "Checking for release…"
                : assets.macUrl
                  ? `Download ${assets.version ?? ""}`.trim()
                  : "View releases"}
            </p>
          </a>
          <a
            href={winHref}
            className="download-card glass-card btn spotlight"
            target="_blank"
            rel="noopener noreferrer"
            onPointerMove={onSpotlight}
          >
            <span className="download-card-icon" aria-hidden="true">
              ⊞
            </span>
            <h3>Windows</h3>
            <p>
              {loading
                ? "Checking for release…"
                : assets.winUrl
                  ? `Download ${assets.version ?? ""}`.trim()
                  : "View releases"}
            </p>
          </a>
        </div>
        {!loading && !assets.macUrl && !assets.winUrl && (
          <p className="download-fallback">
            No release published yet.{" "}
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
              Check GitHub Releases
            </a>{" "}
            or build from source.
          </p>
        )}
      </div>
    </section>
  );
}
