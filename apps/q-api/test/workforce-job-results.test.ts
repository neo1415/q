import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  QArtifactDetailSchema,
  type QArtifactDetail,
} from "@capital-q/contracts";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { REVIEWER_REVISION_PREFIX } from "../src/composition/workforce/documents.js";
import type { WorkRow } from "../src/composition/workforce/queue.js";
import { createWorkforceJobResults } from "../src/composition/workforce/results.js";
import {
  createInMemoryWorkforceStore,
  type Owner,
} from "../src/composition/workforce/store.js";

/**
 * Conversation continuity (legion): after a job finishes, Q in the
 * original conversation reads what the reviewer changed between the memo
 * draft and its revision, and the five founder diligence questions, from
 * what the job's steps persisted -- for the job's owner only.
 */

const tenantId = randomUUID();
const ownerA: Owner = { tenantId, userId: randomUUID() };
const ownerB: Owner = { tenantId, userId: randomUUID() };
const actorOf = (owner: Owner): ActorContext =>
  ActorContextSchema.parse({
    tenantId: owner.tenantId,
    userId: owner.userId,
    organisationId: randomUUID(),
    membershipId: randomUUID(),
    actorType: "HUMAN",
  });
const artifactId = randomUUID();
const conversationId = randomUUID();
const at = new Date("2026-10-12T09:00:00Z");
const QUESTIONS = [
  "What share of 2025 revenue came from your three largest customers?",
  "Which pilot contracts converted to paid, and at what price?",
  "How many months of runway do you have at the current burn?",
  "Who owns the heat-exchanger patent: the company or a founder?",
  "What did the last churned customer say when they left?",
];
const NOTE =
  "Traction: States 40% growth with no source. Fix: mark it as the founder's claim.";

function version(n: number, traction: string, gaps: string[]): QArtifactDetail {
  return QArtifactDetailSchema.parse({
    artifact: {
      artifactId,
      type: "MEMO",
      status: "READY",
      title: "Kestrel Heat memo",
      currentVersion: 2,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    },
    current: {
      artifactId,
      version: n,
      title: "Kestrel Heat memo",
      summary: "Evidence and open questions.",
      content: {
        sections: [
          { heading: "Company", body: "Industrial heat pumps." },
          { heading: "Traction", body: traction },
        ],
        gaps,
      },
      ...(n === 2
        ? { instruction: `${REVIEWER_REVISION_PREFIX} ${NOTE}` }
        : {}),
      createdAt: at.toISOString(),
    },
    history: [],
  });
}

async function setup() {
  const store = createInMemoryWorkforceStore();
  const ensure = (owner: Owner, id: string) =>
    store.ensureJob(owner, {
      source: { kind: "JOB", id },
      goal: "Research Kestrel Heat, write me a memo and have it reviewed",
      budgetUsd: 0.5,
      threshold: 80,
      maxRedrafts: 2,
      rubricVersion: "rubric/v1",
    });
  const { job } = await ensure(ownerA, "legion-a");
  const { job: theirs } = await ensure(ownerB, "legion-b");
  const row = (owner: Owner, jobId: string): WorkRow => ({
    job_id: jobId,
    tenant_id: owner.tenantId,
    user_id: owner.userId,
    state: "COMPLETED",
    plan: {},
    trace: { conversationId },
    results: {
      memo: {
        status: "DONE",
        outputs: { artifactId, companyId: randomUUID() },
      },
      critique: {
        status: "DONE",
        summary:
          "Reviewed the document, found 2 issues and revised it to version 2.",
        outputs: {
          artifactId,
          review: {
            material: true,
            issues: [
              {
                kind: "UNSUPPORTED",
                section: "Traction",
                problem: "States 40% growth with no source.",
              },
              {
                kind: "MISSING_RISK",
                section: "Risks",
                problem: "Customer concentration is not mentioned.",
              },
            ],
            revisedToVersion: 2,
          },
        },
      },
      diligence: {
        status: "DONE",
        outputs: { questions: QUESTIONS, qActionId: randomUUID() },
      },
    },
    attempts: 1,
    max_attempts: 3,
    reason: null,
    created_at: at,
    updated_at: at,
    finished_at: at,
  });
  const rows = [row(ownerA, job.id), row(ownerB, theirs.id)];
  // As the table does: only the owner's own rows.
  const forOwner = vi.fn((owner: Owner, ids: readonly string[]) =>
    Promise.resolve(
      rows.filter(
        (one) =>
          one.tenant_id === owner.tenantId &&
          one.user_id === owner.userId &&
          ids.includes(one.job_id),
      ),
    ),
  );
  const readVersion = vi.fn((_actor: ActorContext, _id: string, n: number) =>
    Promise.resolve(
      n === 1
        ? version(1, "Growing 40% a quarter.", [])
        : version(2, "The founder states 40% growth a quarter; no source.", [
            "Customer concentration",
          ]),
    ),
  );
  return { store, job, theirs, rows, forOwner, readVersion };
}

describe("workforce job results for Q's conversation", () => {
  it("reports the reviewer's changes and the exact persisted diligence questions", async () => {
    const fixture = await setup();
    const read = createWorkforceJobResults({
      store: fixture.store,
      work: { forOwner: fixture.forOwner },
      artifacts: { readVersion: fixture.readVersion },
      conversationOf: () => Promise.resolve(conversationId),
    });
    const [result, ...others] = await read(actorOf(ownerA), {
      runId: randomUUID(),
    });
    expect(others).toEqual([]);
    expect(result).toEqual({
      jobId: fixture.job.id,
      goal: "Research Kestrel Heat, write me a memo and have it reviewed",
      state: "COMPLETED",
      finishedAt: at.toISOString(),
      inThisConversation: true,
      review: {
        outcome: "REVISED",
        documentTitle: "Kestrel Heat memo",
        findings: [
          {
            kind: "UNSUPPORTED",
            section: "Traction",
            problem: "States 40% growth with no source.",
          },
          {
            kind: "MISSING_RISK",
            section: "Risks",
            problem: "Customer concentration is not mentioned.",
          },
        ],
        fromVersion: 1,
        toVersion: 2,
        revisionNote: NOTE,
        sectionsChanged: ["Traction", "Stated as not known"],
      },
      diligence: { questions: QUESTIONS, filedForApproval: true },
    });
    // The versions were read as the person, never with elevated access.
    expect(
      fixture.readVersion.mock.calls.map((call) => call[0].userId),
    ).toEqual([ownerA.userId, ownerA.userId]);
  });

  it("never returns another user's job, questions or review", async () => {
    const fixture = await setup();
    const read = createWorkforceJobResults({
      store: fixture.store,
      work: { forOwner: fixture.forOwner },
      artifacts: { readVersion: fixture.readVersion },
    });
    const results = await read(actorOf(ownerA), { runId: randomUUID() });
    expect(results.map((one) => one.jobId)).toEqual([fixture.job.id]);
    expect(results.map((one) => one.jobId)).not.toContain(fixture.theirs.id);
    // A third person with no jobs reads nothing at all.
    const stranger = { tenantId, userId: randomUUID() };
    expect(await read(actorOf(stranger), { runId: randomUUID() })).toEqual([]);
    expect(fixture.readVersion).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: stranger.userId }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("says unknown (null) when nothing was recorded, and when the document cannot be read", async () => {
    const fixture = await setup();
    const own = fixture.rows[0];
    if (own === undefined) throw new Error("fixture row");
    fixture.forOwner.mockResolvedValue([
      {
        ...own,
        results: {
          ...own.results,
          diligence: { status: "FAILED", summary: "Diligence is unavailable." },
        },
      },
    ]);
    const read = createWorkforceJobResults({
      store: fixture.store,
      work: { forOwner: fixture.forOwner },
      artifacts: {
        readVersion: () => Promise.reject(new Error("not readable as you")),
      },
    });
    const [result] = await read(actorOf(ownerA), { runId: randomUUID() });
    expect(result?.diligence).toBeNull();
    expect(result?.inThisConversation).toBeNull();
    expect(result?.review).toMatchObject({
      outcome: "REVISED",
      documentTitle: null,
      revisionNote: null,
      sectionsChanged: null,
    });

    fixture.forOwner.mockResolvedValue([{ ...own, results: {} }]);
    const [bare] = await read(actorOf(ownerA), { runId: randomUUID() });
    expect(bare?.review).toBeNull();
    expect(bare?.diligence).toBeNull();
  });
});

describe("live 2026-10-12: the Ledgerfold job as production persisted it", () => {
  // q_runtime.agent_work_queue.results of job 43b7bdb4 (shape, not text):
  // the critique's review carried only its issues.
  const LEDGERFOLD_QUESTIONS = [
    "Of the 31 pilot ledgers you report, how many are in paid production today, and what is the median contract value?",
    "Your memo cites reconciliation error rates falling to 0.4%; which customers measured that, and over what period?",
    "Which licence or regulatory approval does Ledgerfold rely on to hold or move client funds, and who issued it?",
    "What share of revenue comes from your three largest customers, and when do their current contracts renew?",
    "How many months of runway do you have at today's burn, and what does the round you are raising extend that to?",
  ];

  async function ledgerfold() {
    const store = createInMemoryWorkforceStore();
    const { job } = await store.ensureJob(ownerA, {
      source: { kind: "JOB", id: "ledgerfold" },
      goal: "Research Ledgerfold, write a memo, have it reviewed and prepare founder diligence questions",
      budgetUsd: 0.5,
      threshold: 80,
      maxRedrafts: 2,
      rubricVersion: "rubric/v1",
    });
    const row: WorkRow = {
      job_id: job.id,
      tenant_id: ownerA.tenantId,
      user_id: ownerA.userId,
      state: "COMPLETED",
      plan: {},
      trace: { conversationId: randomUUID() },
      results: {
        critique_revise_memo: {
          status: "DONE",
          summary: "Reviewed the document.",
          outputs: {
            review: {
              issues: [
                {
                  kind: "UNSUPPORTED",
                  problem: "The 0.4% error rate is stated without a source.",
                  section: "Traction",
                },
                {
                  kind: "MISSING_RISK",
                  problem: "Regulatory licensing risk is not discussed.",
                  section: "Risks",
                },
              ],
            },
            companyId: randomUUID(),
            artifactId,
          },
        },
        prepare_founder_diligence: {
          status: "DONE",
          summary: "Prepared 5 founder questions.",
          outputs: { qActionId: randomUUID(), questions: LEDGERFOLD_QUESTIONS },
        },
      },
      attempts: 1,
      max_attempts: 3,
      reason: null,
      created_at: at,
      updated_at: at,
      finished_at: at,
    };
    return { store, row };
  }

  it("reports the five questions and the reviewer's changes without material/revisedToVersion", async () => {
    const { store, row } = await ledgerfold();
    const results = createWorkforceJobResults({
      store,
      work: { forOwner: () => Promise.resolve([row]) },
      artifacts: {
        // The artifact's own history marks the reviewer's version.
        read: () =>
          Promise.resolve(
            QArtifactDetailSchema.parse({
              ...version(2, "x", []),
              history: [
                {
                  version: 2,
                  title: "Kestrel Heat memo",
                  instruction: `${REVIEWER_REVISION_PREFIX} ${NOTE}`,
                  createdAt: at.toISOString(),
                },
                {
                  version: 1,
                  title: "Kestrel Heat memo",
                  createdAt: at.toISOString(),
                },
              ],
            }),
          ),
        readVersion: (_actor, _id, n) =>
          Promise.resolve(
            n === 1
              ? version(1, "Growing 40% a quarter.", [])
              : version(2, "The founder states 40% growth; no source.", []),
          ),
      },
      // Asked in a NEW conversation, as live.
      conversationOf: () => Promise.resolve(randomUUID()),
    });
    const [found] = await results(actorOf(ownerA), { runId: randomUUID() });
    expect(found?.inThisConversation).toBe(false);
    expect(found?.diligence).toEqual({
      questions: LEDGERFOLD_QUESTIONS,
      filedForApproval: true,
    });
    expect(found?.review).toMatchObject({
      outcome: "REVISED",
      findings: [
        {
          kind: "UNSUPPORTED",
          section: "Traction",
          problem: "The 0.4% error rate is stated without a source.",
        },
        {
          kind: "MISSING_RISK",
          section: "Risks",
          problem: "Regulatory licensing risk is not discussed.",
        },
      ],
      fromVersion: 1,
      toVersion: 2,
      revisionNote: NOTE,
      sectionsChanged: ["Traction"],
    });
  });

  it("keeps the findings and says the revision is unknown when nothing marks it", async () => {
    const { store, row } = await ledgerfold();
    const results = createWorkforceJobResults({
      store,
      work: { forOwner: () => Promise.resolve([row]) },
    });
    const [found] = await results(actorOf(ownerA), { runId: randomUUID() });
    expect(found?.review).toMatchObject({
      outcome: "UNKNOWN",
      toVersion: null,
      sectionsChanged: null,
    });
    expect(found?.review?.findings).toHaveLength(2);
    expect(found?.diligence?.questions).toEqual(LEDGERFOLD_QUESTIONS);
  });
});
