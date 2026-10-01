import { describe, expect, it } from "vitest";
import { z } from "zod";

import { acceptStructuredOutput } from "../src/policy/structured.js";

// Live 2026-10-01: a rehearsal persona whose baseline mood was one word
// outside the list was refused whole, and the lobby could not open.
const Persona = z
  .object({
    summary: z.string(),
    temperament: z
      .object({ baseline: z.enum(["WARM", "NEUTRAL", "SKEPTICAL"]) })
      .strict(),
    traits: z.array(
      z.object({ trait: z.string(), source: z.enum(["PROFILE", "PUBLIC"]) }),
    ),
  })
  .strict();

const text = (baseline: string, source = "PUBLIC") =>
  JSON.stringify({
    summary: "A careful seed investor.",
    temperament: { baseline },
    traits: [{ trait: "Reads the numbers first", source }],
  });

describe("labels outside a fixed set", () => {
  it("maps a label that differs only in case or spacing to the set's spelling", () => {
    const outcome = acceptStructuredOutput(text(" skeptical "), Persona);
    expect(outcome.ok && outcome.value.temperament.baseline).toBe("SKEPTICAL");
  });

  it("uses the stand-in for its path, and reports the path, not the value", () => {
    const outcome = acceptStructuredOutput(
      text("GUARDED", "LINKEDIN"),
      Persona,
      {
        enumFallbacks: {
          "temperament.baseline": "NEUTRAL",
          "traits.source": "PUBLIC",
        },
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.temperament.baseline).toBe("NEUTRAL");
    expect(outcome.value.traits[0]?.source).toBe("PUBLIC");
    expect(outcome.dropped).toEqual([
      "temperament.baseline:label",
      "traits.source:label",
    ]);
    expect(JSON.stringify(outcome.dropped)).not.toContain("GUARDED");
  });

  it("still refuses an unknown label where no stand-in is given", () => {
    const outcome = acceptStructuredOutput(text("GUARDED"), Persona);
    expect(outcome.ok).toBe(false);
  });
});
