/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep native / WASM server packages out of the bundle so they load their
  // own assets (PGlite's WASM, argon2's native binding) from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "@node-rs/argon2", "postgres"],
};

export default nextConfig;
