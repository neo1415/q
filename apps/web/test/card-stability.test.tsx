// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QAnswerCard, QAnswerCardsBlock } from "@capital-q/contracts";

import type { QTurn } from "../src/features/q/conversation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QPresenceStage } = await import("../src/features/q/q-presence-stage");
const { clearResultShelf } = await import("../src/features/q/result-shelf");
// The canvas code loads lazily the first time cards come on the stage.
await import("../src/features/q/stage-canvas");
await import("../src/features/q/answer-canvas");
const WAIT = { timeout: 10_000 } as const;
const { announceQSaid } = await import("../src/features/q-swarm/q-said");

/**
 * INC-1 (live 2026-10-08 19:14–19:16, docs/recovery/evidence/
 * incident-2026-10-08-top-three.md): a top-three answer's 3 cards showed,
 * a follow-up's 10 cards took over, then the cards were gone after an
 * attention answer and a voice reconnect that replayed the arrival.
 *
 * A result set belongs to one run and renders as that set only; it stays
 * while Q speaks or thinks; a newer answer moves it to "Shown recently"
 * (and the Board), one tap away, never deleted.
 */

afterEach(() => {
  cleanup();
  clearResultShelf();
});

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function card(n: number): QAnswerCard {
  return {
    key: `c${String(n)}`,
    name: `Company ${String(n)} Holdings`,
    line: null,
    hue: ((n - 1) % 7) + 1,
    fit: null,
    reasons: [`Reason for ${String(n)}`],
    measures: [],
    view: null,
    said: null,
    sourceCount: 0,
    subject: { kind: "COMPANY", companyId: uuid(n) },
  };
}

function cards(from: number, count: number, title: string): QAnswerCardsBlock {
  return {
    kind: "ANSWER_CARDS",
    shape: "RANKED",
    title,
    cards: Array.from({ length: count }, (_, i) => card(from + i)),
    followUps: [],
  };
}

const THREE = cards(1, 3, "Top three for your mandate");
const TEN = cards(11, 10, "Ranked, with pros and cons");

function answer(
  id: string,
  runId: string,
  text: string,
  blocks: Extract<QTurn, { kind: "Q" }>["blocks"] = [],
  streaming = false,
): QTurn {
  return {
    kind: "Q",
    id,
    runId,
    text,
    streaming,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  };
}
const person = (id: string, text: string): QTurn => ({
  kind: "PERSON",
  id,
  text,
  unconfirmed: false,
});

function stage(turns: readonly QTurn[]) {
  return (
    <QPresenceStage
      presence={(compact) => <span data-presence={String(compact)} />}
      turns={turns}
      captions={false}
      caption={null}
      live
    />
  );
}

/** The cards on the stage, by answer: never two sets in one group. */
function onStageCards(): {
  readonly answer: string | null;
  readonly n: number;
} {
  const canvases = document.querySelectorAll("[data-q-canvas]");
  expect(canvases.length).toBeLessThanOrEqual(1);
  const canvas = canvases[0];
  return {
    answer: canvas?.getAttribute("data-q-canvas") ?? null,
    n: canvas?.querySelectorAll("[data-ac-card]").length ?? 0,
  };
}

const FIRST: readonly QTurn[] = [
  person("p1", "Top three companies for my mandate"),
  answer(
    "a1",
    "run-1",
    "Three stand out: Company 1, Company 2 and Company 3.",
    [THREE],
  ),
];

describe("INC-1: one run, one set, kept while Q speaks", () => {
  it("keeps the 3 cards through narration, a thinking turn and stage lines", async () => {
    const { rerender } = render(stage(FIRST));
    await waitFor(
      () => expect(onStageCards()).toEqual({ answer: "a1", n: 3 }),
      WAIT,
    );
    // Bridge narration and Q's own lines, three times over (as live).
    act(() => {
      announceQSaid("Let me put that up.");
      announceQSaid("Let me put that up.");
      announceQSaid("Give me a moment.");
    });
    // Q thinks on the next question: a streaming turn.
    rerender(
      stage([
        ...FIRST,
        person("p2", "Rank them with pros and cons"),
        answer("a2", "run-2", "", [], true),
      ]),
    );
    expect(onStageCards()).toEqual({ answer: "a1", n: 3 });
  });

  it("a late duplicate of the same run never duplicates or merges cards", async () => {
    const { rerender } = render(stage(FIRST));
    await waitFor(() => expect(onStageCards().n).toBe(3), WAIT);
    // The same run's message again (room feed, then read-back), and a
    // turn carrying a second card block.
    rerender(
      stage([
        ...FIRST,
        answer("a1-again", "run-1", "Three stand out.", [THREE]),
        answer("a1-late", "run-1", "Three stand out.", [THREE, TEN]),
      ]),
    );
    expect(onStageCards()).toEqual({ answer: "a1", n: 3 });
    // Still one set in "Shown recently", not three.
    await userEvent.click(
      screen.getByRole("button", { name: /Shown recently/u }),
    );
    expect(
      screen.getAllByRole("button", { name: "Top three for your mandate" }),
    ).toHaveLength(1);
  });

  it("a newer turn's 10 cards replace, never merge into, the 3; the 3 stay one tap away", async () => {
    const { rerender } = render(stage(FIRST));
    await waitFor(() => expect(onStageCards().n).toBe(3), WAIT);
    rerender(
      stage([
        ...FIRST,
        person("p2", "Rank them with pros and cons"),
        answer("a2", "run-2", "Here are ten, ranked.", [TEN]),
      ]),
    );
    // Never 13 at once: the stage holds one set.
    await waitFor(
      () => expect(onStageCards()).toEqual({ answer: "a2", n: 10 }),
      WAIT,
    );
    expect(document.querySelectorAll("[data-ac-card]").length).toBe(10);
    await userEvent.click(
      screen.getByRole("button", { name: /Shown recently/u }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Top three for your mandate" }),
    );
    await waitFor(
      () => expect(onStageCards()).toEqual({ answer: "a1", n: 3 }),
      WAIT,
    );
  });

  it("after a findings-only answer the 3 are reachable in one tap", async () => {
    const { rerender } = render(stage(FIRST));
    await waitFor(() => expect(onStageCards().n).toBe(3), WAIT);
    rerender(
      stage([
        ...FIRST,
        person("p3", "Find anything that needs my attention"),
        answer("a3", "run-3", "Two things need you: a reply and a document.", [
          { kind: "COMPANY_REFERENCE", companyId: uuid(90) },
        ]),
      ]),
    );
    await waitFor(() => expect(onStageCards().answer).toBeNull(), WAIT);
    await userEvent.click(
      screen.getByRole("button", { name: /Shown recently/u }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Top three for your mandate" }),
    );
    await waitFor(
      () => expect(onStageCards()).toEqual({ answer: "a1", n: 3 }),
      WAIT,
    );
  });

  it("survives a voice reconnect that opens another conversation and replays the arrival", async () => {
    const { rerender } = render(stage(FIRST));
    await waitFor(() => expect(onStageCards().n).toBe(3), WAIT);
    // The reconnect: the page is now on another conversation whose only
    // turn is the replayed greeting.
    rerender(
      stage([answer("g1", "run-9", "Good evening, Zino. Good to see you.")]),
    );
    expect(onStageCards()).toEqual({ answer: "a1", n: 3 });
    await userEvent.click(
      screen.getByRole("button", { name: /Shown recently/u }),
    );
    expect(
      screen.getByRole("button", { name: "Top three for your mandate" }),
    ).toBeTruthy();
  });
});
