import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output from vinext, Vercel and Cloudflare tooling.
    ".vercel/**",
    ".vinext/**",
    ".wrangler/**",
    // Legacy Cloudflare worker sources remain archived for rollback only;
    // Next.js is the sole active runtime after this migration.
    "worker/**",
    "dist/**",
  ]),
]);

export default eslintConfig;
