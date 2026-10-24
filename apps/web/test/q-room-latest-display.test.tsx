// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  QAnswerCardsBlock,
  QShowInQRoomIntent,
} from "@capital-q/contracts";

import { demoTop } from "../src/features/q/answer-canvas-fixtures";
import type { QTurn } from "../src/features/q/conversation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QPresenceStage } = await import("../src/features/q/q-presence-stage");
const { roomStage } = await import("../src/features/q/room/room-stage");
const { shownItems, stageNoteOf, stageOf } =
  await import("../src/features/q/shown");
const { clearResultShelf } = await import("../src/features/q/result-shelf");
const store = await import("../src/features/q/cards/card-visibility-store");
const { loadWire } = await import("../src/features/q/wire");

beforeAll(async () => {
  await loadWire();
});

afterEach(() => {
  cleanup();
  clearResultShelf();
  store.resetCards();
  window.sessionStorage.clear();
});

/**
 * Owner report 2026-10-17 (release AT, conversation 971c5a53): on Home
 * "sometimes it still brings up saved companies, other times nothing at
 * all" while Q's answers carried the right ANSWER_CARDS. The turns below
 * are that conversation's exact block sequence and the person's own words.
 * Rule: the most recent display in the conversation wins; saved companies
 * show only when the person asks for their saved list in that turn.
 */

const person = (id: string, text: string): QTurn => ({
  kind: "PERSON",
  id,
  text,
  unconfirmed: false,
});

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

const NAMES = ["Halyard Security", "Clearwater Assurance", "Tensorgate"];
const base = demoTop(3);
const FIT: QAnswerCardsBlock = {
  ...base,
  title: "Fit against your mandate",
  cards: base.cards.map((card, index) => ({
    ...card,
    name: NAMES[index] ?? card.name,
  })),
};
const SAVED: QShowInQRoomIntent = {
  kind: "SHOW_IN_Q_ROOM",
  object: "SAVED_COMPARISON",
  id: "9c73b384-876c-45a9-a564-d498d1a3fe22",
  title: "Your saved companies, side by side",
};
const RECORD = {
  kind: "UI_INTENT",
  intent: {
    kind: "OPEN_RECORD_PAGE",
    page: "COMPANY",
    id: "1ab2cc02-160f-4812-a6b1-8be7e43afd3e",
  },
} as const;
const cards = [FIT];
const said =
  "Best fits on your mandate: Halyard Security at 10; then Clearwater Assurance and Tensorgate, level at 8.8.";

const MORNING: readonly QTurn[] = [
  person(
    "u1",
    "Can you show me like the top three in terms of investibility and suitability",
  ),
  answer("q1", `${said} I've put them on screen.`, cards),
  person("u2", "I can't see anything on my screen"),
  answer("q2", "Want me to show the shortlist again?", [
    { kind: "UI_INTENT", intent: { kind: "SCREEN_ACT", act: "NEXT_ITEM" } },
  ]),
  person("u3", "Yes, please. Show m-show me the cards again"),
  answer(
    "q3",
    "The shortlist is back on screen: Halyard Security first, followed by Clearwater Assurance and Tensorgate.",
    [{ kind: "UI_INTENT", intent: SAVED }],
  ),
  person("u4", "What I can see here is Ledgerfold and Ajopot. What's going on"),
  answer(
    "q4",
    "You're on Home, and Ledgerfold and Ajopot are your saved Discover companies, not the shortlist I just showed.",
  ),
  person(
    "u5",
    "No. I want- I want you to show me the top three um, stuff that fit my mandate right now",
  ),
  answer("q5", `So, the top three: ${said}`, cards),
  person("u6", "show me Halyard"),
  answer("q6", "Opening Halyard Security…", [RECORD]),
  person("u7", "Mm .Scroll- show me their, their data room"),
  answer("q7", "Halyard Security, good pick.", [RECORD]),
  person(
    "u8",
    "What-what was the second highest, what was the second highest for my among the top three",
  ),
  answer("q8", "Top of the list: Halyard Security at 10.", cards),
  person("u9", "Okay. Open that. Open that for me"),
  answer("q9", "Opening Clearwater Assurance…", [RECORD]),
];

const LATER: readonly QTurn[] = [
  ...MORNING,
  person(
    "u10",
    "Um, so I think there are some new companies that are, that will do well against my mandate. Can you list out three of them? And tell me which one you would um, recommend",
  ),
  answer("q10", `${said} Cards are up.`, cards),
  person(
    "u11",
    "Okay, so I think there are new companies that match against my mandates. Can you give me like um three of them and then, you know, recommend which one you would you would go for",
  ),
  answer("q11", `Here are the same three companies, ranked. ${said}`, cards),
];

const upTo = (id: string, turns: readonly QTurn[] = LATER) =>
  turns.slice(0, turns.findIndex((turn) => turn.id === id) + 1);

describe("the most recent display wins (owner, 2026-10-17)", () => {
  it("a new answer's cards replace the saved comparison in the room", () => {
    // FAILED BEFORE: "stuff that fit my mandate right now" read "that" as
    // pointing back at the open saved comparison, so it stayed open beside
    // (and below) the new cards.
    expect(roomStage(upTo("q5")).open).toBeNull();
    expect(stageOf(shownItems(upTo("q5")), upTo("q5")).item?.id).toBe("q5");
  });

  it("'new companies' is not a request for the saved list", () => {
    // FAILED BEFORE: the saved view's title words ("your", "companies")
    // reopened it on "some new companies … against my mandate".
    for (const id of ["u10", "q10", "u11", "q11"]) {
      expect(roomStage(upTo(id)).open).toBeNull();
    }
    expect(stageOf(shownItems(LATER), LATER).item?.id).toBe("q11");
  });

  it("'show me the cards again' does not open saved companies", () => {
    // The server answered it with SAVED_COMPARISON; the person did not ask
    // for their saved list, so the room does not show it.
    expect(roomStage(upTo("q3")).open).toBeNull();
  });

  it("saved companies show when the person asks for their saved list", () => {
    const turns = [
      ...MORNING,
      person("s1", "Show me my saved companies side by side"),
      answer("s2", "Here are your saved companies.", [
        { kind: "UI_INTENT", intent: SAVED },
      ]),
    ];
    expect(roomStage(turns).open?.intent).toEqual(SAVED);
    // And a newer answer's cards replace it again.
    const after = [
      ...turns,
      person("s3", "Now the top three for my mandate"),
      answer("s4", said, cards),
    ];
    expect(roomStage(after).open).toBeNull();
    expect(stageOf(shownItems(after), after).item?.id).toBe("s4");
  });

  it("a newer room view replaces older cards on the stage", () => {
    const turns = [
      person("a", "Top three for my mandate"),
      answer("b", said, cards),
      person("c", "Show me my saved companies"),
      answer("d", "Your saved companies, with Halyard Security first.", [
        { kind: "UI_INTENT", intent: SAVED },
      ]),
    ];
    expect(roomStage(turns).open?.intent).toEqual(SAVED);
    expect(stageOf(shownItems(turns), turns).item).toBeNull();
  });
});

describe("Home reopening the owner's conversation", () => {
  const loadRoomCard = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      view: {
        heading: "Your saved companies, side by side",
        lead: null,
        facts: [],
        items: [
          { id: "s-1", title: "Ledgerfold", meta: null },
          { id: "s-2", title: "Ajopot", meta: null },
        ],
        more: 0,
        href: "/discover",
        open: "Open saved",
      },
    }),
  );
  beforeAll(async () => {
    // The stage's lazy parts, in before the first render.
    await import("../src/features/q/room/q-room-card");
    await import("../src/features/q/stage-canvas");
  });
  afterEach(() => loadRoomCard.mockClear());

  function stage(turns: readonly QTurn[]) {
    return (
      <QPresenceStage
        presence={(compact) => (
          <div data-testid="aperture" data-compact={String(compact)} />
        )}
        turns={turns}
        captions={false}
        caption={null}
        loadRoomCard={loadRoomCard}
      />
    );
  }

  it("shows the latest answer's cards, in view, and no saved companies", async () => {
    const { container } = render(stage(LATER));
    await waitFor(
      () =>
        expect(container.querySelector('[data-q-canvas="q11"]')).not.toBeNull(),
      { timeout: 10_000 },
    );
    // Let the room settle too (its lazy part and its read).
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(container.textContent).toContain("Halyard Security");
    // FAILED BEFORE: the saved view was open under the cards.
    expect(container.querySelector("[data-q-room-card]")).toBeNull();
    expect(container.textContent).not.toContain("Ledgerfold");
    expect(loadRoomCard).not.toHaveBeenCalled();
  });

  it("a new answer's cards come on stage over an open room view", async () => {
    const before = [
      ...MORNING,
      person("s1", "Show me my saved companies"),
      answer("s2", "Here they are.", [{ kind: "UI_INTENT", intent: SAVED }]),
    ];
    const view = render(stage(before));
    await waitFor(() => expect(loadRoomCard).toHaveBeenCalled(), {
      timeout: 10_000,
    });
    const after = [
      ...before,
      person("s3", "And the top three that fit my mandate?"),
      answer("s4", said, cards),
    ];
    await waitFor(
      () => expect(view.container.textContent).toContain("Ledgerfold"),
      { timeout: 10_000 },
    );
    view.rerender(stage(after));
    await waitFor(
      () =>
        expect(
          view.container.querySelector('[data-q-canvas="s4"]'),
        ).not.toBeNull(),
      { timeout: 10_000 },
    );
    // The room view leaves (its exit may still be playing): never open.
    await waitFor(() =>
      expect(view.container.textContent).not.toContain("Ledgerfold"),
    );
  });
});

describe("the same display twice (owner, new voice chat, 2026-10-17)", () => {
  function stage(turns: readonly QTurn[]) {
    return (
      <QPresenceStage
        presence={(compact) => (
          <div data-testid="aperture" data-compact={String(compact)} />
        )}
        turns={turns}
        captions={false}
        caption={null}
        onBoardLanded={() => undefined}
      />
    );
  }
  const first: readonly QTurn[] = [
    person("v1", "Show me the top three for my mandate"),
    answer("v2", said, cards),
  ];
  const second: readonly QTurn[] = [
    ...first,
    person("v3", "Give me three of them and recommend one"),
    answer("v4", `Here are the same three companies, ranked. ${said}`, cards),
  ];
  const drawn = (container: HTMLElement, id: string) =>
    container.querySelectorAll(`[data-q-canvas="${id}"] [data-ac-card]`).length;

  afterEach(() => {
    document.querySelector('[data-q-control="board"]')?.remove();
  });

  it("a second 'Fit against your mandate' is drawn after the first was put away", async () => {
    const view = render(stage(first));
    await waitFor(() => expect(drawn(view.container, "v2")).toBe(3), {
      timeout: 10_000,
    });
    // "Clear the cards", then "hide Tensorgate", earlier in the tab.
    act(() => {
      store.applyCardsIntent({ kind: "CARDS", action: "HIDE_ALL" });
      store.applyCardsIntent({
        kind: "CARDS",
        action: "HIDE_ONE",
        name: "Tensorgate",
      });
    });
    view.rerender(stage(second));
    // FAILED BEFORE: the cards were keyed by title, so the new answer's
    // cards were the cleared ones: the stage drew nothing, and Q's
    // presence (hidden while cards are up) was gone too.
    await waitFor(() => expect(drawn(view.container, "v4")).toBe(3), {
      timeout: 10_000,
    });
    expect(view.container.textContent).toContain("Tensorgate");
  });

  it("the leaving set always ends, so the new set comes on stage", async () => {
    // A Board to fly to; this browser cannot animate (a failed flight).
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button data-q-control="board">Board</button>',
    );
    const view = render(stage(first));
    await waitFor(() => expect(drawn(view.container, "v2")).toBe(3), {
      timeout: 10_000,
    });
    view.rerender(stage(second));
    // FAILED BEFORE: the flight threw, the set never left, and neither the
    // new cards nor the presence were drawn again.
    await waitFor(() => expect(drawn(view.container, "v4")).toBe(3), {
      timeout: 10_000,
    });
    expect(view.container.querySelector("[data-q-canvas-leaving]")).toBeNull();
    // Nothing visible was replaced: no "Replaced X with X".
    expect(view.container.querySelector("[data-q-stage-note]")).toBeNull();
  });

  it("cards all put away leave Q's presence on the stage", async () => {
    const view = render(stage(first));
    await waitFor(() => expect(drawn(view.container, "v2")).toBe(3), {
      timeout: 10_000,
    });
    act(() => {
      store.applyCardsIntent({
        kind: "CARDS",
        action: "HIDE_CATEGORY",
        category: "ANSWER",
      });
    });
    await waitFor(() =>
      expect(view.container.querySelector("[data-q-canvas]")).toBeNull(),
    );
    expect(view.getByTestId("aperture").dataset.compact).toBe("false");
  });
});

describe("live check on AV (conversation eef33ec5, 2026-10-17)", () => {
  const RENAMED: QAnswerCardsBlock = {
    ...FIT,
    title: "Companies: fit against your mandate",
  };
  const second = FIT.cards[1];
  if (second === undefined) throw new Error("fixture");
  const ONE: QAnswerCardsBlock = { ...FIT, cards: [second] };
  const turns: readonly QTurn[] = [
    person("w1", "give me three new companies that fit my mandate"),
    answer("w2", said, [FIT]),
    person("w3", "and again, three that fit my mandate"),
    answer("w4", said, [RENAMED]),
    person("w5", "what was the second one?"),
    answer(
      "w6",
      "The second was Clearwater Assurance, at 8.8. Want the detail?",
      [ONE],
    ),
  ];
  const upToTurn = (id: string) =>
    turns.slice(0, turns.findIndex((turn) => turn.id === id) + 1);

  it("cards replacing cards puts no banner over the answer", () => {
    const now = upToTurn("w4");
    const items = shownItems(now);
    const pick = stageOf(items, now);
    expect(pick.item?.id).toBe("w4");
    // FAILED BEFORE: Replaced "Fit against your mandate" with "Companies: …".
    expect(stageNoteOf(items, now, pick, () => false)).toBeNull();
  });

  it("a follow-up about one card on screen keeps the set", () => {
    const items = shownItems(turns);
    const pick = stageOf(items, turns);
    // FAILED BEFORE: the three cards were replaced by the one card.
    expect(pick.item?.id).toBe("w4");
    expect(pick.why).toBe("KEPT");
    expect(stageNoteOf(items, turns, pick, () => false)).toBeNull();
    // A single card that is not on screen is a new display.
    const other: QAnswerCardsBlock = {
      ...FIT,
      cards: [{ ...second, key: "new-one", name: "Lantern Bio" }],
    };
    const fresh = [...upToTurn("w5"), answer("w6", "Lantern Bio.", [other])];
    expect(stageOf(shownItems(fresh), fresh).item?.id).toBe("w6");
  });

  it("a kept set is drawn whole, wide, under the latest exchange", async () => {
    const wide = vi.fn();
    const view = render(
      <QPresenceStage
        presence={() => <div data-testid="aperture" />}
        turns={turns}
        captions={false}
        caption={null}
        onCardsShowingChange={wide}
      />,
    );
    await waitFor(
      () =>
        expect(
          view.container.querySelectorAll('[data-q-canvas="w4"] [data-ac-card]')
            .length,
        ).toBe(3),
      { timeout: 10_000 },
    );
    // FAILED BEFORE: the page widened only for the latest answer's own
    // cards, and the line over them was the turn that first showed them.
    await waitFor(() => expect(wide).toHaveBeenLastCalledWith(true));
    expect(view.container.querySelector(".cq-ac-asked")?.textContent).toBe(
      "what was the second one?",
    );
  });
});

// QA QO-32 (2026-10-23): "Prep me for a call with Zino" named a company on
// the cards shown before; the cards stayed up under the prep's last
// sentence ("I'll play Zino Aviation") and the prep read as the next
// turn's answer.
describe("a written answer about a card on screen (QO-32)", () => {
  const first = FIT.cards[0];
  if (first === undefined) throw new Error("fixture");
  const prep = [
    "**Who they are**",
    `${first.name} is a seed fund.`,
    "",
    "**So far**",
    "This would be the first contact.",
    "",
    "**What they'll likely ask**",
    "1. Why now?",
    "2. Who pays?",
    "3. How big is it?",
    "",
    `Want to rehearse it? I'll play ${first.name}.`,
  ].join("\n");

  it("is its own display: the older cards leave the stage", () => {
    const turns: readonly QTurn[] = [
      person("p1", "which fit my mandate?"),
      answer("p2", said, [FIT]),
      person("p3", `Prep me for a call with ${first.name}`),
      answer("p4", prep, []),
    ];
    const pick = stageOf(shownItems(turns), turns);
    expect(pick).toEqual({ item: null, why: "NONE" });
  });

  it("a short answer about the same card still keeps the set", () => {
    const turns: readonly QTurn[] = [
      person("p1", "which fit my mandate?"),
      answer("p2", said, [FIT]),
      person("p3", `Why ${first.name}?`),
      answer("p4", `${first.name} fits on stage and sector.`, []),
    ];
    const pick = stageOf(shownItems(turns), turns);
    expect(pick.why).toBe("KEPT");
  });
});
