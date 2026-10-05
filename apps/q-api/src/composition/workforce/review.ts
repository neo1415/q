import { workforceCorrelationId } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  DEFAULT_REVIEW_POLICY,
  RUBRIC_VERSION,
  writeWithReview,
  type HoldReason,
  type ReviewPolicy,
} from "@capital-q/q-orchestrator";
import type { DraftChannel, DraftStage } from "@capital-q/q-core";

import type { WorkforceModels } from "./models.js";
import type { JobSourceKind, Owner, WorkforceStore } from "./store.js";

/**
 * Every outward message passes the reviewer (founder brief J2).
 *
 * One service for every path that writes to the other side on a person's
 * behalf: standing-instruction messages, delegated-work replies, errand
 * replies, meeting follow-up recaps and email drafts. The path's own
 * writer produces the first draft as before; this files it under the
 * path's job (one job per instruction, delegation, errand, meeting or
 * email), runs the writer -> reviewer loop and answers PASSED (the body to
 * send or offer, perhaps redrafted) or HELD (not sent and not offered; the
 * person sees the draft, the grade and the feedback on the workforce
 * page). The caller then says what it did with a passed draft (`settle`).
 *
 * Recording never stops the work: without a store, or when a write fails,
 * the review still runs and its verdict still binds.
 */

export const DRAFT_REVIEW_PROMPT_VERSION = "draft-review/v1" as const;

export type OutwardSource = {
  readonly kind: Exclude<JobSourceKind, "JOB">;
  readonly id: string;
  /** What the work is, for the job's title. */
  readonly goal: string;
};

export type OutwardDraft = {
  readonly principalName: string;
  readonly counterpartName: string;
  readonly channel: DraftChannel;
  readonly stage: DraftStage;
  /** What the message is for, in code's words. */
  readonly purpose: string;
  /** What it may state as fact (the brief, the authorised material). */
  readonly material: string;
  readonly thread: string;
  readonly body: string;
};

export type OutwardVerdict =
  | {
      readonly verdict: "PASSED";
      readonly body: string;
      readonly score: number;
      readonly attempts: number;
      readonly jobId: string | null;
      readonly draftId: string | null;
    }
  | {
      readonly verdict: "HELD";
      readonly reason: HoldReason;
      readonly body: string;
      readonly score: number | null;
      readonly feedback: string;
      readonly jobId: string | null;
      readonly draftId: string | null;
    };

/**
 * A message's job, writer and reviewer runs, filed before its first draft
 * is written so the writer's own call is priced under the job (J6).
 */
export type PreparedDraft = {
  readonly jobId: string;
  readonly writer: string;
  readonly reviewer: string;
  readonly policy: { readonly threshold: number; readonly maxRedrafts: number };
  /** The correlation id the first draft's model call carries. */
  readonly correlationId: string;
};

export type OutwardReview = {
  /** Files the job and runs before the first draft; null without a store. */
  readonly prepare: (
    who: Owner,
    source: OutwardSource,
    draft: Pick<OutwardDraft, "channel" | "counterpartName">,
  ) => Promise<PreparedDraft | null>;
  readonly review: (
    who: Owner,
    source: OutwardSource,
    draft: OutwardDraft,
    options?: {
      /** Code's own checks, re-run on a redraft. A string is the problem. */
      readonly recheck?: ((body: string) => string | null) | undefined;
      /** A job planned by the lead Q files the draft under its own run. */
      readonly job?:
        { readonly jobId: string; readonly parentRunId: string } | undefined;
      /** Filed already, before the first draft was written. */
      readonly prepared?: PreparedDraft | null | undefined;
    },
  ) => Promise<OutwardVerdict>;
  /** A prepared message the writer had nothing honest for: its runs end. */
  readonly abandon: (who: Owner, prepared: PreparedDraft) => Promise<void>;
  /** What happened to a passed draft: sent by Q, or offered for approval. */
  readonly settle: (
    who: Owner,
    verdict: OutwardVerdict,
    outcome: "SENT" | "OFFERED",
    qActionId?: string | null,
  ) => Promise<void>;
};

/** The words a held draft carries back to the person. */
export function heldLine(verdict: OutwardVerdict, counterpart: string): string {
  if (verdict.verdict === "PASSED") return "";
  const why: Record<HoldReason, string> = {
    BELOW_BAR: `didn't reach your bar${verdict.score === null ? "" : ` (scored ${String(verdict.score)})`}`,
    INTEGRITY: "would have said something Capital Q can't stand behind",
    REVIEW_UNAVAILABLE: "couldn't be checked just now",
    WRITER_GAVE_UP: "couldn't be written honestly from what you approved",
    CODE_CHECK: "broke one of the rules for this conversation when redrafted",
  };
  return `Q held a message to ${counterpart.slice(0, 80)}: it ${why[verdict.reason]}. You can read it on your workforce page and send your own.`.slice(
    0,
    300,
  );
}

export function createOutwardReview(dependencies: {
  readonly models: Pick<WorkforceModels, "review" | "redraft">;
  readonly store?: WorkforceStore | undefined;
  readonly policy?: ReviewPolicy | undefined;
  readonly logger?: Logger | undefined;
}): OutwardReview {
  const { store, logger } = dependencies;
  const basePolicy = dependencies.policy ?? DEFAULT_REVIEW_POLICY;

  async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      logger?.warn({ err: error }, "workforce record not written");
      return fallback;
    }
  }

  async function file(
    who: Owner,
    source: OutwardSource,
    draft: Pick<OutwardDraft, "channel" | "counterpartName">,
    job: { readonly jobId: string; readonly parentRunId: string } | undefined,
  ): Promise<PreparedDraft | null> {
    if (store === undefined) return null;
    return quietly(async () => {
      const filedJob =
        job === undefined
          ? await store.ensureJob(who, {
              source: { kind: source.kind, id: source.id },
              goal: source.goal,
              budgetUsd: 0.5,
              threshold: basePolicy.threshold,
              maxRedrafts: basePolicy.maxRedrafts,
              rubricVersion: RUBRIC_VERSION,
            })
          : null;
      const jobId = job?.jobId ?? filedJob?.job.id ?? null;
      const parent = job?.parentRunId ?? filedJob?.leadRunId ?? null;
      if (jobId === null || parent === null) return null;
      const goal = `${draft.channel === "EMAIL" ? "Email" : "Message"} to ${draft.counterpartName}`;
      const writer = await store.startRun(who, {
        jobId,
        role: "WRITER",
        agentName: "Writer",
        goal,
        tools: [],
        budgetUsd: 0.1,
        stepKey: null,
        spawnedByRunId: parent,
      });
      const reviewer = await store.startRun(who, {
        jobId,
        role: "REVIEWER",
        agentName: "Reviewer",
        goal: `Grade: ${goal}`,
        tools: [],
        budgetUsd: 0.1,
        stepKey: null,
        spawnedByRunId: parent,
      });
      return {
        jobId,
        writer,
        reviewer,
        policy: {
          threshold: filedJob?.job.review_threshold ?? basePolicy.threshold,
          maxRedrafts: filedJob?.job.max_redrafts ?? basePolicy.maxRedrafts,
        },
        correlationId: workforceCorrelationId(jobId, writer),
      };
    }, null);
  }

  return {
    prepare: (who, source, draft) => file(who, source, draft, undefined),

    abandon: async (who, prepared) => {
      if (store === undefined) return;
      await quietly(async () => {
        await store.endRun(who, prepared.writer, "DONE", "Nothing to say yet.");
        await store.endRun(
          who,
          prepared.reviewer,
          "SKIPPED",
          "Nothing to grade.",
        );
      }, undefined);
    },

    review: async (who, source, draft, options) => {
      // The job, its lead, and this message's writer and reviewer runs.
      const filed =
        options?.prepared ?? (await file(who, source, draft, options?.job));
      const policy = filed?.policy ?? basePolicy;
      const frame = {
        principalName: draft.principalName.slice(0, 120),
        counterpartName: draft.counterpartName.slice(0, 200),
        channel: draft.channel,
        stage: draft.stage,
        purpose: draft.purpose.slice(0, 600),
        material: draft.material.slice(0, 6_000),
        thread: draft.thread.slice(-8_000),
      };
      const reviewTrace =
        filed === null ? null : { jobId: filed.jobId, runId: filed.reviewer };
      const writerTrace =
        filed === null ? null : { jobId: filed.jobId, runId: filed.writer };
      const outcome = await writeWithReview(
        draft.body,
        {
          review: (body) =>
            dependencies.models.review(who, reviewTrace, {
              ...frame,
              draft: body.slice(0, 4_000),
            }),
          redraft: (body, feedback) =>
            dependencies.models.redraft(who, writerTrace, {
              ...frame,
              draft: body.slice(0, 4_000),
              feedback: feedback.slice(0, 2_000),
            }),
          recheck: options?.recheck,
          ...(filed === null || store === undefined
            ? {}
            : {
                onDraft: (one) =>
                  store.addDraft(who, {
                    jobId: filed.jobId,
                    writerRunId: filed.writer,
                    attempt: one.attempt,
                    parentDraftId: one.parentDraftId,
                    channel: draft.channel,
                    counterpartName: draft.counterpartName,
                    body: one.body,
                  }),
                onGrade: async (draftId, grade) => {
                  if (draftId === null) return;
                  await store.addGrade(who, {
                    jobId: filed.jobId,
                    draftId,
                    reviewerRunId: filed.reviewer,
                    grade,
                    threshold: policy.threshold,
                    maxRedrafts: policy.maxRedrafts,
                    rubricVersion: RUBRIC_VERSION,
                    promptVersion: DRAFT_REVIEW_PROMPT_VERSION,
                  });
                },
                onHandoff: (handoff) =>
                  store.handoff(who, {
                    jobId: filed.jobId,
                    fromRunId:
                      handoff.from === "WRITER" ? filed.writer : filed.reviewer,
                    toRunId:
                      handoff.to === "WRITER" ? filed.writer : filed.reviewer,
                    draftId: handoff.draftId,
                    note: handoff.note,
                  }),
              }),
        },
        policy,
      );
      if (filed !== null && store !== undefined) {
        await quietly(async () => {
          const passed = outcome.verdict === "PASSED";
          await store.endRun(
            who,
            filed.writer,
            passed ? "DONE" : "HELD",
            passed
              ? `Wrote it in ${String(outcome.attempts)} ${outcome.attempts === 1 ? "draft" : "drafts"}.`
              : "Its draft was held.",
          );
          await store.endRun(
            who,
            filed.reviewer,
            passed ? "DONE" : "HELD",
            outcome.grade === null
              ? "Couldn't grade it."
              : `Scored ${String(outcome.grade.score)} against a bar of ${String(policy.threshold)}.`,
          );
          if (outcome.verdict === "HELD" && outcome.draftId !== null) {
            await store.addOutcome(who, {
              jobId: filed.jobId,
              draftId: outcome.draftId,
              outcome: "HELD",
              reason: outcome.reason,
              qActionId: null,
            });
          }
        }, undefined);
      }
      const jobId = filed?.jobId ?? null;
      return outcome.verdict === "PASSED"
        ? {
            verdict: "PASSED",
            body: outcome.body,
            score: outcome.grade.score,
            attempts: outcome.attempts,
            jobId,
            draftId: outcome.draftId,
          }
        : {
            verdict: "HELD",
            reason: outcome.reason,
            body: outcome.body,
            score: outcome.grade?.score ?? null,
            feedback: outcome.grade?.feedback ?? "",
            jobId,
            draftId: outcome.draftId,
          };
    },

    settle: async (who, verdict, outcome, qActionId = null) => {
      if (
        store === undefined ||
        verdict.verdict !== "PASSED" ||
        verdict.jobId === null ||
        verdict.draftId === null
      ) {
        return;
      }
      const { jobId, draftId } = verdict;
      await quietly(
        () =>
          store.addOutcome(who, {
            jobId,
            draftId,
            outcome,
            reason: null,
            qActionId,
          }),
        undefined,
      );
    },
  };
}

/**
 * A writer's structured reply, through the reviewer: a passing draft
 * replaces the reply (perhaps redrafted); a held one is no reply, and the
 * person is told why beside the writer's own notes for them. Without a
 * reviewer, or with nothing to send, the result is unchanged.
 */
export async function reviewedReply<
  T extends {
    readonly reply: string | null;
    readonly forPerson: readonly string[];
  },
>(
  review: OutwardReview | undefined,
  who: Owner,
  source: OutwardSource,
  draft: Omit<OutwardDraft, "body">,
  result: T | null,
  /**
   * Told the passing verdict, so the caller records "sent" (`settle`) once
   * its own sender has really sent the graded text.
   */
  onPassed?: ((verdict: OutwardVerdict) => void)  ,
  /** Filed before the first draft, which was priced under the job. */
  prepared?: PreparedDraft | null  ,
): Promise<T | null> {
  if (review === undefined || result === null || result.reply === null) {
    if (review !== undefined && prepared != null) {
      await review.abandon(who, prepared);
    }
    return result;
  }
  const verdict = await review.review(
    who,
    source,
    { ...draft, body: result.reply },
    { prepared },
  );
  if (verdict.verdict === "PASSED") {
    onPassed?.(verdict);
    // Released to the path's own sender, which still applies its own
    // checks (the consider step, caps); what it sends is the graded text.
    return { ...result, reply: verdict.body };
  }
  return {
    ...result,
    reply: null,
    forPerson: [
      ...result.forPerson,
      heldLine(verdict, draft.counterpartName),
    ].slice(0, 5),
  };
}

/**
 * Passed drafts waiting for their path's own sender (J5: delegated replies
 * record "sent"). The orchestrator decides when a reply goes, so the
 * verdict is kept here by its scope and exact text and taken when that
 * text is really sent. In memory and bounded: a restart between grading
 * and sending loses only the "sent" line, never the message or its grade.
 */
export function createPassedDrafts(limit = 500) {
  const waiting = new Map<string, OutwardVerdict>();
  const key = (scope: string, body: string) => `${scope}\u0000${body.trim()}`;
  return {
    remember: (scope: string, verdict: OutwardVerdict) => {
      if (verdict.verdict !== "PASSED") return;
      waiting.set(key(scope, verdict.body), verdict);
      while (waiting.size > limit) {
        const oldest = waiting.keys().next().value;
        if (oldest === undefined) break;
        waiting.delete(oldest);
      }
    },
    take: (scope: string, body: string): OutwardVerdict | null => {
      const found = waiting.get(key(scope, body)) ?? null;
      waiting.delete(key(scope, body));
      return found;
    },
  };
}
