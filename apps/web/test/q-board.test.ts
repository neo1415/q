import { describe, expect, it } from "vitest";

import { QArtifactIdSchema } from "@capital-q/contracts";

import {
  arrangeBoard,
  boardObjects,
  openQuestions,
} from "../src/features/q/board";
import type { QTurn } from "../src/features/q/conversation";

/**
 * The Board (ADR 0017 F3; spec §15 UX-04): every answer lands as typed
 * objects, newest first, pinned on top, dismissed gone; what needs the
 * person (Q's questions, approvals) is not an object on the Board.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ARTIFACT = QArtifactIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);

function person(id: string, text: string): QTurn {
  return { kind: "PERSON", id, text, unconfirmed: false };
}

function q(
  id: string,
  text: string,
  blocks: Extract<QTurn, { kind: "Q" }>["blocks"] = [],
  streaming = false,
): QTurn {
  return {
    kind: "Q",
    id,
    text,
    streaming,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  };
}

const turns: QTurn[] = [
  person("p1", "Which companies fit?"),
  q("q1", "Two fit your mandate.", [
    { kind: "COMPANY_REFERENCE", companyId: COMPANY },
    {
      kind: "CLARIFICATION_REQUEST",
      question: "Which stage?",
      options: ["Seed", "Series A"],
    },
  ]),
  person("p2", "Make me a deck."),
  q("q2", "Here is the deck.", [
    {
      kind: "ARTIFACT_REFERENCE",
      artifactId: ARTIFACT,
      type: "PITCH_DECK",
      status: "READY",
      title: "Acme deck",
    },
  ]),
];

describe("board objects", () => {
  it("turns every answer into typed objects, newest first", () => {
    const objects = boardObjects(turns);
    expect(objects.map((object) => object.kind)).toEqual([
      "NOTE",
      "ARTIFACT",
      "NOTE",
      "COMPANIES",
    ]);
    expect(objects[1]?.question).toBe("Make me a deck.");
    expect(objects[3]?.question).toBe("Which companies fit?");
  });

  it("leaves an answer still arriving on the stage, off the Board", () => {
    const objects = boardObjects([
      person("p1", "Hi"),
      q("q1", "Hel", [], true),
    ]);
    expect(objects).toEqual([]);
  });

  it("never puts a question back or an approval on the Board", () => {
    const kinds = boardObjects(turns).flatMap((object) =>
      object.blocks.map((block) => block.kind),
    );
    expect(kinds).not.toContain("CLARIFICATION_REQUEST");
    expect(kinds).not.toContain("ACTION_PROPOSAL");
  });

  it("puts pinned objects first and drops dismissed ones", () => {
    const objects = boardObjects(turns);
    const companies = objects.find((object) => object.kind === "COMPANIES");
    const deck = objects.find((object) => object.kind === "ARTIFACT");
    if (companies === undefined || deck === undefined) throw new Error();
    const arranged = arrangeBoard(objects, [companies.key], [deck.key]);
    expect(arranged[0]?.key).toBe(companies.key);
    expect(arranged.some((object) => object.key === deck.key)).toBe(false);
    expect(arranged).toHaveLength(objects.length - 1);
  });
});

describe("open questions", () => {
  it("are the latest answer's questions until the person replies", () => {
    const open = openQuestions(turns.slice(0, 2));
    expect(open.map((question) => question.question)).toEqual(["Which stage?"]);
    expect(openQuestions([...turns.slice(0, 2), person("p3", "Seed")])).toEqual(
      [],
    );
  });
});
