import { timingSafeEqual } from "node:crypto";
import { sendDailyBriefs } from "@/server/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily brief run (AUDIT H9). Vercel Cron calls this with
 * "Authorization: Bearer <CRON_SECRET>". Without CRON_SECRET configured the
 * route does not exist (404), so it can never be triggered anonymously.
 * Re-running is harmless: each brief is sent at most once per local day.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Not found", { status: 404 });

  const presented = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await sendDailyBriefs({ deadlineMs: 50_000 });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("daily brief run failed:", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: "Brief run failed; see the server log." }, { status: 500 });
  }
}
