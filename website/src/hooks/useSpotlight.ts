import { useCallback } from "react";
import type { PointerEvent } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/**
 * Returns an onPointerMove handler that writes the cursor position (relative to
 * the hovered element) into --mx/--my CSS custom properties, driving a radial
 * "spotlight" glow defined in CSS. No-op when reduced motion is requested.
 */
export function useSpotlight() {
  const reduced = usePrefersReducedMotion();

  return useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (reduced) return;
      const el = event.currentTarget;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      el.style.setProperty("--my", `${event.clientY - rect.top}px`);
    },
    [reduced],
  );
}
