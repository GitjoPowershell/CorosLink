import type { ManualActivityInput } from "./types";

const SPORT_MAP: Record<ManualActivityInput["sport"], string> = {
  run: "Running",
  bike: "Biking",
  other: "Other"
};

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a minimal, schema-valid TCX for a hand-entered activity. */
export function buildManualTcx(input: ManualActivityInput): string {
  const sport = SPORT_MAP[input.sport] ?? "Other";
  const start = xmlEscape(input.startTimeIso);
  const total = Math.max(0, Math.round(input.durationSec));
  const distance = Math.max(0, Math.round(input.distanceM));
  const calories = Math.max(0, Math.round(input.calories ?? 0));
  const hr =
    input.avgHr != null && input.avgHr > 0
      ? `        <AverageHeartRateBpm><Value>${Math.round(
          input.avgHr
        )}</Value></AverageHeartRateBpm>\n`
      : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n` +
    `  <Activities>\n` +
    `    <Activity Sport="${sport}">\n` +
    `      <Id>${start}</Id>\n` +
    `      <Lap StartTime="${start}">\n` +
    `        <TotalTimeSeconds>${total}</TotalTimeSeconds>\n` +
    `        <DistanceMeters>${distance}</DistanceMeters>\n` +
    `        <Calories>${calories}</Calories>\n` +
    hr +
    `        <Intensity>Active</Intensity>\n` +
    `        <TriggerMethod>Manual</TriggerMethod>\n` +
    `      </Lap>\n` +
    `    </Activity>\n` +
    `  </Activities>\n` +
    `</TrainingCenterDatabase>\n`
  );
}
