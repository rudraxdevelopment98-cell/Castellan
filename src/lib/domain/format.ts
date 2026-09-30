import { diffDays, formatUkDate, type IsoDate } from "../rules/dates";

/** Money as GBP with commas and tabular alignment in mind. Never ambiguous. */
export function formatMoney(amount: number, currency = "GBP"): string {
  const s = amount.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${currency} ${s}`;
}

export { formatUkDate };

/** Human relative date: "overdue by 3 days", "due today", "in 12 days". */
export function relativeDue(due: IsoDate | null, today: IsoDate): string {
  if (!due) return "no date yet";
  const d = diffDays(due, today);
  if (d < 0) return `overdue by ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"}`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `in ${d} days`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
