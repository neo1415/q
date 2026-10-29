import { createHash } from "node:crypto";

import { QPlanIdSchema } from "@capital-q/contracts";
import type {
  QPlan,
  QPlanCondition,
  QPlanStep,
  QPlanStepStatus,
  QTeamThreadEntry,
} from "@capital-q/contracts";

import type { PlanStore } from "./plan-store.js";
import type { Owner } from "./store.js";

/**
 * The team thread of a plan (S6, design B3; addenda 1-2): a blackboard the
 * orchestrator routes, never peer-to-peer. Everything a step does is an
 * append-only entry:
 *
 *   STATUS   what the person sees ("Started: …", "Done: …") -- code's words;
 *   NOTE     the orchestrator's own bookkeeping, typed and machine-read:
 *            `state <STATUS>` and `link <board_item|job|reminder|action> <id>`
 *            per step (a version's body is immutable; where its steps stand
 *            is this projection);
 *   FINDING  something a step or a condition found;
 *   QUESTION what Q needs the person to answer;
 *   DIRECTION the person's own words to running work (only theirs).
 *
 * Every append carries an idempotency key, so a retried step, a replayed
 * event or a repeated turn writes nothing new. Specialists never address
 * each other: only this module (the orchestrator's) writes NOTE/STATUS.
 */

const STATE_NOTE = /^state (TODO|PROPOSED|WAITING_YOU|DOING|DONE|SKIPPED)$/u;
const LINK_NOTE =
  /^link (board_item|job|reminder|action) ([0-9a-f-]{36}|[A-Za-z0-9_-]{1,64})$/u;

export type StepRuntime = {
  readonly status: QPlanStepStatus;
  readonly boardItemId: string | null;
  readonly jobId: string | null;
  readonly reminderId: string | null;
  readonly actionId: string | null;
};

const EMPTY: StepRuntime = {
  status: "TODO",
  boardItemId: null,
  jobId: null,
  reminderId: null,
  actionId: null,
};

/** Where each step stands, from the thread's NOTE entries, oldest first. */
export function stepRuntimes(
  entries: readonly QTeamThreadEntry[],
): ReadonlyMap<string, StepRuntime> {
  const out = new Map<string, StepRuntime>();
  for (const entry of entries) {
    if (entry.kind !== "NOTE" || entry.stepKey === null) continue;
    const before = out.get(entry.stepKey) ?? EMPTY;
    const state = STATE_NOTE.exec(entry.text);
    if (state !== null) {
      out.set(entry.stepKey, {
        ...before,
        status: state[1] as QPlanStepStatus,
      });
      continue;
    }
    const link = LINK_NOTE.exec(entry.text);
    if (link !== null) {
      const id = link[2] ?? null;
      out.set(entry.stepKey, {
        ...before,
        ...(link[1] === "board_item" ? { boardItemId: id } : {}),
        ...(link[1] === "job" ? { jobId: id } : {}),
        ...(link[1] === "reminder" ? { reminderId: id } : {}),
        ...(link[1] === "action" ? { actionId: id } : {}),
      });
    }
  }
  return out;
}

export function runtimeOf(
  runtimes: ReadonlyMap<string, StepRuntime>,
  key: string,
): StepRuntime {
  return runtimes.get(key) ?? EMPTY;
}

/**
 * The status line the person sees for a step moving to `status` (code's
 * words). PROPOSED says "ready for your approval" only when an approval
 * card exists for it (`prepared`); otherwise Q has yet to prepare it (live
 * 2026-10-29: "Ready for your approval" with no approval behind it).
 */
export function statusLine(
  step: QPlanStep,
  status: QPlanStepStatus,
  prepared = true,
): string {
  const title = step.title.replace(/[.\s]+$/u, "");
  switch (status) {
    case "DOING":
      return `Started: ${title}`;
    case "DONE":
      return `Done: ${title}`;
    case "PROPOSED":
      return prepared
        ? `Ready for your approval: ${title}`
        : `Q will prepare it for your approval: ${title}`;
    case "WAITING_YOU":
      return `Your part: ${title}`;
    case "SKIPPED":
      return `Skipped: ${title}`;
    case "TODO":
      return `To do: ${title}`;
  }
}

const shortHash = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);

export type PlanThread = ReturnType<typeof createPlanThread>;

export function createPlanThread(
  store: Pick<PlanStore, "appendThread" | "readThread">,
) {
  const note = (
    owner: Owner,
    plan: Pick<QPlan, "planId" | "version">,
    stepKey: string,
    text: string,
  ) =>
    store.appendThread(owner, {
      planId: plan.planId,
      jobId: null,
      kind: "NOTE",
      author: "WORKER",
      stepKey,
      factRef: null,
      text,
      idempotencyKey: `plan-note:${plan.planId}:${String(plan.version)}:${stepKey}:${shortHash(text)}`,
    });

  return {
    /** A step moves: its NOTE (machine) and its STATUS line (the person's). */
    move: async (
      owner: Owner,
      plan: Pick<QPlan, "planId" | "version">,
      step: QPlanStep,
      status: QPlanStepStatus,
      options: { readonly prepared?: boolean } = {},
    ): Promise<void> => {
      const prepared = options.prepared ?? true;
      await note(owner, plan, step.key, `state ${status}`);
      await store.appendThread(owner, {
        planId: plan.planId,
        jobId: null,
        kind: "STATUS",
        author: "WORKER",
        stepKey: step.key,
        factRef: null,
        text: statusLine(step, status, prepared),
        idempotencyKey: `plan-status:${plan.planId}:${String(plan.version)}:${step.key}:${status}${prepared || status !== "PROPOSED" ? "" : ":unprepared"}`,
      });
    },
    /** A step of theirs that could not be put on their board: said plainly. */
    notPlaced: async (
      owner: Owner,
      plan: Pick<QPlan, "planId" | "version">,
      step: QPlanStep,
    ): Promise<void> => {
      await store.appendThread(owner, {
        planId: plan.planId,
        jobId: null,
        kind: "STATUS",
        author: "WORKER",
        stepKey: step.key,
        factRef: null,
        text: `Couldn't put it on your board yet: ${step.title.replace(/[.\s]+$/u, "")}`,
        idempotencyKey: `plan-status:${plan.planId}:${String(plan.version)}:${step.key}:NOT_PLACED`,
      });
    },
    link: async (
      owner: Owner,
      plan: Pick<QPlan, "planId" | "version">,
      stepKey: string,
      what: "board_item" | "job" | "reminder" | "action",
      id: string,
    ): Promise<void> => {
      await note(owner, plan, stepKey, `link ${what} ${id}`);
    },
    /** A finding (a condition held, something read), said once per key. */
    finding: async (
      owner: Owner,
      planId: string,
      stepKey: string | null,
      text: string,
      key: string,
    ): Promise<void> => {
      await store.appendThread(owner, {
        planId: QPlanIdSchema.parse(planId),
        jobId: null,
        kind: "FINDING",
        author: "WORKER",
        stepKey,
        factRef: null,
        text: text.slice(0, 1_000),
        idempotencyKey: `plan-finding:${planId}:${key}`.slice(0, 200),
      });
    },
    /**
     * The person's direction to running work, once per turn (S6): on the
     * plan's thread when there is one, else on the job's.
     */
    direct: (
      owner: Owner,
      target: { readonly planId: string } | { readonly jobId: string },
      text: string,
      turnKey: string,
    ) =>
      store.appendThread(owner, {
        planId: "planId" in target ? QPlanIdSchema.parse(target.planId) : null,
        jobId: "jobId" in target ? target.jobId : null,
        kind: "DIRECTION",
        author: "PERSON",
        stepKey: null,
        factRef: null,
        text: text.trim().slice(0, 1_000),
        idempotencyKey: `direction:${turnKey}`.slice(0, 200),
      }),
    /** Every step's runtime (all NOTE entries, bounded by the store). */
    runtimes: async (
      owner: Owner,
      planId: string,
    ): Promise<ReadonlyMap<string, StepRuntime>> =>
      stepRuntimes(
        await store.readThread(
          owner,
          { planId },
          { kinds: ["NOTE"], all: true },
        ),
      ),
    /** The person's directions after `afterSeq`, oldest first (bounded). */
    directions: (
      owner: Owner,
      target: { readonly planId: string } | { readonly jobId: string },
      afterSeq = 0,
    ) => store.readThread(owner, target, { kinds: ["DIRECTION"], afterSeq }),
  };
}

/**
 * Code's dependency rule (no model judgement): a step that needs the
 * person's approval waits for the nearest earlier step of theirs (YOU)
 * whose cited facts it shares -- the same grounding means the person's
 * part feeds it. Never a cycle (only earlier steps), at most one wait.
 */
export function derivedWaits(
  steps: readonly QPlanStep[],
): readonly QPlanStep[] {
  return steps.map((step, index) => {
    if (!step.needsApproval || step.owner === "YOU") return step;
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      const before = steps[earlier];
      if (before === undefined || before.owner !== "YOU") continue;
      if (before.cites.some((cite) => step.cites.includes(cite))) {
        const waits: QPlanCondition[] = [
          { kind: "STEP_DONE", stepKey: before.key },
        ];
        return { ...step, waitsFor: waits };
      }
    }
    return step;
  });
}
