import { defineConfig } from "vitest/config";
import { browserBranches } from "./scripts/build/browser-branches.ts";

export default defineConfig(({ mode }) => ({
  define: { "process.env.TEST_BROWSER": JSON.stringify(mode) },
  plugins: [browserBranches(mode)],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/tooling/**", "tests/benchmarks/**"],
    clearMocks: true,
    restoreMocks: true,
  },
}));
