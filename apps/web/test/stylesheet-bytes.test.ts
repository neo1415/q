import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A CSS escape such as `"\25B8"` once reached the stylesheet as a raw
 * control byte, which renders as a missing-glyph box. Control characters
 * never belong in a stylesheet; escapes are written as escapes.
 */
const SHEETS = [
  "../app/globals.css",
  "../../../packages/ui/src/tokens/tokens.css",
];

describe("stylesheets", () => {
  it.each(SHEETS)("%s holds no control characters", (path) => {
    const text = readFileSync(
      fileURLToPath(new URL(path, import.meta.url)),
      "utf8",
    );
    // Tab, line feed and carriage return are whitespace, not content.
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  });
});
