import { z } from "zod";

import type { QArtifactDetail } from "@capital-q/contracts";
import type { QWorkJobResult } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import { REVIEWER_REVISION_PREFIX } from "./documents.js";
import { progressOf } from "./progress.js";
import type { AgentWorkQueue, WorkRow } from "./queue.js";
import type { Owner, WorkforceStore } from "./store.js";

/** Jobs considered per read, and jobs reported in full. */
const JOBS_SCANNED = 10;
const JOBS_REPORTED = 3;

/** A critique step's persisted verdict (jobs.ts writes `outputs.review`). */
export const ReviewOutputSchema = z.object({
  artifactId: z.string().uuid(),
  review: z.object({
    // Older or partial records may lack these; absence is unknown, never "no change".
    material: z.boolean().optional(),
    issues: z
      .array(
        z.object({
          kind: z.string(),
          section: z.string(),
          problem: z.string(),
        }),
      )
      .max(50),
    revisedToVersion: z.number().int().min(1).nullable().optional(),
  }),
});

/** A diligence step's persisted questions (jobs.ts writes `outputs.questions`). */
export const DiligenceOutputSchema = z.object({
  questions: z.array(z.string()).min(1).max(20),
  qActionId: z.string().uuid().optional(),
});

const DoneStepSchema = z.object({
  status: z.literal("DONE"),
  outputs: z.record(z.string(), z.unknown()),
});

/**
 * The documents a job's finished steps filed, by artifact id, as each
 * step recorded it (the job's stored results are a trust boundary).
 */
export function filedDocumentIds(
  row: Pick<WorkRow, "results"> | undefined,
): readonly string[] {
  return [
    ...new Set(
      doneOutputs(row).flatMap((outputs) => {
        const parsed = z
          .object({ artifactId: z.string().uuid() })
          .safeParse(outputs);
        return parsed.success ? [parsed.data.artifactId] : [];
      }),
    ),
  ].slice(0, 12);
}

export function doneOutputs(
  row: Pick<WorkRow, "results"> | undefined,
): readonly unknown[] {
  return Object.values(row?.results ?? {}).flatMap((result) => {
    const parsed = DoneStepSchema.safeParse(result);
    return parsed.success ? [parsed.data.outputs] : [];
  });
}

/** The headings whose text differs between two versions of one document. */
export function sectionsChanged(
  before: QArtifactDetail,
  after: QArtifactDetail,
): readonly string[] | null {
  if (before.current === undefined || after.current === undefined) return null;
  const old = new Map(
    before.current.content.sections.map((section) => [
      section.heading,
      section.body,
    ]),
  );
  const fresh = new Set<string>();
  const changed: string[] = [];
  for (const section of after.current.content.sections) {
    fresh.add(section.heading);
    if (old.get(section.heading) !== section.body)
      changed.push(section.heading);
  }
  for (const heading of old.keys()) {
    if (!fresh.has(heading)) changed.push(`Removed: ${heading}`);
  }
  // What it states as not known is part of the document too.
  if (
    JSON.stringify(before.current.content.gaps) !==
    JSON.stringify(after.current.content.gaps)
  )
    changed.push("Stated as not known");
  return changed;
}

/**
 * The person's own workforce jobs as their steps persisted them, for Q to
 * report in conversation: what the reviewer found and changed between the
 * memo and its revision, and the diligence questions exactly as filed.
 * Owner-only by construction (the store and queue reads name the owner);
 * documents are read again through the artifact service as the person, so
 * a document they can no longer read contributes nothing.
 */
export function createWorkforceJobResults(dependencies: {
  readonly store: Pick<WorkforceStore, "listJobs">;
  readonly work: Pick<AgentWorkQueue, "forOwner">;
  readonly artifacts?:
    | {
        /** The artifact with its version history (no content), as the person. */
        readonly read?:
          | ((
              actor: ActorContext,
              artifactId: string,
            ) => Promise<QArtifactDetail>)
          | undefined;
        readonly readVersion: (
          actor: ActorContext,
          artifactId: string,
          version: number,
        ) => Promise<QArtifactDetail>;
      }
    | undefined;
  /** The conversation a run belongs to, read as the person; null: unknown. */
  readonly conversationOf?:
    | ((actor: ActorContext, runId: string) => Promise<string | null>)
    | undefined;
}) {
  async function review(
    actor: ActorContext,
    outputs: readonly unknown[],
  ): Promise<QWorkJobResult["review"]> {
    // The last critique the job recorded (one per job today).
    const found = outputs
      .map((one) => ReviewOutputSchema.safeParse(one))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
      .at(-1);
    if (found === undefined) return null;
    // The reviewer's revision: as recorded, else the version the artifact's
    // own history marks as the reviewer's (read as the person).
    let to = found.review.revisedToVersion ?? null;
    if (
      to === null &&
      found.review.material !== false &&
      dependencies.artifacts?.read !== undefined
    ) {
      const detail = await dependencies.artifacts
        .read(actor, found.artifactId)
        .catch(() => null);
      to =
        detail?.history.find(
          (entry) =>
            entry.instruction?.startsWith(REVIEWER_REVISION_PREFIX) === true,
        )?.version ?? null;
    }
    const revised = found.review.material !== false && to !== null;
    const outcome: NonNullable<QWorkJobResult["review"]>["outcome"] = revised
      ? "REVISED"
      : found.review.material === false
        ? "NO_CHANGE_NEEDED"
        : "UNKNOWN";
    let documentTitle: string | null = null;
    let revisionNote: string | null = null;
    let changed: readonly string[] | null = null;
    if (dependencies.artifacts !== undefined && to !== null) {
      const read = (version: number) =>
        dependencies.artifacts
          ?.readVersion(actor, found.artifactId, version)
          .catch(() => null) ?? Promise.resolve(null);
      const [after, before] = await Promise.all([
        read(to),
        revised && to > 1 ? read(to - 1) : Promise.resolve(null),
      ]);
      if (after !== null) {
        documentTitle = after.artifact.title;
        const instruction = after.current?.instruction;
        revisionNote =
          instruction?.startsWith(REVIEWER_REVISION_PREFIX) === true
            ? instruction.slice(REVIEWER_REVISION_PREFIX.length).trim() || null
            : null;
        if (before !== null) changed = sectionsChanged(before, after);
      }
    }
    return {
      outcome,
      documentTitle,
      findings: found.review.issues.map((issue) => ({
        kind: issue.kind,
        section: issue.section,
        problem: issue.problem,
      })),
      fromVersion: revised && to !== null && to > 1 ? to - 1 : null,
      toVersion: revised ? to : null,
      revisionNote,
      sectionsChanged: revised
        ? changed
        : outcome === "NO_CHANGE_NEEDED"
          ? []
          : null,
    };
  }

  function diligence(outputs: readonly unknown[]): QWorkJobResult["diligence"] {
    const found = outputs
      .map((one) => DiligenceOutputSchema.safeParse(one))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
      .at(-1);
    return found === undefined
      ? null
      : {
          questions: [...found.questions],
          filedForApproval: found.qActionId !== undefined,
        };
  }

  return async (
    actor: ActorContext,
    context: { readonly runId: string },
  ): Promise<readonly QWorkJobResult[]> => {
    const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
    const jobs = (
      await dependencies.store.listJobs(owner, {
        limit: JOBS_SCANNED,
        before: null,
      })
    ).filter(
      (job) =>
        job.source_kind === "JOB" &&
        job.tenant_id === owner.tenantId &&
        job.user_id === owner.userId,
    );
    if (jobs.length === 0) return [];
    const [rows, conversationId] = await Promise.all([
      dependencies.work.forOwner(
        owner,
        jobs.map((job) => job.id),
      ),
      (
        dependencies.conversationOf?.(actor, context.runId) ??
        Promise.resolve(null)
      ).catch(() => null),
    ]);
    const byJob = new Map(
      rows
        .filter(
          (row) =>
            row.tenant_id === owner.tenantId && row.user_id === owner.userId,
        )
        .map((row) => [row.job_id, row]),
    );
    const placed = jobs.map((job) => {
      const row = byJob.get(job.id);
      const from = row?.trace.conversationId;
      return {
        job,
        row,
        inThisConversation:
          conversationId === null || from === undefined
            ? null
            : from === conversationId,
      };
    });
    // This conversation's jobs first; otherwise newest first (the store's order).
    const chosen = [
      ...placed.filter((one) => one.inThisConversation === true),
      ...placed.filter((one) => one.inThisConversation !== true),
    ].slice(0, JOBS_REPORTED);
    return Promise.all(
      chosen.map(async ({ job, row, inThisConversation }) => {
        const outputs = doneOutputs(row);
        const progress = progressLine(row);
        return {
          jobId: job.id,
          goal: job.goal,
          state: row?.state ?? job.status,
          finishedAt: row?.finished_at?.toISOString() ?? null,
          inThisConversation,
          review: await review(actor, outputs),
          diligence: diligence(outputs),
          ...(progress === null ? {} : { progress }),
        };
      }),
    );
  };
}

/**
 * wf: where the plan stands for Q to say back -- done of total, what is
 * still running or waiting, what was found, and what is next (code's words
 * from the recorded plan). Null: no approved plan is on record.
 */
export function progressLine(
  row: WorkRow | undefined,
): QWorkJobResult["progress"] {
  const plan = progressOf(row);
  if (plan === undefined) return null;
  return {
    outcome: plan.outcome,
    done: plan.done,
    total: plan.total,
    open: plan.steps
      .filter((step) => step.status !== "DONE" && step.status !== "NOT_NEEDED")
      .map(
        (step) =>
          `${step.who}: ${step.does} (${step.status.toLowerCase()}${step.summary === null ? "" : `: ${step.summary}`})`,
      )
      .slice(0, 6),
    found: plan.signals
      .map(
        (one) => `${one.kind.toLowerCase().replaceAll("_", " ")}: ${one.note}`,
      )
      .slice(0, 6),
    next: plan.nextActions
      .map(
        (one) =>
          `${one.action}${one.needsApproval ? " (needs their approval)" : ""}`,
      )
      .slice(0, 6),
  };
}
