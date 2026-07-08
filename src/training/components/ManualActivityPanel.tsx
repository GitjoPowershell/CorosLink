import { CalendarPlus, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import type { ManualActivityInput } from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";

type SportOption = ManualActivityInput["sport"];

const SPORT_OPTIONS: { value: SportOption; label: string }[] = [
  { value: "run", label: "Course" },
  { value: "bike", label: "Vélo" },
  { value: "other", label: "Autre" }
];

interface FormState {
  sport: SportOption;
  startLocal: string;
  hours: string;
  minutes: string;
  distanceKm: string;
  calories: string;
  avgHr: string;
}

const INITIAL_FORM: FormState = {
  sport: "run",
  startLocal: "",
  hours: "",
  minutes: "",
  distanceKm: "",
  calories: "",
  avgHr: ""
};

export function ManualActivityPanel({ api }: { api: CorosLinkApi }) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit() {
    setError(null);
    setSuccess(null);

    if (!form.startLocal) {
      setError("Please choose a start date and time.");
      return;
    }

    const startDate = new Date(form.startLocal);
    if (Number.isNaN(startDate.getTime())) {
      setError("The start date and time is invalid.");
      return;
    }

    const hours = Number(form.hours) || 0;
    const minutes = Number(form.minutes) || 0;
    const durationSec = Math.round(hours * 3600 + minutes * 60);
    if (durationSec <= 0) {
      setError("Duration must be greater than zero.");
      return;
    }

    const distanceKm = Number(form.distanceKm) || 0;
    const distanceM = Math.round(distanceKm * 1000);

    const calories = form.calories.trim() === "" ? undefined : Number(form.calories);
    const avgHr = form.avgHr.trim() === "" ? undefined : Number(form.avgHr);

    const input: ManualActivityInput = {
      sport: form.sport,
      startTimeIso: startDate.toISOString(),
      durationSec,
      distanceM,
      ...(calories !== undefined && !Number.isNaN(calories) ? { calories } : {}),
      ...(avgHr !== undefined && !Number.isNaN(avgHr) ? { avgHr } : {})
    };

    setSubmitting(true);
    try {
      await api.addManualActivityToCoros(input);
      setSuccess("Activity added to COROS.");
      setForm(INITIAL_FORM);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to add activity to COROS."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel training-manual-activity-panel">
      <header className="training-backup-header">
        <div className="training-backup-heading">
          <p className="eyebrow">Manual entry</p>
          <h2>Add activity to COROS</h2>
          <p className="training-backup-hint">
            Log an activity that wasn&apos;t recorded by a device — it will be
            added to your COROS account.
          </p>
        </div>
        <div className="training-backup-icon" aria-hidden="true">
          <CalendarPlus size={22} />
        </div>
      </header>

      <form
        className="training-backup-card"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="training-login-fields">
          <label className="field training-login-field">
            <span>Sport</span>
            <div className="training-login-input">
              <select
                value={form.sport}
                onChange={(event) =>
                  updateField("sport", event.target.value as SportOption)
                }
                disabled={submitting}
              >
                {SPORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </label>

          <label className="field training-login-field">
            <span>Start</span>
            <div className="training-login-input">
              <input
                type="datetime-local"
                value={form.startLocal}
                onChange={(event) => updateField("startLocal", event.target.value)}
                disabled={submitting}
              />
            </div>
          </label>

          <label className="field training-login-field">
            <span>Duration (hours)</span>
            <div className="training-login-input">
              <input
                type="number"
                min={0}
                value={form.hours}
                onChange={(event) => updateField("hours", event.target.value)}
                placeholder="0"
                disabled={submitting}
              />
            </div>
          </label>

          <label className="field training-login-field">
            <span>Duration (minutes)</span>
            <div className="training-login-input">
              <input
                type="number"
                min={0}
                max={59}
                value={form.minutes}
                onChange={(event) => updateField("minutes", event.target.value)}
                placeholder="0"
                disabled={submitting}
              />
            </div>
          </label>

          <label className="field training-login-field">
            <span>Distance (km)</span>
            <div className="training-login-input">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.distanceKm}
                onChange={(event) => updateField("distanceKm", event.target.value)}
                placeholder="0"
                disabled={submitting}
              />
            </div>
          </label>

          <label className="field training-login-field">
            <span>Calories (optional)</span>
            <div className="training-login-input">
              <input
                type="number"
                min={0}
                value={form.calories}
                onChange={(event) => updateField("calories", event.target.value)}
                placeholder="e.g. 450"
                disabled={submitting}
              />
            </div>
          </label>

          <label className="field training-login-field">
            <span>Average HR (optional)</span>
            <div className="training-login-input">
              <input
                type="number"
                min={0}
                value={form.avgHr}
                onChange={(event) => updateField("avgHr", event.target.value)}
                placeholder="e.g. 145"
                disabled={submitting}
              />
            </div>
          </label>
        </div>

        <div className="settings-actions">
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <CalendarPlus size={16} aria-hidden="true" />
            )}
            Add to COROS
          </button>
        </div>

        {success ? (
          <p className="training-backup-result is-success">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>{success}</span>
          </p>
        ) : null}

        {error ? (
          <p className="training-backup-error">
            <XCircle size={14} aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
