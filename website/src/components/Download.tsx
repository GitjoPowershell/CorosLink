import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const RELEASES_URL = "https://github.com/JunAkerBuilds/CorosLink/releases";
const API_URL = "https://api.github.com/repos/JunAkerBuilds/CorosLink/releases/latest";

interface ReleaseAssets {
  macUrl: string | null;
  winUrl: string | null;
  linuxUrl: string | null;
  version: string | null;
}

const installNotes = [
  "No CorosLink account required",
  "Stores music and tokens locally",
  "Unsigned builds while the project is young",
];

export function Download() {
  const reduced = usePrefersReducedMotion();
  const [assets, setAssets] = useState<ReleaseAssets>({
    macUrl: null,
    winUrl: null,
    linuxUrl: null,
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
        const linuxAsset = data.assets?.find((a: { name: string }) =>
          a.name.endsWith(".AppImage"),
        );

        setAssets({
          macUrl: macAsset?.browser_download_url ?? null,
          winUrl: winAsset?.browser_download_url ?? null,
          linuxUrl: linuxAsset?.browser_download_url ?? null,
          version: data.tag_name ?? null,
        });
      } catch {
        if (!cancelled) setAssets({ macUrl: null, winUrl: null, linuxUrl: null, version: null });
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
  const linuxHref = assets.linuxUrl ?? RELEASES_URL;
  const releaseLabel = loading
    ? "Checking release..."
    : assets.version
      ? `Download ${assets.version}`
      : "View releases";
  const releaseStatus = loading
    ? "Checking GitHub Releases"
    : assets.version
      ? `Latest release ${assets.version}`
      : "Release assets unavailable";
  const reveal = {
    initial: { opacity: 0, y: reduced ? 0 : 34 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "0px 0px -120px 0px" },
    transition: { duration: 0.68, ease: "easeOut" as const },
  };

  return (
    <section id="download" className="download-section">
      <motion.div className="container download-panel" {...reveal}>
        <div className="download-hero-grid">
          <div className="download-copy">
            <motion.p className="eyebrow" {...reveal}>
              Get CorosLink
            </motion.p>
            <motion.h2 {...reveal}>Download the desktop companion.</motion.h2>
            <motion.p {...reveal}>
              Free for macOS, Windows, and Linux. Pull your Pace Pro workflows into one
              desktop app for music sync, direct USB transfer, and training review.
            </motion.p>

            <motion.div className="download-release-strip" {...reveal}>
              <span className="download-live-dot" aria-hidden="true" />
              <strong>{releaseStatus}</strong>
              <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
                GitHub Releases
              </a>
            </motion.div>

            <motion.ul className="download-note-list" {...reveal}>
              {installNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </motion.ul>
          </div>

          <motion.div
            className="download-preview"
            initial={{ opacity: 0, y: reduced ? 0 : 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -120px 0px" }}
            transition={{ duration: 0.62, ease: "easeOut" }}
          >
            <div className="download-window-bar" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="download-preview-body">
              <div>
                <span>Connected device</span>
                <strong>Pace Pro ready</strong>
              </div>
              <div className="download-preview-meter" aria-hidden="true">
                <motion.span
                  animate={reduced ? { width: "88%" } : { width: ["42%", "88%", "88%", "42%"] }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { duration: 5.6, repeat: Infinity, ease: "easeInOut" }
                  }
                />
              </div>
              <div className="download-preview-stats">
                <span>
                  <strong>42</strong>
                  tracks
                </span>
                <span>
                  <strong>3</strong>
                  playlists
                </span>
                <span>
                  <strong>FIT</strong>
                  export
                </span>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="download-actions">
          <DownloadOption
            delay={0}
            href={macHref}
            label="macOS"
            meta="Apple Silicon and Intel"
            cta={assets.macUrl || loading ? releaseLabel : "View releases"}
            icon="mac"
            version={assets.version}
            directAsset={Boolean(assets.macUrl)}
            reduced={reduced}
          />
          <DownloadOption
            delay={0.1}
            href={winHref}
            label="Windows"
            meta="Windows desktop installer"
            cta={assets.winUrl || loading ? releaseLabel : "View releases"}
            icon="windows"
            version={assets.version}
            directAsset={Boolean(assets.winUrl)}
            reduced={reduced}
          />
          <DownloadOption
            delay={0.2}
            href={linuxHref}
            label="Linux"
            meta="AppImage for x64 desktops"
            cta={assets.linuxUrl || loading ? releaseLabel : "View releases"}
            icon="linux"
            version={assets.version}
            directAsset={Boolean(assets.linuxUrl)}
            reduced={reduced}
          />
        </div>

        {!loading && !assets.macUrl && !assets.winUrl && !assets.linuxUrl && (
          <motion.p
            className="download-fallback"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            No installer assets were found in the latest release. Use GitHub Releases
            or build from source.
          </motion.p>
        )}
      </motion.div>
    </section>
  );
}

function DownloadOption({
  delay,
  href,
  label,
  meta,
  cta,
  icon,
  version,
  directAsset,
  reduced,
}: {
  delay: number;
  href: string;
  label: string;
  meta: string;
  cta: string;
  icon: "mac" | "windows" | "linux";
  version: string | null;
  directAsset: boolean;
  reduced: boolean;
}) {
  function handleDownloadClick() {
    track("Download Button Clicked", {
      platform: label,
      release: version ?? "unknown",
      target: directAsset ? "release-asset" : "github-releases",
    });
  }

  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="download-option"
      onClick={handleDownloadClick}
      initial={{ opacity: 0, y: reduced ? 0 : 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -120px 0px" }}
      transition={{ delay: reduced ? 0 : delay, duration: 0.56, ease: "easeOut" }}
      whileHover={reduced ? undefined : { y: -5 }}
      whileTap={reduced ? undefined : { scale: 0.99 }}
    >
      <span className={`download-platform-icon download-platform-icon--${icon}`} aria-hidden="true">
        {icon === "mac" ? <AppleIcon /> : icon === "windows" ? <WindowsIcon /> : <LinuxIcon />}
      </span>
      <span className="download-option-copy">
        <span>{label}</span>
        <strong>{cta}</strong>
        <em>{meta}</em>
      </span>
      <span className="download-arrow" aria-hidden="true">
        <DownloadArrowIcon />
      </span>
    </motion.a>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 384 512" focusable="false">
      <path
        fill="currentColor"
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM262.1 104.5c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
      />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path fill="currentColor" d="M3 4.8 10.7 3.7v7.4H3V4.8Zm8.7-1.2L21 2.2v8.9h-9.3V3.6ZM3 12.1h7.7v7.5L3 18.5v-6.4Zm8.7 0H21V21l-9.3-1.3v-7.6Z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path
        fill="currentColor"
        d="M12.5 2c-2.8 0-5 2.2-5 5 0 .5.1 1 .2 1.5C5.8 9.1 4 11.4 4 14c0 3.3 2.7 6 6 6h.5c.3 1.2 1.3 2 2.5 2s2.2-.8 2.5-2H16c3.3 0 6-2.7 6-6 0-2.6-1.8-4.9-4.2-5.5.1-.5.2-1 .2-1.5 0-2.8-2.2-5-5-5Zm-1.8 3.2c.4 0 .8.3.8.8s-.4.8-.8.8-.8-.3-.8-.8.4-.8.8-.8Zm3.6 0c.4 0 .8.3.8.8s-.4.8-.8.8-.8-.3-.8-.8.4-.8.8-.8ZM8.2 15.8c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1Zm7.6 0c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1Z"
      />
    </svg>
  );
}

function DownloadArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
        d="M12 4v12m0 0 5-5m-5 5-5-5m-2 8h14"
      />
    </svg>
  );
}
