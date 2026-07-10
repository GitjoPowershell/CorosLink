# Design — Strength activity detail (Summary + Exercise table)

**Date:** 2026-07-10
**Status:** Approved (design phase). Branch `feat/strength-activity-detail`.

## Problem

For a strength/gym activity, CorosLink's `ActivityDetailPanel` shows the generic
endurance layout: Duration / Distance / Avg HR / Calories / Elevation / Training
Load, then a Route map, an Elevation chart, and a Laps table. For indoor strength
these are mostly empty or meaningless (no GPS, no elevation), while COROS's own
Training Hub shows a rich strength view: a per-exercise table (sets, reps, weight,
rest, time, calories) and an enriched summary (total sets, total reps, total
weight, training load, aerobic/anaerobic effect…).

This feature brings the **summary** and the **exercise table** to CorosLink for
strength activities, using **real COROS data** (no reconstruction). The muscle
heatmap is explicitly **out of scope** for this first delivery (tracked as a
future phase — see Non-goals).

## Research findings (empirically verified against a live account)

All data comes from the existing endpoint `POST /activity/detail/query`
(`labelId`, `sportType`, `userId`) that CorosLink already calls — **no new
endpoint, no new auth**. Verified on the strength activity "Kb : force"
(labelId `478805059845521611`, sportType `402`).

- **`data.summary`** carries every headline stat. Unit conversions verified 1:1
  against the COROS web screenshot:
  | Field | Raw | Conversion | Displayed |
  |-------|-----|-----------|-----------|
  | `sets` | 29 | as-is | 29 |
  | `totalReps` | 330 | as-is | 330 |
  | `totalWeight` | 7376000 | ÷1000 | 7376 kg |
  | `calories` | 324123 | ÷1000 | 324 kcal |
  | `totalTime` / `workoutTime` | 368598 | ÷100 (centiseconds) | 01:01:26 |
  | `avgHr` / `maxHr` | 129 / 176 | as-is | 129 / 176 bpm |
  | `trainingLoad` | 57 | as-is | 57 |
  | `aerobicEffect` / `anaerobicEffect` | 2.3 / 0.4 | as-is | 2.3 / 0.4 |
  | `exercises` | 8 | as-is | 8 |

- **`data.lapList[0].lapItemList`** (72 items for this activity) is the per-set
  breakdown. Relevant per-item fields: `exerciseNameKey` (e.g. `T1178`),
  `exerciseIndex`, `reps`, `sets`, `weight` (grams), `time` (centiseconds),
  `calories` (milli-cal), `avgHr`, `maxHr`. The cleaner MCP projection
  (`queryActivityLapData`) confirms the semantics: `time` already in seconds
  there, `weight` in grams, and rows alternate **work** / **rest**.

- **Exercise names are i18n keys, not text.** `exerciseNameKey` is a code like
  `T1178`. The COROS **exercise catalogue** (`GET /training/exercise/query`,
  requires a **mobile** token) returns 387 library exercises; each has
  `name` = the same `T-code`, but also **`overview`** = a stable English
  semantic id, e.g. `sid_strength_two_arm_kettlebell_swings`. Humanizing the
  `overview` yields clean English names that match the screenshot exercises:
  - `T1178` → **Two Arm Kettlebell Swings** (screenshot FR "Balançoires Haltères")
  - `T1309` → **One Arm Dumbbell Row** ("Extension des haltères à un bras")
  - `T1310` → **Farmers Walk** ("Promenade de l'agriculteur")
  - `T1301` → Goblet Squat, `T1176` → Snatches, `T1232` → Wide Grip Push Up, …
  382/387 derive cleanly from `overview` (0 residual `sid`/underscores); the
  other 5 are user-custom exercises that already carry a readable `name`.
  Neither `language=fr-FR` nor the embedded COROS MCP localizes these — the
  localized French strings live in a separate web-frontend i18n bundle we do
  **not** depend on.

**Language decision:** English. CorosLink's existing UI is English ("Duration",
"Distance", "Laps"), so `overview`-derived English names are the natural fit and
are fully self-contained.

## Scope

- **Enriched summary** for strength activities (the table above).
- **Grouped exercise table** built from `lapItemList`.
- **Static exercise-name dictionary** (`T-code → English`) shipped in the app;
  resolved at render time with a pure function; **no runtime auth/fetch**.

## Non-goals

- **Muscle heatmap** (front/back silhouettes). Data exists (`data.muscleList`:
  `muscleId`, `level`, `sets`, `reps`, `muscleType` primary/secondary) but the
  feature needs an anatomical SVG asset + a `muscleId → region` mapping + muscle
  labels. Deferred to a later phase.
- No French localization of exercise/muscle names (English only).
- No new runtime dependency, no new authentication, no backend/SQLite changes.
- No change to the endurance detail view (route/elevation/laps) for non-strength
  activities.

## Architecture

### Data layer — `electron/trainingHubService.ts` + `electron/types.ts`

Extend the activity-detail parse to attach an **optional** `strength` block to
`TrainingHubActivityDetail` when the raw payload looks like strength (a populated
`lapItemList` with `exerciseNameKey`, and/or `summary.sets`/`summary.exercises`).
Endurance activities are unaffected (`strength` stays `undefined`).

```ts
interface StrengthSet {
  reps: number;
  weightKg: number;      // grams ÷ 1000
  workSec: number;       // centiseconds ÷ 100
  restSec: number;       // from the following rest lap
  calories: number;      // milli-cal ÷ 1000, rounded
}
interface StrengthExercise {
  nameKey: string;       // e.g. "T1178" or a custom name
  name: string;          // resolved via resolveExerciseName
  sets: number;          // from the aggregate lap (fallback: count of work sets)
  totalReps: number;
  entries: StrengthSet[];
}
interface StrengthSummary {
  sets: number; totalReps: number; totalWeightKg: number; exercises: number;
  calories: number; durationSec: number; avgHr?: number; maxHr?: number;
  trainingLoad?: number; aerobicEffect?: number; anaerobicEffect?: number;
}
interface StrengthDetail {
  summary: StrengthSummary;
  exercises: StrengthExercise[];
}
// TrainingHubActivityDetail gains: strength?: StrengthDetail;
```

**Grouping algorithm** (pure, unit-testable):
1. Walk `lapItemList` in order; start a new group when `exerciseNameKey` changes.
2. Within a group, classify laps: **work** (`reps > 0`), **rest** (`reps === 0`
   and `sets === 0`), **aggregate** (`sets > 0`).
3. Each work lap becomes a `StrengthSet`; its `restSec` is the `time` of the
   immediately-following rest lap in the same group (0 if none).
4. The aggregate lap supplies the group's `sets` and `totalReps`; if absent, fall
   back to `entries.length` and the sum of reps.
5. **Drop `S3618` rows** — a per-group section/rest marker absent from the
   catalogue (`reps === 0`, not a real exercise).

### Name resolution — `src/training/exerciseNames.ts` + `exerciseNames.json`

- `exerciseNames.json`: `{ "T1178": "Two Arm Kettlebell Swings", ... }` generated
  from the catalogue's `overview` field. **Only built-in `T#`/`S#` library codes
  are bundled** (public COROS library data, ~382 entries) — user-**custom**
  exercise names are personal and are **not** committed; they are resolved at
  runtime from the payload's own `name` field instead.
- `resolveExerciseName(nameKey: string, customName?: string): string` — pure:
  return the dictionary hit; else a readable `customName` if it is not itself a
  `T#/S#` code; else a humanized fallback of the key; else the key verbatim.
- **Regeneration**: a committed script `scripts/build-exercise-names.mjs`
  documents how to rebuild the dict from a freshly-fetched catalogue (one-time
  mobile login, outside the app). The app ships the static JSON and never fetches
  it at runtime.

### UI — `src/training/components/StrengthDetailPanel.tsx`

`ActivityDetailPanel` branches: when `detail.strength` is present, render
`StrengthDetailPanel` **instead of** the Route / Elevation / Laps sections (kept
for endurance). It reuses existing styles where possible.

- **Summary tiles** — reuse the `activity-detail-stat` grid: Sets, Reps,
  Total Weight, Calories, Duration, Avg HR, Max HR, Training Load, Aerobic,
  Anaerobic. Missing/zero optional values are hidden.
- **Exercise table** — one section per exercise: a header
  (`{index}. {name} · {sets} sets · {totalReps} reps`) then a compact table with
  columns `Set | Reps | Weight | Time | Rest | Cal`, reusing the existing
  `table-shell` / `<table>` styling. Weight shown in kg, time/rest as `m:ss`.

The existing "Show raw JSON" toggle stays.

## Data flow

```
/activity/detail/query (already called)
  → parseActivityDetail → detail.strength = { summary, exercises[] }
        exercises[] = groupLapItems(lapList[0].lapItemList)
        each name = resolveExerciseName(exerciseNameKey, name)  [static JSON]
  → ActivityDetailPanel: detail.strength ? <StrengthDetailPanel> : <endurance view>
```

## Error handling / edge cases

- No `lapItemList` / no `summary.sets` → `strength` undefined → endurance view
  (no regression).
- Unknown `exerciseNameKey` → humanized fallback, never a crash.
- Missing aggregate lap → derive `sets`/`totalReps` from work laps.
- Trailing work lap with no following rest → `restSec = 0`.
- Optional summary fields absent → their tiles are hidden.

## Testing

`scripts/test-strength-detail.mjs` (existing `node --experimental-strip-types`
convention, `node:assert/strict`):
- **Name resolution:** `T1178 → "Two Arm Kettlebell Swings"`; custom name passes
  through; unknown key humanizes; `S####` unmapped falls back gracefully.
- **Grouping:** on an **anonymized** `lapItemList` fixture (subset of the real
  activity, personal identifiers stripped) — correct number of exercises, sets
  per exercise, work/rest pairing, `S3618` dropped, aggregate-derived totals.
- **Unit conversions:** validated against the screenshot oracle — summary yields
  29 sets / 330 reps / 7376 kg / 324 kcal / 01:01:26; a known set yields
  15 reps × 32 kg.
- **No-strength input:** endurance detail leaves `strength` undefined.

Manual: open a strength activity in the app → summary + grouped table render with
real English names; open a run → unchanged route/elevation/laps view.
