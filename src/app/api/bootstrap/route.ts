import { bootstrapProd } from "@/server/db/bootstrap_prod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One-time production schema bootstrap. Protected by BOOTSTRAP_TOKEN so it can be
 * triggered over HTTPS exactly once after a database is connected:
 *
 *   curl -X POST "https://<host>/api/bootstrap" -H "x-bootstrap-token: <token>"
 *
 * It applies the Drizzle migrations + RLS policies and ensures the `app_user`
 * role, running inside the Vercel runtime where the database is reachable. It is
 * idempotent: re-running only re-ensures the role. Returns 404 when no database
 * or token is configured, so the endpoint is invisible before setup.
 */
export async function POST(req: Request): Promise<Response> {
  const expected = process.env.BOOTSTRAP_TOKEN;
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  // Hidden until both a database and a token are configured.
  if (!expected || !url) {
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const provided =
    req.headers.get("x-bootstrap-token") ||
    new URL(req.url).searchParams.get("token") ||
    "";
  // Constant-time-ish comparison on equal length; length check first is fine here.
  if (provided.length !== expected.length || provided !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await bootstrapProd(url);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
