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
const { QResultBlocks } = await import("../src/features/q/q-result-blocks");
const { clearResultShelf } = await import("../src/features/q/result-shelf");
const { clearSpotlightTaps } =
  await import("../src/features/q/spotlight-store");
const { announceQSaid } = await import("../src/features/q-swarm/q-said");
const { ordinalIn, spotlightOf } = await import("../src/features/q/spotlight");
await import("../src/features/q/stage-canvas");
await import("../src/features/q/answer-canvas");
const WAIT = { timeout: 10_000 } as const;

/**
 * The spotlight (founder, Dubai demo 2026-10-09): the company the
 * conversation is about is the one large card; the others shrink to a
 * strip, one tap away; it moves with the conversation; a new set starts
 * level; with no single subject all stay level. INC-1 still holds: one
 * set, every card still on screen.
 */

afterEach(() => {
  cleanup();
  clearResultShelf();
  clearSpotlightTaps();
  vi.unstubAllGlobals();
});

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function card(n: number): QAnswerCard {
  return {
    key: `c${String(n)}`,
    name: `Company ${String(n)} Holdings`,
    line: null,
    hue: ((n - 1) % 7) + 1,
    fit: { score: 9 - n * 0.5, measured: 4, of: 6 },
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

function answer(
  id: string,
  text: string,
  blocks: Extract<QTurn, { kind: "Q" }>["blocks"] = [],
): QTurn {
  return {
    kind: "Q",
    id,
    runId: `run-${id}`,
    text,
    streaming: false,
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

const FIRST: readonly QTurn[] = [
  person("p1", "Top three companies for my mandate"),
  answer("a1", "Three stand out.", [THREE]),
];

function stage(turns: readonly QTurn[], live = false) {
  return (
    <QPresenceStage
      presence={() => <span />}
      turns={turns}
      captions={false}
      caption={null}
      live={live}
    />
  );
}

function spot(): string | null {
  const cardsEl = document.querySelector("[data-q-canvas] [data-ac-cards]");
  return cardsEl?.getAttribute("data-layout") === "spotlight"
    ? cardsEl.getAttribute("data-spotlight")
    : null;
}
const allCards = () =>
  document.querySelectorAll("[data-q-canvas] [data-ac-card]").length;

describe("the spotlight on the stage", () => {
  it("starts level: no single subject, every card the same size", async () => {
    render(stage(FIRST));
    await waitFor(() => expect(allCards()).toBe(3), WAIT);
    expect(spot()).toBeNull();
  });

  it("naming a company spotlights it; the others shrink to a strip, still there", async () => {
    render(
      stage([...FIRST, person("p2", "Tell me more about Company 2 Holdings")]),
    );
    await waitFor(() => expect(spot()).toBe("c2"), WAIT);
    expect(allCards()).toBe(3);
    expect(document.querySelectorAll("[data-ac-strip]")).toHaveLength(2);
    // Said in words, not colour alone.
    expect(
      document.querySelector("[data-ac-spot] [data-ac-spot-label]")
        ?.textContent,
    ).toBe("In focus");
  });

  it("'the second one' spotlights card 2", async () => {
    render(stage([...FIRST, person("p2", "What about the second one?")]));
    await waitFor(() => expect(spot()).toBe("c2"), WAIT);
  });

  it("moves when the conversation moves to another company (structured subject first)", async () => {
    const { rerender } = render(
      stage([...FIRST, person("p2", "What about the second one?")]),
    );
    await waitFor(() => expect(spot()).toBe("c2"), WAIT);
    // Q's answer is about card 3 by its subject reference alone.
    rerender(
      stage([
        ...FIRST,
        person("p2", "What about the second one?"),
        answer("a2", "Its team is the strongest of the three.", [
          { kind: "COMPANY_REFERENCE", companyId: uuid(3) },
        ]),
      ]),
    );
    await waitFor(() => expect(spot()).toBe("c3"), WAIT);
    expect(allCards()).toBe(3);
  });

  it("two companies at once put the cards back level", async () => {
    render(
      stage([
        ...FIRST,
        person("p2", "Compare Company 1 Holdings and Company 3 Holdings"),
      ]),
    );
    await waitFor(() => expect(allCards()).toBe(3), WAIT);
    expect(spot()).toBeNull();
  });

  it("a new card set resets the spotlight", async () => {
    const { rerender } = render(
      stage([...FIRST, person("p2", "Tell me about Company 1 Holdings")]),
    );
    await waitFor(() => expect(spot()).toBe("c1"), WAIT);
    rerender(
      stage([
        ...FIRST,
        person("p2", "Tell me about Company 1 Holdings"),
        answer("a3", "Here are four more.", [cards(11, 4, "Four more")]),
      ]),
    );
    await waitFor(
      () =>
        expect(
          document
            .querySelector("[data-q-canvas]")
            ?.getAttribute("data-q-canvas"),
        ).toBe("a3"),
      WAIT,
    );
    expect(spot()).toBeNull();
    expect(allCards()).toBe(4);
  });

  it("a tap spotlights a card; a tap on a small one moves it; the large one again levels them", async () => {
    render(stage(FIRST));
    await waitFor(() => expect(allCards()).toBe(3), WAIT);
    const headOf = (key: string) =>
      document.querySelector(
        `[data-ac-card="${key}"] .cq-ac-head-main`,
      ) as HTMLElement;
    await userEvent.click(headOf("c1"));
    await waitFor(() => expect(spot()).toBe("c1"), WAIT);
    await userEvent.click(
      screen.getByRole("button", { name: "Bring Company 3 Holdings forward" }),
    );
    await waitFor(() => expect(spot()).toBe("c3"), WAIT);
    await userEvent.click(headOf("c3"));
    await waitFor(() => expect(spot()).toBeNull(), WAIT);
  });

  it("on a live line, the card Q's own line names comes forward", async () => {
    render(stage(FIRST, true));
    await waitFor(() => expect(allCards()).toBe(3), WAIT);
    act(() => {
      announceQSaid("Company 2 Holdings has the strongest team.");
    });
    await waitFor(() => expect(spot()).toBe("c2"), WAIT);
  });

  it("with reduced motion the spotlight is a plain state change", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          onchange: null,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    render(
      stage([...FIRST, person("p2", "Tell me more about Company 2 Holdings")]),
    );
    await waitFor(() => expect(spot()).toBe("c2"), WAIT);
    expect(allCards()).toBe(3);
  });
});

describe("the same spotlight on the Board and in the dock", () => {
  it("a tap on the static cards spotlights there", async () => {
    render(<QResultBlocks blocks={[THREE]} />);
    await waitFor(
      () => expect(document.querySelectorAll("[data-ac-card]").length).toBe(3),
      WAIT,
    );
    await userEvent.click(
      document.querySelector(
        '[data-ac-card="c2"] .cq-ac-head-main',
      ) as HTMLElement,
    );
    await waitFor(
      () =>
        expect(
          document
            .querySelector("[data-ac-cards]")
            ?.getAttribute("data-spotlight"),
        ).toBe("c2"),
      WAIT,
    );
  });
});

describe("spotlight rules", () => {
  it("reads positions from the closed set only", () => {
    expect(ordinalIn("the second one", 3)).toBe(1);
    expect(ordinalIn("number 3 please", 3)).toBe(2);
    expect(ordinalIn("the last one", 3)).toBe(2);
    expect(ordinalIn("the fifth one", 3)).toBeNull();
    expect(ordinalIn("one more thing", 3)).toBeNull();
  });

  it("a later copy of the same run is not a new signal", () => {
    const turns: QTurn[] = [
      ...FIRST,
      person("p2", "Tell me about Company 2 Holdings"),
      {
        ...(answer("a1-copy", "Company 1 Holdings leads.", [THREE]) as Extract<
          QTurn,
          { kind: "Q" }
        >),
        runId: "run-a1",
      },
    ];
    expect(spotlightOf({ turns, answerId: "a1", cards: THREE.cards })).toBe(1);
  });
});
