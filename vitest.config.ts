import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "scripts/**/*.test.ts",
      "n8n/**/*.test.ts",
    ],
    testTimeout: 10_000,
  },
});
