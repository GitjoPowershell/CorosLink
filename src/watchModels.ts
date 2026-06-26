import type { WatchModelId, WatchStatus } from "../electron/types";
import pace4Hero from "../public/assets/pace-4-hero.webp";
import paceProHero from "../public/assets/pace-pro-hero.webp";

export const PACE_PRO_BYTES = 32 * 1024 * 1024 * 1024;
export const PACE_4_BYTES = 4 * 1024 * 1024 * 1024;

export interface WatchPresentation {
  model?: WatchModelId;
  displayName: string;
  companion: string;
  connectHint: string;
  heroImage: string;
  heroAlt: string;
  capacityLabel: string;
  fallbackBytes: number;
}

const MODEL_PRESENTATION: Record<WatchModelId, WatchPresentation> = {
  "pace-pro": {
    model: "pace-pro",
    displayName: "COROS Pace Pro",
    companion: "Your Pace Pro companion",
    connectHint: "Connect your Pace Pro via USB to sync music",
    heroImage: paceProHero,
    heroAlt: "COROS Pace Pro",
    capacityLabel: "32 GB Pace Pro capacity fallback",
    fallbackBytes: PACE_PRO_BYTES,
  },
  "pace-4": {
    model: "pace-4",
    displayName: "COROS Pace 4",
    companion: "Your Pace 4 companion",
    connectHint: "Connect your Pace 4 via USB to sync music",
    heroImage: pace4Hero,
    heroAlt: "COROS Pace 4",
    capacityLabel: "4 GB Pace 4 capacity fallback",
    fallbackBytes: PACE_4_BYTES,
  },
};

const OFFLINE_PRESENTATION: WatchPresentation = {
  displayName: "COROS Watch",
  companion: "Your COROS companion",
  connectHint: "Connect your COROS watch via USB to sync music",
  heroImage: paceProHero,
  heroAlt: "COROS watch",
  capacityLabel: "32 GB Pace Pro capacity fallback",
  fallbackBytes: PACE_PRO_BYTES,
};

export function getWatchPresentation(
  watchStatus: WatchStatus | null
): WatchPresentation {
  if (!watchStatus?.connected || !watchStatus.model) {
    return OFFLINE_PRESENTATION;
  }

  return MODEL_PRESENTATION[watchStatus.model];
}
