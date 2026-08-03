import { defineConfig } from "vitest/config";

// Separate entrypoint for the slow CLI start/stop smoke test (excluded from the
// default `npm run test`/vitest.config.ts run). Invoked via `npm run test:cli`,
// and as its own step in CI rather than bundled into the main test run.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["bin/wikilink-graph.cli.test.mjs"],
    testTimeout: 60_000,
  },
});
