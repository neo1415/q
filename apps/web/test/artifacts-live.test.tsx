// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QMessageIdSchema, type QArtifactPreview } from "@capital-q/contracts";

import { demoTop } from "../src/features/q/answer-canvas-fixtures";
import type { QTurn } from "../src/features/q/conversation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/discover",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QPresenceStage } = await import("../src/features/q/q-presence-stage");
const { livePreviewOf, shownItems, stageOf } =
  await import("../src/features/q/shown");
const { LivePreview } = await import("../src/features/q/live-preview");
const { EntityAvatar, entityImageSources, companyLogoPath, companyPhotoPath } =
  await import("../src/features/entity/entity-avatar");
const { clearResultShelf } = await import("../src/features/q/result-shelf");
const store = await import("../src/features/q/cards/card-visibility-store");
const { AnswerChipFor } = await import("../src/features/q/answer-chip");
const { turnsFrom } = await import("../src/features/q/conversation");
const { createQStreamState, reduceQStream } =
  await import("@capital-q/api-client");

/**
 * Artifacts live (owner 2026-10-20): as Q talks, the card for what it is
 * saying comes up at that moment, with a real picture or initials (never
 * a broken image or a blank), and is filled when the answer lands. The
 * Board's and the chip's show/hide is the one controller's.
 */

afterEach(() => {
  cleanup();
  clearResultShelf();
  store.resetCards();
  window.sessionStorage.clear();
});

const BARIDI = "a0000000-0000-4000-8000-00000000000a";
const MEDTRAIL = "b0000000-0000-4000-8000-00000000000b";
const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const MSG = "123e4567-e89b-12d3-a456-426614174000";

const preview = (
  layout: QArtifactPreview["layout"],
  ...names: readonly (readonly [string, string])[]
): QArtifactPreview => ({
  messageId: QMessageIdSchema.parse(MSG),
  subjects: names.map(([companyId, name]) => ({
    subject: { kind: "COMPANY", companyId },
    name,
  })),
  layout,
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
    blocks: [],
    ...extra,
  };
}

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

describe("the card comes up with the sentence that names it", () => {
  it("puts the named subject's card frame on the stage while Q is still talking", () => {
    const turns = [
      person("p1", "Tell me about Baridi"),
      answer(MSG, "Baridi Health is a clinic network.", {
        streaming: true,
        preview: preview("CARD", [BARIDI, "Baridi Health"]),
      }),
    ];
    const { container } = render(stage(turns));
    const frame = container.querySelector(`[data-q-preview="${MSG}"]`);
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Baridi Health")).toBeTruthy();
    // The presence steps aside to compact, as for any object shown.
    expect(screen.getByTestId("aperture").dataset.compact).toBe("true");
  });

  it("lays a comparison out as a table frame, one column per company, in the order named", () => {
    const { container } = render(
      <LivePreview
        preview={preview(
          "TABLE",
          [MEDTRAIL, "MedTrail"],
          [BARIDI, "Baridi Health"],
        )}
      />,
    );
    const columns = [
      ...container.querySelectorAll("[data-q-preview-column]"),
    ].map((one) => one.getAttribute("data-q-preview-column"));
    expect(columns).toEqual([MEDTRAIL, BARIDI]);
  });

  it("goes when the answer settles: the answer's own blocks decide", () => {
    const turns = [
      person("p1", "Top three?"),
      answer(MSG, "Three stand out.", {
        streaming: false,
        preview: preview("CARD", [BARIDI, "Baridi Health"]),
        blocks: [demoTop(3)],
      }),
    ];
    expect(livePreviewOf(turns, null)).toBeNull();
    expect(stageOf(shownItems(turns), turns).item?.id).toBe(MSG);
  });

  it("keeps the set on screen when Q is naming a card already in it", () => {
    const top = demoTop(3);
    const turns = [
      person("p1", "Top three?"),
      answer("a1", "Three stand out.", { blocks: [top] }),
      person("p2", "Tell me about the second one"),
      answer(MSG, "Kestrel Heat ...", {
        streaming: true,
        preview: preview("CARD", [MEDTRAIL, top.cards[1]?.name ?? ""]),
      }),
    ];
    const shown = stageOf(shownItems(turns), turns).item;
    expect(shown).not.toBeNull();
    expect(livePreviewOf(turns, shown)).toBeNull();
  });

  it("carries the stream's preview onto the live turn, and drops it with the persisted message", () => {
    const event = (type: string, data: unknown, sequence: number) =>
      ({
        contractVersion: 1,
        eventId: `0000000${String(sequence)}-0000-4000-8000-000000000000`,
        runId: RUN,
        sequence,
        occurredAt: "2026-10-20T10:00:00.000Z",
        type,
        data,
      }) as never;
    let state = createQStreamState();
    state = reduceQStream(
      state,
      event("q.run.started", { capability: "ANSWER", status: "RUNNING" }, 1),
    );
    state = reduceQStream(
      state,
      event(
        "q.artifact.preview",
        preview("CARD", [BARIDI, "Baridi Health"]),
        1,
      ),
    );
    state = reduceQStream(
      state,
      event("q.message.delta", { messageId: MSG, text: "Baridi leads. " }, 1),
    );
    const live = turnsFrom(state, []).at(-1);
    expect(live?.kind === "Q" ? live.preview?.subjects[0]?.name : null).toBe(
      "Baridi Health",
    );
  });

  it("on a voice line, puts up what Q is naming aloud until the answer is in the thread (L-16)", () => {
    const spoken = preview("CARD", [BARIDI, "Baridi Health"]);
    const asked = [person("p1", "Which one fits?")];
    // The spoken answer does not stream into the thread: the room's
    // preview is what is up.
    expect(livePreviewOf(asked, null, spoken)?.subjects[0]?.name).toBe(
      "Baridi Health",
    );
    // A typed answer streaming now wins.
    const typed = preview("CARD", [MEDTRAIL, "MedTrail"]);
    expect(
      livePreviewOf(
        [
          ...asked,
          answer("t1", "MedTrail...", { streaming: true, preview: typed }),
        ],
        null,
        spoken,
      )?.subjects[0]?.name,
    ).toBe("MedTrail");
    // The answer landed: its own blocks decide.
    const landed = [
      ...asked,
      answer(MSG, "Baridi Health fits.", { blocks: [demoTop(3)] }),
    ];
    expect(livePreviewOf(landed, null, spoken)).toBeNull();
  });
});

describe("cards shown for a turn stay through its answer (owner 2026-10-23)", () => {
  const event = (type: string, data: unknown, sequence: number) =>
    ({
      contractVersion: 1,
      eventId: `0000000${String(sequence)}-0000-4000-8000-000000000000`,
      runId: RUN,
      sequence,
      occurredAt: "2026-10-23T08:00:00.000Z",
      type,
      data,
    }) as never;

  it("an answer that lands with no cards of its own keeps what it put up", () => {
    const shownWhileTalking = preview("CARD", [BARIDI, "Baridi Health"]);
    const turns = [
      person("p1", "Search for Baridi Health"),
      answer(MSG, "Here is what is public on Baridi Health.", {
        streaming: false,
        preview: shownWhileTalking,
        blocks: [],
      }),
    ];
    expect(livePreviewOf(turns, null)?.subjects[0]?.name).toBe("Baridi Health");
    // The next question moves on: nothing of the last turn is held up.
    expect(
      livePreviewOf([...turns, person("p2", "And MedTrail?")], null),
    ).toBeNull();
  });

  it("the stream keeps the preview with its message as it lands and as the run ends", () => {
    let state = createQStreamState();
    state = reduceQStream(
      state,
      event("q.run.started", { capability: "ANSWER", status: "RUNNING" }, 1),
    );
    state = reduceQStream(
      state,
      event(
        "q.artifact.preview",
        preview("CARD", [BARIDI, "Baridi Health"]),
        2,
      ),
    );
    state = reduceQStream(
      state,
      event("q.message.delta", { messageId: MSG, text: "Baridi leads. " }, 3),
    );
    state = reduceQStream(
      state,
      event(
        "q.message.completed",
        {
          message: {
            messageId: MSG,
            runId: RUN,
            role: "Q",
            text: "Baridi leads.",
            contentType: "TEXT",
            createdAt: "2026-10-23T08:00:01.000Z",
            blocks: [],
          },
        },
        4,
      ),
    );
    state = reduceQStream(
      state,
      event(
        "q.run.completed",
        { status: "COMPLETED", completedAt: "2026-10-23T08:00:02.000Z" },
        5,
      ),
    );
    const turns = turnsFrom(state, []);
    const landed = turns.at(-1);
    expect(landed?.kind === "Q" ? landed.streaming : null).toBe(false);
    expect(livePreviewOf(turns, null)?.subjects[0]?.name).toBe("Baridi Health");
  });

  it("on a voice line, the spoken preview stays once its answer is in the thread with no cards", () => {
    const spoken = preview("CARD", [BARIDI, "Baridi Health"]);
    const landed = [
      person("p1", "Search for Baridi Health"),
      answer(MSG, "Here is what is public.", { streaming: false, blocks: [] }),
    ];
    expect(livePreviewOf(landed, null, spoken)?.subjects[0]?.name).toBe(
      "Baridi Health",
    );
  });
});

describe("pictures: a real logo or photo, else initials, never broken or blank", () => {
  it("tries the photo, then the website's logo, for a company in Q's artifacts", () => {
    expect(
      entityImageSources({
        kind: "company",
        companyId: BARIDI,
        siteLogo: true,
      }),
    ).toEqual([companyPhotoPath(BARIDI), companyLogoPath(BARIDI)]);
    // Elsewhere nothing changes: the photo alone.
    expect(entityImageSources({ kind: "company", companyId: BARIDI })).toEqual([
      companyPhotoPath(BARIDI),
    ]);
  });

  it("falls through a failed photo to the logo, and a failed logo to initials", () => {
    const { container } = render(
      <EntityAvatar
        kind="company"
        name="Baridi Health"
        companyId={BARIDI}
        fallback="initials"
        siteLogo
      />,
    );
    const avatar = () =>
      container.querySelector("[data-entity-avatar]") as HTMLElement;
    const img = () => avatar().querySelector("img");
    // Initials are drawn underneath from the first frame: never blank.
    expect(avatar().textContent).toContain("BH");
    expect(img()?.getAttribute("src")).toBe(companyPhotoPath(BARIDI));
    act(() => {
      fireEvent.error(img() as HTMLImageElement);
    });
    expect(img()?.getAttribute("src")).toBe(companyLogoPath(BARIDI));
    act(() => {
      fireEvent.load(img() as HTMLImageElement);
    });
    expect(avatar().dataset.entityAvatarState).toBe("logo");
    act(() => {
      fireEvent.error(img() as HTMLImageElement);
    });
    // Out of pictures: no <img> left to break, the initials stay.
    expect(img()).toBeNull();
    expect(avatar().dataset.entityAvatarState).toBe("fallback");
    expect(avatar().textContent).toContain("BH");
  });

  it("keeps the plain company mark by default (founder 2026-10-02)", () => {
    const { container } = render(
      <EntityAvatar kind="company" name="Baridi Health" src={null} />,
    );
    expect(container.textContent).not.toContain("BH");
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("one presentation controller (audit 2026-10-15 §4)", () => {
  it("keeps the Board's pins and removals with the other show/hide state, across a reload", () => {
    store.setBoardMarks("conv-1", { pinned: ["a1"], dismissed: ["a2"] });
    const saved = window.sessionStorage.getItem(store.CARDS_STORAGE_KEY);
    expect(saved).toContain("conv-1");
    expect(store.boardMarksOf(store.cardsState(), "conv-1")).toEqual({
      pinned: ["a1"],
      dismissed: ["a2"],
    });
    expect(store.boardMarksOf(store.cardsState(), "other")).toBe(
      store.EMPTY_BOARD_MARKS,
    );
  });

  it("puts a dismissed chip away for every page, not just this one", () => {
    const turns = [
      person("p1", "Top three?"),
      answer("a1", "Three stand out.", { blocks: [demoTop(3)] }),
    ];
    const chip = (path: string, shownTurns: readonly QTurn[]) => (
      <AnswerChipFor
        pathname={path}
        turns={shownTurns}
        loading={false}
        conversationId="conv-1"
      />
    );
    // The answer lands while the person is on Discover.
    const { container, rerender } = render(chip("/discover", []));
    rerender(chip("/discover", turns));
    const dismiss = container.querySelector(".chip-x");
    expect(dismiss).not.toBeNull();
    fireEvent.click(dismiss as Element);
    expect(container.querySelector("[data-answer-chip]")).toBeNull();
    expect(store.cardsState().keys).toContain("chip:a1");
  });
});

describe("artifacts live, round 2", () => {
  it("lights the summary point Q is saying, and labels what is not a verified fact", async () => {
    const { SummaryBody } =
      await import("../src/features/q/blocks/summary-block");
    const { announceQSaid } = await import("../src/features/q-swarm/q-said");
    vi.useFakeTimers();
    try {
      const { container } = render(
        <SummaryBody
          block={{
            kind: "SUMMARY",
            title: "Summary",
            points: [
              {
                text: "Revenue is thirty eight thousand pounds a month.",
                truthClass: "USER_CLAIM",
                evidenceStatus: "DOCUMENT_SUPPORTED",
              },
              {
                text: "The round should close before the new year.",
                truthClass: "Q_INFERENCE",
                evidenceStatus: "NO_EVIDENCE",
              },
            ],
            missing: ["Audited accounts"],
          }}
        />,
      );
      expect(container.textContent).toContain("Their claim");
      expect(container.textContent).toContain("Q's inference");
      expect(container.textContent).toContain("Audited accounts");
      act(() => {
        announceQSaid("The round should close before the new year.");
      });
      act(() => {
        vi.advanceTimersByTime(10);
      });
      const current = container.querySelector("[data-q-summary-current]");
      expect(current?.getAttribute("data-q-summary-point")).toBe("1");
      expect(current?.getAttribute("aria-current")).toBe("true");
      // Lit by the rail's shape as well as its colour, never by a change
      // of weight that would reflow the words (design pass, round 3).
      const rail = current?.querySelector("[aria-hidden='true']");
      expect(rail?.className).toContain("scale-x-100");
      expect(
        container.querySelector(
          "[data-q-summary-point='0'] [aria-hidden='true']",
        )?.className,
      ).toContain("scale-x-50");
      expect(current?.innerHTML).not.toContain("font-medium");
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts a summary frame up before anything is named", () => {
    const { container } = render(
      <LivePreview
        preview={{
          messageId: QMessageIdSchema.parse(MSG),
          subjects: [],
          layout: "SUMMARY",
        }}
      />,
    );
    expect(container.querySelector("[data-q-preview-summary]")).not.toBeNull();
  });

  it("shows a researched identity by name with its credited image, or initials", () => {
    const { container } = render(
      <LivePreview
        preview={{
          messageId: QMessageIdSchema.parse(MSG),
          subjects: [
            {
              subject: null,
              name: "Shadi Qishta",
              kind: "PERSON",
              image: {
                url: "https://images.example/shadi.jpg",
                attribution: "Example News",
              },
            },
            { subject: null, name: "Halima Bello", kind: "PERSON" },
          ],
          layout: "CARDS",
        }}
      />,
    );
    const imgs = [...container.querySelectorAll("img")].map((one) =>
      one.getAttribute("src"),
    );
    expect(imgs).toEqual(["https://images.example/shadi.jpg"]);
    expect(container.textContent).toContain("Photo: Example News");
    // No image: initials, never a broken picture.
    expect(container.textContent).toContain("HB");
  });

  it("opens the live turn for a card that goes up before Q's first word", () => {
    const event = (type: string, data: unknown, sequence: number) =>
      ({
        contractVersion: 1,
        eventId: `0000000${String(sequence)}-0000-4000-8000-000000000000`,
        runId: RUN,
        sequence,
        occurredAt: "2026-10-20T10:00:00.000Z",
        type,
        data,
      }) as never;
    let state = createQStreamState();
    state = reduceQStream(
      state,
      event("q.run.started", { capability: "ANSWER", status: "RUNNING" }, 1),
    );
    state = reduceQStream(
      state,
      event(
        "q.artifact.preview",
        {
          messageId: MSG,
          subjects: [{ subject: null, name: "Shadi Qishta", kind: "PERSON" }],
          layout: "CARD",
        },
        1,
      ),
    );
    const live = turnsFrom(state, []).at(-1);
    expect(live?.kind).toBe("Q");
    expect(live?.kind === "Q" ? live.streaming : false).toBe(true);
    expect(live?.kind === "Q" ? live.preview?.subjects[0]?.name : null).toBe(
      "Shadi Qishta",
    );
  });
});

describe("a landed answer's frames are settled cards, never a blank panel (owner 2026-10-23)", () => {
  it("draws no placeholder once the answer is in, and offers a way in", () => {
    const one = preview("CARD", [BARIDI, "Baridi Health"]);
    const live = render(<LivePreview preview={one} />);
    expect(
      live.container.querySelectorAll(
        ".animate-pulse, [class*='animate-pulse']",
      ).length,
    ).toBeGreaterThan(0);
    live.unmount();
    const settled = render(<LivePreview preview={one} settled />);
    expect(
      settled.container.querySelectorAll("[class*='animate-pulse']"),
    ).toHaveLength(0);
    expect(
      settled.container.querySelector("[data-q-preview-settled]"),
    ).not.toBeNull();
    expect(
      settled.container.querySelector(`[data-q-preview-open='${BARIDI}']`),
    ).not.toBeNull();
    expect(settled.container.textContent).toContain("Baridi Health");
  });

  it("a landed answer's summary or table frame is not kept: nothing would fill it", () => {
    for (const layout of ["SUMMARY", "TABLE"] as const) {
      const turns = [
        person("p1", "Tell me about Baridi and MedTrail"),
        answer(MSG, "Both are seed companies.", {
          streaming: false,
          preview: preview(
            layout,
            [BARIDI, "Baridi Health"],
            [MEDTRAIL, "MedTrail"],
          ),
          blocks: [],
        }),
      ];
      expect(livePreviewOf(turns, null)).toBeNull();
    }
  });
});
