import { describe, expect, it } from "vitest";

import type { QConversationState, QLedgerEntity } from "@capital-q/q-runtime";

import { personAnchorOf } from "../src/conversation-ledger.js";

/**
 * Live 2026-11-06 (6c8d108cf): "What did the first one do before?" about
 * Ledgerfold's founder pulled a real namesake's career from the web. The
 * company a person is held against, from the ledger, is what public pages
 * about them must also name.
 */

const entity = (
  e: Partial<QLedgerEntity> & Pick<QLedgerEntity, "ref" | "kind" | "name">,
): QLedgerEntity => ({
  id: null,
  firstTurn: 2,
  lastTurn: 2,
  via: ["SAID_BY_Q"],
  of: null,
  value: null,
  ...e,
});

const stateOf = (entities: readonly QLedgerEntity[]): QConversationState => ({
  conversationId: "c",
  tenantId: "t",
  userId: "u",
  ledger: { entities: [...entities], lists: [] },
  openThreads: [],
  throughMessageAt: null,
  throughMessageId: null,
  messagesFolded: 2,
  builderVersion: "ledger-v1",
  version: 1,
});

const LEDGERFOLD = entity({
  ref: "E1",
  kind: "COMPANY",
  name: "Ledgerfold",
  id: "11111111-1111-4111-8111-111111111111",
  firstTurn: 1,
  via: ["SAID_BY_THEM", "FETCHED"],
});

describe("personAnchorOf: the company a person is held against", () => {
  it("is the record the person was read from (their ledger entry's company)", () => {
    const state = stateOf([
      LEDGERFOLD,
      entity({
        ref: "E2",
        kind: "PERSON",
        name: "Adaeze Nwachukwu",
        via: ["FETCHED"],
        of: "E1",
      }),
    ]);
    expect(personAnchorOf("Adaeze  Nwachukwu", state)).toBe("Ledgerfold");
  });

  it("is the one company in play when Q named the person with no record tie", () => {
    const state = stateOf([
      LEDGERFOLD,
      entity({ ref: "E2", kind: "PERSON", name: "Adaeze Nwachukwu" }),
    ]);
    expect(personAnchorOf("Adaeze Nwachukwu", state)).toBe("Ledgerfold");
  });

  it("is none for a person only they named, or with two companies in play", () => {
    const theirs = stateOf([
      LEDGERFOLD,
      entity({
        ref: "E2",
        kind: "PERSON",
        name: "Tony Elumelu",
        via: ["SAID_BY_THEM"],
      }),
    ]);
    expect(personAnchorOf("Tony Elumelu", theirs)).toBeNull();
    const two = stateOf([
      LEDGERFOLD,
      entity({ ref: "E3", kind: "COMPANY", name: "Silo Credit", firstTurn: 2 }),
      entity({ ref: "E2", kind: "PERSON", name: "Adaeze Nwachukwu" }),
    ]);
    expect(personAnchorOf("Adaeze Nwachukwu", two)).toBeNull();
    expect(personAnchorOf("Nobody Here", theirs)).toBeNull();
    expect(personAnchorOf("Adaeze Nwachukwu", null)).toBeNull();
  });
});
