import { todayInLondon, type IsoDate } from "../rules/dates";

/**
 * The demo is seeded around 2026-09-30 so the Today list, matrix and review
 * queue are always populated and stable for screenshots and acceptance tests.
 * Set CASTELLAN_LIVE_CLOCK=1 to use the real Europe/London date instead.
 */
export const DEMO_TODAY: IsoDate = "2026-09-30";

export function getToday(): IsoDate {
  if (process.env.CASTELLAN_LIVE_CLOCK === "1") return todayInLondon();
  return DEMO_TODAY;
}
