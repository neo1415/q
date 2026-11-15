// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Live founder re-check 2026-11-15 (64637e8c9), D1 and D5
 * (docs/ai-handoff/audits/2026-11-15-founder-onboarding-live.md). The deck's
 * findings and Q's line landed at 12:39:00Z; its four page-cited figure
 * cards were filed 22–24 s later. One read at the findings found none, so
 * no card was drawn, and a reload never brought them back.
 */

const approve = vi.fn((_id: string) => Promise.resolve({ ok: true as const }));
const reject = vi.fn((_id: string) => Promise.resolve({ ok: true as const }));
vi.mock("@/features/q/actions", () => ({
  approveQApprovalAction: (id: string) => approve(id),
  rejectQApprovalAction: (id: string) => reject(id),
}));

const { FIGURE_WATCH_DELAYS_MS, mergeFigureCards, watchDeckFigures } =
  await import("../src/features/onboarding-conversation/deck-figure-sync");
const {
  deckFigureCards,
  deckFiguresLaterLine,
  deckReadLine,
  uploadEventOf,
  uploadNote,
  withoutRepeatedUploads,
} = await import("../src/features/onboarding-conversation/upload-lines");
const { DeckFigureCards } =
  await import("../src/features/onboarding-conversation/deck-figure-cards");

afterEach(() => {
  cleanup();
  approve.mockClear();
  reject.mockClear();
});

const workspaceSource = () =>
  readFileSync(
    resolve(
      import.meta.dirname,
      "../src/features/onboarding-conversation/q-onboarding-workspace.tsx",
    ),
    "utf8",
  );

const FILE = "mangrove-tally-fictional-deck.pdf";
const SESSION_STARTED = Date.parse("2026-11-15T12:36:30.000Z");
const UPLOADED_AT = Date.parse("2026-11-15T12:38:10.000Z");

/** The run's four cards, filed 22–24 s after the findings. */
const FILED = [
  {
    approvalId: "ff370765",
    summary: `Keep your MRR of USD 42,000 for October 2026, from "${FILE}" (page 3)`,
    requestedAt: "2026-11-15T12:39:22.000Z",
  },
  {
    approvalId: "d488e294",
    summary: `Keep your paying customers of 1,850 for October 2026, from "${FILE}" (page 3)`,
    requestedAt: "2026-11-15T12:39:23.000Z",
  },
  {
    approvalId: "4b4454c8",
    summary: `Keep your gross margin of 61% for October 2026, from "${FILE}" (page 3)`,
    requestedAt: "2026-11-15T12:39:23.000Z",
  },
  {
    approvalId: "ae0f825d",
    summary: `Keep your monthly burn of USD 55,000 for October 2026, from "${FILE}" (page 3)`,
    requestedAt: "2026-11-15T12:39:24.000Z",
  },
];

const noWait = () => Promise.resolve();

describe("D1: figure cards filed after Q's read-back line", () => {
  it("the read at the findings is empty: the line claims no figures", () => {
    const line = deckReadLine(
      FILE,
      [{ label: "Stage", value: "Seed" }],
      deckFigureCards([], UPLOADED_AT),
    );
    expect(line).not.toMatch(/figure/u);
  });

  it("the watch keeps reading until the cards land, shows each, then stops once they settle", async () => {
    // Reads 1–3: nothing yet (the job is still reading). Read 4: two
    // cards. Read 5: all four. Reads 6–7: nothing new, so it stops.
    const reads = [[], [], [], FILED.slice(0, 2), FILED, FILED, FILED, FILED];
    let at = 0;
    const read = vi.fn(() => Promise.resolve(reads[at++] ?? FILED));
    const batches: string[][] = [];
    const found = await watchDeckFigures({
      since: UPLOADED_AT,
      read,
      sleep: noWait,
      onCards: (cards) => batches.push(cards.map((c) => c.approvalId)),
    });
    expect(batches).toEqual([
      ["ff370765", "d488e294"],
      ["4b4454c8", "ae0f825d"],
    ]);
    expect(found).toHaveLength(4);
    // Stopped two quiet reads after the last card, not at the cap.
    expect(read).toHaveBeenCalledTimes(7);
    expect(read.mock.calls.length).toBeLessThan(FIGURE_WATCH_DELAYS_MS.length);
  });

  it("Q's follow-up names each figure with its page and saves nothing", () => {
    const line = deckFiguresLaterLine(deckFigureCards(FILED, UPLOADED_AT));
    expect(line).toMatch(/^I also found these figures: /u);
    expect(line).toContain("MRR of USD 42,000 for October 2026");
    expect(line).toContain("monthly burn of USD 55,000");
    expect(line.match(/\(page 3\)/gu)).toHaveLength(4);
    expect(line).toMatch(/None of them is saved until you keep each one/u);
  });

  it("a watch that never finds a card stops at the cap and claims nothing", async () => {
    const read = vi.fn(() => Promise.resolve([]));
    const onCards = vi.fn();
    const found = await watchDeckFigures({
      since: UPLOADED_AT,
      read,
      sleep: noWait,
      onCards,
    });
    expect(found).toEqual([]);
    expect(onCards).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(FIGURE_WATCH_DELAYS_MS.length);
  });

  it("cards an earlier deck left do not settle the watch for this one", async () => {
    const earlier = deckFigureCards(
      [
        {
          approvalId: "old",
          summary: `Keep your MRR of USD 30,000 for August 2026, from "old.pdf" (page 2)`,
          requestedAt: "2026-11-15T12:37:00.000Z",
        },
      ],
      SESSION_STARTED,
    );
    const reads = [[], [], [], [], FILED];
    let at = 0;
    const found = await watchDeckFigures({
      since: UPLOADED_AT,
      known: earlier,
      read: () => Promise.resolve(reads[at++] ?? FILED),
      sleep: noWait,
      onCards: () => undefined,
    });
    expect(found).toHaveLength(4);
  });

  it("a failed read is a read that found nothing, never an error", async () => {
    let at = 0;
    const found = await watchDeckFigures({
      since: UPLOADED_AT,
      read: () =>
        at++ === 0
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(FILED),
      sleep: noWait,
      onCards: () => undefined,
    });
    expect(found).toHaveLength(4);
  });

  it("the page going away stops the watch", async () => {
    const read = vi.fn(() => Promise.resolve([]));
    await watchDeckFigures({
      since: UPLOADED_AT,
      read,
      sleep: noWait,
      stopped: () => true,
      onCards: () => undefined,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("merging never shows a card twice", () => {
    const shown = deckFigureCards(FILED.slice(0, 2), UPLOADED_AT);
    const merged = mergeFigureCards(shown, deckFigureCards(FILED, UPLOADED_AT));
    expect(merged.map((c) => c.approvalId)).toEqual(
      FILED.map((c) => c.approvalId),
    );
    expect(mergeFigureCards(merged, shown)).toBe(merged);
  });
});

describe("D1: a reload restores the cards from server state", () => {
  it("the pending approvals since the session began are this onboarding's cards", () => {
    // After a reload the page has no upload time, only the session: every
    // pending page-cited figure card since it began is drawn again.
    const restored = deckFigureCards(
      [
        ...FILED,
        {
          approvalId: "reply",
          summary: "Reply to Tensorgate",
          requestedAt: "2026-11-15T12:40:00.000Z",
        },
        {
          approvalId: "before",
          summary: `Keep your MRR of USD 20,000 for May 2026, from "older.pdf" (page 1)`,
          requestedAt: "2026-11-14T09:00:00.000Z",
        },
      ],
      SESSION_STARTED,
    );
    expect(restored.map((c) => c.approvalId)).toEqual(
      FILED.map((c) => c.approvalId),
    );
  });

  it("the workspace reads them when it opens, keyed by the session, not only after an upload", () => {
    const source = workspaceSource();
    expect(source).toMatch(
      /figuresOpenedFor\.current = session\.id;[\s\S]{0,200}Date\.parse\(session\.startedAt\)/u,
    );
    expect(source).toMatch(
      /readPendingFigures\(\)\.then\([\s\S]{0,200}deckFigureCards\(pending \?\? \[\], since\)/u,
    );
    // After the findings, the cards are watched, not read once.
    expect(source).toMatch(/void watchFiguresAfter\(/u);
  });

  it("restored cards render with Keep and Not this, acting through the approval actions", async () => {
    render(<DeckFigureCards cards={deckFigureCards(FILED, SESSION_STARTED)} />);
    expect(document.querySelectorAll("[data-deck-figure]").length).toBe(4);
    const firstKeep = screen.getAllByRole("button", { name: "Keep" }).at(0);
    const lastDrop = screen.getAllByRole("button", { name: "Not this" }).at(3);
    if (firstKeep === undefined || lastDrop === undefined) {
      throw new Error("the cards were not drawn");
    }
    fireEvent.click(firstKeep);
    fireEvent.click(lastDrop);
    expect(approve).toHaveBeenCalledWith("ff370765");
    expect(reject).toHaveBeenCalledWith("ae0f825d");
    expect(await screen.findByText("Kept")).toBeTruthy();
  });

  it("while the figures are still being read, it says so; it never claims there are none", () => {
    const { rerender } = render(<DeckFigureCards cards={[]} reading />);
    expect(screen.getByRole("status").textContent).toBe(
      "Still reading figures…",
    );
    rerender(<DeckFigureCards cards={[]} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toMatch(/no figures/iu);
  });
});

describe("D5: the upload is in the thread, live and after a reload", () => {
  it("the line kept when the file lands is an upload event", () => {
    expect(uploadEventOf(uploadNote("SHARED", FILE))).toBe(FILE);
  });

  it("their own words about sharing stay theirs", () => {
    expect(uploadEventOf("I've shared the deck with my cofounder.")).toBeNull();
  });

  it("one 'You shared' per file, whatever Q is handed after it", () => {
    const thread = [
      { id: "1", uploaded: FILE },
      { id: "2" },
      { id: "3", uploaded: FILE },
      { id: "4", uploaded: "other.pdf" },
    ];
    expect(withoutRepeatedUploads(thread).map((t) => t.id)).toEqual([
      "1",
      "2",
      "4",
    ]);
  });

  it("the workspace keeps the event in the server thread when the file lands", () => {
    const source = workspaceSource();
    expect(source).toMatch(
      /uploadNoteFor\("SHARED", file\.name\);\s*push\("PERSON", shared\);[\s\S]{0,200}onboardingThreadKeepLinesAction\(sessionId, \[\s*\{ role: "PERSON", text: shared \},?\s*\]\)/u,
    );
  });
});
