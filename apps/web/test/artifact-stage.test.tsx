// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QArtifactIdSchema,
  QPageManifestSchema,
  type QResultBlock,
} from "@capital-q/contracts";

import { demoTop } from "../src/features/q/answer-canvas-fixtures";
import type { QTurn } from "../src/features/q/conversation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QPresenceStage, stageCardRef } =
  await import("../src/features/q/q-presence-stage");
const { shownItems, stageOf, stageNoteOf } =
  await import("../src/features/q/shown");
const { clearResultShelf, rememberResults } =
  await import("../src/features/q/result-shelf");
const store = await import("../src/features/q/cards/card-visibility-store");
const { currentManifest } = await import("../src/features/q/manifest");
const { clearRendered, renderedObject } =
  await import("../src/features/q/artifact-rendered");

/**
 * Lane A (2026-10-15): the owner's report that Q's artifacts "appear and
 * disappear willy-nilly" and "don't appear when they are needed or being
 * talked about", reproduced as tests. Each `FAILED BEFORE:` line is what
 * the code on build/int-rc 755d9b4f did.
 */

afterEach(() => {
  cleanup();
  clearResultShelf();
  store.resetCards();
  clearRendered();
  window.sessionStorage.clear();
});

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
  extra: Partial<Extract<QTurn, { kind: "Q" }>> = {},
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
    ...extra,
  };
}

const CARDS = [demoTop(3)];
const TABLE: Extract<QResultBlock, { kind: "TABLE" }> = {
  kind: "TABLE",
  title: "Side by side",
  columns: [
    { label: "Norrland Grid", subject: null },
    { label: "Kestrel Heat", subject: null },
  ],
  rows: [{ label: "Based in", cells: ["SE", "GB"] }],
};
const MAP: Extract<QResultBlock, { kind: "MAP" }> = {
  kind: "MAP",
  title: "Where they're based",
  basis: "Head-office country, as each company publishes it on Capital Q.",
  places: [
    { label: "Norrland Grid", countryCode: "SE", subject: null, note: null },
    { label: "Kestrel Heat", countryCode: "GB", subject: null, note: null },
  ],
};

const TOP3: readonly QTurn[] = [
  person("p1", "Show me my top three matches"),
  answer("a1", "Three stand out. They're on screen.", CARDS),
];

function stage(turns: readonly QTurn[]) {
  return (
    <QPresenceStage
      presence={(compact) => (
        <div data-testid="aperture" data-compact={String(compact)} />
      )}
      turns={turns}
      captions={false}
      caption={null}
    />
  );
}

const onStageNow = (turns: readonly QTurn[]) =>
  stageOf(shownItems(turns), turns).item?.id ?? null;

describe("an artifact stays while it is the subject (FAIL-1)", () => {
  it("keeps the cards for a follow-up that points back at them without a name", () => {
    // FAILED BEFORE: "them" named no card, so the cards left the stage.
    const turns = [
      ...TOP3,
      person("p2", "What should I ask them first?"),
      answer("a2", "Start with the evidence behind the revenue claim."),
    ];
    expect(onStageNow(turns)).toBe("a1");
  });

  it("keeps an object however many answers are about it", () => {
    // FAILED BEFORE: the third answer after it stepped it back, by count.
    let turns: QTurn[] = [...TOP3];
    for (let i = 0; i < 5; i++) {
      turns = [
        ...turns,
        person(`pk${String(i)}`, `And Kestrel Heat's point ${String(i)}?`),
        answer(`ak${String(i)}`, `Kestrel Heat, point ${String(i)}.`),
      ];
    }
    expect(onStageNow(turns)).toBe("a1");
  });

  it("brings the object back when the conversation comes back to it", () => {
    // FAILED BEFORE: once moved on, never back without a tap.
    const turns = [
      ...TOP3,
      person("p2", "What's on tomorrow?"),
      answer("a2", "Two meetings tomorrow."),
    ];
    expect(onStageNow(turns)).toBeNull();
    const back = [
      ...turns,
      person("p3", "Back to Norrland Grid: what's its revenue?"),
      answer("a3", "Norrland Grid reports £38k a month."),
    ];
    expect(onStageNow(back)).toBe("a1");
  });

  it("holds still while the next answer is still arriving", () => {
    const turns = [
      ...TOP3,
      person("p2", "What's on tomorrow?"),
      answer("a2", "Two meet", [], { streaming: true }),
    ];
    expect(onStageNow(turns)).toBe("a1");
  });
});

describe("QA F-105: a stale card leaves for unrelated answers", () => {
  it("'show me my Q Card' is not about the cards on the stage (F10)", () => {
    const turns = [
      ...TOP3,
      person("p2", "Show me my Q Card and the share link."),
      answer("a2", "You don't have a Q Card yet."),
    ];
    expect(onStageNow(turns)).toBeNull();
  });

  it("an answer that brings its own approval takes the stage (founder Q page)", () => {
    // FAILED BEFORE: "accept Norrland Grid's interest" named a card on the
    // set, so the set stayed "In focus" and the approval sat below it.
    const approval = {
      kind: "ACTION_PROPOSAL",
      proposal: { summary: "Accept Norrland Grid's interest" },
    } as unknown as Extract<QTurn, { kind: "Q" }>["blocks"][number];
    const turns = [
      ...TOP3,
      person("p2", "Reply to Norrland Grid: accept their interest."),
      answer("a2", "Norrland Grid's acceptance is ready."),
      // The run's second message: the approval itself.
      answer("a2b", "That's ready. It's waiting for your yes.", [approval], {
        runId: "run-a2",
      }),
    ];
    expect(onStageNow(turns)).toBeNull();
  });

  it("'it' in an unrelated question does not keep the cards", () => {
    // FAILED BEFORE: "how can I make it better?" pointed back at the cards.
    const turns = [
      ...TOP3,
      person(
        "p2",
        "How is my pitch video doing, and how can I make it better?",
      ),
      answer("a2", "Your opening is strong; lead with the litre price."),
    ];
    expect(onStageNow(turns)).toBeNull();
  });

  it("Q's own words naming a card that has left do not bring it back", () => {
    // FAILED BEFORE: an answer mentioning a company on an old set put the
    // whole set back over an unrelated turn.
    const turns = [
      ...TOP3,
      person("p2", "What's on tomorrow?"),
      answer("a2", "Two meetings tomorrow."),
      person("p3", "Who looked at my pitch?"),
      answer("a3", "Views aren't recorded; Norrland Grid expressed interest."),
    ];
    expect(onStageNow(turns)).toBeNull();
  });

  it("the person naming it still brings it back, and 'them' still keeps it", () => {
    const named = [
      ...TOP3,
      person("p2", "What's on tomorrow?"),
      answer("a2", "Two meetings tomorrow."),
      person("p3", "And Norrland Grid?"),
      answer("a3", "Norrland Grid reports £38k a month."),
    ];
    expect(onStageNow(named)).toBe("a1");
    const them = [
      ...TOP3,
      person("p2", "Which of them is raising?"),
      answer("a2", "Two of the three are raising."),
    ];
    expect(onStageNow(them)).toBe("a1");
  });
});

describe("an artifact shows when Q shows it (FAIL-2)", () => {
  it("puts a table on the stage, drawn, and reports it drawn", async () => {
    // FAILED BEFORE: TABLE, MAP, CHART and TIMELINE were not stage
    // objects, so "here's the table" drew nothing on the Q page.
    const turns = [
      person("p1", "Put them in a table"),
      answer("a1", "Here they are side by side.", [TABLE]),
    ];
    const { container } = render(stage(turns));
    // W7: the stage's object code loads when it is first needed.
    await waitFor(
      () => expect(container.querySelector("table")).not.toBeNull(),
      { timeout: 10_000 },
    );
    expect(container.querySelector('[data-q-shown="a1"]')).not.toBeNull();
    await waitFor(() =>
      expect(renderedObject()).toEqual({ run: "run-a1", kinds: ["TABLE"] }),
    );
    expect(
      container
        .querySelector("[data-q-artifact-rendered]")
        ?.getAttribute("data-q-artifact-kinds"),
    ).toBe("TABLE");
  });

  it("puts a map on the stage", () => {
    const turns = [
      person("p1", "Show me on a map"),
      answer("a1", "Here's where they're based.", [MAP]),
    ];
    expect(onStageNow(turns)).toBe("a1");
  });

  it("draws the rest of a set beside the cards, never drops it", async () => {
    // FAILED BEFORE: a set with cards drew only the cards.
    const turns = [
      person("p1", "Top two, and where they are"),
      answer("a1", "Two, and where they are.", [demoTop(2), MAP]),
    ];
    const { container } = render(stage(turns));
    await waitFor(
      () =>
        expect(
          container.querySelector('[data-q-canvas-rest="a1"]'),
        ).not.toBeNull(),
      { timeout: 10_000 },
    );
  });
});

describe("QA U2: a document on the stage is drawn once", () => {
  it("a lone document card has no second frame with its title", async () => {
    const turns = [
      person("p1", "Make me a one-page investor brief PDF."),
      answer("a1", "Here's the brief for Maji Loop.", [
        {
          kind: "ARTIFACT_REFERENCE",
          artifactId: QArtifactIdSchema.parse(
            "a0000000-0000-4000-8000-000000000002",
          ),
          type: "INVESTMENT_BRIEF",
          title: "Investment brief — Maji Loop",
          status: "READY",
        },
      ]),
    ];
    const { container } = render(stage(turns));
    await waitFor(
      () =>
        expect(container.querySelector('[data-q-shown="a1"]')).not.toBeNull(),
      { timeout: 10_000 },
    );
    const heading = container.querySelector('[data-q-shown="a1"] h2');
    // Named for screen readers; the card shows the title once.
    expect(heading?.className).toContain("sr-only");
    expect(
      container.querySelector('[data-q-shown="a1"] [data-q-shown-dismiss]'),
    ).not.toBeNull();
  });
});

describe("replaced explicitly, never silently (FAIL-3)", () => {
  it("says what it replaced, and what it put away", async () => {
    const replaced = [
      ...TOP3,
      person("p2", "Put Norrland and Kestrel in a table"),
      answer("a2", "Side by side.", [TABLE]),
    ];
    expect(onStageNow(replaced)).toBe("a2");
    const items = shownItems(replaced);
    const pick = stageOf(items, replaced);
    expect(stageNoteOf(items, replaced, pick, () => false)?.text).toBe(
      "Replaced “Top three for your mandate” with “Side by side”.",
    );

    const movedOn = [
      ...TOP3,
      person("p2", "What's on tomorrow?"),
      answer("a2", "Two meetings tomorrow."),
    ];
    const { container } = render(stage(movedOn));
    const note = container.querySelector('[data-q-stage-note="a2"]');
    expect(note?.textContent).toContain(
      "Put “Top three for your mandate” away as we moved on.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Show again" }));
    await waitFor(
      () =>
        expect(document.querySelector('[data-q-canvas="a1"]')).not.toBeNull(),
      { timeout: 10_000 },
    );
  });
});

describe("no stale artifact from another conversation (FAIL-4)", () => {
  it("carries the last set only until this conversation answers something else", () => {
    const other = shownItems(TOP3).map((item) => ({ ...item, answer: 0 }));
    // Nothing answered here yet: the last set shown stays (INC-1).
    expect(stageOf(other, []).item?.run).toBe("run-a1");
    // FAILED BEFORE: it stayed for three answers about anything at all.
    const here = [
      person("n1", "What's on tomorrow?"),
      answer("n2", "Two meetings tomorrow."),
    ];
    expect(stageOf(other, here).item).toBeNull();
  });
});

describe("presentation state has one controller (FAIL-5)", () => {
  it("keeps a dismissed object dismissed across a page change and a reload", async () => {
    // FAILED BEFORE: Dismiss was the stage's own useState, so leaving the
    // Q page and coming back brought the object back.
    const first = render(stage(TOP3));
    await waitFor(
      () =>
        expect(document.querySelector('[data-q-canvas="a1"]')).not.toBeNull(),
      { timeout: 10_000 },
    );
    first.unmount();
    const [item] = shownItems(TOP3);
    if (item === undefined) throw new Error("no item");
    act(() => store.hideKey(stageCardRef(item).key));
    // Back on the Q page: still put away.
    const again = render(stage(TOP3));
    expect(again.container.querySelector("[data-q-canvas]")).toBeNull();
    // A reload reads the same state back from the tab's storage.
    const raw = window.sessionStorage.getItem(store.CARDS_STORAGE_KEY);
    expect(raw).toContain("stage:run-a1");
    vi.resetModules();
    const fresh = await import("../src/features/q/cards/card-visibility-store");
    expect(fresh.isCardHidden(stageCardRef(item))).toBe(true);
  });

  it("clears and restores stage objects with the cards", async () => {
    // FAILED BEFORE: "Q, clear all cards" left the stage's object up.
    rememberResults([]);
    const { container } = render(stage(TOP3));
    await waitFor(
      () =>
        expect(container.querySelector('[data-q-canvas="a1"]')).not.toBeNull(),
      { timeout: 10_000 },
    );
    act(() => {
      store.applyCardsIntent({ kind: "CARDS", action: "HIDE_ALL" });
    });
    await waitFor(() =>
      expect(container.querySelector("[data-q-canvas]")).toBeNull(),
    );
    act(() => {
      store.applyCardsIntent({ kind: "CARDS", action: "RESTORE_ALL" });
    });
    await waitFor(() =>
      expect(container.querySelector('[data-q-canvas="a1"]')).not.toBeNull(),
    );
  });
});

describe("the browser confirms what it drew (slice 3)", () => {
  const RUN = "9b2f6c1e-3d4a-4c5b-8e6f-7a8b9c0d1e2f";
  it("reports the drawn object in the page manifest, and nothing once it leaves", async () => {
    const turns = [
      person("p1", "Show me on a map"),
      answer("a1", "Here's where they're based.", [MAP], { runId: RUN }),
    ];
    const view = render(stage(turns));
    await waitFor(
      () =>
        expect(currentManifest()?.drawn).toEqual({ run: RUN, kinds: ["MAP"] }),
      { timeout: 10_000 },
    );
    expect(QPageManifestSchema.safeParse(currentManifest()).success).toBe(true);
    view.unmount();
    expect(currentManifest()?.drawn).toBeUndefined();
    // The contract's kinds are closed.
    expect(
      QPageManifestSchema.safeParse({
        v: 2,
        seq: 1,
        inView: [],
        sections: [],
        dialogs: [],
        drawn: { run: RUN, kinds: ["TEXT"] },
      }).success,
    ).toBe(false);
  });
});
