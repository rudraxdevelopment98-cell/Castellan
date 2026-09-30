import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // PGlite + argon2 need a little headroom on first run.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
