import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  PROFILE_GAP_READER_V1,
  ProfileGapReaderResultSchema,
  TURN_READER_V26,
  TURN_READER_V27,
  TURN_READER_V27_SAVE_TO_PROFILE,
  TurnReaderV27ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v27 (HARDEN P0, live 2026-10-02, Nixo): "I'm giving you full
 * permission and approval to update my profile with what you get online"
 * is saveToOwnProfile, read by meaning; code then fills the open fields.
 */
describe("TURN_READER v27", () => {
  it("v26 is deprecated (v28 is active)", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(29);
    expect(TURN_READER_V26.status).toBe("DEPRECATED");
  });

  it("adds saveToOwnProfile by meaning and loses nothing of v26", () => {
    expect(TURN_READER_V27.template).toContain(TURN_READER_V27_SAVE_TO_PROFILE);
    expect(TURN_READER_V27.template).toContain(
      "saveToOwnProfile is true when the person authorises Q to put what research finds",
    );
    for (const line of TURN_READER_V26.template.split("\n")) {
      expect(TURN_READER_V27.template).toContain(line);
    }
  });

  it("reads saveToOwnProfile as false when a model leaves it out", () => {
    const parsed = TurnReaderV27ResultSchema.parse({
      kind: "RESEARCH_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
    });
    expect(parsed.saveToOwnProfile).toBe(false);
  });
});

describe("PROFILE_GAP_READER v1", () => {
  it("is a structured extraction with a strict schema, active", () => {
    expect(
      createDefaultPromptRegistry().getActive("PROFILE_GAP_READER").definition
        .version,
    ).toBe(1);
    expect(PROFILE_GAP_READER_V1.taskClass).toBe("STRUCTURED_EXTRACTION");
    expect(
      ProfileGapReaderResultSchema.safeParse({
        values: [],
        conflicting: [],
        verdict: "verified",
      }).success,
    ).toBe(false);
    expect(ProfileGapReaderResultSchema.parse({})).toEqual({
      wrongSubject: false,
      values: [],
      conflicting: [],
    });
  });
});
