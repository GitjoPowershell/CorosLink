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
  // COROS appends the salt as a SUFFIX to the base64 payload (verified live:
  // the credentials string ends with SALT). Strip it from the end; fall back to
  // removing a single occurrence anywhere for resilience if the format shifts.
  const base64 = rawCredentials.endsWith(SALT)
    ? rawCredentials.slice(0, -SALT.length)
    : rawCredentials.replace(SALT, "");
  const json = Buffer.from(base64, "base64").toString("utf8");
  return JSON.parse(json) as StsCredentials;
}
