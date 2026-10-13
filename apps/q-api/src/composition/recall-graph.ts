import { z } from "zod";

import type { ListQArtifactsResponse } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { CompanyKnowledgePort } from "@capital-q/discovery";
import type {
  GraphConversation,
  GraphDocument,
  GraphJob,
  RecallGraphPort,
} from "@capital-q/q-knowledge";
import type { QRuntimeRepositories } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

import type { AgentWorkQueue } from "./workforce/queue.js";
import {
  DiligenceOutputSchema,
  doneOutputs,
  ReviewOutputSchema,
} from "./workforce/results.js";
import type { Owner, WorkforceStore } from "./workforce/store.js";

/**
 * The connected-recall port (q-knowledge memory/graph.ts) over the
 * canonical stores, each read through the port that already authorises it
 * as the person, so no new authorisation lives here:
 *
 *   conversations  q_runtime, owner and tenant from the actor
 *   jobs           the workforce store and queue, owner from the actor
 *   documents      the artifact service, the actor's own organisation
 *   mandate, names the knowledge port: the actor's own organisation's
 *                  mandate and fit; companies listed to the network only
 *
 * Each read also re-checks the owner on what comes back (defence in
 * depth) and a non-person actor reads nothing. No edge is stored: they
 * are the typed fields these rows already carry, joined on read.
 */

const DocumentStepSchema = z.object({
  artifactId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
});

export function jobOf(
  job: {
    readonly id: string;
    readonly goal: string;
    readonly status: string;
  },
  row:
    | {
        readonly state: string;
        readonly trace: { readonly conversationId?: string | undefined };
        readonly results: Readonly<Record<string, unknown>>;
        readonly finished_at: Date | null;
      }
    | undefined,
): GraphJob {
  const outputs = doneOutputs(row);
  const documents = new Map<string, string | null>();
  for (const one of outputs) {
    const parsed = DocumentStepSchema.safeParse(one);
    if (!parsed.success) continue;
    const known = documents.get(parsed.data.artifactId);
    documents.set(
      parsed.data.artifactId,
      parsed.data.companyId ?? known ?? null,
    );
  }
  const review =
    outputs
      .map((one) => ReviewOutputSchema.safeParse(one))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
      .at(-1) ?? null;
  const diligence =
    outputs
      .map((one) => DiligenceOutputSchema.safeParse(one))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
      .at(-1) ?? null;
  return {
    jobId: job.id,
    goal: job.goal,
    state: row?.state ?? job.status,
    finishedAt: row?.finished_at?.toISOString() ?? null,
    conversationId: row?.trace.conversationId ?? null,
    documents: [...documents].map(([artifactId, companyId]) => ({
      artifactId,
      companyId,
    })),
    review:
      review === null
        ? null
        : {
            artifactId: review.artifactId,
            material: review.review.material ?? null,
            issues: review.review.issues,
            revisedToVersion: review.review.revisedToVersion ?? null,
          },
    diligence:
      diligence === null
        ? null
        : {
            questions: diligence.questions,
            filedForApproval: diligence.qActionId !== undefined,
          },
  };
}

export function documentsOf(
  page: ListQArtifactsResponse,
): readonly GraphDocument[] {
  return page.items.map((item) => ({
    artifactId: item.artifactId,
    type: item.type,
    title: item.title,
    summary: item.summary ?? null,
    companyId: item.subject?.kind === "COMPANY" ? item.subject.companyId : null,
    status: item.status,
    version: item.currentVersion,
    updatedAt: item.updatedAt,
  }));
}

export function createRecallGraphPort(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly repositories: Pick<QRuntimeRepositories, "conversations">;
  readonly store: Pick<WorkforceStore, "listJobs">;
  readonly work: Pick<AgentWorkQueue, "forOwner">;
  /** Read lazily: the artifact service is composed after memory. */
  readonly artifacts: () => {
    readonly list: (
      actor: ActorContext,
      query: { readonly limit: number },
    ) => Promise<ListQArtifactsResponse>;
  };
  readonly knowledge: Pick<
    CompanyKnowledgePort,
    "companies" | "mandateSummary" | "fitSummary"
  >;
}): RecallGraphPort {
  const person = (actor: ActorContext) => actor.actorType === "HUMAN";
  return {
    conversations: async (actor, query) => {
      if (!person(actor)) return [];
      const found = await dependencies.repositories.conversations.listForOwner(
        dependencies.sql,
        actor.tenantId,
        actor.userId,
        { limit: Math.min(Math.max(query.limit, 1), 50) },
      );
      return found.flatMap((c): GraphConversation[] => {
        if (c.tenantId !== actor.tenantId || c.userId !== actor.userId)
          return [];
        const at = c.lastMessageAt ?? c.createdAt;
        if (Date.parse(at) < Date.parse(query.since)) return [];
        if (c.summary === null && c.subjects.length === 0) return [];
        return [
          {
            conversationId: c.id,
            title: c.title,
            summary: c.summary,
            at,
            companyIds: c.subjects.flatMap((s) =>
              s.kind === "COMPANY" ? [s.companyId] : [],
            ),
          },
        ];
      });
    },
    jobs: async (actor, query) => {
      if (!person(actor)) return [];
      const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
      const jobs = (
        await dependencies.store.listJobs(owner, {
          limit: Math.min(Math.max(query.limit, 1), 20),
          before: null,
        })
      ).filter(
        (job) =>
          job.tenant_id === owner.tenantId && job.user_id === owner.userId,
      );
      if (jobs.length === 0) return [];
      const rows = await dependencies.work.forOwner(
        owner,
        jobs.map((job) => job.id),
      );
      const byJob = new Map(
        rows
          .filter(
            (row) =>
              row.tenant_id === owner.tenantId && row.user_id === owner.userId,
          )
          .map((row) => [row.job_id, row]),
      );
      return jobs.map((job) => jobOf(job, byJob.get(job.id)));
    },
    documents: async (actor, query) => {
      // An artifact belongs to an organisation; acting personally, none.
      if (!person(actor) || actor.organisationId === undefined) return [];
      return documentsOf(
        await dependencies.artifacts().list(actor, {
          limit: Math.min(Math.max(query.limit, 1), 50),
        }),
      );
    },
    mandateFit: async (actor) => {
      if (!person(actor)) return null;
      const mandate = await dependencies.knowledge.mandateSummary(actor);
      if (mandate === null) return null;
      const fit = await dependencies.knowledge.fitSummary(
        actor,
        mandate.mandateId,
      );
      // A slate of an older mandate version ranks against what it no
      // longer says: treated as no current slate (unknown), never as fit.
      if (
        fit === null ||
        fit.slateId === null ||
        fit.mandateVersion !== mandate.mandateVersion
      )
        return {
          mandateName: mandate.name,
          mandateVersion: mandate.mandateVersion,
          slateGeneratedAt: null,
          companyIds: null,
        };
      return {
        mandateName: mandate.name,
        mandateVersion: mandate.mandateVersion,
        slateGeneratedAt: fit.slateGeneratedAt,
        companyIds: fit.topCompanyIds,
      };
    },
    companies: async (actor, companyIds) => {
      if (!person(actor) || companyIds.length === 0) return [];
      const found = await dependencies.knowledge.companies(actor, companyIds);
      return [...found.values()].map((c) => ({
        companyId: c.companyId,
        name: c.name,
      }));
    },
  };
}
