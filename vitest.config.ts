import { defineConfig } from "vitest/config";

// Offline tests only. The provider's lifecycle tests need a NetBird server; see
// vitest.server.config.ts.
export default defineConfig({
  test: {
    include: [
      "packages/netbird/test/**/*.test.ts",
      "packages/alchemy-netbird/test/unit/**/*.test.ts",
    ],
  },
});
