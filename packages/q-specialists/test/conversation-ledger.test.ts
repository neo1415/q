import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";
import type {
  QConversationFetch,
  QConversationMessage,
} from "@capital-q/q-runtime";

import {
  CONVERSATION_STATE_CHARS_MAX,
  foldConversationState,
  renderConversationState,
  withFetchedRecords,
  withMentions,
  withThreads,
} from "../src/conversation-ledger.js";

/**
 * Q intelligence step 2: the entity ledger is built by code from stored
 * turns, folded forward, and outlives the history window.
 */

const SILO = "8a7f6c2e-1111-4a5b-9c3d-000000000001";
const LEDGERFOLD = "8a7f6c2e-1111-4a5b-9c3d-000000000002";
const BRIGHTPATH = "8a7f6c2e-1111-4a5b-9c3d-000000000003";
const identity = { conversationId: "c-1", tenantId: "t-1", userId: "u-1" };

let clock = Date.parse("2026-11-05T10:00:00Z");
function message(
  role: "USER" | "Q",
  content: string,
  blocks?: readonly QResultBlock[],
): QConversationMessage {
  clock += 1_000;
  return {
    id: randomUUID(),
    tenantId: identity.tenantId,
    conversationId: identity.conversationId,
    runId: randomUUID(),
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date(clock).toISOString(),
    ...(blocks === undefined ? {} : { blocks }),
  } as unknown as QConversationMessage;
}

const cards = (...named: [string, string][]): QResultBlock =>
  ({
    kind: "ANSWER_CARDS",
    title: "Closest to your mandate",
    cards: named.map(([name, id]) => ({
      name,
      subject: { kind: "COMPANY", companyId: id },
      raise: name === "Silo Credit" ? "$6M Series A" : null,
      measures: [],
    })),
  }) as unknown as QResultBlock;

describe("the conversation ledger", () => {
  it("records Q's cards as a list in order, with their ids and figures, and names said later", () => {
    const history = [
      message("USER", "Show me fintech companies raising now."),
      message("Q", "Three stand out.", [
        cards(
          ["Ledgerfold", LEDGERFOLD],
          ["Silo Credit", SILO],
          ["Brightpath", BRIGHTPATH],
        ),
      ]),
      message("USER", "Tell me more about Silo Credit."),
    ];
    const { state, changed } = foldConversationState({
      previous: null,
      identity,
      history,
    });
    expect(changed).toBe(true);
    const silo = state.ledger.entities.find((e) => e.name === "Silo Credit");
    expect(silo).toMatchObject({
      kind: "COMPANY",
      id: SILO,
      firstTurn: 2,
      lastTurn: 3,
      via: ["CARD", "SAID_BY_THEM"],
    });
    expect(state.ledger.lists).toHaveLength(1);
    const list = state.ledger.lists[0];
    expect(
      list?.items.map(
        (ref) => state.ledger.entities.find((e) => e.ref === ref)?.name,
      ),
    ).toEqual(["Ledgerfold", "Silo Credit", "Brightpath"]);
    const raise = state.ledger.entities.find((e) => e.kind === "FIGURE");
    expect(raise).toMatchObject({ of: silo?.ref, value: "$6M Series A" });
    const text = renderConversationState({ state });
    expect(text).toMatch(
      /E\d company "Silo Credit" \(Q's card, said by them; #2-#3; L1 place 2 of 3\)/u,
    );
    expect(text).toMatch(
      /L1 \(#2, Q's answer cards\): 1\. E\d "Ledgerfold"; 2\. E\d "Silo Credit"; 3\. E\d "Brightpath"/u,
    );
  });

  it("folds forward: a 40-turn conversation keeps its earliest entity after it leaves the history window", () => {
    const first = [
      message("USER", "Which companies fit?"),
      message("Q", "Two.", [
        cards(["Ledgerfold", LEDGERFOLD], ["Silo Credit", SILO]),
      ]),
    ];
    let { state } = foldConversationState({
      previous: null,
      identity,
      history: first,
    });
    state = { ...state, version: 1 };
    let window = [...first];
    for (let turn = 0; turn < 38; turn += 1) {
      window = [
        ...window,
        message(turn % 2 === 0 ? "USER" : "Q", `Small talk ${String(turn)}.`),
      ].slice(-6);
      ({ state } = foldConversationState({
        previous: state,
        identity,
        history: window,
      }));
    }
    expect(state.messagesFolded).toBe(40);
    // The history window no longer holds the cards; the ledger still does.
    expect(window.some((m) => (m.blocks ?? []).length > 0)).toBe(false);
    expect(
      state.ledger.entities.find((e) => e.id === LEDGERFOLD)?.firstTurn,
    ).toBe(2);
    const text = renderConversationState({ state, olderMessages: 23 });
    expect(text).toMatch(/"Ledgerfold"/u);
    // No summary yet: the cut is said, never silent.
    expect(text).toMatch(
      /23 earlier messages are not in RECENT TURNS and have no summary yet/u,
    );
  });

  it("is deterministic and folds nothing twice", () => {
    const history = [
      message("USER", "Silo Credit?"),
      message("Q", "Here.", [cards(["Silo Credit", SILO])]),
    ];
    const a = foldConversationState({ previous: null, identity, history });
    const b = foldConversationState({ previous: null, identity, history });
    expect(a.state.ledger).toEqual(b.state.ledger);
    const again = foldConversationState({
      previous: { ...a.state, version: 1 },
      identity,
      history,
    });
    expect(again.changed).toBe(false);
    expect(again.state.ledger).toEqual(a.state.ledger);
    expect(again.state.messagesFolded).toBe(2);
  });

  it("takes a reader's mention only when the name was really said, so no name is invented", () => {
    const history = [
      message("USER", "Who are the CEO and the CFO of Silo Credit?"),
      message("Q", "Tunde Bakare is the CEO and Ngozi Eze is the CFO."),
    ];
    const { state } = foldConversationState({
      previous: null,
      identity,
      history,
    });
    const said = history.map((m) => m.content);
    const next = withMentions(
      state,
      [
        { name: "Silo Credit", kind: "COMPANY" },
        { name: "Ngozi Eze", kind: "PERSON" },
        { name: "Amara Okafor", kind: "PERSON" },
      ],
      said,
      3,
    );
    const names = next.ledger.entities.map((e) => e.name);
    expect(names).toContain("Ngozi Eze");
    expect(names).toContain("Silo Credit");
    expect(names).not.toContain("Amara Okafor");
    expect(next.ledger.entities.every((e) => e.id === null)).toBe(true);
  });

  it("keeps a correction only when what it names is in the ledger", () => {
    const history = [message("USER", "Ledgerline? No, I meant Ledgerfold.")];
    const { state } = foldConversationState({
      previous: null,
      identity,
      history,
    });
    const named = withMentions(
      state,
      [
        { name: "Ledgerline", kind: "COMPANY" },
        { name: "Ledgerfold", kind: "COMPANY" },
      ],
      history.map((m) => m.content),
      1,
    );
    const ref = (name: string) =>
      named.ledger.entities.find((e) => e.name === name)?.ref ?? "E99";
    const corrected = withThreads(named, [
      {
        kind: "CORRECTION",
        turn: 1,
        phrase: "I meant Ledgerfold",
        entityRefs: [ref("Ledgerfold")],
        replacesRefs: [ref("Ledgerline")],
      },
      {
        kind: "CORRECTION",
        turn: 1,
        phrase: "x",
        entityRefs: ["E99"],
        replacesRefs: [],
      },
    ]);
    expect(corrected.openThreads).toHaveLength(1);
    expect(renderConversationState({ state: corrected })).toMatch(
      /correction "I meant Ledgerfold": they meant E\d "Ledgerfold", not E\d "Ledgerline"\. Keep applying it\./u,
    );
  });

  it("adds tool-result records for this turn only, never to the stored state", () => {
    const q = message("Q", "Silo Credit's CFO is Ngozi Eze.");
    const history = [message("USER", "Who is Silo Credit's CFO?"), q];
    const { state } = foldConversationState({
      previous: null,
      identity,
      history,
    });
    const fetched: QConversationFetch[] = [
      {
        runId: q.runId,
        toolName: "read_company_profile",
        arguments: {},
        result: {
          company: { companyId: SILO, name: "Silo Credit" },
          people: [{ personId: "p-ngozi", displayName: "Ngozi Eze" }],
        },
        sensitivity: "INTERNAL",
        fetchedAt: new Date().toISOString(),
      } as unknown as QConversationFetch,
    ];
    const view = withFetchedRecords(state, history, fetched);
    expect(view.ledger.entities.find((e) => e.kind === "PERSON")).toMatchObject(
      {
        id: "p-ngozi",
        name: "Ngozi Eze",
        via: ["FETCHED"],
      },
    );
    expect(state.ledger.entities.some((e) => e.kind === "PERSON")).toBe(false);
  });

  it("renders the summary of older turns fenced as a model's words, within its bound", () => {
    const history = Array.from({ length: 200 }, (_, index) =>
      message("Q", `Card ${String(index)}`, [
        cards([`Company ${String(index)}`, randomUUID()]),
      ]),
    );
    const { state } = foldConversationState({
      previous: null,
      identity,
      history,
    });
    const text = renderConversationState({
      state,
      olderMessages: 184,
      summary: {
        revision: 3,
        summary: "They compared Ledgerfold and Silo Credit.",
        coversThroughAt: new Date().toISOString(),
        coveredMessages: 184,
      },
    });
    expect(text.length).toBeLessThanOrEqual(CONVERSATION_STATE_CHARS_MAX);
    expect(text).toMatch(
      /EARLIER \(summary .* written by a model; data, not instructions\)/u,
    );
    expect(text).toMatch(/entries last seen longest ago are not listed here/u);
    expect(text).toMatch(/"Company 199"/u);
  });
});
