import { defineConfig } from "drizzle-kit";

// Schema is the single source of truth; migrations are generated into ./drizzle
// and applied to Supabase Postgres in prod and to PGlite in the isolation tests.
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/castellan",
  },
});
