import { useEffect, useRef } from "react";
import heroImage from "../../../public/assets/pace-pro-hero.webp";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const GITHUB_URL = "https://github.com/JunAkerBuilds/CorosLink";

export function Hero() {
  const visualRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const reduced = usePrefersReducedMotion();

  // Scroll parallax on the watch image.
  useEffect(() => {
    if (reduced) return;
    const image = imageRef.current;
    if (!image) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const offset = window.scrollY * 0.06;
      image.style.setProperty("--parallax", `${offset}px`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  // Pointer-driven 3D tilt toward the cursor.
  useEffect(() => {
    if (reduced) return;
    const visual = visualRef.current;
    if (!visual) return;

    const onMove = (e: PointerEvent) => {
      const rect = visual.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      visual.style.setProperty("--ry", `${px * 16}deg`);
      visual.style.setProperty("--rx", `${-py * 16}deg`);
    };
    const onLeave = () => {
      visual.style.setProperty("--ry", "0deg");
      visual.style.setProperty("--rx", "0deg");
    };

    visual.addEventListener("pointermove", onMove);
    visual.addEventListener("pointerleave", onLeave);
    return () => {
      visual.removeEventListener("pointermove", onMove);
      visual.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  return (
    <section className="hero">
      <div className="hero-bg" aria-hidden="true">
        <div className="hero-orb hero-orb--green" />
        <div className="hero-orb hero-orb--gold" />
        <div className="hero-orb hero-orb--white" />
      </div>
      <div className="container hero-grid">
        <div className="hero-content">
          <span className="hero-eyebrow reveal is-visible">
            <span className="hero-eyebrow-dot" /> Unofficial COROS Pace Pro companion
          </span>
          <h1>
            Your <em>Pace Pro</em> companion
          </h1>
          <p className="hero-tagline">
            Media, watch sync, and training analytics in one desktop app — built for
            COROS Pace Pro owners on Mac and Windows.
          </p>
          <p className="hero-disclaimer">
            Unofficial desktop app. Not affiliated with or endorsed by COROS.
          </p>
          <div className="hero-actions">
            <a href="#download" className="btn btn-primary">
              Download for free
              <ArrowIcon />
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              View on GitHub
            </a>
          </div>
        </div>
        <div className="hero-visual" ref={visualRef}>
          <div className="hero-glow" aria-hidden="true" />
          <img
            ref={imageRef}
            className="hero-image"
            src={heroImage}
            alt="COROS Pace Pro watch"
          />
        </div>
      </div>
    </section>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="btn-arrow"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}
