import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep native / WASM server packages out of the bundle so they load their
  // own assets (PGlite's WASM, argon2's native binding) from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "@node-rs/argon2", "postgres"],
  // Static hardening headers on every response (AUDIT H8). The
  // Content-Security-Policy carries a per-request nonce, so it is set in
  // src/middleware.ts instead.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
