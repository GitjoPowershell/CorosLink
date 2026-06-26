import { useEffect, useRef, useState } from "react";
import { useInView } from "../hooks/useInView";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

interface Stat {
  /** Numeric target for the count-up; null = no animated number (uses prefix only). */
  value: number | null;
  prefix?: string;
  suffix?: string;
  label: string;
}

const stats: Stat[] = [
  { value: 2, label: "Desktop platforms — macOS & Windows" },
  { value: 100, suffix: "%", label: "Local-first — no cloud backend" },
  { value: 1, prefix: "", suffix: "-click", label: "USB sync to your Pace Pro" },
  { value: 0, prefix: "$", label: "Free & open source, forever" },
];

function useCountUp(target: number, active: boolean, reduced: boolean) {
  const [display, setDisplay] = useState(reduced ? target : 0);

  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setDisplay(target);
      return;
    }
    const duration = 1400;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(eased * target));
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, target, reduced]);

  return display;
}

function StatValue({ stat, active }: { stat: Stat; active: boolean }) {
  const reduced = usePrefersReducedMotion();
  const count = useCountUp(stat.value ?? 0, active, reduced);
  return (
    <span className="stat-value">
      {stat.prefix}
      {stat.value === null ? "" : count}
      {stat.suffix}
    </span>
  );
}

export function Stats() {
  const { ref, isVisible } = useInView<HTMLDivElement>();
  const startedRef = useRef(false);
  if (isVisible) startedRef.current = true;

  return (
    <section className="section stats-section">
      <div className="container">
        <div
          ref={ref}
          className={`stats-grid glass-card reveal-stagger ${isVisible ? "is-visible" : ""}`}
        >
          {stats.map((stat) => (
            <div key={stat.label} className="stat">
              <StatValue stat={stat} active={startedRef.current} />
              <span className="stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
