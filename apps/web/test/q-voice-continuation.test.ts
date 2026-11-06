import { describe, expect, it } from "vitest";

import { demoTop } from "../src/features/q/answer-canvas-fixtures";
import type { QTurn } from "../src/features/q/conversation";
import {
  continuationLine,
  threadOfTurns,
} from "../src/features/q/continuation";

/**
 * Owner 2026-11-06: voice opened on a conversation under way carries on
 * from it -- the thread's own words -- never the arrival greeting.
 */

type Block = Extract<QTurn, { kind: "Q" }>["blocks"][number];

const person = (id: string, text: string): QTurn => ({
  kind: "PERSON",
  id,
  text,
  unconfirmed: false,
});
const answer = (
  id: string,
  text: string,
  blocks: readonly Block[] = [],
): QTurn => ({
  kind: "Q",
  id,
  text,
  streaming: false,
  sourceCount: 0,
  publicSources: [],
  findings: [],
  uncertainties: [],
  blocks,
});

describe("Q's first words on a line opened mid-conversation", () => {
  it("is nothing for an empty thread (the arrival greeting opens it)", () => {
    expect(continuationLine([])).toBeNull();
  });

  it("names what was found when the last answer laid out cards", () => {
    const line = continuationLine(
      threadOfTurns([
        person("p1", "What changed this week?"),
        answer("q1", "Two replies came in."),
        person("p2", "Find me more companies online."),
        answer("q2", "Here they are.", [
          { ...demoTop(5), kind: "ANSWER_CARDS" },
        ]),
      ]),
    );
    expect(line).toBe(
      "You'd asked “Find me more companies online”, and I found five. Want me to go through them, or something else?",
    );
  });

  it("picks up the subject when the last answer was words", () => {
    expect(
      continuationLine(
        threadOfTurns([
          person("p1", "What's Brightwell's runway?"),
          answer("q1", "About 14 months at the current burn."),
        ]),
      ),
    ).toBe(
      "We were on “What's Brightwell's runway”. Want to pick up from there, or something else?",
    );
  });

  it("offers to carry on when Q had not answered yet", () => {
    expect(
      continuationLine(
        threadOfTurns([person("p1", "Draft a note to Spheros")]),
      ),
    ).toBe(
      "You'd asked “Draft a note to Spheros”. Want me to carry on with that, or something else?",
    );
  });

  it("says long words back short, at a word", () => {
    const line =
      continuationLine(
        threadOfTurns([
          person(
            "p1",
            "Can you compare every fintech founder raising a seed round in Lagos and Nairobi this quarter against my mandate please",
          ),
        ]),
      ) ?? "";
    const said = /“(.+)”/u.exec(line)?.[1] ?? "";
    expect(said.endsWith("…")).toBe(true);
    expect(said.length).toBeLessThanOrEqual(91);
    // Cut at a word: the last word before the ellipsis is whole.
    expect(said).toMatch(/ Nairobi this…$/u);
    expect(said).not.toContain("mandate");
  });

  it("never says the arrival's waiting count", () => {
    const line =
      continuationLine(
        threadOfTurns([person("p1", "Hi"), answer("q1", "Hello.")]),
      ) ?? "";
    expect(line).not.toMatch(/things? (are )?waiting|need you|welcome/iu);
  });
});
