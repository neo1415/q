import { beforeAll, describe, expect, it } from "vitest";

import {
  createQStreamState,
  reduceQStream,
  type QStreamState,
} from "@capital-q/api-client";
import {
  Q_PUBLIC_FAILURE_MESSAGES,
  Q_VISIBLE_STAGE_LABELS,
  type QStreamEvent,
} from "@capital-q/contracts";

import {
  failureMessage,
  turnsFrom,
  workingLabel,
} from "../src/features/q/conversation";
import { loadWire } from "../src/features/q/wire";

// W7: the wire's contracts load after the first paint in the browser;
// here they are in before any test reads Q's data.
beforeAll(async () => {
  await loadWire();
});

/**
 * What a person sees while Q answers (CQ-C5-R1 §14, §17-§19).
 *
 * The projection is driven here by the real stream reducer over real
 * stream events, so what is under test is the same path a browser takes —
 * only the socket is missing.
 *
 * The properties that matter are the ones a chat UI usually gets wrong:
 * the turn you just typed must not appear twice when the server confirms
 * it, streamed text must be replaced by the persisted message rather than
 * sitting beside it, and nothing may be shown that the server did not say.
 */

const RUN = "f0000000-0000-4000-8000-000000000001";
const USER_MESSAGE = "f0000000-0000-4000-8000-000000000003";
const Q_MESSAGE = "f0000000-0000-4000-8000-000000000004";
const NOW = "2026-09-08T09:00:00.000Z";

let sequence = 0;
function durable(type: string, data: Record<string, unknown>): QStreamEvent {
  sequence += 1;
  return {
    type,
    runId: RUN,
    sequence,
    occurredAt: NOW,
    data,
  } as unknown as QStreamEvent;
}

function delta(messageId: string, text: string): QStreamEvent {
  return {
    type: "q.message.delta",
    runId: RUN,
    occurredAt: NOW,
    data: { messageId, text },
  } as unknown as QStreamEvent;
}

function apply(
  events: readonly QStreamEvent[],
  from: QStreamState = createQStreamState(),
): QStreamState {
  return events.reduce(reduceQStream, from);
}

const userTurn = durable("q.message.completed", {
  message: {
    messageId: USER_MESSAGE,
    runId: RUN,
    role: "USER",
    text: "Analyse Northstar.",
    createdAt: NOW,
  },
});

const qTurn = durable("q.message.completed", {
  message: {
    messageId: Q_MESSAGE,
    runId: RUN,
    role: "Q",
    text: "Northstar sells B2B infrastructure software.",
    createdAt: NOW,
  },
});

describe("C5R1-W01 · the turns a person reads are the server's", () => {
  it("shows what was just typed before the server confirms it", () => {
    const turns = turnsFrom(createQStreamState(), [
      { id: "local-1", text: "Analyse Northstar.", at: NOW },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      kind: "PERSON",
      text: "Analyse Northstar.",
      unconfirmed: true,
    });
  });

  it("replaces the placeholder with the confirmed turn rather than showing both", () => {
    const state = apply([userTurn]);
    const turns = turnsFrom(state, [
      { id: "local-1", text: "Analyse Northstar.", at: NOW },
    ]);
    // The single most visible way a chat UI lies: the same sentence twice.
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ unconfirmed: false, id: USER_MESSAGE });
  });

  it("keeps a repeated question as a placeholder when only an older identical turn exists", () => {
    // The person asks the same thing again, minutes later. The earlier turn
    // is history, not confirmation of the one just typed.
    const earlier = apply([
      durable("q.message.completed", {
        message: {
          messageId: "msg_user_earlier",
          runId: RUN,
          role: "USER",
          text: "Analyse Northstar.",
          createdAt: "2026-09-12T09:00:00.000Z",
        },
      }),
    ]);
    const turns = turnsFrom(earlier, [
      {
        id: "local-2",
        text: "Analyse Northstar.",
        at: "2026-09-12T10:00:00.000Z",
      },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ kind: "PERSON", unconfirmed: true });
  });

  it("streams Q's answer, then lets the persisted message replace it", () => {
    const streaming = apply([
      userTurn,
      delta(Q_MESSAGE, "Northstar sells "),
      delta(Q_MESSAGE, "B2B infrastructure software."),
    ]);
    const live = turnsFrom(streaming, []);
    expect(live).toHaveLength(2);
    expect(live[1]).toMatchObject({
      kind: "Q",
      streaming: true,
      text: "Northstar sells B2B infrastructure software.",
    });

    const settled = apply([qTurn], streaming);
    const final = turnsFrom(settled, []);
    // One Q turn, not a persisted one beside its own draft.
    expect(final.filter((turn) => turn.kind === "Q")).toHaveLength(1);
    expect(final[1]).toMatchObject({ kind: "Q", streaming: false });
  });

  it("shows nothing at all before anything has been said", () => {
    expect(turnsFrom(createQStreamState(), [])).toHaveLength(0);
  });

  it("keeps the question above the answer even when the answer is confirmed first", () => {
    // Seen in the browser: the run persists Q's message as a durable event
    // while the person's own turn is still an unconfirmed placeholder. Both
    // carry a time, so the reply cannot float above the question.
    const answered = apply([qTurn]);
    const turns = turnsFrom(answered, [
      {
        id: "local-1",
        text: "Analyse Northstar.",
        at: "2026-09-08T08:59:59.000Z",
      },
    ]);
    expect(turns.map((turn) => turn.kind)).toEqual(["PERSON", "Q"]);
  });
});

describe("C5R1-W02 · working states and failures are the server's words", () => {
  it("says nothing about a stage the server did not report", () => {
    expect(workingLabel(createQStreamState())).toBeUndefined();
  });

  it("renders a reported stage through the contract's own plain label", () => {
    const state = apply([
      durable("q.stage.changed", { stage: "CHECKING_EVIDENCE" }),
    ]);
    expect(workingLabel(state)).toBe(
      Q_VISIBLE_STAGE_LABELS["CHECKING_EVIDENCE"],
    );
    // No enum, no node name, no provider, no prompt version (§17).
    expect(workingLabel(state)).not.toMatch(
      /CHECKING_EVIDENCE|LangGraph|Qwen|RRF|specialist|prompt/i,
    );
  });

  it("uses the public failure projection's own sentence", () => {
    const message = Q_PUBLIC_FAILURE_MESSAGES["Q_UNAVAILABLE"];
    expect(failureMessage({ message })).toBe(message);
  });

  it("falls back to one plain sentence when nothing was received", () => {
    const fallback = failureMessage(null);
    expect(fallback).toBe("I couldn't answer that right now. Try again.");
    // Nothing technical reaches a person (§19).
    expect(fallback).not.toMatch(/\d{3}|http|sql|queue|provider|stack/i);
  });
});

describe("C5R1-W03 · a conversation outlives its runs", () => {
  it("keeps earlier turns when a later run's state is folded in", () => {
    // What the hook does between runs: a finished run's messages become
    // history, and the next run starts the reducer clean.
    const first = apply([userTurn, qTurn]);
    const second = apply([
      durable("q.message.completed", {
        message: {
          messageId: "f0000000-0000-4000-8000-000000000005",
          runId: RUN,
          role: "USER",
          text: "What worries you most?",
          createdAt: NOW,
        },
      }),
    ]);
    const merged: QStreamState = {
      ...second,
      messages: [...first.messages, ...second.messages],
    };
    const turns = turnsFrom(merged, []);
    expect(turns.map((turn) => turn.kind)).toEqual(["PERSON", "Q", "PERSON"]);
    expect(turns[2]).toMatchObject({ text: "What worries you most?" });
  });

  it("carries public web sources beside the answer, not in it (R23, R38)", () => {
    const withSource = apply([
      durable("q.message.completed", {
        message: {
          messageId: Q_MESSAGE,
          runId: RUN,
          role: "Q",
          text: "Public sources say Northstar opened a Kenya hub.",
          blocks: [
            {
              kind: "PUBLIC_SOURCE",
              url: "https://news.example.com/2026/09/northstar",
              domain: "news.example.com",
              title: "Northstar expands to Kenya",
              publishedOn: "2026-09-02",
              retrievedOn: "2026-09-27",
            },
          ],
          createdAt: NOW,
        },
      }),
    ]);
    const [turn] = turnsFrom(withSource, []);
    expect(turn).toMatchObject({
      kind: "Q",
      text: "Public sources say Northstar opened a Kenya hub.",
      publicSources: [
        {
          url: "https://news.example.com/2026/09/northstar",
          domain: "news.example.com",
          title: "Northstar expands to Kenya",
          publishedOn: "2026-09-02",
          retrievedOn: "2026-09-27",
        },
      ],
      blocks: [],
    });
  });

  it("reports how many sources an answer cites, and never their identifiers", () => {
    const withEvidence = apply([
      durable("q.message.completed", {
        message: {
          messageId: Q_MESSAGE,
          runId: RUN,
          role: "Q",
          text: "Annual recurring revenue is recorded at USD 2.4m.",
          blocks: [
            {
              kind: "EVIDENCE",
              evidenceRefs: [
                {
                  kind: "DOCUMENT",
                  documentId: "a0000000-0000-4000-8000-00000000000b",
                  page: 6,
                },
              ],
            },
          ],
          createdAt: NOW,
        },
      }),
    ]);
    const turns = turnsFrom(withEvidence, []);
    expect(turns[0]).toMatchObject({ kind: "Q", sourceCount: 1 });
    // The projection carries a count. The document id stays on the server
    // side of the seam, because nothing yet resolves one into something a
    // person may safely be shown (§18).
    expect(JSON.stringify(turns)).not.toContain(
      "a0000000-0000-4000-8000-00000000000b",
    );
  });
});

describe("PRESENCE: an answer's gestures reach the turn", () => {
  it("carries the closed-set gestures from the completion event, and none when absent", () => {
    const state = apply([
      durable("q.message.completed", {
        message: {
          messageId: "msg_q_gestures",
          runId: RUN,
          role: "Q",
          text: "Revenue doubled. Well done.",
          gestures: [
            { sentence: 0, gesture: "CHART_UP" },
            { sentence: 1, gesture: "CLAP" },
          ],
          createdAt: "2026-09-12T09:00:01.000Z",
        },
      }),
    ]);
    const turn = turnsFrom(state, []).find((item) => item.kind === "Q");
    expect(turn?.kind === "Q" ? turn.gestures : null).toEqual([
      { sentence: 0, gesture: "CHART_UP" },
      { sentence: 1, gesture: "CLAP" },
    ]);
  });
});

describe("progressive findings · shown as each validates, settled without moving", () => {
  const COMPANY = "f0000000-0000-4000-8000-0000000000c1";
  function finding(n: number, statement: string) {
    return {
      findingId: `f0000000-0000-4000-8000-00000000f00${String(n)}`,
      type: "FACT",
      statement,
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
      confidence: "MODERATE",
      evidenceRefs: [],
      subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    };
  }
  const found = (n: number, statement: string) =>
    durable("q.finding.available", { finding: finding(n, statement) });
  const statements = (state: QStreamState) => {
    const last = turnsFrom(state, []).at(-1);
    return last?.kind === "Q" ? last.findings.map((f) => f.statement) : [];
  };

  it("adds each finding to the live answer as it arrives, in arrival order", () => {
    let state = apply([userTurn, delta(Q_MESSAGE, "Northstar")]);
    expect(statements(state)).toEqual([]);
    state = apply([found(1, "Revenue is recurring.")], state);
    expect(statements(state)).toEqual(["Revenue is recurring."]);
    state = apply([found(2, "Two customers make up most of it.")], state);
    expect(statements(state)).toEqual([
      "Revenue is recurring.",
      "Two customers make up most of it.",
    ]);
    const last = turnsFrom(state, []).at(-1);
    expect(last).toMatchObject({ kind: "Q", streaming: true });
  });

  it("keeps the live order when the completed message lists them differently, and only removes or merges", () => {
    const live = apply([
      userTurn,
      delta(Q_MESSAGE, "Northstar"),
      found(1, "Revenue is recurring."),
      found(2, "Two customers make up most of it."),
      found(3, "Dropped after checking."),
    ]);
    const settled = apply(
      [
        durable("q.message.completed", {
          message: {
            messageId: Q_MESSAGE,
            runId: RUN,
            role: "Q",
            text: "Northstar sells B2B infrastructure software.",
            createdAt: NOW,
            blocks: [
              // The message's own order, a reworded copy, a duplicate
              // statement under another id, and one only it has.
              { kind: "FINDING", finding: finding(4, "Churn is unknown.") },
              {
                kind: "FINDING",
                finding: finding(2, "Two customers make up most of revenue."),
              },
              {
                kind: "FINDING",
                finding: finding(1, "Revenue is recurring."),
              },
              {
                kind: "FINDING",
                finding: finding(5, "  revenue is   RECURRING. "),
              },
            ],
          },
        }),
      ],
      live,
    );
    expect(statements(settled)).toEqual([
      "Revenue is recurring.",
      "Two customers make up most of revenue.",
      "Churn is unknown.",
    ]);
    expect(turnsFrom(settled, []).at(-1)).toMatchObject({ streaming: false });
  });

  it("an answer from another run is not given this run's findings", () => {
    const state = apply([userTurn, qTurn, found(1, "Revenue is recurring.")]);
    const other = { ...state, runId: "f0000000-0000-4000-8000-0000000000ff" };
    const last = turnsFrom(other, []).at(-1);
    expect(last?.kind === "Q" ? last.findings : null).toEqual([]);
  });
});
