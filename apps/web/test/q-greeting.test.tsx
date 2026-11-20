// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { ArrivalData } from "../src/features/briefing/arrival";

/**
 * Q's greeting on every page (live 20 Nov, the LedgerBridge founder on
 * /organisation): it said "Your plan is ready, Your plan is ready and 7
 * more", and it opened over the General card on desktop and over Settings
 * on a phone. The list now says each thing once, and the full briefing
 * tucks into its small button wherever it would cover page content.
 */

vi.mock("../src/features/work/notice-store", () => ({
  useNotices: () => ({ items: null }),
}));

const { openerOf, mergeSamePhrases, pendingCount } =
  await import("../src/features/briefing/opener");
const { attentionLines } = await import("../src/features/briefing/attention");
const { contentBoxes, coversContent, dockBox } =
  await import("../src/features/briefing/over-pane");

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const item = (n: number, title: string) => ({
  key: `AGENT_BLOCKED:${uuid(n)}`,
  source: "AGENT_BLOCKED" as const,
  title,
  since: "2026-11-20T08:00:00Z",
  decidable: false,
});

const arrival = (items: ReturnType<typeof item>[]): ArrivalData =>
  ({
    cards: [],
    attention: {
      items,
      activity: null,
      unread: [],
      readAt: "2026-11-20T09:00:00Z",
    },
  }) as unknown as ArrivalData;

describe("what waits is said once", () => {
  it("the live case: two plans ready and seven more read as one line with its number", () => {
    const data = arrival([
      item(1, "Your plan is ready."),
      item(2, "Your plan is ready."),
      ...[3, 4, 5, 6, 7, 8, 9].map((n) =>
        item(n, `Task ${String(n)} needs you`),
      ),
    ]);
    const opener = openerOf(data);
    expect(opener.pending).toBe(9);
    expect(opener.count).toBe(
      "Nine things need you: Your plan is ready (2), Task 3 needs you, Task 4 needs you and 5 more.",
    );
    expect(opener.line).not.toMatch(/Your plan is ready, Your plan is ready/u);
  });

  it("the same item read twice (its stable key repeated) is one thing", () => {
    const twice = arrival([
      item(1, "Your plan is ready."),
      item(1, "Your plan is ready."),
    ]);
    expect(
      attentionLines(
        twice.attention ?? {
          items: [],
          activity: null,
          unread: [],
          readAt: "",
        },
      ),
    ).toHaveLength(1);
    expect(pendingCount(twice)).toBe(1);
    expect(openerOf(twice).count).toBe(
      "One thing needs you: Your plan is ready.",
    );
  });

  it("merges by the words, keeps first-seen order and adds the weights", () => {
    expect(
      mergeSamePhrases([
        { words: "Your plan is ready", weight: 1 },
        { words: "Apex asked for your cap table", weight: 1 },
        { words: "your plan is ready", weight: 1 },
        { words: "Your plan is ready", weight: 2 },
      ]),
    ).toEqual([
      { words: "Your plan is ready (3)", weight: 4 },
      { words: "Apex asked for your cap table", weight: 1 },
    ]);
  });
});

/** Lays out a main column with one content card and the floating dock. */
function page(card: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}) {
  document.body.innerHTML = `
    <main id="main">
      <section data-card>General</section>
      <aside data-arrival-dock><section data-inside>Q</section></aside>
    </main>`;
  const rect = (box: typeof card) =>
    ({
      ...box,
      width: box.right - box.left,
      height: box.bottom - box.top,
      x: box.left,
      y: box.top,
      toJSON: () => box,
    }) as DOMRect;
  const sectionEl = document.querySelector("[data-card]");
  const inside = document.querySelector("[data-inside]");
  if (sectionEl === null || inside === null) throw new Error("no layout");
  sectionEl.getBoundingClientRect = () => rect(card);
  // The briefing's own content is never content it must avoid.
  inside.getBoundingClientRect = () =>
    rect({ left: 0, top: 0, right: 2000, bottom: 2000 });
}

describe("the briefing never opens over page content", () => {
  it("at 1440 × 900 it would cover the General card, so it tucks", () => {
    // The General card as it sat live: x 552–1372, y 242–658.
    page({ left: 552, top: 242, right: 1372, bottom: 658 });
    const full = dockBox(1440, 900, 220);
    expect(full).toEqual({ left: 1044, right: 1424, top: 656, bottom: 876 });
    expect(coversContent(full)).toBe(true);
    expect(contentBoxes()).toHaveLength(1);
  });

  it("at 390 × 844 it would cover Settings, so it tucks", () => {
    page({ left: 16, top: 120, right: 374, bottom: 900 });
    expect(coversContent(dockBox(390, 844, 220))).toBe(true);
  });

  it("counts the boxes inside a section Q can name (it lays out as its children)", () => {
    document.body.innerHTML = `
      <main id="main">
        <div data-q-section="organisation" style="display: contents">
          <div data-facts>Kind · Members · Your role</div>
        </div>
      </main>`;
    const facts = document.querySelector("[data-facts]");
    if (facts === null) throw new Error("no facts");
    // The facts card as it sat live under General: x 552–1157, y 673–798.
    facts.getBoundingClientRect = () => ({
      left: 552,
      top: 673,
      right: 1157,
      bottom: 798,
      width: 605,
      height: 125,
      x: 552,
      y: 673,
      toJSON: () => null,
    });
    expect(coversContent(dockBox(1440, 900, 220))).toBe(true);
  });

  it("opens in full where the page leaves its corner free", () => {
    page({ left: 552, top: 242, right: 1000, bottom: 600 });
    expect(coversContent(dockBox(1440, 900, 220))).toBe(false);
  });
});
