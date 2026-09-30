import { sql } from "drizzle-orm";
import { asService, getDb } from "@/server/db/client";

export const runtime = "nodejs";

/** Liveness + database connectivity. No tenant data is read. */
export async function GET() {
  try {
    const db = await getDb();
    await asService(db, (tx) => tx.execute(sql`select 1 as ok`));
    return Response.json({ ok: true, db: "connected" });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
