/**
 * Date-only arithmetic for the rules engine.
 *
 * Correctness of dates is the product's first promise (see spec meta / role).
 * All obligation maths is done on *calendar dates*, never wall-clock instants,
 * so British Summer Time transitions can never shift a due date by a day.
 *
 * A date is represented as an ISO `YYYY-MM-DD` string. We parse it into a
 * UTC-noon Date internally to stay clear of any DST edge, and only ever read
 * back the Y/M/D. This module has zero dependencies and is pure.
 */

export type IsoDate = string; // "YYYY-MM-DD"

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

export function daysInMonth(year: number, month1to12: number): number {
  // month is 1..12. Day 0 of next month == last day of this month.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function parts(iso: IsoDate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toIso(y: number, m: number, d: number): IsoDate {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * Add whole calendar months, clamping the day to the last valid day of the
 * target month. e.g. 2025-01-31 + 1 month => 2025-02-28 (not 2025-03-03).
 * This is the behaviour a landlord expects for "12 months from last check".
 */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const { y, m, d } = parts(iso);
  const zeroBased = m - 1 + months;
  const targetYear = y + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12 + 1; // 1..12
  const clampedDay = Math.min(d, daysInMonth(targetYear, targetMonth));
  return toIso(targetYear, targetMonth, clampedDay);
}

export function addYears(iso: IsoDate, years: number): IsoDate {
  return addMonths(iso, years * 12);
}

/** Add whole days. Uses UTC to avoid any DST-induced off-by-one. */
export function addDays(iso: IsoDate, days: number): IsoDate {
  const { y, m, d } = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** a - b, in whole calendar days. Positive when a is after b. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  const pa = parts(a);
  const pb = parts(b);
  const ua = Date.UTC(pa.y, pa.m - 1, pa.d);
  const ub = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((ua - ub) / 86_400_000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return diffDays(a, b);
}

export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return diffDays(a, b) < 0;
}

export function isAfter(a: IsoDate, b: IsoDate): boolean {
  return diffDays(a, b) > 0;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return isBefore(a, b) ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return isAfter(a, b) ? a : b;
}

/** Today in Europe/London as a calendar date, independent of server timezone. */
export function todayInLondon(now: Date = new Date()): IsoDate {
  // en-CA gives YYYY-MM-DD; timeZone pins it to London regardless of host TZ.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

/** UK display format: "14 Oct 2027". Never the ambiguous 03/04 form. */
export function formatUkDate(iso: IsoDate): string {
  const { y, m, d } = parts(iso);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}
