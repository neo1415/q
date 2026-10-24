// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  liveFraction,
  liveLine,
  Q_WORK_SETTLED_EVENT,
  WorkInProgressCard,
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

describe("the card", () => {
  it("shows the stage and the sections as drafted, then becomes the document and tells the conversation", async () => {
    const reads: WorkforceLive[] = [
      {
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
      },
      {
        jobId: JOB,
        state: "DONE",
        done: 2,
        total: 2,
        stage: null,
        document: {
          artifactId: ARTIFACT,
          type: "ANALYSIS",
          title: "Paystack and Halyard: the case",
        },
        reason: null,
      },
    ];
    const fetch = vi.fn((url: string) => {
      expect(url).toBe(`/api/q-work-live/${JOB}`);
      const body = reads.length > 1 ? reads.shift() : reads[0];
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetch);
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
      expect(screen.getByText("Paystack and Halyard: the case")).toBeTruthy();
      expect(screen.getByText("Security posture")).toBeTruthy();
      expect(screen.getByText("Step 2 of 2")).toBeTruthy();
      await vi.advanceTimersByTimeAsync(2_600);
      await waitFor(() => expect(documentCard()).toBe("READY"));
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(Q_WORK_SETTLED_EVENT, settled);
      vi.useRealTimers();
    }
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
