# Design — Import intervals.icu → COROS

**Date:** 2026-07-08
**Status:** Approved (design phase)

## Problem

Athletes who record activities on non-COROS devices (a third-party bike
computer, a Garmin, a phone app, etc.) often end up with those activities on
Strava/intervals.icu but **not** on their COROS account. There is no built-in way
to push those activities back into COROS. The goal: detect activities that exist
on the source platform but are missing from COROS, and import the **original FIT
file** into COROS from within CorosLink.

## Why intervals.icu and not Strava

The original ask was Strava. **Strava's public API has no endpoint to download
the original uploaded file** (FIT/TCX/GPX) — "Export Original" exists only in the
Strava website UI, deliberately not in the API. Reconstructing a file from Strava
streams was rejected: we need the real FIT, not a lossy rebuild.

**intervals.icu preserves and serves the original file** via
`GET /api/v1/activity/{id}/file`. The provider is therefore intervals.icu.

### ⚠️ Load-bearing assumption: original vs reconstructed FIT

`/activity/{id}/file` returns a genuine **original** device FIT **only when the
source file reached intervals.icu with an original attached** — i.e. the recording
device (or Garmin Connect) uploaded to intervals.icu directly. For an activity that
entered intervals.icu **via Strava**, Strava never handed intervals.icu the original
either (same API limit), so intervals.icu may return **its own reconstruction** —
exactly the lossy rebuild the user rejected, laundered through a third party.

**Consequence:** the feature delivers a real FIT for directly-synced / Garmin-sourced
activities, but a Strava-only-sourced activity may come back as intervals.icu's
rebuild. The user must confirm their sources put real FITs into intervals.icu.

**Discriminating check (to run before/early in implementation):** download a FIT for
a known Strava-sourced activity and inspect the FIT `file_id` message —
`manufacturer` / `product` / `serial_number`. A real device (wahoo, hammerhead,
garmin, …) means original; `intervals` or a missing manufacturer means
reconstruction.

## Non-goals

- No Strava direct integration in this iteration.
- No reconstruction of activity files from streams.
- No CN (Alibaba OSS) upload path — US and EU (AWS S3) only, matching the regions
  CorosLink's Training Hub already handles.
- No new heavy dependencies (no `@aws-sdk/*`, no zip library). Both missing
  primitives (a store-only ZIP writer and S3 SigV4 signing) are hand-rolled with
  `node:crypto`, consistent with how CorosLink already does native HTTPS + crypto.

## Architecture

Follows CorosLink's existing service + IPC + Training-Hub-view patterns.

| Piece | Location | Mirrors |
|-------|----------|---------|
| intervals.icu connector | `electron/intervalsService.ts` (new) | `electron/spotifyService.ts` |
| COROS FIT upload | extend `electron/trainingHubService.ts` | reuses existing COROS session |
| Missing-activity matching | `electron/intervalsMatch.ts` (new, pure) | testable in isolation |
| Store-only ZIP writer | `electron/zipStore.ts` (new, pure) | verifiable with existing `unzipper` |
| S3 SigV4 PUT | `electron/awsSigV4.ts` (new, pure) | `node:crypto` only |
| IPC surface | `electron/preload.ts` + `electron/main.ts` | existing `spotify:*` channels |
| UI | `src/training/components/IntervalsImportPanel.tsx` (new) inside Training Hub | existing Training Hub panels |

The feature lives as an **"Import from intervals.icu" panel inside the Training Hub
view** (chosen over a new top-level tab) because the Training Hub already owns the
COROS login and the COROS activity list this feature compares against.

## Components

### 1. intervalsService (`electron/intervalsService.ts`)

- **Connect / status.** User supplies an intervals.icu **API key** and
  **athlete id** (from intervals.icu → Settings → Developer). Stored encrypted via
  `safeStorage`, same pattern as Spotify tokens. `getStatus()` reports connected +
  athlete display name.
- **Auth header.** `Authorization: Basic base64("API_KEY:" + apiKey)`.
- **`listActivities(daysBack)`** → `GET https://intervals.icu/api/v1/athlete/{athleteId}/activities?oldest=&newest=`.
  Returns `{ intervalsId, name, startTime, movingTimeSec, distanceM, type }`.
- **`downloadOriginalFit(intervalsId, destPath)`** → `GET /api/v1/activity/{id}/file`,
  writes bytes to a temp file. Extension may be `.fit` or `.tcx` (COROS accepts
  both); reject anything else.

### 2. Missing-activity matching (`electron/intervalsMatch.ts`, pure)

COROS and intervals.icu use different activity IDs, so matching is fuzzy on
metadata. An intervals.icu activity is considered **already on COROS** when a COROS
activity matches on **all** of:

- start time within **±3 minutes**,
- moving time within **±5%**,
- distance within **±5%** (only when both report distance > 0; time-only activities
  fall back to start-time + duration).

**Timezone correctness:** intervals.icu exposes both `start_date` (UTC) and
`startDateLocal` (wall-clock); COROS stores its own timestamp. Comparison **must**
normalize both sides to absolute UTC instants first — comparing local wall-clock
against UTC would mismatch by whole hours and defeat the ±3-min tolerance. Match on
intervals' UTC `start_date`.

Anything with no COROS match is a **missing** candidate for import. Tolerances are
constants so they are easy to tune. This module is pure (arrays in, classification
out) and fully unit-tested.

### 3. COROS FIT upload (extend `electron/trainingHubService.ts`)

Reuses the existing stored COROS session (`getStoredAuth()` →
`{ accessToken, userId }`, `buildTrainingHubHeaders()`). No separate COROS login.
Reverse-engineered 3-step protocol (verified against `@nyt87/crs-connect`):

1. **STS credentials** — `GET https://faq.coros.com/openapi/oss/sts` with query
   `bucket`, `service=aws`, `v=2`, `app_id`, `sign`. Unauthenticated (uses app-level
   `app_id`/`sign`, not the user token). Region constants:
   - US: `bucket=coros-s3`, `app_id=1660188068672619112`, `sign=E34EF0E34A498A54A9C3EAEFC12B7CAF`
   - EU: `bucket=eu-coros`, `sign=877571111A1EE5316E4B590103D4B5B3`
   Response `data.credentials` is base64 with a salt prefix `9y78gpoERW4lBNYL`
   stripped before `atob` → JSON `{ Region, Bucket, AccessKeyId, SecretAccessKey, SessionToken }`.
2. **Package + upload to S3.** md5 the FIT; build a store-only ZIP containing
   `{md5}/{originalName}.{ext}`; `PUT` it to `fit_zip/{userId}/{md5}.zip` in the STS
   bucket via SigV4 (`awsSigV4.ts`), `Content-Type: application/zip`, session token
   in `x-amz-security-token`.
3. **Register import** — `POST {teamapi}/activity/fit/import`, `multipart/form-data`
   with one field `jsonParameter` = JSON:
   ```json
   { "source": 1, "timezone": <coros-tz-units>, "bucket": "...", "md5": "...",
     "size": <zipBytes>, "object": "fit_zip/{userId}/{md5}.zip",
     "serviceName": "aws", "oriFileName": "{name}.{ext}" }
   ```
   Authenticated with the existing Training Hub headers. `timezone` uses COROS's unit
   convention: `-getTimezoneOffset()/60 * 4`. Returns an `importId`.

Region (US vs EU) is chosen from the same signal Training Hub already uses to pick
`teamapi` vs `teameuapi`.

### 4. Store-only ZIP writer (`electron/zipStore.ts`, pure)

COROS only needs a valid ZIP wrapping one entry; no compression required. A
deterministic store-only (method 0) ZIP writer (~60 lines: local file header + CRC32
+ central directory + end-of-central-directory) avoids adding a zip dependency.
Round-trip tested against the already-present `unzipper`.

### 5. S3 SigV4 (`electron/awsSigV4.ts`, pure)

Minimal AWS Signature V4 for a single `PutObject` (canonical request → string to
sign → signing key → `Authorization` header), using `node:crypto`. Inputs: region,
bucket, key, temp credentials (incl. session token), body + its sha256. Avoids
`@aws-sdk/client-s3`. Unit-tested against a known AWS SigV4 test vector.

### 6. IPC + UI

- **IPC channels** (preload + main handlers): `intervals:getStatus`,
  `intervals:connect(apiKey, athleteId)`, `intervals:disconnect`,
  `intervals:listMissing(daysBack)` (lists intervals activities, cross-references
  COROS, tags each as `on-coros` | `missing`), `intervals:import(intervalsId)`
  (download → upload → returns result), with progress events like existing syncs.
- **UI** `IntervalsImportPanel.tsx` in Training Hub: connect form (API key +
  athlete id) when disconnected; when connected, a table of intervals activities
  with status badges, per-row **Import** for missing ones, an **Import all missing**
  action, live progress, and per-row success/error. Styling matches existing
  Training Hub panels.

## Data flow

```
intervals.icu (original FIT)  ──download──▶  temp file
        │
        ├── md5 + store-only zip ──▶ fit_zip/{userId}/{md5}.zip
        │                               │ (SigV4 PUT)
        ▼                               ▼
  COROS STS creds ◀──GET faq/oss/sts   COROS S3 bucket
        │                               │
        └──────────────▶ POST teamapi/activity/fit/import ──▶ COROS processes
```

## Error handling

- Per-activity isolation: one failure does not stop the batch.
- Distinct, actionable messages: invalid intervals API key / athlete id (401/403),
  expired COROS session (re-login prompt), unsupported file type, S3 PUT failure,
  import rejected.
- Returned `importId`s are recorded (settings/SQLite) so a re-run does not
  re-import while COROS is still processing an upload.
- Temp FIT files are always cleaned up (success or failure).

## Implementation sequencing — tracer bullet first

The COROS upload path is reverse-engineered, staleness-prone (`app_id`/`sign`/salt),
and depends on a hand-rolled SigV4. **Step 1 of the implementation plan is a minimal
spike, before any UI:** take one hardcoded local FIT and run STS → zip → S3 PUT →
`/activity/fit/import`, and confirm it lands in a real COROS account. If `app_id`/
`sign` are stale or the SigV4 is off, that must surface on day one — not after the
panel is built. Only after the spike lands do we build the connector, matching, IPC,
and UI.

## Testing

- **Unit:** matching tolerances (`intervalsMatch`), STS salt+base64 decode, ZIP
  writer round-trip via `unzipper`, SigV4 against a known AWS test vector.
- **Integration (mocked HTTP):** listMissing cross-reference logic.
- **Manual (real accounts required):** full import of one activity end-to-end, then
  confirm it appears in the COROS web/app. Documented in the PR description.

## Delivery / PR process

The upstream repo `JunAkerBuilds/CorosLink` was cloned read-only and cannot be
pushed to directly. Plan:

1. `gh repo fork JunAkerBuilds/CorosLink --remote` (authenticated as
   `GitjoPowershell`) to create the fork and wire remotes.
2. Feature branch `feat/intervals-icu-import`.
3. PR from the fork → `JunAkerBuilds/CorosLink`.

Note: this `docs/superpowers/` planning doc may be excluded from the upstream PR if
maintainers prefer not to carry planning artifacts.

## Open risks

- COROS S3/import protocol is reverse-engineered and unofficial; COROS could change
  `app_id`/`sign`/bucket layout. Isolated in one module to ease future fixes.
- SigV4 hand-roll must exactly match AWS canonicalization — mitigated by testing
  against a published AWS test vector before wiring the live PUT.
