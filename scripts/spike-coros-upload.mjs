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
