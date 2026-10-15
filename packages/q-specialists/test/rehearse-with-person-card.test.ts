import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";
import type { QConversationMessage } from "@capital-q/q-runtime";

import { rehearseWithPersonCard } from "../src/references.js";

const PERSON = "5b0f6d8e-4f6e-5a3b-8c1d-2e3f4a5b6c7d";

const message = (
  role: "USER" | "Q",
  content: string,
  blocks: QResultBlock[] = [],
): QConversationMessage =>
  ({
    id: randomUUID(),
    tenantId: randomUUID(),
    conversationId: randomUUID(),
    runId: randomUUID(),
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
    blocks,
  }) as unknown as QConversationMessage;

const card = (name: string, external?: Record<string, unknown>) => ({
  key: external === undefined ? "other" : PERSON,
  name,
  line: null,
  about: null,
  hue: 1,
  fit: null,
  reasons: ["Strong match on public sources"],
  measures: [],
  view: null,
  said: null,
  sourceCount: 2,
  subject: null,
  ...(external === undefined ? {} : { external }),
});

const block = (...cards: ReturnType<typeof card>[]): QResultBlock =>
  ({
    kind: "ANSWER_CARDS",
    shape: "RESEARCH",
    title: "Who I found",
    cards,
    followUps: [],
  }) as unknown as QResultBlock;

const personCard = card("Shadi Qishta", {
  externalPersonId: PERSON,
  profileUrl: "https://example.org/shadi",
  rehearse: true,
});
const after = [
  message("USER", "find Shadi Qishta in Doha"),
  message("Q", "Found him.", [block(personCard)]),
];

describe("I want to rehearse with him (right after a person card)", () => {
  it.each([
    "I want to rehearse with him",
    "I want to rehearse an investment pitch with him.",
    "Let's rehearse with them",
    "can we practise a pitch with her?",
    "I'd like to rehearse with this person",
    "rehearse with Shadi",
    "I want to rehearse with Shadi Qishta",
  ])("%s -> the card's person", (said) => {
    expect(rehearseWithPersonCard(said, after)).toEqual({
      externalPersonId: PERSON,
      name: "Shadi Qishta",
    });
  });

  it("binds only to the newest answer: not once the conversation has moved on", () => {
    const moved = [
      ...after,
      message("USER", "thanks"),
      message("Q", "You're welcome."),
    ];
    expect(
      rehearseWithPersonCard("I want to rehearse with him", moved),
    ).toBeNull();
  });

  it("does not guess between cards, or bind a different name, or a card with no rehearsal", () => {
    const two = [
      message("Q", "Two.", [
        block(
          personCard,
          card("Other Person", {
            externalPersonId: randomUUID(),
            profileUrl: null,
            rehearse: true,
          }),
        ),
      ]),
    ];
    expect(
      rehearseWithPersonCard("I want to rehearse with him", two),
    ).toBeNull();
    expect(
      rehearseWithPersonCard("I want to rehearse with Priya", after),
    ).toBeNull();
    const noRehearse = [
      message("Q", "Found.", [
        block(
          card("Shadi Qishta", {
            externalPersonId: PERSON,
            profileUrl: null,
            rehearse: false,
          }),
        ),
      ]),
    ];
    expect(
      rehearseWithPersonCard("I want to rehearse with him", noRehearse),
    ).toBeNull();
    // An ordinary company card carries no external record.
    const company = [message("Q", "Here.", [block(card("Nixo"))])];
    expect(
      rehearseWithPersonCard("I want to rehearse with them", company),
    ).toBeNull();
  });

  it("ignores other sentences and refusals", () => {
    expect(rehearseWithPersonCard("tell me more about him", after)).toBeNull();
    expect(
      rehearseWithPersonCard("I don't want to rehearse with him", after),
    ).toBeNull();
    expect(rehearseWithPersonCard("", after)).toBeNull();
  });
});
