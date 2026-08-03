import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts (which is dev/build-only) so `vitest` config changes
// can't accidentally affect the app bundle. jsdom by default so React component tests
// don't need a per-file pragma; parser/Node-only tests opt out with
// `// @vitest-environment node` at the top of the file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // The CLI smoke test spawns a real dev server and is slow; it runs only via
    // `npm run test:cli`, not on every plain `vitest run`.
    exclude: [...configDefaults.exclude, "bin/wikilink-graph.cli.test.mjs"],
  },
});
