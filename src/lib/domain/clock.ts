import { todayInLondon, type IsoDate } from "../rules/dates";

/**
 * DEMO ONLY. The public demo is seeded around 2026-09-30 so its Today list,
 * matrix and review queue stay populated and stable. Set CASTELLAN_LIVE_CLOCK=1
 * to run the demo on the real Europe/London date instead.
 *
 * Real workspaces must never use this: they use todayInZone(workspace.timezone)
 * (AUDIT C5 — the platform's Today/Week once ran on this frozen date).
 */
export const DEMO_TODAY: IsoDate = "2026-09-30";

export function getToday(): IsoDate {
  if (process.env.CASTELLAN_LIVE_CLOCK === "1") return todayInLondon();
  return DEMO_TODAY;
}
