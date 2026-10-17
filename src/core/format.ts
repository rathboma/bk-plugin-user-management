/**
 * Parses timestamps as databases print them, e.g. PostgreSQL's
 * "2026-10-16 12:00:00+00", which Date.parse doesn't accept everywhere.
 */
export function parseTimestamp(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  let text = value.trim().replace(" ", "T");
  // A time zone offset of +00 / -0500 -> +00:00 / -05:00
  if (/T\d{2}:\d{2}/.test(text)) {
    text = text.replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function sameTimestamp(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = parseTimestamp(a);
  const db = parseTimestamp(b);
  if (!da || !db) return !da && !db;
  return da.getTime() === db.getTime();
}

/** Local date and time for display, e.g. "16 Oct 2026, 12:00". */
export function formatTimestamp(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return value ?? "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "in 3 days", "2 hours ago". */
export function relativeTime(value: string | null | undefined, now = new Date()): string {
  const date = parseTimestamp(value);
  if (!date) return "";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, "second");
}

/** Value for <input type="datetime-local"> in the viewer's time zone. */
export function toDateTimeInput(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO timestamp (UTC) from a datetime-local value, or null when empty. */
export function fromDateTimeInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
