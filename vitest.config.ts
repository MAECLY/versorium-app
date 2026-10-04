import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
    conditions: ["browser"],
  },
  // tests/unit holds the tests written outside the code they test (the
  // repo keeps new tests under tests/); older ones stay beside their code.
  test: { environment: "jsdom", include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"] },
});
