import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/** Non-interactive lint gate: Next's core-web-vitals + TypeScript rules. */
const config = [
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts", ".castellan-dev-db/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
