import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same "@/" alias as tsconfig.json, so tests can import app code the way the app does.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
