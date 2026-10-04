import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V33_TAIL,
  TURN_READER_V36,
  TURN_READER_V37,
} from "../src/index.js";

/**
 * TURN_READER v37 (QA run 3af14042): a deck's audience is set_deck_audience,
 * never the company's visibility.
 */
describe("TURN_READER v37", () => {
  it("is the active reader and v36 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(41);
    expect(TURN_READER_V36.status).toBe("DEPRECATED");
  });

  it("reads a deck's audience as set_deck_audience, never SET_VISIBILITY", () => {
    const template = TURN_READER_V37.template;
    expect(template).toContain(
      "A deck, document or upload of theirs, named or pointed to, is never SET_VISIBILITY",
    );
    expect(template).toContain(
      '"make Ajopot seed deck private to my organisation again" is set_deck_audience',
    );
    expect(template).toContain(
      "who may play their pitch video is set_pitch_sharing.",
    );
  });

  it("changes only the static prefix; the per-turn tail is v36's", () => {
    const tail = (t: string) => t.slice(t.indexOf(TURN_READER_V33_TAIL));
    expect(tail(TURN_READER_V37.template)).toBe(tail(TURN_READER_V36.template));
    const prefix = TURN_READER_V37.template.slice(
      0,
      TURN_READER_V37.template.indexOf(TURN_READER_V33_TAIL),
    );
    expect(prefix).not.toMatch(/\{\{\w+\}\}/u);
  });
});
