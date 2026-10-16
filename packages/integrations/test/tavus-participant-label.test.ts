import { describe, expect, it } from "vitest";

import {
  TAVUS_PARTICIPANT_LABEL_MAX,
  tavusParticipantLabel,
} from "../src/index.js";

describe("the name on Q's video tile is who Q plays, never the face's name", () => {
  it("names the persona on every Tavus surface", () => {
    expect(
      tavusParticipantLabel({
        surface: "REHEARSAL",
        counterpart: "Harbourline Cargo",
        person: "Babatunde",
      }),
    ).toBe("Babatunde · Harbourline Cargo (Q rehearsal)");
    expect(
      tavusParticipantLabel({
        surface: "REHEARSAL",
        counterpart: "Harbourline Cargo",
      }),
    ).toBe("Harbourline Cargo (Q rehearsal)");
    expect(
      tavusParticipantLabel({
        surface: "INTERVIEW",
        fund: "Savanna Seed Partners",
      }),
    ).toBe("Q · Savanna Seed Partners (AI interviewer)");
    expect(tavusParticipantLabel({ surface: "INTERVIEW", fund: null })).toBe(
      "Q (AI interviewer)",
    );
    expect(tavusParticipantLabel({ surface: "MEETING" })).toBe(
      "Q · Capital Q (AI assistant)",
    );
  });

  it("stays within the provider's bound and keeps saying it is Q", () => {
    const label = tavusParticipantLabel({
      surface: "REHEARSAL",
      counterpart: "A".repeat(300),
      person: "B".repeat(80),
    });
    expect(label.length).toBeLessThanOrEqual(TAVUS_PARTICIPANT_LABEL_MAX);
    expect(label.endsWith(" (Q rehearsal)")).toBe(true);
    expect(
      tavusParticipantLabel({ surface: "INTERVIEW", fund: "F".repeat(300) })
        .length,
    ).toBeLessThanOrEqual(TAVUS_PARTICIPANT_LABEL_MAX);
  });
});
