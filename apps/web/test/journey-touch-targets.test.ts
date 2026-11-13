import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Journey audit 2026-11-13 D8 (phone, /company/<id>?tab=dataroom): the
 * folder chips were 39px tall and the header links ("$1M seed safe",
 * "Your relationship") 20px. Touch targets are at least 44px.
 */
const globals = readFileSync(
  join(import.meta.dirname, "../app/globals.css"),
  "utf8",
);
const brief = readFileSync(
  join(import.meta.dirname, "../src/features/company/brief/brief.css"),
  "utf8",
);

/** The declarations of the first `selector {…}` block after `from`. */
function block(css: string, selector: string, from = 0): string {
  const at = css.indexOf(`${selector} {`, from);
  expect(at, `${selector} is styled`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

function minHeight(declarations: string): number | null {
  const match = /min-height:\s*(\d+)px/u.exec(declarations);
  return match === null ? null : Number(match[1]);
}

describe("touch targets on the data room (D8)", () => {
  it("folder chips are 44px tall, also as phone pills", () => {
    expect(minHeight(block(globals, ".cq-room-shelf"))).toBe(44);
    const phone = globals.indexOf("@container (max-width: 559px)");
    const pill = block(globals, ".cq-room-shelf", phone);
    expect(minHeight(pill)).toBeGreaterThanOrEqual(44);
  });

  it("the header's links are 44px tall on touch", () => {
    const coarse = brief.indexOf("@media (pointer: coarse)");
    expect(coarse).toBeGreaterThanOrEqual(0);
    expect(minHeight(block(brief, ".cq-brief-link", coarse))).toBe(44);
  });
});
