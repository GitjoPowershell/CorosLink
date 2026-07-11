import { ChevronDown, Loader2, Type } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import type { CorosLinkApi } from "../coroslink-api";
import type { WatchfaceTypography } from "./watchfaceStudio";

interface LocalFontPickerProps {
  api: CorosLinkApi;
  label: string;
  value: string;
  emptyLabel: string;
  onChange: (family: string) => void;
  typography?: WatchfaceTypography;
  onTypographyChange?: (typography: WatchfaceTypography) => void;
  disabled?: boolean;
}

/**
 * A searchable picker for the font families installed on the current machine.
 * A font is deliberately only applied when the user presses the rasterize
 * button, making the browser-preview → PNG-sprite step explicit.
 */
export function LocalFontPicker({
  api,
  label,
  value,
  emptyLabel,
  onChange,
  typography,
  onTypographyChange,
  disabled = false
}: LocalFontPickerProps) {
  const [open, setOpen] = useState(false);
  const [families, setFamilies] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState(value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchingFamilies = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return families ?? [];
    }
    return (families ?? []).filter((family) =>
      family.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [families, query]);
  const exactMatch = matchingFamilies.some(
    (family) => family.localeCompare(query.trim(), undefined, { sensitivity: "accent" }) === 0
  );
  const fontWeight = typography?.fontWeight ?? 400;
  const fontStyle = typography?.fontStyle ?? "normal";
  const letterSpacing = typography?.letterSpacing ?? 0;
  const typographyDisabled = disabled || !value;
  const sampleStyle: CSSProperties = {
    fontWeight,
    fontStyle,
    letterSpacing: `${letterSpacing}em`
  };

  function updateTypography(patch: WatchfaceTypography) {
    onTypographyChange?.({ ...typography, ...patch });
  }

  async function openPicker() {
    if (disabled) {
      return;
    }
    setCandidate(value);
    setOpen(true);
    if (families !== null || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextFamilies = await api.listLocalFontFamilies();
      setFamilies(nextFamilies);
      if (nextFamilies.length === 0) {
        setError("No installed font families were found. You can still enter a family name below.");
      }
    } catch {
      setFamilies([]);
      setError("Could not scan installed fonts. You can still enter a family name below.");
    } finally {
      setLoading(false);
    }
  }

  function closePicker() {
    setOpen(false);
    setQuery("");
  }

  function applyCandidate() {
    if (!candidate.trim()) {
      return;
    }
    onChange(candidate.trim());
    closePicker();
  }

  function restoreTemplate() {
    onChange("");
    closePicker();
  }

  return (
    <div className="field watchface-font-picker">
      <span className="watchface-font-picker-label">{label}</span>
      <button
        className="watchface-font-picker-trigger"
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => void openPicker()}
      >
        <span
          className={value ? "watchface-font-picker-value" : "watchface-font-picker-placeholder"}
          style={value ? { fontFamily: value, ...sampleStyle } : undefined}
        >
          {value || emptyLabel}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {typography && onTypographyChange ? (
        <div className="watchface-typography-controls">
          <label>
            Weight
            <select
              value={fontWeight}
              disabled={typographyDisabled}
              onChange={(event) => updateTypography({ fontWeight: Number(event.target.value) })}
            >
              {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => (
                <option key={weight} value={weight}>
                  {weight}{weight === 400 ? " · Regular" : weight === 700 ? " · Bold" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Style
            <select
              value={fontStyle}
              disabled={typographyDisabled}
              onChange={(event) =>
                updateTypography({
                  fontStyle: event.target.value as "normal" | "italic"
                })
              }
            >
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </select>
          </label>
          <label className="watchface-typography-tracking">
            Digit spacing <span>{Math.round(letterSpacing * 100)}%</span>
            <input
              type="range"
              min="-0.1"
              max="0.25"
              step="0.01"
              value={letterSpacing}
              disabled={typographyDisabled}
              onChange={(event) => updateTypography({ letterSpacing: Number(event.target.value) })}
            />
          </label>
        </div>
      ) : null}
      {typography && !value ? (
        <p className="watchface-typography-hint">
          Choose a local font and rasterize it into the preview before adjusting its weight or spacing.
        </p>
      ) : null}

      {open ? (
        <div className="watchface-font-picker-panel">
          <div className="watchface-font-picker-search">
            <Type size={15} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search or enter a font family"
              aria-label="Search installed fonts"
            />
          </div>

          {loading ? (
            <p className="watchface-font-picker-status">
              <Loader2 className="spin" size={14} /> Loading your local font library…
            </p>
          ) : null}
          {error ? <p className="watchface-font-picker-status">{error}</p> : null}
          {families !== null && !loading ? (
            <p className="watchface-font-picker-status">
              {families.length} installed font {families.length === 1 ? "family" : "families"} available locally.
            </p>
          ) : null}

          {query.trim() && !exactMatch ? (
            <button
              className="watchface-font-custom-option"
              type="button"
              onClick={() => setCandidate(query.trim())}
            >
              Use “{query.trim()}” as entered
            </button>
          ) : null}

          <div className="watchface-font-picker-results" role="listbox" aria-label="Installed font families">
            {matchingFamilies.slice(0, 100).map((family) => (
              <button
                key={family}
                className={candidate === family ? "is-selected" : ""}
                type="button"
                role="option"
                aria-selected={candidate === family}
                onClick={() => setCandidate(family)}
              >
                <strong style={{ fontFamily: family, ...sampleStyle }}>{family}</strong>
                <span style={{ fontFamily: family, ...sampleStyle }}>0123456789 · Wed</span>
              </button>
            ))}
          </div>
          {matchingFamilies.length > 100 ? (
            <p className="watchface-font-picker-status">Showing the first 100 matches—keep typing to narrow the list.</p>
          ) : null}

          <div className="watchface-font-picker-actions">
            <button className="secondary-button" type="button" onClick={restoreTemplate}>
              {emptyLabel}
            </button>
            <button className="primary-button" type="button" disabled={!candidate.trim()} onClick={applyCandidate}>
              Rasterize into preview
            </button>
          </div>
          <p className="watchface-font-picker-note">
            Weight and style affect each glyph. Digit spacing adjusts the gap between time digits, then creating the archive bakes the result into watch-ready PNG sprites.
          </p>
        </div>
      ) : null}
    </div>
  );
}
