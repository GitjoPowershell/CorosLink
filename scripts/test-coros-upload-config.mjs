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

// decode: COROS returns base64(JSON) with the salt appended as a SUFFIX
// (verified live against faq.coros.com/openapi/oss/sts — the credentials
// string ENDS with SALT and the base64 starts immediately).
const creds = {
  Region: "us-west-1",
  Bucket: "coros-s3",
  AccessKeyId: "AKID",
  SecretAccessKey: "SECRET",
  SessionToken: "TOKEN"
};
const encoded = Buffer.from(JSON.stringify(creds)).toString("base64") + SALT;
assert.deepEqual(decodeStsCredentials(encoded), creds);

// The base64 payload itself ends with "=" padding before the salt (real
// responses look like "...In0=9y78gpoERW4lBNYL"); the suffix strip must remove
// only the trailing salt and leave the padding intact.
const payload2 = {
  Region: "eu-west-1",
  Bucket: "eu-coros",
  AccessKeyId: "A",
  SecretAccessKey: "S",
  SessionToken: "T"
};
const b64 = Buffer.from(JSON.stringify(payload2)).toString("base64");
assert.ok(b64.endsWith("="), "sanity: this fixture's base64 has = padding");
assert.deepEqual(decodeStsCredentials(b64 + SALT), payload2);
// Suffix strip leaves the base64 (with padding) intact:
assert.equal(b64, (b64 + SALT).slice(0, -SALT.length));

console.log("coros-upload-config tests passed");
