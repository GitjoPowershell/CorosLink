import { ImagePlus } from "lucide-react";
import { useState } from "react";
import type {
  CorosWatchfaceRasterFont,
  CorosWatchfaceRasterFontFolder
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  normalizeRasterFontGlyphs,
  rasterFontSupportsText
} from "./watchfaceStudio";

interface CustomPngFontPanelProps {
  api: CorosLinkApi;
  rasterFont?: CorosWatchfaceRasterFont;
  onRasterFontChange: (font: CorosWatchfaceRasterFont | undefined) => void;
  onActivate?: () => void;
}

interface RasterSpriteFolderImport
  extends Pick<
    CorosWatchfaceRasterFont,
    "dataUrl" | "glyphs" | "columns" | "labels"
  > {
  importedDigitCount: number;
  importedWeekdayCount: number;
}

const DEFAULT_RASTER_GLYPHS = "0123456789";
const MAX_RASTER_FONT_BYTES = 5 * 1024 * 1024;
const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The PNG font could not be read."));
    reader.onload = () => {
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The PNG font could not be read."));
    };
    reader.readAsDataURL(file);
  });
}

function labelFromFileName(name: string): string {
  return name.replace(/\.png$/i, "").trim() || "Custom PNG font";
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A PNG sprite could not be decoded."));
    image.src = dataUrl;
  });
}

function numericSpriteIndex(fileName: string): number | null {
  const match = fileName.match(/^(\d{1,2})\.png$/i);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 && index <= 9 ? index : null;
}

function weekdayLabelFor(fileName: string): string | null {
  const stem = fileName.replace(/\.png$/i, "").toUpperCase();
  if (WEEKDAY_LABELS.includes(stem)) {
    return stem;
  }
  const index = numericSpriteIndex(fileName);
  return index === null ? null : WEEKDAY_LABELS[index] ?? null;
}

async function createAtlasFromSprites(
  digitSprites: Map<string, string>
): Promise<Pick<CorosWatchfaceRasterFont, "dataUrl" | "glyphs" | "columns">> {
  const glyphs = [...digitSprites.keys()].sort();
  if (glyphs.length === 0) {
    throw new Error("Choose at least one digit PNG named 00.png through 09.png.");
  }
  const sprites = await Promise.all(
    glyphs.map(async (glyph) => ({
      glyph,
      image: await loadImage(digitSprites.get(glyph)!)
    }))
  );
  const cellWidth = Math.max(...sprites.map((sprite) => sprite.image.naturalWidth));
  const cellHeight = Math.max(...sprites.map((sprite) => sprite.image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = cellWidth * sprites.length;
  canvas.height = cellHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("PNG font atlas creation is unavailable in this window.");
  }
  sprites.forEach((sprite, index) => {
    context.drawImage(
      sprite.image,
      index * cellWidth + (cellWidth - sprite.image.naturalWidth) / 2,
      (cellHeight - sprite.image.naturalHeight) / 2
    );
  });
  return {
    dataUrl: canvas.toDataURL("image/png"),
    glyphs: glyphs.join(""),
    columns: glyphs.length
  };
}

async function readRasterSpriteFolder(
  folder: CorosWatchfaceRasterFontFolder,
  currentRasterFont?: CorosWatchfaceRasterFont
): Promise<RasterSpriteFolderImport> {
  const digitSprites = new Map<string, string>();
  const labelSprites = new Map<string, string>();
  const folderIsWeekdays = /^weekdays?$/i.test(folder.label.trim());
  for (const file of folder.sprites) {
    const relativePath = file.relativePath.replace(/\\/g, "/").toLowerCase();
    if (folderIsWeekdays || /(^|\/)weekdays?\//.test(relativePath)) {
      const label = weekdayLabelFor(file.name);
      if (label) {
        labelSprites.set(label, file.dataUrl);
      }
      continue;
    }
    const digit = numericSpriteIndex(file.name);
    if (digit !== null) {
      digitSprites.set(String(digit), file.dataUrl);
    }
  }
  const atlas = digitSprites.size > 0
    ? await createAtlasFromSprites(digitSprites)
    : currentRasterFont?.dataUrl
      ? {
          dataUrl: currentRasterFont.dataUrl,
          glyphs: normalizeRasterFontGlyphs(currentRasterFont.glyphs),
          columns: currentRasterFont.columns
        }
      : labelSprites.size > 0
        ? {
            dataUrl: labelSprites.values().next().value!,
            glyphs: "",
            columns: 1
          }
        : (() => {
            throw new Error(
              "Choose a digits folder, a weekdays folder, or a parent folder containing PNG sprites."
            );
          })();
  const labels = { ...currentRasterFont?.labels, ...Object.fromEntries(labelSprites) };
  return {
    ...atlas,
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    importedDigitCount: digitSprites.size,
    importedWeekdayCount: labelSprites.size
  };
}

function labelFromSpriteFolder(folder: CorosWatchfaceRasterFontFolder): string {
  return folder.label.replace(/[-_]+/g, " ").trim() || "Custom PNG sprites";
}

export function CustomPngFontPanel({
  api,
  rasterFont,
  onRasterFontChange,
  onActivate
}: CustomPngFontPanelProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rasterFontHasDigits = rasterFontSupportsText(
    rasterFont,
    DEFAULT_RASTER_GLYPHS
  );

  function updateRasterFont(patch: Partial<CorosWatchfaceRasterFont>) {
    if (rasterFont) {
      onRasterFontChange({ ...rasterFont, ...patch });
    }
  }

  async function chooseRasterFont(file: File | undefined) {
    if (!file) {
      return;
    }
    if (file.type !== "image/png") {
      setError("Choose a PNG file for the custom raster font.");
      return;
    }
    if (file.size > MAX_RASTER_FONT_BYTES) {
      setError("PNG font files must be 5 MB or smaller.");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      onActivate?.();
      onRasterFontChange({
        label: rasterFont?.label || labelFromFileName(file.name),
        dataUrl,
        glyphs: normalizeRasterFontGlyphs(rasterFont?.glyphs || DEFAULT_RASTER_GLYPHS),
        columns: rasterFont?.columns || DEFAULT_RASTER_GLYPHS.length,
        tint: rasterFont?.tint ?? false
      });
      setStatus(`Loaded ${file.name}.`);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The PNG font could not be read.");
    }
  }

  async function chooseRasterSpriteFolder() {
    try {
      setStatus("Reading PNG sprite folder…");
      setError(null);
      const folder = await api.chooseCorosWatchfaceRasterFontFolder();
      if (!folder) {
        setStatus(null);
        return;
      }
      const raster = await readRasterSpriteFolder(folder, rasterFont);
      onActivate?.();
      onRasterFontChange({
        label: rasterFont?.label || labelFromSpriteFolder(folder),
        ...raster,
        tint: rasterFont?.tint ?? false
      });
      const importSummary = [
        raster.importedDigitCount > 0
          ? String(raster.importedDigitCount) +
            " digit sprite" +
            (raster.importedDigitCount === 1 ? "" : "s")
          : null,
        raster.importedWeekdayCount > 0
          ? String(raster.importedWeekdayCount) +
            " weekday label" +
            (raster.importedWeekdayCount === 1 ? "" : "s")
          : null
      ].filter(Boolean).join(" and ");
      setStatus("Imported " + importSummary + ".");
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The PNG sprite folder could not be imported."
      );
      setStatus(null);
    }
  }

  return (
    <section className="watchface-raster-font-panel" aria-label="Custom PNG font">
      <div>
        <strong>Custom PNG font</strong>
        <span>Upload a uniformly gridded glyph atlas.</span>
      </div>
      <label className="watchface-raster-font-upload">
        <ImagePlus size={15} aria-hidden="true" />
        <span>{rasterFont ? "Replace PNG atlas" : "Upload PNG atlas"}</span>
        <input
          type="file"
          accept="image/png"
          onChange={(event) => void chooseRasterFont(event.currentTarget.files?.[0])}
        />
      </label>
      <button
        className="watchface-raster-font-upload"
        type="button"
        onClick={() => void chooseRasterSpriteFolder()}
      >
        <ImagePlus size={15} aria-hidden="true" />
        <span>Import PNG sprite folder</span>
      </button>
      {rasterFont ? (
        <div className="watchface-raster-font-fields">
          <label>
            Font label
            <input
              value={rasterFont.label}
              onChange={(event) => updateRasterFont({ label: event.target.value })}
              placeholder="My pixel font"
            />
          </label>
          <label>
            Columns
            <input
              type="number"
              min="1"
              max="64"
              value={rasterFont.columns}
              onChange={(event) =>
                updateRasterFont({
                  columns: Math.max(1, Math.min(64, Number(event.target.value) || 1))
                })
              }
            />
          </label>
          <label className="watchface-raster-font-glyphs">
            Glyph labels (left-to-right, then top-to-bottom)
            <input
              value={rasterFont.glyphs}
              onChange={(event) =>
                updateRasterFont({ glyphs: normalizeRasterFontGlyphs(event.target.value) })
              }
              placeholder="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            />
          </label>
          <label className="watchface-raster-font-tint">
            <input
              type="checkbox"
              checked={rasterFont.tint}
              onChange={(event) => updateRasterFont({ tint: event.target.checked })}
            />
            Apply selected digit color (overrides PNG colors)
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onRasterFontChange(undefined)}
          >
            Remove PNG font
          </button>
        </div>
      ) : null}
      {rasterFont && !rasterFontHasDigits ? (
        rasterFontSupportsText(rasterFont, "MON") ? (
          <p className="watchface-raster-font-status">
            This PNG set provides weekday labels and leaves numeric fields unchanged.
          </p>
        ) : (
          <p className="watchface-raster-font-warning">
            Add all of 0123456789 to the glyph labels before this PNG font can replace live watchface digits.
          </p>
        )
      ) : null}
      {error ? <p className="watchface-raster-font-warning">{error}</p> : null}
      {status ? <p className="watchface-raster-font-status">{status}</p> : null}
      <p>
        PNG colors are preserved by default. An atlas needs 0123456789 for live numeric fields. A sprite folder can contain digits/00.png-09.png and optional weekdays/00.png-06.png (Monday to Sunday).
      </p>
    </section>
  );
}
