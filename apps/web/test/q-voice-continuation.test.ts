import { describe, expect, it } from "vitest";

import { demoTop } from "../src/features/q/answer-canvas-fixtures";
import type { QTurn } from "../src/features/q/conversation";
import {
  CONTINUATION_LINE,
  continuationLine,
  threadOfTurns,
} from "../src/features/q/continuation";

/**
 * Owner 2026-11-06: voice opened on a conversation under way carries on
 * from it, never the arrival greeting. D9 (audit 14 Nov 2026): it never
 * quotes the person's last transcribed fragment back; what to carry on
 * with is Q's to say once they answer.
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

  it("never quotes the last raw fragment back (D9 live shapes)", () => {
    for (const fragment of [
      "Hey-ky",
      "I'm not sure yet. Let's just have",
      "turning off Q",
    ]) {
      const line =
        continuationLine(
          threadOfTurns([
            person("p1", "What changed this week?"),
            answer("q1", "Two replies came in."),
            person("p2", fragment),
          ]),
        ) ?? "";
      expect(line).toBe(CONTINUATION_LINE);
      expect(line).not.toContain(fragment);
      expect(line).not.toMatch(/[“"]/u);
    }
  });

  it("claims no content of its own, even after cards", () => {
    const line = continuationLine(
      threadOfTurns([
        person("p2", "Find me more companies online."),
        answer("q2", "Here they are.", [
          { ...demoTop(5), kind: "ANSWER_CARDS" },
        ]),
      ]),
    );
    expect(line).toBe(CONTINUATION_LINE);
    expect(line).not.toMatch(/found|five|\d/iu);
  });

  it("ends on a question, so a bare yes goes to Q on the live line", () => {
    expect(CONTINUATION_LINE.trim().endsWith("?")).toBe(true);
  });

  it("never says the arrival's waiting count", () => {
    const line =
      continuationLine(
        threadOfTurns([person("p1", "Hi"), answer("q1", "Hello.")]),
      ) ?? "";
    expect(line).not.toMatch(/things? (are )?waiting|need you|welcome/iu);
  });
});
