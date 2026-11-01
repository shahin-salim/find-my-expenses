/**
 * Local-calendar helpers. Every screen groups by local day, and a week runs
 * Monday to Sunday (section 10, "How periods are defined").
 */

export const MILLIS_PER_DAY = 86_400_000;

function pad(value: number): string {
  return value < 10 ? '0' + value : String(value);
}

/** `YYYY-MM-DD` for the local calendar day an instant falls on. */
export function toLocalDateString(epochMillis: number): string {
  const d = new Date(epochMillis);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Epoch millis for local midnight at the start of the day an instant falls on. */
export function startOfLocalDay(epochMillis: number): number {
  const d = new Date(epochMillis);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Epoch millis for the Monday that starts the week an instant falls in. */
export function startOfLocalWeek(epochMillis: number): number {
  const d = new Date(startOfLocalDay(epochMillis));
  // getDay(): Sunday is 0. Monday-first means Sunday is 6 days into the week.
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

/** Epoch millis for the first day of the calendar month an instant falls in. */
export function startOfLocalMonth(epochMillis: number): number {
  const d = new Date(epochMillis);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addLocalDays(epochMillis: number, days: number): number {
  const d = new Date(epochMillis);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function addLocalMonths(epochMillis: number, months: number): number {
  const d = new Date(epochMillis);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/** The instant one year before `now`; the oldest message the import reads. */
export function oneYearBefore(epochMillis: number): number {
  const d = new Date(epochMillis);
  d.setFullYear(d.getFullYear() - 1);
  return d.getTime();
}

/** Epoch millis rounded down to the minute, used by the fallback dedup key. */
export function floorToMinute(epochMillis: number): number {
  return Math.floor(epochMillis / 60_000) * 60_000;
}
