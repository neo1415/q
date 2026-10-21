// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createQStreamState,
  qCurrentStage,
  reduceQStream,
  type QStreamState,
} from "@capital-q/api-client";
import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { turnsFrom } = await import("../src/features/q/conversation");
const { QAnswer } = await import("../src/features/q/q-answer");
const { StageLine, stageLineText, taskLineText } =
  await import("../src/features/q/stage-line");
const { loadWire } = await import("../src/features/q/wire");

/**
 * Owner 2026-10-21 (as fast as it can be done properly): the run's stream replayed into the
 * real thread path (reducer → turnsFrom → QAnswer, and the StageProgress
 * every surface draws) at stated latencies, timed by a fake clock.
 *
 * What it measures is what the UI adds on top of the server: the moment
 * each thing is in the DOM, against the moment its event arrived. The
 * profiles are the arrival times of the stream's events after send; they
 * are assumptions stated here (typical, slow network, slow model), not
 * production measurements, and the live check is the place for those.
 *
 * What is asserted is what the UI owns: each thing is painted the moment
 * its event arrives (no timer, debounce or wait in the UI path), and the
 * preview frame is up before the full answer. The times themselves are
 * reported as evidence (STAGE-TIMING lines), not a pass/fail gate: the
 * server side takes as long as its real work needs.
 */

const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const MSG = "123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-10-21T10:00:00.000Z";

type Arrival = { readonly at: number; readonly event: QStreamEvent };

let counter = 0;
function event(
  type: QStreamEvent["type"],
  data: Record<string, unknown>,
  sequence: number,
): QStreamEvent {
  counter += 1;
  return QStreamEventSchema.parse({
    contractVersion: 1,
    eventId: `${counter.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    runId: RUN,
    sequence,
    occurredAt: NOW,
    type,
    data,
  });
}

const PREVIEW = {
  messageId: MSG,
  layout: "TABLE",
  subjects: [
    { subject: null, kind: "ORGANISATION", name: "Portside" },
    { subject: null, kind: "ORGANISATION", name: "Souqsheet" },
  ],
};
const ANSWER = "Souqsheet is the closer fit. Portside leads on its model.";

/** Arrival times (ms after send) of one compare turn's events. */
type Profile = {
  readonly name: string;
  readonly started: number;
  readonly stages: readonly [number, string][];
  readonly preview: number;
  readonly deltas: readonly [number, string][];
  readonly completed: number;
};

const PROFILES: readonly Profile[] = [
  {
    name: "typical",
    started: 150,
    stages: [
      [250, "REVIEWING_COMPANY"],
      [1_100, "COMPARING_OPPORTUNITIES"],
      [2_600, "PREPARING_ANALYSIS"],
    ],
    preview: 1_500,
    deltas: [
      [1_600, "Souqsheet is the closer fit. "],
      [2_400, "Portside leads on its model."],
    ],
    completed: 3_400,
  },
  {
    name: "slow network",
    started: 450,
    stages: [
      [700, "REVIEWING_COMPANY"],
      [1_600, "COMPARING_OPPORTUNITIES"],
      [3_300, "PREPARING_ANALYSIS"],
    ],
    preview: 2_100,
    deltas: [
      [2_300, "Souqsheet is the closer fit. "],
      [3_100, "Portside leads on its model."],
    ],
    completed: 4_300,
  },
  {
    name: "slow model",
    started: 150,
    stages: [
      [300, "REVIEWING_COMPANY"],
      [900, "CHECKING_EVIDENCE"],
      [2_200, "COMPARING_OPPORTUNITIES"],
      [3_700, "PREPARING_ANALYSIS"],
    ],
    preview: 2_900,
    deltas: [
      [3_000, "Souqsheet is the closer fit. "],
      [4_100, "Portside leads on its model."],
    ],
    completed: 4_800,
  },
];

function arrivals(profile: Profile): readonly Arrival[] {
  let seq = 0;
  const next = () => (seq += 1);
  const list: Arrival[] = [
    {
      at: profile.started,
      event: event(
        "q.run.started",
        { capability: "INVESTIGATE", status: "RECEIVED" },
        next(),
      ),
    },
    ...profile.stages.map(([at, stage]) => ({
      at,
      event: event("q.stage.changed", { stage }, next()),
    })),
    {
      at: profile.preview,
      event: event("q.artifact.preview", PREVIEW, seq),
    },
    ...profile.deltas.map(([at, text]) => ({
      at,
      event: event("q.message.delta", { messageId: MSG, text }, seq),
    })),
    {
      at: profile.completed,
      event: event(
        "q.message.completed",
        {
          message: {
            messageId: MSG,
            runId: RUN,
            role: "Q",
            text: ANSWER,
            createdAt: NOW,
          },
        },
        next(),
      ),
    },
  ];
  return list.sort((a, b) => a.at - b.at);
}

/**
 * What the thread draws from the stream (q-conversation, round 4): Q's
 * answer slot from the moment it starts work, holding the one live line
 * where Q's first words will land, then the answer itself.
 */
function Surface({ state }: { readonly state: QStreamState }) {
  const now =
    state.messages.length > 0 ? null : qCurrentStage(state.stageHistory);
  const current =
    now === null
      ? null
      : {
          stage: now.stage,
          ...(now.about === undefined ? {} : { about: now.about }),
        };
  const latest = turnsFrom(state, []).findLast((turn) => turn.kind === "Q");
  const line = (
    <StageLine current={current} size="answer" live={false} reserve />
  );
  return (
    <div>
      {latest?.kind === "Q" ? (
        <QAnswer turn={latest} mark={false} working={line} />
      ) : state.runId !== null ? (
        <div data-q-pending>{line}</div>
      ) : null}
    </div>
  );
}

type Timings = {
  readonly firstStagePainted: number;
  readonly firstStageArrived: number;
  readonly previewPainted: number;
  readonly firstWordsPainted: number;
  readonly answerPainted: number;
  readonly answerArrived: number;
  readonly maxUiDelay: number;
};

async function replay(profile: Profile): Promise<Timings> {
  let state = createQStreamState();
  const view = render(<Surface state={state} />);
  const seen = {
    stage: Number.NaN,
    preview: Number.NaN,
    words: Number.NaN,
    answer: Number.NaN,
  };
  let maxUiDelay = 0;
  let clock = 0;
  for (const { at, event: next } of arrivals(profile)) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(at - clock);
    });
    clock = at;
    state = reduceQStream(state, next);
    const before = clock;
    act(() => {
      view.rerender(<Surface state={state} />);
    });
    // The fake clock does not move inside a render: what is in the DOM
    // now was painted at the event's arrival, so the UI added nothing.
    maxUiDelay = Math.max(maxUiDelay, clock - before);
    const dom = view.container;
    if (
      Number.isNaN(seen.stage) &&
      dom.querySelector("[data-q-stage-line] .cq-stage-line") !== null
    ) {
      seen.stage = clock;
    }
    if (
      Number.isNaN(seen.preview) &&
      dom.querySelector("[data-q-preview]") !== null
    ) {
      seen.preview = clock;
    }
    if (
      Number.isNaN(seen.words) &&
      (dom.textContent ?? "").includes("Souqsheet is the closer fit")
    ) {
      seen.words = clock;
    }
    if (
      Number.isNaN(seen.answer) &&
      dom.querySelector("[data-q-answer='settled']") !== null
    ) {
      seen.answer = clock;
    }
  }
  view.unmount();
  return {
    firstStagePainted: seen.stage,
    firstStageArrived: profile.stages[0]?.[0] ?? Number.NaN,
    previewPainted: seen.preview,
    firstWordsPainted: seen.words,
    answerPainted: seen.answer,
    answerArrived: profile.completed,
    maxUiDelay,
  };
}

beforeAll(async () => {
  // The stage labels arrive with the wire's contracts (W7): loaded first,
  // as the page warms them before a turn.
  await loadWire();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("speed on the thread path (replayed stream)", () => {
  for (const profile of PROFILES) {
    it(`${profile.name}: each step painted as it arrives, preview before the answer`, async () => {
      vi.useFakeTimers();
      const timings = await replay(profile);
      // Recorded for the report (workstream file, PR).
      console.info(`STAGE-TIMING ${profile.name} ${JSON.stringify(timings)}`);
      expect(timings.firstStagePainted).toBe(timings.firstStageArrived);
      expect(timings.previewPainted).toBeLessThan(timings.answerPainted);
      expect(timings.firstWordsPainted).toBeLessThan(timings.answerPainted);
      expect(timings.answerPainted).toBe(timings.answerArrived);
      expect(timings.maxUiDelay).toBe(0);
    });
  }

  it("names what the stage is about from the run's reads, and never names the web", () => {
    const labels = {
      REVIEWING_COMPANY: "Looking at the company",
      COMPARING_OPPORTUNITIES: "Comparing them side by side",
      CHECKING_EVIDENCE: "Reading their deck and documents",
      SEARCHING_PUBLIC_SOURCES: "Looking into it",
      PREPARING_ANALYSIS: "Pulling it together",
      DESIGNING_DOCUMENT: "Laying out each page",
    } as unknown as Parameters<typeof stageLineText>[1];
    expect(stageLineText({ stage: "REVIEWING_COMPANY" }, labels)).toBe(
      "Looking at the company",
    );
    expect(
      stageLineText(
        { stage: "REVIEWING_COMPANY", about: { subjects: ["Nixo"] } },
        labels,
      ),
    ).toBe("Looking at Nixo");
    expect(
      stageLineText(
        {
          stage: "COMPARING_OPPORTUNITIES",
          about: { subjects: ["Nixo", "Halyard"] },
        },
        labels,
      ),
    ).toBe("Comparing Nixo and Halyard");
    // One name is not a comparison: the approved label, not "Comparing Nixo".
    expect(
      stageLineText(
        { stage: "COMPARING_OPPORTUNITIES", about: { subjects: ["Nixo"] } },
        labels,
      ),
    ).toBe("Comparing them side by side");
    expect(
      stageLineText(
        { stage: "CHECKING_EVIDENCE", about: { subjects: ["Nixo"] } },
        labels,
      ),
    ).toBe("Reading Nixo's deck and documents");
    // R38: research is "Looking into it", whatever it is about.
    expect(
      stageLineText(
        { stage: "SEARCHING_PUBLIC_SOURCES", about: { subjects: ["Nixo"] } },
        labels,
      ),
    ).toBe("Looking into it");
    expect(stageLineText({ stage: "PREPARING_ANALYSIS" }, labels)).toBe(
      "Pulling it together",
    );
  });

  it("says a durable task by its name and the pipeline's real step count", () => {
    const labels = {
      DESIGNING_DOCUMENT: "Laying out each page",
    } as unknown as Parameters<typeof taskLineText>[1];
    const deck = {
      stage: "DESIGNING_DOCUMENT" as const,
      about: {
        subjects: ["Nixo"],
        task: { kind: "PITCH_DECK" as const, step: 2, of: 4 },
      },
    };
    expect(taskLineText(deck, labels)).toEqual([
      "Deck for Nixo",
      "2 of 4",
      "Laying out each page",
    ]);
    expect(stageLineText(deck, labels)).toBe(
      "Deck for Nixo · 2 of 4 · Laying out each page",
    );
    // A brief has no pipeline count: no number is invented.
    expect(
      taskLineText(
        {
          stage: "DESIGNING_DOCUMENT",
          about: { subjects: ["Nixo"], task: { kind: "INVESTMENT_BRIEF" } },
        },
        labels,
      ),
    ).toEqual(["Brief for Nixo", "Laying out each page"]);
  });

  it("keeps one line, replaced in place: never a list, never a percentage", async () => {
    vi.useFakeTimers();
    let state = createQStreamState();
    const view = render(<Surface state={state} />);
    for (const { event: next } of arrivals(PROFILES[2] as Profile).filter(
      (one) =>
        one.event.type === "q.stage.changed" ||
        one.event.type === "q.run.started",
    )) {
      state = reduceQStream(state, next);
      act(() => {
        view.rerender(<Surface state={state} />);
      });
      expect(
        view.container.querySelectorAll("[data-q-stage-line]"),
      ).toHaveLength(1);
    }
    expect(view.container.querySelectorAll("li")).toHaveLength(0);
    const text = view.container.textContent ?? "";
    expect(text).toBe("Pulling it together");
    expect(text).not.toMatch(/%|PREPARING_ANALYSIS/u);
    await Promise.resolve();
  });
});
