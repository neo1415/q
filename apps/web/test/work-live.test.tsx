// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QArtifactReferenceBlockSchema,
  type WorkforceLive,
} from "@capital-q/contracts";

import {
  followWork,
  type QTurn,
  type QTurnObjectBlock,
} from "../src/features/q/conversation";
import {
  nextStep,
  stepInViewLine,
  stepLine,
  stepStates,
  WorkInProgressCard,
} from "../src/features/q/work-canvas";
import { earlierWork, PinnedWorkLines } from "../src/features/q/pinned-work";
import {
  elapsedWords,
  liveFraction,
  liveKey,
  liveLine,
  promisedJobs,
  Q_WORK_SETTLED_EVENT,
  resetWorkLive,
  settledDetail,
  useFollowJobs,
  usualLength,
  useWorkLive,
  WORK_LIVE_WATCH_MS,
} from "../src/features/q/work-live";
import {
  idleEnds,
  LINE_HOLD_MAX_MS,
  lineHeld,
} from "../src/features/voice/live/line-hold";

/**
 * Owner 2026-10-24: "they see 'On it. Starting now...' and then nothing
 * until 'ready' about 3 minutes later." The card that follows the job.
 */
afterEach(() => {
  cleanup();
  resetWorkLive();
  vi.unstubAllGlobals();
});

const JOB = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const AT = "2026-10-24T17:00:00.000Z";

function qTurn(id: string, blocks: readonly QTurnObjectBlock[]): QTurn {
  return {
    kind: "Q",
    id,
    at: AT,
    text: id,
    streaming: false,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  };
}

const work = {
  kind: "WORK_IN_PROGRESS",
  jobId: JOB,
  title: "Making Paystack interested in Halyard Security",
} as const;
const document = QArtifactReferenceBlockSchema.parse({
  kind: "ARTIFACT_REFERENCE",
  artifactId: ARTIFACT,
  type: "ANALYSIS",
  status: "READY",
  title: "Making Paystack interested in Halyard Security",
});

function blocksOf(turn: QTurn | undefined) {
  return turn?.kind === "Q" ? turn.blocks.map((block) => block.kind) : null;
}

describe("one card per document being made", () => {
  it("the starting card becomes the document: the delivery shows no second card", () => {
    const turns = [qTurn("start", [work]), qTurn("delivery", [document, work])];
    followWork(turns);
    expect(blocksOf(turns[0])).toEqual(["WORK_IN_PROGRESS"]);
    expect(blocksOf(turns[1])).toEqual([]);
  });

  it("without the starting card in the thread, the delivery shows the document", () => {
    const turns = [qTurn("delivery", [document, work])];
    followWork(turns);
    expect(blocksOf(turns[0])).toEqual(["ARTIFACT_REFERENCE"]);
  });

  it("leaves another document's card alone", () => {
    const other = { ...work, jobId: "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e" };
    const turns = [
      qTurn("start", [work]),
      qTurn("delivery", [document, other]),
    ];
    followWork(turns);
    expect(blocksOf(turns[1])).toEqual(["ARTIFACT_REFERENCE"]);
  });
});

function stage(over: Partial<NonNullable<WorkforceLive["stage"]>>) {
  return {
    stage: "SEARCHING" as const,
    questions: null,
    sources: null,
    facts: null,
    draft: null,
    drafts: null,
    title: null,
    sections: [],
    at: AT,
    ...over,
  };
}

describe("what the card says is happening", () => {
  it("says each stage in plain words with its counts", () => {
    expect(liveLine(null)).toBe("Planning the work");
    expect(liveLine(stage({ questions: 9 }))).toBe(
      "Searching 9 lines of enquiry",
    );
    expect(liveLine(stage({ stage: "READING", sources: 12 }))).toBe(
      "Reading 12 public sources",
    );
    expect(liveLine(stage({ stage: "READING", sources: 12, facts: 7 }))).toBe(
      "Read 12 public sources, kept 7 sourced facts",
    );
    expect(liveLine(stage({ stage: "REVISING", draft: 2, drafts: 3 }))).toBe(
      "Revising: draft 2 of 3",
    );
  });

  it("moves the bar forward and fills it only when done", () => {
    const working = (s: ReturnType<typeof stage> | null): WorkforceLive => ({
      jobId: JOB,
      state: "WORKING",
      done: 1,
      total: 2,
      stage: s,
      document: null,
      reason: null,
    });
    const searching = liveFraction(working(stage({})));
    const reviewing = liveFraction(working(stage({ stage: "REVIEWING" })));
    expect(searching).toBe(0.5);
    expect(reviewing).toBeGreaterThan(searching);
    expect(liveFraction(working(stage({ stage: "FILING" })))).toBeLessThan(1);
    expect(liveFraction({ ...working(null), state: "DONE" })).toBe(1);
  });
});

function working(over: Partial<WorkforceLive> = {}): WorkforceLive {
  return {
    jobId: JOB,
    state: "WORKING",
    done: 1,
    total: 2,
    stage: stage({
      stage: "REVIEWING",
      draft: 1,
      drafts: 3,
      title: "Paystack and Halyard: the case",
      sections: ["Why Paystack", "Security posture"],
    }),
    document: null,
    reason: null,
    ...over,
  };
}

const done: WorkforceLive = {
  ...working(),
  state: "DONE",
  done: 2,
  stage: stage({ stage: "FILING", draft: 1, drafts: 3, openPoints: 0 }),
  document: {
    artifactId: ARTIFACT,
    type: "ANALYSIS",
    title: "Paystack and Halyard: the case",
  },
};

function serve(reads: WorkforceLive[]) {
  const fetch = vi.fn((url: string) => {
    expect(url).toBe(`/api/q-work-live/${JOB}`);
    const body = reads.length > 1 ? reads.shift() : reads[0];
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function stepsShown(): string[] {
  return [...window.document.querySelectorAll("[data-q-work-step]")].map(
    (step) => step.getAttribute("data-q-work-step") ?? "",
  );
}

describe("the work canvas's step bar", () => {
  it("marks steps done, current and later; revising not needed after one draft; a failed step", () => {
    expect(stepStates(3, working())).toEqual([
      "DONE",
      "DONE",
      "DONE",
      "CURRENT",
      "LATER",
      "LATER",
    ]);
    expect(stepStates(5, working())).toEqual([
      "DONE",
      "DONE",
      "DONE",
      "DONE",
      "SKIPPED",
      "CURRENT",
    ]);
    expect(stepStates(2, { ...working(), state: "FAILED" })[2]).toBe("FAILED");
    expect(stepLine("READING", "DONE", stage({ sources: 12, facts: 7 }))).toBe(
      "12 sources, 7 facts",
    );
    expect(stepLine("REVISING", "SKIPPED", null)).toBe("Not needed");
    expect(stepLine("FILING", "LATER", null)).toBe("");
  });

  it("the step in view says the investigation's own stage, live (run A, 2026-10-29)", () => {
    // Planning shows on the research step: its own line, never the step's.
    expect(
      stepInViewLine(
        "SEARCHING",
        stage({ stage: "PLANNING_RESEARCH", round: 1 }),
      ),
    ).toBe("Planning the investigation");
    // Round 2 while the view holds Reading (it never steps back).
    expect(
      stepInViewLine(
        "READING",
        stage({ stage: "SEARCHING", round: 2, questions: 3, sources: 33 }),
      ),
    ).toBe("Round 2: checking 3 open questions");
    expect(
      stepInViewLine(
        "READING",
        stage({ stage: "CROSS_CHECKING", sources: 33, facts: 35 }),
      ),
    ).toBe("Cross-checking sources");
    // Outside research, the step's own line as before.
    expect(
      stepInViewLine("DRAFTING", stage({ stage: "READING", sources: 3 })),
    ).toBe("Writing the first draft");
  });
});

describe("the card", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.document.getElementById("cq-work-chips")?.remove();
  });

  it("shows the step in view with its work, keeps each step in view, then becomes the document and tells the conversation", async () => {
    serve([working(), done]);
    const settled = vi.fn();
    window.addEventListener(Q_WORK_SETTLED_EVENT, settled);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<WorkInProgressCard block={work} onOpen={() => undefined} />);
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe(
          "Reviewing the first draft",
        ),
      );
      expect(stepsShown()).toEqual([
        "DONE",
        "DONE",
        "DONE",
        "CURRENT",
        "LATER",
        "LATER",
      ]);
      expect(screen.getByText("Paystack and Halyard: the case")).toBeTruthy();
      expect(screen.getByText("Security posture")).toBeTruthy();
      expect(
        window.document
          .querySelector("[data-q-work-status]")
          ?.getAttribute("data-q-work-status"),
      ).toBe("WORKING");
      // The job is filed at the next read; the card still walks to Filing
      // (revising skipped: one draft passed) before it becomes the document.
      await vi.advanceTimersByTimeAsync(2_600);
      // Still in view for its own time after the filed reading arrives.
      expect(stepsShown()[3]).toBe("CURRENT");
      // Walk time forward: Filing comes into view (revising skipped), and
      // only after its own time does the card become the document.
      const seen: string[] = [];
      const filedLines: string[] = [];
      for (let tick = 0; tick < 40 && documentCard() === null; tick += 1) {
        await vi.advanceTimersByTimeAsync(150);
        seen.push(JSON.stringify(stepsShown()));
        const line = window.document.querySelector(
          '[data-q-work-line="FILING"]',
        );
        if (line !== null)
          filedLines.push(
            `${window.document.querySelector("[data-q-work-status]")?.getAttribute("data-q-work-status") ?? ""}|${line.textContent}`,
          );
      }
      // Filed: the chip says Done and the line says filed, never "Filing…".
      expect(filedLines.length).toBeGreaterThan(0);
      for (const shown of filedLines)
        expect(shown.startsWith("DONE|Filed the document")).toBe(true);
      expect(seen).toContain(
        JSON.stringify(["DONE", "DONE", "DONE", "DONE", "SKIPPED", "CURRENT"]),
      );
      expect(seen).not.toContain(
        JSON.stringify(["DONE", "DONE", "DONE", "DONE", "CURRENT", "LATER"]),
      );
      await waitFor(() => expect(documentCard()).toBe("READY"));
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(Q_WORK_SETTLED_EVENT, settled);
      vi.useRealTimers();
    }
  });

  it("a reload of a filed job shows the document at once, never replaying the steps", async () => {
    serve([done]);
    render(<WorkInProgressCard block={work} />);
    await waitFor(() => expect(documentCard()).toBe("READY"));
  });

  it("a DONE job with no document shows no planning step (job 4d1a8b04)", async () => {
    serve([{ ...done, document: null }]);
    render(<WorkInProgressCard block={work} />);
    await waitFor(() =>
      expect(
        window.document
          .querySelector("[data-q-work-status]")
          ?.getAttribute("data-q-work-status"),
      ).toBe("DONE"),
    );
    expect(window.document.querySelector("[data-q-work-in-view]")).toBeNull();
    expect(screen.queryByText("Planning the work")).toBeNull();
  });

  it("lands the sources read as their site and title, as text, never a link", async () => {
    serve([
      working({
        stage: stage({
          stage: "READING",
          sources: 2,
          read: [
            { domain: "techcabal.com", title: "Paystack's security posture" },
            { domain: "cbn.gov.ng", title: null },
          ],
        }),
      }),
    ]);
    render(<WorkInProgressCard block={work} />);
    await waitFor(() => expect(screen.getByText("techcabal.com")).toBeTruthy());
    expect(screen.getByText("Paystack's security posture")).toBeTruthy();
    const list = window.document.querySelector("[data-q-work-read]");
    expect(list?.querySelectorAll("a")).toHaveLength(0);
  });

  it("puts aside into a chip that says how it is going, remembered on this device, and brings it back", async () => {
    serve([working()]);
    const { unmount } = render(<WorkInProgressCard block={work} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Put aside")).toBeTruthy(),
    );
    fireEvent.click(screen.getByLabelText("Put aside"));
    await waitFor(() =>
      expect(
        window.document.querySelector("[data-q-work-chip]"),
      ).not.toBeNull(),
    );
    expect(window.document.querySelector("[data-q-work-card]")).toBeNull();
    expect(window.localStorage.getItem(`cq.work.aside.${JOB}`)).toBe("1");
    // Remembered: a reload keeps it aside.
    unmount();
    serve([working()]);
    render(<WorkInProgressCard block={work} />);
    const chip = await waitFor(() => {
      const found =
        window.document.querySelector<HTMLButtonElement>("[data-q-work-chip]");
      expect(found?.getAttribute("data-q-work-chip")).toBe("WORKING");
      return found;
    });
    fireEvent.click(chip as HTMLButtonElement);
    await waitFor(() =>
      expect(
        window.document.querySelector("[data-q-work-card]"),
      ).not.toBeNull(),
    );
    expect(window.localStorage.getItem(`cq.work.aside.${JOB}`)).toBeNull();
  });

  it("says Waiting for you and Failed in a word, with one plain line", async () => {
    serve([
      working({ state: "WAITING", reason: "It needs your decision on Work." }),
    ]);
    const first = render(<WorkInProgressCard block={work} />);
    await waitFor(() =>
      expect(screen.getByText("Waiting for you")).toBeTruthy(),
    );
    expect(screen.getByText("It needs your decision on Work.")).toBeTruthy();
    expect(screen.getByText("Open Work").getAttribute("href")).toBe("/work");
    first.unmount();

    serve([
      working({
        state: "FAILED",
        reason: "Public sources couldn't be checked just now.",
      }),
    ]);
    render(<WorkInProgressCard block={work} />);
    await waitFor(() => expect(screen.getByText("Failed")).toBeTruthy());
    expect(stepsShown()).toContain("FAILED");
  });

  it("someone else's job shows nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("null", { status: 404 }))),
    );
    const { container } = render(<WorkInProgressCard block={work} />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});

function documentCard(): string | null {
  return (
    window.document
      .querySelector("[data-q-artifact-card]")
      ?.getAttribute("data-q-artifact-card") ?? null
  );
}

describe("coordinator 25 Oct: one poll per job, paced by real movement", () => {
  it("counts the stage, the draft and the sections as movement, not a new source", () => {
    const base = working();
    expect(liveKey(base)).toBe(liveKey({ ...base, done: base.done + 1 }));
    expect(liveKey(base)).not.toBe(
      liveKey({ ...base, stage: stage({ ...base.stage, draft: 2 }) }),
    );
    expect(liveKey(base)).not.toBe(
      liveKey({
        ...base,
        stage: stage({ ...base.stage, sections: ["Why Paystack"] }),
      }),
    );
    expect(liveKey({ ...base, state: "WAITING" })).toBe("WAITING");
  });

  it("two places showing the same job read it once", async () => {
    const fetch = serve([working()]);
    function Shows() {
      const { live } = useWorkLive(JOB);
      return <p>{live?.state ?? "…"}</p>;
    }
    render(
      <>
        <Shows />
        <Shows />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText("WORKING")).toHaveLength(2));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("after the watch window, a focus reads again instead of needing a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetch = serve([working()]);
      function Shows() {
        const { live } = useWorkLive(JOB);
        return <p>{live?.state ?? "…"}</p>;
      }
      render(<Shows />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      // Past the window: the next read finds it expired and stops.
      await vi.advanceTimersByTimeAsync(WORK_LIVE_WATCH_MS + 60_000);
      const stopped = fetch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetch.mock.calls.length).toBe(stopped);
      window.dispatchEvent(new Event("focus"));
      await waitFor(() =>
        expect(fetch.mock.calls.length).toBeGreaterThan(stopped),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("coordinator 25 Oct: a document being made stays in view", () => {
  it("lists the jobs from before the latest exchange, once each", () => {
    const earlier = [{ blocks: [work] }, { blocks: [work] }];
    expect(earlierWork(earlier, []).map((job) => job.jobId)).toEqual([JOB]);
    expect(earlierWork(earlier, [{ blocks: [work] }])).toEqual([]);
  });

  it("shows the title, the stage in words and the bar; a tap opens the card; done, it goes", async () => {
    serve([working(), done]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<PinnedWorkLines jobs={[work]} />);
      await waitFor(() =>
        expect(screen.getByText("Paystack and Halyard: the case")).toBeTruthy(),
      );
      expect(screen.getByText("Reviewing the first draft")).toBeTruthy();
      expect(screen.getByRole("progressbar")).toBeTruthy();
      fireEvent.click(
        window.document.querySelector("[data-q-pinned-work-toggle]") as Element,
      );
      expect(
        window.document.querySelector(
          "[data-q-work-progress], [data-q-work-step]",
        ),
      ).not.toBeNull();
      await vi.advanceTimersByTimeAsync(2_600);
      await waitFor(() =>
        expect(
          window.document.querySelector("[data-q-pinned-work-job]"),
        ).toBeNull(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Owner 2026-10-28 (job 9e52faf7: 3 min 25 s with only "Pulling it
 * together" on screen): the plan as it happens, the wait understood, and
 * done announced and opened.
 */
describe("owner 2026-10-28: long work, visible and announced", () => {
  const STARTED = "2026-10-28T14:04:40.000Z";

  it("shows which steps are done, which runs, what is next, how long it has gone and usually takes", async () => {
    serve([
      working({
        startedAt: STARTED,
        expected: { kind: "DOCUMENT", minMinutes: 2, maxMinutes: 4 },
      }),
    ]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.parse("2026-10-28T14:06:45.000Z"));
    try {
      render(<WorkInProgressCard block={work} />);
      await waitFor(() =>
        expect(
          window.document.querySelector("[data-q-work-timing]"),
        ).not.toBeNull(),
      );
      expect(stepsShown()).toEqual([
        "DONE",
        "DONE",
        "DONE",
        "CURRENT",
        "LATER",
        "LATER",
      ]);
      const timing =
        window.document.querySelector("[data-q-work-timing]")?.textContent ??
        "";
      expect(timing).toMatch(/Going for 2 min 0\d s/u);
      expect(timing).toContain("Usually 2–4 minutes");
      expect(timing).toContain("Next: Revising");
      // Never an internal name or reasoning: only the approved labels.
      expect(window.document.body.textContent).not.toMatch(/agent|analyst/iu);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing about length when the kind's usual length is not known", () => {
    expect(usualLength(working())).toBeNull();
    expect(
      usualLength(
        working({
          expected: { kind: "RESEARCH", minMinutes: 1, maxMinutes: 2 },
        }),
      ),
    ).toBe("Usually 1–2 minutes");
    expect(elapsedWords(STARTED, Date.parse(STARTED) + 42_000)).toBe("42 s");
    expect(nextStep(["DONE", "CURRENT", "LATER"])).toBe("Writing");
    expect(nextStep(["DONE", "DONE", "DONE"])).toBeNull();
  });

  it("follows the promised job from acceptance until its delivery is in the thread", () => {
    expect(promisedJobs([{ blocks: [work] }])).toEqual([JOB]);
    // The delivery as the server sends it (document beside the job)...
    expect(
      promisedJobs([{ blocks: [work] }, { blocks: [document, work] }]),
    ).toEqual([]);
    // ...and as the thread holds it once followWork took the card off.
    const turns = [qTurn("start", [work]), qTurn("delivery", [document, work])];
    followWork(turns);
    expect(
      promisedJobs(turns.flatMap((turn) => (turn.kind === "Q" ? [turn] : []))),
    ).toEqual([]);
  });

  it("subscribes with nothing drawn, holds an open live line while it works, and says it is done with its document", async () => {
    serve([working(), done]);
    const details: unknown[] = [];
    const settled = (event: Event) => {
      details.push(settledDetail(event));
    };
    window.addEventListener(Q_WORK_SETTLED_EVENT, settled);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    function Follower() {
      useFollowJobs([JOB]);
      return null;
    }
    try {
      render(<Follower />);
      await waitFor(() => expect(lineHeld()).toBe(true));
      await vi.advanceTimersByTimeAsync(2_600);
      await waitFor(() => expect(details).toHaveLength(1));
      expect(details[0]).toEqual({
        jobId: JOB,
        state: "DONE",
        document: done.document,
      });
      expect(lineHeld()).toBe(false);
    } finally {
      window.removeEventListener(Q_WORK_SETTLED_EVENT, settled);
      vi.useRealTimers();
    }
  });

  it("a stuck job holds the line only for a bounded while", () => {
    const idle = 3 * 60_000;
    expect(idleEnds(idle - 1, idle, true)).toBe(false);
    expect(idleEnds(idle + 1, idle, false)).toBe(true);
    expect(idleEnds(idle + 1, idle, true)).toBe(false);
    expect(idleEnds(idle + LINE_HOLD_MAX_MS + 1, idle, true)).toBe(true);
  });
});
