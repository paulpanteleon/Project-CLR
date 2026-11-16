import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same "@/" alias as tsconfig.json, so tests can import app code the way the app does.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Each database test file builds an in-memory Postgres and runs every migration before its
    // tests. Under load that can pass the default 10 seconds.
    hookTimeout: 30_000,
  },
});
