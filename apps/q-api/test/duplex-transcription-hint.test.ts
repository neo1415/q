import { describe, expect, it } from "vitest";

import { transcriptionHintFor } from "../src/voice/duplex/broker.js";

/**
 * Live 2026-10-08 11:13 UTC: "find anything that needs my attention" was
 * transcribed as "Fidiani inanituma attention". The transcriber is told
 * the language and the names this person is likely to say.
 */
describe("the duplex transcriber's hint", () => {
  it("pins English by default and names their records", () => {
    const hint = transcriptionHintFor({
      locale: undefined,
      vocabulary: ["Tensorgate", "  FDN   Capital ", "Tensorgate", "x"],
    });
    expect(hint.language).toBe("en");
    expect(hint.prompt).toContain("Tensorgate, FDN Capital, Capital Q");
    expect(hint.prompt.match(/Tensorgate/g)).toHaveLength(1);
    expect(hint.prompt).not.toContain(", x,");
  });

  it("follows the device language when it is not English", () => {
    expect(transcriptionHintFor({ locale: "fr-FR" }).language).toBe("fr");
  });
});
