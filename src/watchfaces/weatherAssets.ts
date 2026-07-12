import type {
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import { loadStudioImage, parseConfigPos, pickPreviewResolution } from "./watchfaceStudio";

export interface WatchfaceWeatherStyle {
  enabled: boolean;
  /** Top-left corner in preview-resolution coordinates. */
  x: number;
  y: number;
  scale: number;
}

const weather416 = import.meta.glob(
  "../assets/watchfaces/weather/416/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;
const weather800 = import.meta.glob(
  "../assets/watchfaces/weather/800/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

function orderedUrls(files: Record<string, string>): string[] {
  return Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, url]) => url);
}

const urls416 = orderedUrls(weather416);
const urls800 = orderedUrls(weather800);

export function getWeatherCapability(details: CorosWatchfaceTemplateDetails): {
  active: boolean;
  defaultPos: { x: number; y: number };
  size: { width: number; height: number };
} | null {
  const resolution = pickPreviewResolution(details);
  if (!resolution) {
    return null;
  }
  const scale = resolution.width / 416;
  return {
    active: Boolean(
      parseConfigPos(resolution.config.weather_icon_pos) &&
      resolution.config.weather_icon_dir
    ),
    defaultPos:
      parseConfigPos(resolution.config.weather_icon_pos) ?? {
        x: Math.round(187 * scale),
        y: Math.round(57 * scale)
      },
    size: resolution.width >= 800
      ? { width: 123, height: 123 }
      : { width: 64, height: 64 }
  };
}

export function buildWeatherOverrides(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceWeatherStyle
): CorosWatchfaceConfigOverride[] {
  const base = pickPreviewResolution(details);
  if (!base) {
    return [];
  }
  return details.resolutions.flatMap((resolution) => {
    const hasWeatherKeys =
      Object.prototype.hasOwnProperty.call(resolution.config, "weather_icon_pos") ||
      Object.prototype.hasOwnProperty.call(resolution.config, "weather_icon_dir");
    if (!style.enabled && !hasWeatherKeys) {
      return [];
    }
    const scale = resolution.width / base.width;
    return [{
      path: `${resolution.directory}/config.txt`,
      values: style.enabled
        ? {
            weather_icon_pos: `{${Math.round(style.x * scale)},${Math.round(style.y * scale)}}`,
            weather_icon_dir: "weather"
          }
        : { weather_icon_pos: "", weather_icon_dir: "" }
    }];
  });
}

async function imageUrlToDataUrl(url: string, scale: number): Promise<string> {
  const image = await loadStudioImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Weather sprite rendering is unavailable in this window.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function weatherPreviewUrl(width: number): string {
  return (width >= 800 ? urls800 : urls416)[0] ?? "";
}

export async function buildWeatherSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceWeatherStyle
): Promise<CorosWatchfaceAssetReplacement[]> {
  if (!style.enabled) {
    return [];
  }
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const resolution of details.resolutions) {
    const urls = resolution.width >= 800 ? urls800 : urls416;
    if (urls.length !== 41) {
      throw new Error("The stored weather set must contain exactly 41 sprites.");
    }
    const dataUrls = await Promise.all(
      urls.map((url) => imageUrlToDataUrl(url, style.scale))
    );
    dataUrls.forEach((dataUrl, index) => {
      replacements.push({
        path: `${resolution.directory}/weather/${String(index).padStart(2, "0")}.png`,
        dataUrl,
        create: true
      });
    });
  }
  return replacements;
}
