import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep test jobs out of the development queue
    env: { QUEUE_PREFIX: "hookflow-test" },
    globalSetup: "./src/test/globalSetup.ts",
  },
});
