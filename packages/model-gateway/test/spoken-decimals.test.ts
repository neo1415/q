import { describe, expect, it } from "vitest";

import { spokenBeforeCards } from "../src/q/fit-cards.js";
import { withoutUnbackedScreenClaims } from "../src/q/screen-claims.js";

/** D9: Q said "8. 8/10" for 8.8/10 — a per-stop split rejoined with a space. */
describe("decimals survive spoken and guarded text", () => {
  it("spokenBeforeCards keeps 8.8/10 and 3.8% whole", () => {
    const said = spokenBeforeCards(
      "Ledgerfold scores 8.8/10. Its portfolio-at-risk is 3.8%. F2 follows.",
    );
    expect(said).toContain("8.8/10");
    expect(said).toContain("3.8%");
    expect(said).not.toMatch(/\d\. \d/u);
    expect(said).toContain("F2 follows.");
  });

  it("the screen-claim guard keeps decimals whole when it rewrites a line", () => {
    const out = withoutUnbackedScreenClaims(
      "Ledgerfold scores 8.8/10. I've opened it on your screen.",
      false,
    );
    expect(out.text).toContain("8.8/10");
    expect(out.text).not.toMatch(/\d\. \d/u);
  });
});
