import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { todayInZone } from "@/lib/rules/dates";

/**
 * AUDIT C5: "today" for a real workspace is the real date in the workspace's
 * time zone. The fixed demo date must never reach a platform page.
 */

describe("todayInZone", () => {
  // 23:30 UTC on 31 Dec 2026
  const lateNightUtc = new Date("2026-12-31T23:30:00Z");

  it("uses the workspace's zone, not the server's", () => {
    expect(todayInZone("Europe/London", lateNightUtc)).toBe("2026-12-31");
    expect(todayInZone("Asia/Kolkata", lateNightUtc)).toBe("2027-01-01");
    expect(todayInZone("America/New_York", lateNightUtc)).toBe("2026-12-31");
  });

  it("follows UK clock changes (BST)", () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in London (BST, UTC+1).
    expect(todayInZone("Europe/London", new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });

  it("falls back to London for an unknown zone instead of failing", () => {
    expect(todayInZone("Not/A_Zone", lateNightUtc)).toBe("2026-12-31");
  });
});

describe("no platform page runs on the demo clock", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(path.join(process.cwd(), "src/app/(platform)"));
  walk(path.join(process.cwd(), "src/server"));

  it.each(files.map((f) => [path.relative(process.cwd(), f)]))("%s does not import the demo clock", (rel) => {
    const src = readFileSync(path.join(process.cwd(), rel), "utf8");
    expect(src).not.toMatch(/lib\/domain\/clock|getToday\(|DEMO_TODAY/);
  });
});
