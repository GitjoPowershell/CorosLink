# intervals.icu → COROS Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Training Hub feature that lists intervals.icu activities, detects the ones missing from COROS, and imports their original FIT file into COROS.

**Architecture:** Pure, unit-tested primitives (SigV4, store-only ZIP, STS decode, fuzzy matching) feed two service layers — a new `intervalsService` (calqued on `spotifyService`) and a COROS-upload extension of the existing `trainingHubService` that reuses the stored COROS session. IPC channels mirror the existing `spotify:*` surface; the UI is a panel inside the existing Training Hub view. The COROS upload path is proven early with a tracer-bullet spike before any UI is built.

**Tech Stack:** Electron (main process, TypeScript → `dist-electron/`), React 19 renderer, `node:crypto`/`node:https`/`fetch`, `better-sqlite3` settings, `safeStorage` for secrets. No new runtime dependencies.

## Global Constraints

- **No new runtime dependencies.** Both missing primitives (store-only ZIP writer, S3 SigV4) are hand-rolled with `node:crypto`. Do not add `@aws-sdk/*`, `jszip`, `archiver`, `axios`, or `ky`.
- **Reuse the existing COROS session.** Upload authenticates via `getStoredAuth()` / `buildTrainingHubHeaders()` in `electron/trainingHubService.ts`. Do NOT add a second COROS login.
- **Secrets encrypted at rest** via `safeStorage`, stored through `setSetting`/`getSetting` (SQLite), same pattern as `electron/spotifyService.ts`.
- **Regions:** US (`teamapi.coros.com`, bucket `coros-s3`) and EU (`teameuapi.coros.com`, bucket `eu-coros`) only. Pick region from `auth.baseUrl`. No CN/Alibaba OSS path.
- **Test convention:** a `scripts/test-<name>.mjs` file using `node:assert/strict`, importing compiled output from `dist-electron/<file>.js`, printing `"<name> tests passed"`, wired as an `npm run test:<name>` script that runs `npm run build:electron` first. Match the style of `scripts/test-activity-backup.mjs`.
- **COROS upload constants** (verified against `@nyt87/crs-connect`):
  - STS endpoint: `GET https://faq.coros.com/openapi/oss/sts?bucket=<bucket>&service=aws&v=2&app_id=<appId>&sign=<sign>`
  - `app_id = "1660188068672619112"` (both regions)
  - US `sign = "E34EF0E34A498A54A9C3EAEFC12B7CAF"`, EU `sign = "877571111A1EE5316E4B590103D4B5B3"`
  - salt = `"9y78gpoERW4lBNYL"`, stripped from `data.credentials` before base64-decode
  - Import endpoint: `POST <baseUrl>/activity/fit/import`, `multipart/form-data`, single field `jsonParameter`
  - Remote object key: `fit_zip/<userId>/<md5>.zip`; ZIP inner entry: `<md5>/<oriFileName>`

---

### Task 1: AWS SigV4 request signer

**Files:**
- Create: `electron/awsSigV4.ts`
- Test: `scripts/test-aws-sigv4.mjs`
- Modify: `package.json` (add `test:aws-sigv4` script)

**Interfaces:**
- Produces:
  - `signRequest(params: SigV4Params): { authorization: string; amzDate: string }`
    where `SigV4Params = { method: string; url: string; region: string; service: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string; signedHeaders: Record<string,string>; payloadHash: string; amzDate?: string }`.
    `signedHeaders` are the exact headers to sign (values only; names lower-cased internally). `amzDate` may be injected for deterministic tests; otherwise derived from `new Date()`.
  - `sha256Hex(body: Buffer | string): string`

- [ ] **Step 1: Write the failing test** — validates against the published AWS SigV4 `get-vanilla` vector.

Create `scripts/test-aws-sigv4.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { signRequest, sha256Hex } = await import(
  `${distUrl("awsSigV4.js")}?cacheBust=${Date.now()}`
);

// SHA-256 of empty string (well-known constant).
assert.equal(
  sha256Hex(""),
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
);

// AWS SigV4 test-suite "get-vanilla": GET https://example.amazonaws.com/
// with only host + x-amz-date signed, empty payload.
const { authorization } = signRequest({
  method: "GET",
  url: "https://example.amazonaws.com/",
  region: "us-east-1",
  service: "service",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  amzDate: "20150830T123600Z",
  signedHeaders: { host: "example.amazonaws.com" },
  payloadHash: sha256Hex("")
});

assert.equal(
  authorization,
  "AWS4-HMAC-SHA256 " +
    "Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
    "SignedHeaders=host;x-amz-date, " +
    "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
);

console.log("aws-sigv4 tests passed");
```

- [ ] **Step 2: Add the test script to package.json**

In `package.json` `"scripts"`, add:

```json
"test:aws-sigv4": "npm run build:electron && node scripts/test-aws-sigv4.mjs",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:aws-sigv4`
Expected: FAIL — `Cannot find module .../dist-electron/awsSigV4.js` (module not built yet).

- [ ] **Step 4: Write the implementation**

Create `electron/awsSigV4.ts`:

```ts
import crypto from "node:crypto";

export interface SigV4Params {
  method: string;
  url: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Header values to sign, keyed by header name (case-insensitive). */
  signedHeaders: Record<string, string>;
  /** Hex SHA-256 of the request body. */
  payloadHash: string;
  /** Override for deterministic tests, e.g. "20150830T123600Z". */
  amzDate?: string;
}

export function sha256Hex(body: Buffer | string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

// Encode a URI path, preserving "/" between segments (AWS canonical URI rules).
function encodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
      )
    )
    .join("/");
}

export function signRequest(params: SigV4Params): {
  authorization: string;
  amzDate: string;
} {
  const url = new URL(params.url);
  const amzDate =
    params.amzDate ??
    new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = encodePath(url.pathname || "/");
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  // x-amz-date is always part of the signature (AWS convention). Merge it in
  // so callers never have to pass it explicitly.
  const allSignedHeaders: Record<string, string> = {
    ...params.signedHeaders,
    "x-amz-date": amzDate
  };
  const headerEntries = Object.entries(allSignedHeaders)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonicalHeaders =
    headerEntries.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaderNames = headerEntries.map(([k]) => k).join(";");

  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames,
    params.payloadHash
  ].join("\n");

  const scope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest)
  ].join("\n");

  const kDate = hmac(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, params.region);
  const kService = hmac(kRegion, params.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

  return { authorization, amzDate };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:aws-sigv4`
Expected: `aws-sigv4 tests passed`

- [ ] **Step 6: Commit**

```bash
git add electron/awsSigV4.ts scripts/test-aws-sigv4.mjs package.json
git commit -m "feat: add AWS SigV4 request signer for S3 uploads"
```

---

### Task 2: Store-only ZIP writer

**Files:**
- Create: `electron/zipStore.ts`
- Test: `scripts/test-zip-store.mjs`
- Modify: `package.json` (add `test:zip-store` script)

**Interfaces:**
- Produces: `createStoreZip(entries: { name: string; data: Buffer }[]): Buffer` — a valid ZIP archive using method 0 (stored, no compression).

- [ ] **Step 1: Write the failing test** — round-trips through the already-present `unzipper`.

Create `scripts/test-zip-store.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import unzipper from "unzipper";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { createStoreZip } = await import(
  `${distUrl("zipStore.js")}?cacheBust=${Date.now()}`
);

const payload = Buffer.from("FIT-FILE-BYTES-éà-123");
const name = "abc123/Morning Ride.fit";
const zip = createStoreZip([{ name, data: payload }]);

assert.equal(zip.subarray(0, 4).toString("hex"), "504b0304"); // local file header
const dir = await unzipper.Open.buffer(zip);
assert.equal(dir.files.length, 1);
assert.equal(dir.files[0].path, name);
const out = await dir.files[0].buffer();
assert.ok(out.equals(payload), "round-tripped bytes must match");

console.log("zip-store tests passed");
```

- [ ] **Step 2: Add the test script to package.json**

```json
"test:zip-store": "npm run build:electron && node scripts/test-zip-store.mjs",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:zip-store`
Expected: FAIL — `Cannot find module .../dist-electron/zipStore.js`.

- [ ] **Step 4: Write the implementation**

Create `electron/zipStore.ts`:

```ts
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface Entry {
  name: string;
  data: Buffer;
}

/** Build a ZIP archive using method 0 (stored). No external dependency. */
export function createStoreZip(entries: Entry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 filename
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + entry.data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localDir = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localDir.length, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localDir, centralDir, eocd]);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:zip-store`
Expected: `zip-store tests passed`

- [ ] **Step 6: Commit**

```bash
git add electron/zipStore.ts scripts/test-zip-store.mjs package.json
git commit -m "feat: add store-only ZIP writer"
```

---

### Task 3: COROS upload config + STS credential decode

**Files:**
- Create: `electron/corosUploadConfig.ts`
- Test: `scripts/test-coros-upload-config.mjs`
- Modify: `package.json` (add `test:coros-upload-config` script)

**Interfaces:**
- Produces:
  - `type CorosRegion = "US" | "EU"`
  - `regionFromBaseUrl(baseUrl: string): CorosRegion` — `"EU"` when `baseUrl` contains `teameuapi`, else `"US"`.
  - `stsRequestUrl(region: CorosRegion): string` — the full `faq.coros.com/openapi/oss/sts` URL with the correct bucket/app_id/sign.
  - `decodeStsCredentials(rawCredentials: string): StsCredentials` where `StsCredentials = { Region: string; Bucket: string; AccessKeyId: string; SecretAccessKey: string; SessionToken: string }` — strips the salt, base64-decodes, JSON-parses.
  - `SALT: string`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-coros-upload-config.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { regionFromBaseUrl, stsRequestUrl, decodeStsCredentials, SALT } =
  await import(`${distUrl("corosUploadConfig.js")}?cacheBust=${Date.now()}`);

assert.equal(regionFromBaseUrl("https://teamapi.coros.com"), "US");
assert.equal(regionFromBaseUrl("https://teameuapi.coros.com"), "EU");

const usUrl = stsRequestUrl("US");
assert.ok(usUrl.startsWith("https://faq.coros.com/openapi/oss/sts?"));
assert.match(usUrl, /bucket=coros-s3/);
assert.match(usUrl, /app_id=1660188068672619112/);
assert.match(usUrl, /sign=E34EF0E34A498A54A9C3EAEFC12B7CAF/);
assert.match(stsRequestUrl("EU"), /bucket=eu-coros/);
assert.match(stsRequestUrl("EU"), /sign=877571111A1EE5316E4B590103D4B5B3/);

// decode: salt-prefixed base64 of a JSON creds object.
const creds = {
  Region: "us-east-1",
  Bucket: "coros-s3",
  AccessKeyId: "AKID",
  SecretAccessKey: "SECRET",
  SessionToken: "TOKEN"
};
const encoded = SALT + Buffer.from(JSON.stringify(creds)).toString("base64");
assert.deepEqual(decodeStsCredentials(encoded), creds);

console.log("coros-upload-config tests passed");
```

- [ ] **Step 2: Add the test script to package.json**

```json
"test:coros-upload-config": "npm run build:electron && node scripts/test-coros-upload-config.mjs",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:coros-upload-config`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `electron/corosUploadConfig.ts`:

```ts
export type CorosRegion = "US" | "EU";

export const SALT = "9y78gpoERW4lBNYL";
const APP_ID = "1660188068672619112";

const REGION_STS = {
  US: { bucket: "coros-s3", sign: "E34EF0E34A498A54A9C3EAEFC12B7CAF" },
  EU: { bucket: "eu-coros", sign: "877571111A1EE5316E4B590103D4B5B3" }
} as const;

export interface StsCredentials {
  Region: string;
  Bucket: string;
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
}

export function regionFromBaseUrl(baseUrl: string): CorosRegion {
  return baseUrl.includes("teameuapi") ? "EU" : "US";
}

export function stsRequestUrl(region: CorosRegion): string {
  const { bucket, sign } = REGION_STS[region];
  const params = new URLSearchParams({
    bucket,
    service: "aws",
    v: "2",
    app_id: APP_ID,
    sign
  });
  return `https://faq.coros.com/openapi/oss/sts?${params.toString()}`;
}

export function decodeStsCredentials(rawCredentials: string): StsCredentials {
  const base64 = rawCredentials.replace(SALT, "");
  const json = Buffer.from(base64, "base64").toString("utf8");
  return JSON.parse(json) as StsCredentials;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:coros-upload-config`
Expected: `coros-upload-config tests passed`

- [ ] **Step 6: Commit**

```bash
git add electron/corosUploadConfig.ts scripts/test-coros-upload-config.mjs package.json
git commit -m "feat: add COROS upload config and STS credential decode"
```

---

### Task 4: COROS FIT upload + tracer-bullet spike

This is the **tracer bullet**: it wires the reverse-engineered upload end-to-end and is proven against a real COROS account before any connector/UI work. It depends on Tasks 1–3.

**Files:**
- Modify: `electron/trainingHubService.ts` (add exported `uploadActivityFitToCoros`)
- Create: `scripts/spike-coros-upload.mjs` (manual, real-account verification — not a unit test)

**Interfaces:**
- Consumes: `signRequest`, `sha256Hex` (Task 1); `createStoreZip` (Task 2); `regionFromBaseUrl`, `stsRequestUrl`, `decodeStsCredentials` (Task 3); existing `getStoredAuth()`, `buildTrainingHubHeaders()` in `trainingHubService.ts`.
- Produces: `uploadActivityFitToCoros(fitPath: string): Promise<{ importId: string }>` — reads the local FIT/TCX at `fitPath`, uploads it to the caller's COROS account, returns the import id. Throws with a clear message if not logged in or any step fails.

- [ ] **Step 1: Add imports at the top of `electron/trainingHubService.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { signRequest, sha256Hex } from "./awsSigV4";
import { createStoreZip } from "./zipStore";
import {
  regionFromBaseUrl,
  stsRequestUrl,
  decodeStsCredentials
} from "./corosUploadConfig";
```

(If any of `fs`/`path`/`crypto` is already imported in the file, keep the existing import and do not duplicate.)

- [ ] **Step 2: Implement `uploadActivityFitToCoros`**

Add near the other exported functions in `electron/trainingHubService.ts`:

```ts
/**
 * Upload a local .fit or .tcx activity file to the signed-in COROS account.
 * Reuses the stored Training Hub session (no separate COROS login).
 * Flow: STS credentials → zip the file → S3 PUT → POST /activity/fit/import.
 */
export async function uploadActivityFitToCoros(
  fitPath: string
): Promise<{ importId: string }> {
  const auth = getStoredAuth();
  if (!auth) {
    throw new Error("Not signed in to COROS. Log in to the Training Hub first.");
  }

  const ext = path.extname(fitPath).toLowerCase().replace(".", "");
  if (ext !== "fit" && ext !== "tcx") {
    throw new Error(`Unsupported file type ".${ext}" (only .fit or .tcx).`);
  }

  const fileBuf = fs.readFileSync(fitPath);
  const md5 = crypto.createHash("md5").update(fileBuf).digest("hex");
  const oriFileName = path.basename(fitPath);

  // 1. STS credentials (unauthenticated app-level request).
  const region = regionFromBaseUrl(auth.baseUrl);
  const stsResp = await fetch(stsRequestUrl(region));
  if (!stsResp.ok) {
    throw new Error(`COROS STS request failed: ${stsResp.status}`);
  }
  const stsJson = (await stsResp.json()) as {
    data?: { credentials?: string };
  };
  if (!stsJson.data?.credentials) {
    throw new Error("COROS STS response missing credentials.");
  }
  const sts = decodeStsCredentials(stsJson.data.credentials);

  // 2. Zip the file as <md5>/<oriFileName> and upload to S3.
  const zipBuf = createStoreZip([
    { name: `${md5}/${oriFileName}`, data: fileBuf }
  ]);
  const objectKey = `fit_zip/${auth.userId}/${md5}.zip`;
  const host = `${sts.Bucket}.s3.${sts.Region}.amazonaws.com`;
  const putUrl = `https://${host}/${objectKey}`;
  const payloadHash = sha256Hex(zipBuf);
  // Compute the timestamp once so the signed value and the sent header match.
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const { authorization } = signRequest({
    method: "PUT",
    url: putUrl,
    region: sts.Region,
    service: "s3",
    accessKeyId: sts.AccessKeyId,
    secretAccessKey: sts.SecretAccessKey,
    sessionToken: sts.SessionToken,
    payloadHash,
    amzDate,
    signedHeaders: {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "x-amz-security-token": sts.SessionToken
    }
  });
  const putResp = await fetch(putUrl, {
    method: "PUT",
    headers: {
      Host: host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "x-amz-security-token": sts.SessionToken,
      Authorization: authorization,
      "Content-Type": "application/zip"
    },
    body: zipBuf
  });
  if (!putResp.ok) {
    throw new Error(`S3 upload failed: ${putResp.status}`);
  }

  // 3. Register the import with COROS.
  const body = {
    source: 1,
    timezone: (-new Date().getTimezoneOffset() / 60) * 4,
    bucket: sts.Bucket,
    md5,
    size: zipBuf.byteLength,
    object: objectKey,
    serviceName: "aws",
    oriFileName
  };
  const form = new FormData();
  form.append("jsonParameter", JSON.stringify(body));
  const importResp = await fetch(`${auth.baseUrl}/activity/fit/import`, {
    method: "POST",
    headers: buildTrainingHubHeaders(auth.accessToken, auth.userId),
    body: form
  });
  if (!importResp.ok) {
    throw new Error(`COROS import failed: ${importResp.status}`);
  }
  const importJson = (await importResp.json()) as {
    result?: string;
    message?: string;
    data?: { importId?: string | number };
  };
  if (importJson.result && importJson.result !== "0000") {
    throw new Error(`COROS import rejected: ${importJson.message ?? "unknown"}`);
  }
  return { importId: String(importJson.data?.importId ?? "") };
}
```

> **Correctness notes for the implementer:**
> - `x-amz-content-sha256`, `x-amz-date`, and `x-amz-security-token` must all be **signed** (present in `signedHeaders`) AND sent as request headers with identical values — for STS temporary credentials S3 requires the session token to be part of the signature. The code above already does this.
> - If the S3 PUT returns `403 SignatureDoesNotMatch`, first suspect a mismatch between a signed header value and the sent header value (especially `x-amz-date`), or path encoding of `objectKey`.

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build:electron`
Expected: no TypeScript errors.

- [ ] **Step 4: Write the manual spike script**

Create `scripts/spike-coros-upload.mjs`:

```js
// Manual tracer-bullet: proves the COROS upload path against a real account.
// Prereq: log into the Training Hub in the app once so a session is stored,
// then run:  node scripts/spike-coros-upload.mjs /path/to/one-activity.fit
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const fitPath = process.argv[2];
if (!fitPath) {
  console.error("Usage: node scripts/spike-coros-upload.mjs <file.fit>");
  process.exit(1);
}

const { uploadActivityFitToCoros } = await import(
  `${distUrl("trainingHubService.js")}?cacheBust=${Date.now()}`
);

const result = await uploadActivityFitToCoros(fitPath);
console.log("Upload accepted, importId:", result.importId);
console.log("Now confirm the activity appears in the COROS web app / phone app.");
```

- [ ] **Step 5: Run the spike (manual, real account required)**

```bash
npm run build:electron
node scripts/spike-coros-upload.mjs ~/path/to/a-real-activity.fit
```

Expected: `Upload accepted, importId: <non-empty>`, and the activity appears in the COROS web/app within a minute.
**If this fails** (STS 4xx, S3 signature error, or import rejected): STOP and fix the upload path — the constants (`app_id`/`sign`) or SigV4 may be stale. Do not proceed to later tasks until the spike lands.

- [ ] **Step 6: Commit**

```bash
git add electron/trainingHubService.ts scripts/spike-coros-upload.mjs
git commit -m "feat: upload FIT activities to COROS via STS/S3/import"
```

---

### Task 5: intervals.icu ↔ COROS activity matching

**Files:**
- Create: `electron/intervalsMatch.ts`
- Test: `scripts/test-intervals-match.mjs`
- Modify: `package.json` (add `test:intervals-match` script)

**Interfaces:**
- Produces:
  - `type MatchableActivity = { startEpochMs: number; movingSec: number; distanceM: number }`
  - `isAlreadyOnCoros(intervals: MatchableActivity, corosList: MatchableActivity[]): boolean`
  - Constants (exported for tuning/testing): `START_TOLERANCE_MS = 180_000`, `DURATION_TOLERANCE = 0.05`, `DISTANCE_TOLERANCE = 0.05`.

Matching rule: a COROS activity matches when start times are within `START_TOLERANCE_MS`, moving times within `DURATION_TOLERANCE`, and — only when both distances are > 0 — distances within `DISTANCE_TOLERANCE`. All times are absolute UTC epoch ms; the caller is responsible for converting intervals' UTC `start_date` and COROS timestamps to epoch ms before calling.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-intervals-match.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { isAlreadyOnCoros } = await import(
  `${distUrl("intervalsMatch.js")}?cacheBust=${Date.now()}`
);

const base = { startEpochMs: 1_700_000_000_000, movingSec: 3600, distanceM: 10000 };
const coros = [base];

// Exact match → already on COROS.
assert.equal(isAlreadyOnCoros(base, coros), true);

// Start within 2 min, duration +2%, distance +2% → still a match.
assert.equal(
  isAlreadyOnCoros(
    { startEpochMs: base.startEpochMs + 120_000, movingSec: 3672, distanceM: 10200 },
    coros
  ),
  true
);

// Start off by 10 min → not a match (missing).
assert.equal(
  isAlreadyOnCoros({ ...base, startEpochMs: base.startEpochMs + 600_000 }, coros),
  false
);

// Distance off by 20% → not a match.
assert.equal(isAlreadyOnCoros({ ...base, distanceM: 12000 }, coros), false);

// Time-only activities (distance 0 on both) match on start+duration alone.
assert.equal(
  isAlreadyOnCoros(
    { startEpochMs: base.startEpochMs, movingSec: 3600, distanceM: 0 },
    [{ startEpochMs: base.startEpochMs, movingSec: 3600, distanceM: 0 }]
  ),
  true
);

// Empty COROS list → nothing matches.
assert.equal(isAlreadyOnCoros(base, []), false);

console.log("intervals-match tests passed");
```

- [ ] **Step 2: Add the test script to package.json**

```json
"test:intervals-match": "npm run build:electron && node scripts/test-intervals-match.mjs",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:intervals-match`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `electron/intervalsMatch.ts`:

```ts
export interface MatchableActivity {
  startEpochMs: number;
  movingSec: number;
  distanceM: number;
}

export const START_TOLERANCE_MS = 180_000; // ±3 minutes
export const DURATION_TOLERANCE = 0.05; // ±5%
export const DISTANCE_TOLERANCE = 0.05; // ±5%

function within(a: number, b: number, ratio: number): boolean {
  if (a === 0 && b === 0) return true;
  const larger = Math.max(Math.abs(a), Math.abs(b));
  if (larger === 0) return true;
  return Math.abs(a - b) / larger <= ratio;
}

export function isAlreadyOnCoros(
  intervals: MatchableActivity,
  corosList: MatchableActivity[]
): boolean {
  return corosList.some((c) => {
    if (Math.abs(intervals.startEpochMs - c.startEpochMs) > START_TOLERANCE_MS) {
      return false;
    }
    if (!within(intervals.movingSec, c.movingSec, DURATION_TOLERANCE)) {
      return false;
    }
    if (intervals.distanceM > 0 && c.distanceM > 0) {
      return within(intervals.distanceM, c.distanceM, DISTANCE_TOLERANCE);
    }
    return true;
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:intervals-match`
Expected: `intervals-match tests passed`

- [ ] **Step 6: Commit**

```bash
git add electron/intervalsMatch.ts scripts/test-intervals-match.mjs package.json
git commit -m "feat: add intervals.icu <-> COROS activity matching"
```

---

### Task 6: intervals.icu connector service

**Files:**
- Create: `electron/intervalsService.ts`
- Modify: `electron/types.ts` (add the types below)
- Test: `scripts/test-intervals-service.mjs`
- Modify: `package.json` (add `test:intervals-service` script)

**Interfaces:**
- Consumes: `setSetting`, `getSetting`, `deleteSettings` from `./database`; `safeStorage` from `electron`; `isAlreadyOnCoros`, `MatchableActivity` (Task 5).
- Produces (all exported from `intervalsService.ts`):
  - `getIntervalsStatus(): IntervalsStatus`
  - `connectIntervals(apiKey: string, athleteId: string): Promise<IntervalsStatus>`
  - `disconnectIntervals(): void`
  - `listIntervalsActivities(daysBack: number): Promise<IntervalsActivity[]>`
  - `downloadIntervalsFit(intervalsId: string, destPath: string): Promise<string>` (returns `destPath`)
  - `parseIntervalsActivities(raw: any[]): IntervalsActivity[]` (pure, exported for tests)
- New types in `electron/types.ts`:
  ```ts
  export interface IntervalsStatus {
    connected: boolean;
    athleteId?: string;
  }
  export interface IntervalsActivity {
    intervalsId: string;
    name: string;
    startEpochMs: number;
    movingSec: number;
    distanceM: number;
    type: string;
    fileExt: "fit" | "tcx" | "unknown";
  }
  ```

- [ ] **Step 1: Add the types to `electron/types.ts`**

Append the `IntervalsStatus` and `IntervalsActivity` interfaces shown above to `electron/types.ts`.

- [ ] **Step 2: Write the failing test** — covers the pure parser only (network calls are exercised manually / via the UI).

Create `scripts/test-intervals-service.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { parseIntervalsActivities } = await import(
  `${distUrl("intervalsService.js")}?cacheBust=${Date.now()}`
);

const raw = [
  {
    id: "i123",
    name: "Morning Ride",
    start_date: "2026-07-01T06:00:00Z",
    start_date_local: "2026-07-01T08:00:00",
    moving_time: 3600,
    distance: 25000,
    type: "Ride",
    source_file: { type: "fit" }
  },
  {
    id: "i124",
    // no name, no distance, tcx source
    start_date: "2026-07-02T05:30:00Z",
    elapsed_time: 1800,
    type: "Run",
    source_file: { type: "tcx" }
  }
];

const parsed = parseIntervalsActivities(raw);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].intervalsId, "i123");
assert.equal(parsed[0].name, "Morning Ride");
assert.equal(parsed[0].startEpochMs, Date.parse("2026-07-01T06:00:00Z"));
assert.equal(parsed[0].movingSec, 3600);
assert.equal(parsed[0].distanceM, 25000);
assert.equal(parsed[0].fileExt, "fit");

assert.equal(parsed[1].name, "Unnamed");
assert.equal(parsed[1].distanceM, 0);
assert.equal(parsed[1].movingSec, 1800);
assert.equal(parsed[1].fileExt, "tcx");

console.log("intervals-service tests passed");
```

- [ ] **Step 3: Add the test script to package.json**

```json
"test:intervals-service": "npm run build:electron && node scripts/test-intervals-service.mjs",
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:intervals-service`
Expected: FAIL — module not found.

- [ ] **Step 5: Write the implementation**

Create `electron/intervalsService.ts` (secret storage mirrors `spotifyService.ts`):

```ts
import fs from "node:fs";
import { safeStorage } from "electron";
import { deleteSettings, getSetting, setSetting } from "./database";
import type { IntervalsActivity, IntervalsStatus } from "./types";

const BASE_URL = "https://intervals.icu/api/v1";
const SETTINGS = {
  apiKey: "intervals.apiKey",
  athleteId: "intervals.athleteId"
};

function storeSecret(key: string, value: string): void {
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString("base64")
    : value;
  setSetting(key, payload);
}

function readSecret(key: string): string | undefined {
  const raw = getSetting(key);
  if (!raw) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return raw;
  try {
    return safeStorage.decryptString(Buffer.from(raw, "base64"));
  } catch {
    return raw;
  }
}

function authHeader(apiKey: string): string {
  return "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
}

function requireAuth(): { apiKey: string; athleteId: string } {
  const apiKey = readSecret(SETTINGS.apiKey);
  const athleteId = getSetting(SETTINGS.athleteId);
  if (!apiKey || !athleteId) {
    throw new Error("Not connected to intervals.icu.");
  }
  return { apiKey, athleteId };
}

export function getIntervalsStatus(): IntervalsStatus {
  const apiKey = readSecret(SETTINGS.apiKey);
  const athleteId = getSetting(SETTINGS.athleteId);
  return apiKey && athleteId
    ? { connected: true, athleteId }
    : { connected: false };
}

export async function connectIntervals(
  apiKey: string,
  athleteId: string
): Promise<IntervalsStatus> {
  const id = athleteId.trim();
  // Validate the key by hitting the athlete endpoint.
  const resp = await fetch(`${BASE_URL}/athlete/${id}`, {
    headers: { Authorization: authHeader(apiKey.trim()) }
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("Invalid intervals.icu API key.");
  }
  if (!resp.ok) {
    throw new Error(`intervals.icu error: ${resp.status}`);
  }
  storeSecret(SETTINGS.apiKey, apiKey.trim());
  setSetting(SETTINGS.athleteId, id);
  return { connected: true, athleteId: id };
}

export function disconnectIntervals(): void {
  deleteSettings([SETTINGS.apiKey, SETTINGS.athleteId]);
}

function fileExtOf(raw: any): IntervalsActivity["fileExt"] {
  const t = String(raw?.source_file?.type ?? raw?.source ?? "").toLowerCase();
  if (t.includes("fit")) return "fit";
  if (t.includes("tcx")) return "tcx";
  return "unknown";
}

export function parseIntervalsActivities(raw: any[]): IntervalsActivity[] {
  return raw.map((a) => {
    const start = a.start_date ?? a.startDate ?? a.start_date_local ?? "";
    return {
      intervalsId: String(a.id),
      name: a.name ?? "Unnamed",
      startEpochMs: start ? Date.parse(start) : 0,
      movingSec: Number(a.moving_time ?? a.movingTime ?? a.elapsed_time ?? 0),
      distanceM: Number(a.distance ?? 0),
      type: String(a.type ?? ""),
      fileExt: fileExtOf(a)
    };
  });
}

export async function listIntervalsActivities(
  daysBack: number
): Promise<IntervalsActivity[]> {
  const { apiKey, athleteId } = requireAuth();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - daysBack * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const url = `${BASE_URL}/athlete/${athleteId}/activities?oldest=${from}&newest=${to}`;
  const resp = await fetch(url, {
    headers: { Authorization: authHeader(apiKey) }
  });
  if (!resp.ok) {
    throw new Error(`intervals.icu fetch failed: ${resp.status}`);
  }
  return parseIntervalsActivities((await resp.json()) as any[]);
}

export async function downloadIntervalsFit(
  intervalsId: string,
  destPath: string
): Promise<string> {
  const { apiKey } = requireAuth();
  const resp = await fetch(`${BASE_URL}/activity/${intervalsId}/file`, {
    headers: { Authorization: authHeader(apiKey) }
  });
  if (!resp.ok) {
    throw new Error(
      `FIT download failed (${resp.status}) for activity ${intervalsId}`
    );
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return destPath;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:intervals-service`
Expected: `intervals-service tests passed`

- [ ] **Step 7: Commit**

```bash
git add electron/intervalsService.ts electron/types.ts scripts/test-intervals-service.mjs package.json
git commit -m "feat: add intervals.icu connector service"
```

---

### Task 7: IPC wiring (main + preload + renderer API)

**Files:**
- Modify: `electron/main.ts` (register handlers)
- Modify: `electron/preload.ts` (expose channels)
- Modify: `src/coroslink-api.ts` (renderer-side typed API + types re-export)

**Interfaces:**
- Consumes: all exported functions from `intervalsService.ts` (Task 6), `uploadActivityFitToCoros` (Task 4), `listTrainingHubActivities` / stored COROS activities + `isAlreadyOnCoros` (Task 5).
- Produces (renderer API, on the object exposed as `window.coroslink` / imported in `coroslink-api.ts`):
  - `intervals.getStatus(): Promise<IntervalsStatus>`
  - `intervals.connect(apiKey, athleteId): Promise<IntervalsStatus>`
  - `intervals.disconnect(): Promise<void>`
  - `intervals.listMissing(daysBack): Promise<IntervalsActivityWithStatus[]>` where `IntervalsActivityWithStatus = IntervalsActivity & { onCoros: boolean }`
  - `intervals.import(intervalsId): Promise<{ importId: string }>`

- [ ] **Step 1: Add the `IntervalsActivityWithStatus` type to `electron/types.ts`**

```ts
export interface IntervalsActivityWithStatus extends IntervalsActivity {
  onCoros: boolean;
}
```

- [ ] **Step 2: Register IPC handlers in `electron/main.ts`**

Find where the existing `ipcMain.handle("spotify:...")` handlers are registered and add alongside them:

```ts
import {
  getIntervalsStatus,
  connectIntervals,
  disconnectIntervals,
  listIntervalsActivities,
  downloadIntervalsFit
} from "./intervalsService";
import {
  uploadActivityFitToCoros,
  listTrainingHubActivities
} from "./trainingHubService";
import { isAlreadyOnCoros } from "./intervalsMatch";
import type { IntervalsActivityWithStatus } from "./types";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

ipcMain.handle("intervals:getStatus", () => getIntervalsStatus());

ipcMain.handle("intervals:connect", (_e, apiKey: string, athleteId: string) =>
  connectIntervals(apiKey, athleteId)
);

ipcMain.handle("intervals:disconnect", () => {
  disconnectIntervals();
});

ipcMain.handle(
  "intervals:listMissing",
  async (_e, daysBack: number): Promise<IntervalsActivityWithStatus[]> => {
    const intervals = await listIntervalsActivities(daysBack);
    // Pull enough COROS activities to cover the window and map to MatchableActivity.
    const corosRaw = await listTrainingHubActivities(1, 200);
    const coros = corosRaw.map((a) => ({
      startEpochMs:
        Number(a.startTime) * (String(a.startTime).length <= 10 ? 1000 : 1),
      movingSec: Number(a.duration ?? 0),
      distanceM: Number(a.distance ?? 0)
    }));
    return intervals.map((a) => ({
      ...a,
      onCoros: isAlreadyOnCoros(
        {
          startEpochMs: a.startEpochMs,
          movingSec: a.movingSec,
          distanceM: a.distanceM
        },
        coros
      )
    }));
  }
);

ipcMain.handle(
  "intervals:import",
  async (_e, intervalsId: string): Promise<{ importId: string }> => {
    const tmp = path.join(os.tmpdir(), `coroslink-intervals-${intervalsId}.fit`);
    try {
      await downloadIntervalsFit(intervalsId, tmp);
      return await uploadActivityFitToCoros(tmp);
    } finally {
      try {
        fs.rmSync(tmp);
      } catch {
        /* best effort */
      }
    }
  }
);
```

> **Implementer note:** confirm the exact property names of a Training Hub activity (`startTime`, `duration`, `distance`) against the `TrainingHubActivity` type in `electron/types.ts` and the mapping in `listTrainingHubActivities`. Adjust the `coros.map(...)` accessors to the real field names and units (COROS `startTime` is epoch seconds; convert to ms). If `listTrainingHubActivities` is not exported, export it (it already exists internally).

- [ ] **Step 3: Expose the channels in `electron/preload.ts`**

Alongside the existing `spotify` block on the exposed API object, add:

```ts
intervals: {
  getStatus: () => ipcRenderer.invoke("intervals:getStatus"),
  connect: (apiKey: string, athleteId: string) =>
    ipcRenderer.invoke("intervals:connect", apiKey, athleteId),
  disconnect: () => ipcRenderer.invoke("intervals:disconnect"),
  listMissing: (daysBack: number) =>
    ipcRenderer.invoke("intervals:listMissing", daysBack),
  import: (intervalsId: string) =>
    ipcRenderer.invoke("intervals:import", intervalsId)
},
```

Also import the types at the top of `preload.ts` next to the other Training Hub type imports:

```ts
import type {
  IntervalsStatus,
  IntervalsActivity,
  IntervalsActivityWithStatus
} from "./types";
```

- [ ] **Step 4: Add the renderer-side API + types in `src/coroslink-api.ts`**

Mirror the shape in the renderer's typed API surface (`src/coroslink-api.ts`), matching how `spotify` is declared there. Add the `intervals` method group with the same signatures, and re-export/declare the `IntervalsStatus`, `IntervalsActivity`, and `IntervalsActivityWithStatus` types used by the UI.

- [ ] **Step 5: Build to verify everything compiles**

Run: `npm run build:electron && npm run build:renderer`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts electron/types.ts src/coroslink-api.ts
git commit -m "feat: wire intervals.icu import IPC channels"
```

---

### Task 8: Training Hub import panel (UI)

**Files:**
- Create: `src/training/components/IntervalsImportPanel.tsx`
- Modify: `src/training/TrainingHubView.tsx` (mount the panel)

**Interfaces:**
- Consumes: renderer `intervals.*` API (Task 7).
- Produces: `IntervalsImportPanel` React component (default export), rendered inside the Training Hub view.

- [ ] **Step 1: Write the panel component**

Create `src/training/components/IntervalsImportPanel.tsx`. It must:
- On mount, call `intervals.getStatus()`.
- **Disconnected state:** a form with two inputs (API key — masked; athlete id) and a **Connect** button calling `intervals.connect(...)`; show errors inline.
- **Connected state:** a **days-back** selector (default 30) and a **Refresh** button calling `intervals.listMissing(daysBack)`; render a table of activities with columns Name, Date, Type, Distance, Status. Status shows a badge: green "On COROS" when `onCoros`, amber "Missing" otherwise.
- Missing rows get an **Import** button calling `intervals.import(intervalsId)`; disable it and show a spinner while in flight; on success flip the row to "On COROS"; on error show the message on the row.
- An **Import all missing** button that imports missing rows sequentially, updating each as it completes, isolating per-row failures (one failure does not stop the loop).
- A **Disconnect** button calling `intervals.disconnect()` and returning to the form.

Use the existing Training Hub panel styling conventions (reuse the classNames/patterns from a sibling panel such as `ActivityBackupPanel.tsx`). Example skeleton (fill in with real handlers and the app's styling):

```tsx
import { useEffect, useState } from "react";
import { coroslink } from "../../coroslink-api";
import type {
  IntervalsStatus,
  IntervalsActivityWithStatus
} from "../../coroslink-api";

export default function IntervalsImportPanel() {
  const [status, setStatus] = useState<IntervalsStatus>({ connected: false });
  const [apiKey, setApiKey] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [daysBack, setDaysBack] = useState(30);
  const [rows, setRows] = useState<IntervalsActivityWithStatus[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    coroslink.intervals.getStatus().then(setStatus).catch(() => {});
  }, []);

  async function connect() {
    setError(null);
    try {
      setStatus(await coroslink.intervals.connect(apiKey, athleteId));
    } catch (e: any) {
      setError(e?.message ?? "Connection failed");
    }
  }

  async function refresh() {
    setError(null);
    try {
      setRows(await coroslink.intervals.listMissing(daysBack));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load activities");
    }
  }

  async function importOne(id: string) {
    setBusyId(id);
    try {
      await coroslink.intervals.import(id);
      setRows((rs) =>
        rs.map((r) => (r.intervalsId === id ? { ...r, onCoros: true } : r))
      );
    } catch (e: any) {
      setError(`Import failed for ${id}: ${e?.message ?? "error"}`);
    } finally {
      setBusyId(null);
    }
  }

  async function importAllMissing() {
    for (const r of rows.filter((r) => !r.onCoros)) {
      await importOne(r.intervalsId);
    }
  }

  // Render disconnected form vs connected table per the requirements above.
  // ...
  return null; // replace with real JSX using existing Training Hub styling
}
```

> The skeleton returns `null` only as a placeholder — the implementer must render the full disconnected/connected UI described in the bullet list, using the app's existing panel markup and CSS classes.

- [ ] **Step 2: Mount the panel in the Training Hub**

In `src/training/TrainingHubView.tsx`, import and render `IntervalsImportPanel` in the same section list as the other panels (e.g. near `ActivityBackupPanel`), only when the COROS Training Hub is authenticated (reuse the existing auth/logged-in guard the other panels use).

```tsx
import IntervalsImportPanel from "./components/IntervalsImportPanel";
// ... within the authenticated panels region:
<IntervalsImportPanel />
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build:renderer`
Expected: no TypeScript errors.

- [ ] **Step 4: Manual smoke test (real accounts)**

```bash
npm run dev
```
In the app: open Training Hub, log into COROS, connect intervals.icu (API key + athlete id), Refresh, confirm activities show with correct On COROS / Missing badges, Import one missing activity, and confirm it appears in COROS.

- [ ] **Step 5: Commit**

```bash
git add src/training/components/IntervalsImportPanel.tsx src/training/TrainingHubView.tsx
git commit -m "feat: add intervals.icu import panel to Training Hub"
```

---

## Final integration & PR

- [ ] **Run every new unit test:**

```bash
npm run test:aws-sigv4
npm run test:zip-store
npm run test:coros-upload-config
npm run test:intervals-match
npm run test:intervals-service
```
All must print their `... tests passed` line.

- [ ] **Full build:** `npm run build` — no errors.

- [ ] **Fork + PR** (delivery per the spec):

```bash
gh repo fork JunAkerBuilds/CorosLink --remote --remote-name origin
git push -u origin feat/intervals-icu-import
gh pr create --repo JunAkerBuilds/CorosLink \
  --title "Import activities from intervals.icu into COROS" \
  --body "See docs/superpowers/specs/2026-07-08-intervals-icu-to-coros-import-design.md"
```

> Decide with the maintainer whether to include the `docs/superpowers/` planning docs in the PR or drop them from the branch first.
