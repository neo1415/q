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
  stepLine,
  stepStates,
  WorkInProgressCard,
} from "../src/features/q/work-canvas";
import {
  liveFraction,
  liveLine,
  Q_WORK_SETTLED_EVENT,
} from "../src/features/q/work-live";

/**
 * Owner 2026-10-24: "they see 'On it. Starting now...' and then nothing
 * until 'ready' about 3 minutes later." The card that follows the job.
 */
afterEach(() => {
  cleanup();
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
      for (let tick = 0; tick < 40 && documentCard() === null; tick += 1) {
        await vi.advanceTimersByTimeAsync(150);
        seen.push(JSON.stringify(stepsShown()));
      }
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
