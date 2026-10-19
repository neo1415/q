// The root config only discovers apps/ and packages/; this suite lives with its script.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: new URL(".", import.meta.url).pathname,
    include: ["*.test.mjs"],
  },
});
