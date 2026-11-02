/**
 * Times shown to people, in New Zealand time.
 *
 * Every club and admin is in New Zealand, and the booking app shows its own
 * times the same way, so a sync it reports at "5:21 pm" reads as 17:21 here
 * too rather than 04:21 UTC. The label (NZDT or NZST) comes from the date
 * itself, so daylight saving is handled and always stated.
 *
 * DISPLAY ONLY. Stored values, API responses and the job schedule stay in UTC.
 */
const ZONE = "Pacific/Auckland";

const parts = new Intl.DateTimeFormat("en-NZ", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

function pieces(date: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** `2026-11-02 17:21 NZDT` (or with seconds: `2026-11-02 17:21:05 NZDT`). */
export function formatNzDateTime(date: Date, options: { seconds?: boolean } = {}): string {
  const p = pieces(date);
  const time = options.seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
  return `${p.year}-${p.month}-${p.day} ${time} ${p.timeZoneName}`;
}

/** `2026-11-02`: the New Zealand calendar date of a moment. */
export function formatNzDate(date: Date): string {
  const p = pieces(date);
  return `${p.year}-${p.month}-${p.day}`;
}
