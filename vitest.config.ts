import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Mirrors tsconfig's `@/*` so modules under test can import app code.
// `tests/` is the Playwright e2e suite (`pnpm e2e`), not vitest.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    exclude: [...configDefaults.exclude, "tests/**"],
  },
});
