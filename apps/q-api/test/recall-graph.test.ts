import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ListQArtifactsResponse } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type {
  CompanyKnowledge,
  FitSummary,
  MandateSummary,
} from "@capital-q/discovery";
import type { QConversation } from "@capital-q/q-runtime";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createRecallGraphPort,
  jobOf,
} from "../src/composition/recall-graph.js";
import type { WorkRow } from "../src/composition/workforce/queue.js";
import {
  createInMemoryWorkforceStore,
  type Owner,
} from "../src/composition/workforce/store.js";

/**
 * The connected-recall adapter: every hop goes through the port that
 * already authorises it as the person, the owner is re-checked on what
 * comes back, the persisted step outputs become typed edges, and a stale
 * or missing slate is fit unknown.
 */

const tenantId = randomUUID();
const organisationId = randomUUID();
const ownerA: Owner = { tenantId, userId: randomUUID() };
const ownerB: Owner = { tenantId, userId: randomUUID() };
const actorOf = (
  owner: Owner,
  over: Partial<ActorContext> = {},
): ActorContext =>
  ActorContextSchema.parse({
    tenantId: owner.tenantId,
    userId: owner.userId,
    organisationId,
    membershipId: randomUUID(),
    actorType: "HUMAN",
    ...over,
  });
const companyId = randomUUID();
const artifactId = randomUUID();
const at = new Date("2026-10-05T09:00:00Z");
const sql = (() => Promise.resolve([])) as unknown as DatabaseExecutor;

function workRow(owner: Owner, jobId: string): WorkRow {
  return {
    job_id: jobId,
    tenant_id: owner.tenantId,
    user_id: owner.userId,
    state: "COMPLETED",
    plan: {},
    trace: { conversationId: "c-1" },
    results: {
      // A critique step's outputs carry no companyId; the memo's does.
      critique: {
        status: "DONE",
        outputs: {
          artifactId,
          review: {
            material: true,
            issues: [
              {
                kind: "UNSUPPORTED",
                section: "Traction",
                problem: "No source.",
              },
            ],
            revisedToVersion: 2,
          },
        },
      },
      memo: { status: "DONE", outputs: { artifactId, companyId } },
      diligence: {
        status: "DONE",
        outputs: { questions: ["What is churn?"], qActionId: randomUUID() },
      },
      failed: {
        status: "FAILED",
        outputs: { artifactId: randomUUID(), companyId },
      },
    },
    attempts: 1,
    max_attempts: 3,
    reason: null,
    created_at: at,
    updated_at: at,
    finished_at: at,
  };
}

function conversation(
  owner: Owner,
  over: Partial<QConversation> = {},
): QConversation {
  return {
    id: randomUUID(),
    tenantId: owner.tenantId,
    userId: owner.userId,
    organisationId: null,
    contextType: "ORGANISATION",
    subjects: [{ kind: "COMPANY", companyId }],
    title: "Tensorgate",
    summary: "Talked about Tensorgate.",
    summaryThrough: null,
    lastMessageAt: "2026-10-10T09:00:00.000Z",
    createdAt: "2026-10-01T09:00:00.000Z",
    archivedAt: null,
    ...over,
  } as QConversation;
}

const mandate = {
  mandateId: randomUUID(),
  investorOrganisationId: randomUUID(),
  name: "Savanna Seed Fund I",
  status: "ACTIVE",
  mandateVersion: 3,
} as MandateSummary;
const fit = (over: Partial<FitSummary> = {}): FitSummary => ({
  mandateId: mandate.mandateId,
  mandateVersion: 3,
  slateId: randomUUID(),
  slateGeneratedAt: "2026-10-11T00:00:00.000Z",
  slateItemCount: 1,
  topCompanyIds: [companyId],
  eligibleCount: 1,
  version: "1",
  updatedAt: "2026-10-11T00:00:00.000Z",
  ...over,
});

async function setup(
  options: { fit?: FitSummary | null; conversations?: QConversation[] } = {},
) {
  const store = createInMemoryWorkforceStore();
  const ensure = (owner: Owner, id: string) =>
    store.ensureJob(owner, {
      source: { kind: "JOB", id },
      goal: "Memo on Tensorgate",
      budgetUsd: 0.5,
      threshold: 80,
      maxRedrafts: 2,
      rubricVersion: "rubric/v1",
    });
  const { job } = await ensure(ownerA, "a");
  const { job: theirs } = await ensure(ownerB, "b");
  const listed: { actor: ActorContext; limit: number }[] = [];
  const port = createRecallGraphPort({
    sql,
    repositories: {
      conversations: {
        listForOwner: (_sql: unknown, tenant: string, user: string) =>
          Promise.resolve(
            // A misbehaving store returning someone else's row is filtered.
            options.conversations ??
              [conversation(ownerA), conversation(ownerB)].filter(
                (c) =>
                  c.tenantId === tenant &&
                  (c.userId === user || c.userId === ownerB.userId),
              ),
          ),
      } as never,
    },
    store,
    work: {
      // Also returns another owner's row: the adapter re-checks.
      forOwner: () =>
        Promise.resolve([workRow(ownerA, job.id), workRow(ownerB, theirs.id)]),
    },
    artifacts: () => ({
      list: (actor, query) => {
        listed.push({ actor, limit: query.limit });
        return Promise.resolve({
          items: [
            {
              artifactId,
              type: "MEMO",
              status: "READY",
              title: "Tensorgate memo",
              summary: "Seed memo",
              subject: { kind: "COMPANY", companyId },
              currentVersion: 2,
              createdAt: at.toISOString(),
              updatedAt: at.toISOString(),
            },
          ],
        } as ListQArtifactsResponse);
      },
    }),
    knowledge: {
      mandateSummary: () => Promise.resolve(mandate),
      fitSummary: () =>
        Promise.resolve(options.fit === undefined ? fit() : options.fit),
      companies: (_actor, ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              { companyId: id, name: "Tensorgate" } as CompanyKnowledge,
            ]),
          ),
        ),
    },
  });
  return { port, job, theirs, listed };
}

describe("persisted step outputs become typed edges", () => {
  it("links the job to its document and company, its review and its questions", () => {
    const parsed = jobOf(
      { id: "j-1", goal: "Memo on Tensorgate", status: "DONE" },
      workRow(ownerA, "j-1"),
    );
    expect(parsed.documents).toEqual([{ artifactId, companyId }]);
    expect(parsed.review).toEqual({
      artifactId,
      material: true,
      issues: [
        { kind: "UNSUPPORTED", section: "Traction", problem: "No source." },
      ],
      revisedToVersion: 2,
    });
    expect(parsed.diligence).toEqual({
      questions: ["What is churn?"],
      filedForApproval: true,
    });
    expect(parsed.conversationId).toBe("c-1");
    expect(parsed.finishedAt).toBe(at.toISOString());
  });

  it("a job with no queue row says what it knows and nothing more", () => {
    const parsed = jobOf(
      { id: "j-2", goal: "x", status: "RUNNING" },
      undefined,
    );
    expect(parsed).toMatchObject({
      state: "RUNNING",
      documents: [],
      review: null,
      diligence: null,
      finishedAt: null,
      conversationId: null,
    });
  });
});

describe("every read is the person's own", () => {
  it("re-checks the owner on conversations and jobs", async () => {
    const { port, job } = await setup();
    const actor = actorOf(ownerA);
    const conversations = await port.conversations(actor, {
      since: "2026-09-01T00:00:00.000Z",
      limit: 30,
    });
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.companyIds).toEqual([companyId]);
    const jobs = await port.jobs(actor, { limit: 10 });
    expect(jobs.map((j) => j.jobId)).toEqual([job.id]);
  });

  it("drops conversations older than the window", async () => {
    const { port } = await setup({
      conversations: [
        conversation(ownerA, { lastMessageAt: "2026-08-01T00:00:00.000Z" }),
      ],
    });
    expect(
      await port.conversations(actorOf(ownerA), {
        since: "2026-09-01T00:00:00.000Z",
        limit: 30,
      }),
    ).toEqual([]);
  });

  it("reads documents through the artifact service as the actor, and none acting personally", async () => {
    const { port, listed } = await setup();
    const actor = actorOf(ownerA);
    const documents = await port.documents(actor, { limit: 25 });
    expect(documents).toEqual([
      expect.objectContaining({
        artifactId,
        companyId,
        version: 2,
        status: "READY",
      }),
    ]);
    expect(listed[0]?.actor).toBe(actor);
    const personal = ActorContextSchema.parse({
      tenantId,
      userId: ownerA.userId,
      actorType: "HUMAN",
    });
    expect(await port.documents(personal, { limit: 25 })).toEqual([]);
  });

  it("a non-person actor reads nothing", async () => {
    const { port } = await setup();
    const q = actorOf(ownerA, { actorType: "Q" });
    expect(
      await port.conversations(q, {
        since: "2026-01-01T00:00:00.000Z",
        limit: 5,
      }),
    ).toEqual([]);
    expect(await port.jobs(q, { limit: 5 })).toEqual([]);
    expect(await port.documents(q, { limit: 5 })).toEqual([]);
    expect(await port.mandateFit(q)).toBeNull();
    expect(await port.companies(q, [companyId])).toEqual([]);
  });
});

describe("mandate fit", () => {
  it("is the current slate in rank order", async () => {
    const { port } = await setup();
    expect(await port.mandateFit(actorOf(ownerA))).toMatchObject({
      mandateName: "Savanna Seed Fund I",
      mandateVersion: 3,
      companyIds: [companyId],
    });
  });

  it("is unknown (null slate) without a slate or with one of an older mandate version", async () => {
    for (const f of [
      null,
      fit({ slateId: null }),
      fit({ mandateVersion: 2 }),
    ]) {
      const { port } = await setup({ fit: f });
      expect((await port.mandateFit(actorOf(ownerA)))?.companyIds).toBeNull();
    }
  });
});

describe("an older persisted review", () => {
  it("without material or revisedToVersion reads them as unknown", () => {
    const parsed = jobOf(
      { id: "j-3", goal: "x", status: "DONE" },
      {
        ...workRow(ownerA, "j-3"),
        results: {
          critique: {
            status: "DONE",
            outputs: { artifactId, review: { issues: [] } },
          },
        },
      },
    );
    expect(parsed.review).toEqual({
      artifactId,
      material: null,
      issues: [],
      revisedToVersion: null,
    });
  });
});
