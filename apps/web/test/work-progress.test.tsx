// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Q_VISIBLE_STAGE_LABELS,
  type WorkforceLive,
  type WorkforceLiveStage,
} from "@capital-q/contracts";

import { stageLineText } from "../src/features/q/stage-line";
import {
  documentActions,
  jobProgress,
  jobStepDetail,
  runProgress,
  workStreams,
  WORK_STEPS_SHOWN_MAX,
  type RunProgressInput,
} from "../src/features/q/work-progress";
import { WorkProgressList } from "../src/features/q/work-progress-view";

const opened = vi.hoisted(() => vi.fn());
vi.mock("../src/features/documents/document-ready", async (original) => ({
  ...(await original<
    typeof import("../src/features/documents/document-ready")
  >()),
  openDocumentViewer: opened,
}));

/**
 * Owner 2026-11-04 (N2): Q's work shown as it really happens -- only the
 * stages that occurred, several pieces of work at once, waiting and failed
 * states, and the finished document's real actions. No percentage.
 */

afterEach(() => {
  cleanup();
  opened.mockReset();
});

const JOB = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const JOB2 = "1f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";

const label: RunProgressInput["label"] = (stage) =>
  stageLineText(stage, Q_VISIBLE_STAGE_LABELS);

function run(over: Partial<RunProgressInput> = {}): RunProgressInput {
  return {
    runId: "run-1",
    stages: [],
    working: true,
    awaitingApproval: false,
    awaitingReply: false,
    failure: null,
    label,
    ...over,
  };
}

function stage(over: Partial<WorkforceLiveStage>): WorkforceLiveStage {
  return {
    stage: "SEARCHING",
    questions: null,
    sources: null,
    facts: null,
    draft: null,
    drafts: null,
    title: null,
    sections: [],
    at: "2026-11-04T10:00:00.000Z",
    ...over,
  };
}

function live(over: Partial<WorkforceLive>): WorkforceLive {
  return {
    jobId: JOB,
    state: "WORKING",
    done: 0,
    total: 0,
    stage: null,
    document: null,
    reason: null,
    ...over,
  };
}

describe("an answer being worked out: its run's stage events", () => {
  it("lists each stage once, in order, the newest in progress", () => {
    const stream = runProgress(
      run({
        stages: [
          { stage: "UNDERSTANDING_REQUEST" },
          { stage: "REVIEWING_COMPANY", about: { subjects: ["Nixo"] } },
          { stage: "REVIEWING_COMPANY", about: { subjects: ["Nixo"] } },
          {
            stage: "COMPARING_OPPORTUNITIES",
            about: { subjects: ["Nixo", "Halyard"] },
          },
        ],
      }),
    );
    expect(stream?.status).toBe("WORKING");
    expect(stream?.steps.map((step) => [step.label, step.state])).toEqual([
      ["Understanding your request", "DONE"],
      ["Looking at Nixo", "DONE"],
      ["Comparing Nixo and Halyard", "CURRENT"],
    ]);
    expect(stream?.actions).toEqual([]);
  });

  it("is nothing when Q is idle: a finished answer is its own artifact", () => {
    expect(
      runProgress(
        run({ working: false, stages: [{ stage: "PREPARING_ANALYSIS" }] }),
      ),
    ).toBeNull();
  });

  it("waits for approval as a state, never a step, with the work so far done", () => {
    const stream = runProgress(
      run({
        working: false,
        awaitingApproval: true,
        stages: [
          { stage: "UNDERSTANDING_REQUEST" },
          { stage: "PREPARING_ANALYSIS" },
          { stage: "WAITING_FOR_APPROVAL" },
        ],
      }),
    );
    expect(stream?.status).toBe("AWAITING_APPROVAL");
    expect(stream?.steps.map((step) => step.state)).toEqual(["DONE", "DONE"]);
    expect(stream?.steps.some((step) => step.label.includes("approval"))).toBe(
      false,
    );
  });

  it("waits for their reply when Q asked a question", () => {
    expect(
      runProgress(run({ working: false, awaitingReply: true }))?.status,
    ).toBe("AWAITING_REPLY");
  });

  it("marks where it stopped when the run failed, with the public line", () => {
    const stream = runProgress(
      run({
        working: false,
        failure: "I couldn't answer that right now. Try again.",
        stages: [
          { stage: "UNDERSTANDING_REQUEST" },
          { stage: "SEARCHING_PUBLIC_SOURCES" },
        ],
      }),
    );
    expect(stream?.status).toBe("FAILED");
    expect(stream?.steps.at(-1)).toMatchObject({
      label: "Looking into it",
      state: "FAILED",
    });
    expect(stream?.note).toBe("I couldn't answer that right now. Try again.");
  });

  it("keeps only the newest steps of a very long run", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      stage:
        index % 2 === 0
          ? ("REVIEWING_COMPANY" as const)
          : ("CHECKING_EVIDENCE" as const),
    }));
    expect(runProgress(run({ stages: many }))?.steps.length).toBe(
      WORK_STEPS_SHOWN_MAX,
    );
  });
});

describe("deep work: the job's own record", () => {
  it("shows only the stages the job really passed, never a fixed pipeline", () => {
    const stream = jobProgress({
      jobId: JOB,
      title: "Growth plan",
      missing: false,
      live: live({
        stage: stage({
          stage: "PLANNING",
          passed: ["GATHERING", "READING_DOCUMENTS"],
        }),
      }),
    });
    // No public reading happened, so none is shown.
    expect(stream?.steps.map((step) => [step.label, step.state])).toEqual([
      ["Gathering your situation", "DONE"],
      ["Reading your documents", "DONE"],
      ["Drafting the plan", "CURRENT"],
    ]);
    expect(stream?.title).toBe("Growth plan");
  });

  it("claims no earlier stage for a job that did not keep them", () => {
    const stream = jobProgress({
      jobId: JOB,
      title: "Memo",
      missing: false,
      live: live({ stage: stage({ stage: "REVIEWING", draft: 1 }) }),
    });
    expect(stream?.steps.map((step) => step.label)).toEqual([
      "Reviewing evidence",
    ]);
  });

  it("is under way with no step claimed until its first read lands", () => {
    expect(
      jobProgress({ jobId: JOB, title: "Deck", missing: false, live: null }),
    ).toMatchObject({ status: "WORKING", steps: [], title: "Deck" });
  });

  it("says why it waits on the person, or why it failed", () => {
    const waiting = jobProgress({
      jobId: JOB,
      title: "Intro",
      missing: false,
      live: live({
        state: "WAITING",
        reason: "Waiting for your decision on the email.",
        stage: stage({ stage: "DRAFTING", passed: ["SEARCHING"] }),
      }),
    });
    expect(waiting?.status).toBe("WAITING");
    expect(waiting?.note).toBe("Waiting for your decision on the email.");
    expect(waiting?.steps.at(-1)?.state).toBe("DONE");
    const failed = jobProgress({
      jobId: JOB,
      title: "Intro",
      missing: false,
      live: live({
        state: "FAILED",
        reason: "The analysis could not be written; nothing was filed.",
        stage: stage({ stage: "DRAFTING", passed: ["SEARCHING", "READING"] }),
      }),
    });
    expect(failed?.status).toBe("FAILED");
    expect(failed?.steps.at(-1)).toMatchObject({
      label: "Drafting",
      state: "FAILED",
    });
  });

  it("finishes into the document's real actions, by its type", () => {
    const done = jobProgress({
      jobId: JOB,
      title: "Plan",
      missing: false,
      live: live({
        state: "DONE",
        stage: stage({ stage: "FILING", passed: ["DRAFTING", "REVIEWING"] }),
        document: { artifactId: ARTIFACT, type: "MEMO", title: "Nixo memo" },
      }),
    });
    expect(done?.status).toBe("READY");
    expect(done?.title).toBe("Nixo memo");
    expect(done?.steps.every((step) => step.state === "DONE")).toBe(true);
    expect(done?.actions.map((action) => action.label)).toEqual([
      "Open document",
      "Download",
    ]);
    expect(
      documentActions({
        artifactId: ARTIFACT,
        type: "SPREADSHEET",
        title: "x",
      }),
    ).toEqual([
      { kind: "OPEN", label: "Open spreadsheet", artifactId: ARTIFACT },
      {
        kind: "DOWNLOAD",
        label: "Download spreadsheet",
        artifactId: ARTIFACT,
        format: "xlsx",
      },
    ]);
    expect(
      documentActions({
        artifactId: ARTIFACT,
        type: "PITCH_DECK",
        title: "x",
      })[0]?.label,
    ).toBe("Open deck");
  });

  it("is nothing when the job is not theirs to read", () => {
    expect(
      jobProgress({ jobId: JOB, title: "x", missing: true, live: null }),
    ).toBeNull();
  });

  it("carries the real counts of the step in progress, and nothing once done", () => {
    expect(
      jobStepDetail(
        live({
          stage: stage({ stage: "READING", sources: 9, facts: 4 }),
        }),
      ),
    ).toBe("Read 9 public sources, kept 4 sourced facts");
    expect(
      jobStepDetail(live({ state: "DONE", stage: stage({ stage: "FILING" }) })),
    ).toBeNull();
  });
});

describe("several pieces of work at once", () => {
  it("are separate streams, each in its own state, the answer first", () => {
    const answer = runProgress(
      run({
        stages: [
          { stage: "UNDERSTANDING_REQUEST" },
          { stage: "REVIEWING_COMPANY" },
        ],
      }),
    );
    const deck = jobProgress({
      jobId: JOB,
      title: "Deck",
      missing: false,
      live: live({ stage: stage({ stage: "DRAFTING", passed: [] }) }),
    });
    const memo = jobProgress({
      jobId: JOB2,
      title: "Memo",
      missing: false,
      live: live({ jobId: JOB2, state: "FAILED", reason: "Stopped." }),
    });
    const streams = workStreams(answer, [deck, memo, null]);
    expect(streams.map((one) => [one.source, one.status])).toEqual([
      ["RUN", "WORKING"],
      ["JOB", "WORKING"],
      ["JOB", "FAILED"],
    ]);
    expect(workStreams(null, [deck, memo], new Set([JOB2]))).toHaveLength(1);
  });
});

describe("the component", () => {
  const streams = workStreams(
    runProgress(
      run({
        stages: [
          { stage: "UNDERSTANDING_REQUEST" },
          { stage: "SEARCHING_PUBLIC_SOURCES" },
          { stage: "PREPARING_ANALYSIS" },
        ],
      }),
    ),
    [
      jobProgress({
        jobId: JOB,
        title: "Nixo memo",
        missing: false,
        live: live({
          state: "DONE",
          stage: stage({ stage: "FILING", passed: ["DRAFTING"] }),
          document: { artifactId: ARTIFACT, type: "MEMO", title: "Nixo memo" },
        }),
      }),
      jobProgress({
        jobId: JOB2,
        title: "Intro email",
        missing: false,
        live: live({
          jobId: JOB2,
          state: "WAITING",
          reason: "Waiting for your approval to send it.",
          stage: stage({ stage: "DRAFTING", passed: [] }),
        }),
      }),
    ],
  );

  it("draws each stream with its steps, its state in words, and no percentage", () => {
    render(<WorkProgressList streams={streams} />);
    expect(
      document
        .querySelector("[data-q-work-streams]")
        ?.getAttribute("data-q-work-streams"),
    ).toBe("3");
    expect(screen.getByText("Understanding your request")).toBeTruthy();
    expect(screen.getByText("Looking into it")).toBeTruthy();
    expect(screen.getByText("Pulling it together")).toBeTruthy();
    expect(
      document.querySelectorAll('[data-q-work-step="CURRENT"]').length,
    ).toBe(1);
    expect(screen.getByText("Waiting for you")).toBeTruthy();
    expect(
      screen.getByText("Waiting for your approval to send it."),
    ).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\d+\s?%/u);
    // The step in progress turns Q's mark; nothing else moves.
    expect(document.querySelectorAll("[data-working-mark]").length).toBe(1);
  });

  it("opens the finished document in the one viewer", () => {
    render(<WorkProgressList streams={streams} />);
    fireEvent.click(screen.getByText("Open document"));
    expect(opened).toHaveBeenCalledWith(ARTIFACT);
  });

  it("fades a new step up when motion is allowed", () => {
    render(<WorkProgressList streams={streams} />);
    const step = document.querySelector<HTMLElement>("[data-q-work-step]");
    expect(step?.style.opacity).toBe("0");
  });

  it("shows only the newest steps in the dock", () => {
    render(<WorkProgressList streams={streams.slice(0, 1)} compact />);
    expect(document.querySelectorAll("[data-q-work-step]").length).toBe(3);
  });

  it("draws nothing when there is no work", () => {
    const { container } = render(<WorkProgressList streams={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
