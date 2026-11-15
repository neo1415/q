import { describe, expect, it } from "vitest";

import { preparedLine } from "../src/tools/app-actions.js";

describe("Q's line for a prepared card", () => {
  it("ends the card's own sentence once (live 2026-11-15 D6: 'investors don't see it..')", () => {
    const said = preparedLine({
      summary: "Record your monthly burn of USD 48,000",
      preview:
        'You said: "Actually our monthly burn is US$48,000". Kept as your own statement (self-reported), private to your company: investors don\'t see it.',
    });
    expect(said).not.toMatch(/\.\./u);
    expect(said).toMatch(
      /investors don't see it\. It's on the card for your approval/u,
    );
  });
});
