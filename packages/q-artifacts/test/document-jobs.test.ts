import { describe, expect, it } from "vitest";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type {
  PermittedContextPlan,
  QArtifactContent,
} from "@capital-q/contracts";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  ArtifactAuthorityError,
  ArtifactCompositionFailedError,
  ArtifactNotFoundError,
  ArtifactNotRevisableError,
  createArtifactService,
  type ArtifactRepository,
  type ComposedArtifact,
  type DocumentJobRepository,
  type StoredArtifact,
  type StoredArtifactVersion,
} from "../src/index.js";

/**
 * Q room W5 (R8): documents made by a job, and edits of one's own
 * document. In memory: what is under test is the rule set -- a request
 * is authorised by the run's plan and queues one job; the worker files
 * version 1 into exactly that artifact, once; an edit appends (the old
 * version stays readable), replays rather than duplicates, and refuses a
 * base that is no longer current; a stranger's edit is "not found".
 */

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const COMPANY = "f0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000009";

function content(body: string): QArtifactContent {
  return { sections: [{ heading: "Business", body, findings: [] }], gaps: [] };
}
function composed(body: string): ComposedArtifact {
  return {
    title: "Deck",
    summary: "What the record supports.",
    content: content(body),
  };
}

function memory() {
  const artifacts = new Map<string, StoredArtifact>();
  const bindings = new Map<
    string,
    { readonly id: string; readonly digest: string }
  >();
  const versions: StoredArtifactVersion[] = [];
  const own = (actor: ActorContext, a: StoredArtifact | undefined) =>
    a !== undefined &&
    a.tenantId === actor.tenantId &&
    a.organisationId === actor.organisationId
      ? a
      : null;
  const repository: ArtifactRepository = {
    findForWorkforce: (actor, input) => {
      const prior = bindings.get(`${input.jobId}:${input.stepKey}`);
      const artifact =
        prior === undefined ? undefined : artifacts.get(prior.id);
      return Promise.resolve(
        prior?.digest === input.intentSha256 &&
          artifact !== undefined &&
          artifact.tenantId === actor.tenantId &&
          artifact.organisationId === actor.organisationId &&
          artifact.createdByUserId === actor.userId &&
          artifact.type === input.type &&
          artifact.companyId === input.companyId &&
          artifact.archivedAt === null
          ? artifact
          : null,
      );
    },
    createForWorkforce: async (tx, input, binding) => {
      const key = `${binding.jobId}:${binding.stepKey}`;
      const prior = bindings.get(key);
      if (prior !== undefined) {
        const artifact = artifacts.get(prior.id);
        return prior.digest === binding.intentSha256 &&
          artifact !== undefined &&
          artifact.tenantId === input.tenantId &&
          artifact.organisationId === input.organisationId &&
          artifact.createdByUserId === input.createdByUserId &&
          artifact.type === input.type &&
          artifact.companyId === input.companyId &&
          artifact.archivedAt === null
          ? { artifact, created: false }
          : null;
      }
      const artifact = await repository.create(tx, input);
      bindings.set(key, { id: artifact.id, digest: binding.intentSha256 });
      return { artifact, created: true };
    },
    create: (_tx, input) => {
      const artifact: StoredArtifact = {
        id: `a${String(artifacts.size + 1)}000000-0000-4000-8000-000000000001`,
        tenantId: input.tenantId,
        organisationId: input.organisationId,
        type: input.type,
        companyId: input.companyId,
        investorOrganisationId: input.investorOrganisationId,
        status: "PREPARING",
        currentVersion: 0,
        visibilityScope: "organisation_private",
        createdByUserId: input.createdByUserId,
        createdAt: "2026-10-07T00:00:00.000Z",
        updatedAt: "2026-10-07T00:00:00.000Z",
        archivedAt: null,
      };
      artifacts.set(artifact.id, artifact);
      return Promise.resolve(artifact);
    },
    findById: (actor, id) => Promise.resolve(own(actor, artifacts.get(id))),
    list: () => Promise.resolve([...artifacts.values()]),
    setStatus: (_tx, id, status) => {
      const found = artifacts.get(id);
      if (found !== undefined) artifacts.set(id, { ...found, status });
      return Promise.resolve();
    },
    appendVersion: (_tx, input) => {
      if (
        versions.some(
          (v) =>
            v.artifactId === input.artifactId && v.version === input.version,
        )
      ) {
        return Promise.resolve(null);
      }
      const stored: StoredArtifactVersion = {
        ...input,
        createdAt: "2026-10-07T00:00:01.000Z",
      };
      versions.push(stored);
      const artifact = artifacts.get(input.artifactId);
      if (artifact !== undefined) {
        artifacts.set(input.artifactId, {
          ...artifact,
          currentVersion: input.version,
        });
      }
      return Promise.resolve(stored);
    },
    findVersion: (actor, id, version) =>
      Promise.resolve(
        own(actor, artifacts.get(id)) === null
          ? null
          : (versions.find(
              (v) => v.artifactId === id && v.version === version,
            ) ?? null),
      ),
    history: (_actor, id) =>
      Promise.resolve(
        versions
          .filter((v) => v.artifactId === id)
          .sort((a, b) => b.version - a.version)
          .map((v) => ({
            version: v.version,
            title: v.title,
            instruction: v.instruction,
            createdAt: v.createdAt,
          })),
      ),
  };
  return { repository, artifacts, versions };
}

const transactions: TransactionManager = {
  run: (work) => work({ sql: undefined as never } as TransactionContext),
};

function plan(overrides: Record<string, unknown> = {}): PermittedContextPlan {
  return {
    contractVersion: 1,
    policyVersion: 1,
    planId: "f0000000-0000-4000-8000-00000000000a",
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: ACTOR.tenantId,
    actor: { userId: ACTOR.userId, organisationId: ACTOR.organisationId },
    purpose: {
      capability: "COMPANY_INTELLIGENCE",
      taskClass: "EVIDENCE_SYNTHESIS",
    },
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    scopes: [],
    denied: [],
    maxSensitivity: "INTERNAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: "2026-10-07T00:00:00.000Z",
    revalidateAfter: "2099-01-01T00:00:00.000Z",
    revalidateOnResume: true,
    ...overrides,
  } as unknown as PermittedContextPlan;
}

function queue() {
  const queued: Parameters<DocumentJobRepository["enqueue"]>[1][] = [];
  const repository: DocumentJobRepository = {
    enqueue: (_tx, job) => {
      queued.push(job);
      return Promise.resolve();
    },
    progress: () => Promise.resolve(null),
    claim: () => Promise.resolve(null),
    setStage: () => Promise.resolve(),
    finish: () => Promise.resolve(),
    release: () => Promise.resolve(),
  };
  return { repository, queued };
}

const EXTRA = {
  grounding: ["First composition."],
  sectorCodes: [],
  directionChosen: false,
  brand: null,
  sensitivity: "INTERNAL" as const,
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    actorContext: ACTOR,
    permittedContextPlan: plan(),
    qRunId: RUN,
    subject: { kind: "COMPANY" as const, companyId: COMPANY },
    artifactType: "PITCH_DECK",
    content: composed("First composition."),
    kind: "PITCH_DECK" as const,
    job: EXTRA,
    ...overrides,
  };
}

describe("documents made by a job", () => {
  const workforce = {
    jobId: "f0000000-0000-4000-8000-0000000000b1",
    stepKey: "prepare-own-deck",
    intentSha256: "a".repeat(64),
  };

  it("a restart after enqueue reuses the artifact without enqueueing another worker job", async () => {
    const { repository, artifacts } = memory();
    const jobs = queue();
    const svc = createArtifactService({
      repository,
      transactions,
      jobs: jobs.repository,
    });
    const first = await svc.requestDocument({ ...request(), workforce });
    const replay = await svc.requestDocument({
      ...request(),
      workforce,
      content: composed("A regenerated draft is not a new approved intent."),
    });
    expect(replay.artifact.artifactId).toBe(first.artifact.artifactId);
    expect(artifacts.size).toBe(1);
    expect(jobs.queued).toHaveLength(1);
    expect(jobs.queued[0]?.input.content.sections[0]?.body).toBe(
      "First composition.",
    );
  });

  it("an authorized resume finds the existing identity before recomposition and hides strangers", async () => {
    const { repository } = memory();
    const jobs = queue();
    const svc = createArtifactService({
      repository,
      transactions,
      jobs: jobs.repository,
    });
    const input = { ...request(), workforce };
    expect(await svc.findWorkforceDocument(input)).toBeNull();
    const first = await svc.requestDocument(input);
    expect((await svc.findWorkforceDocument(input))?.artifactId).toBe(
      first.artifact.artifactId,
    );
    expect(
      await svc.findWorkforceDocument({
        ...input,
        workforce: { ...workforce, intentSha256: "b".repeat(64) },
      }),
    ).toBeNull();
    await expect(
      svc.findWorkforceDocument({
        ...input,
        permittedContextPlan: plan({ subjects: [] }),
      }),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
    const stranger = { ...ACTOR, userId: UserIdSchema.parse(COMPANY) };
    expect(
      await svc.findWorkforceDocument({
        ...input,
        actorContext: stranger,
        permittedContextPlan: plan({
          actor: {
            userId: stranger.userId,
            organisationId: ACTOR.organisationId,
          },
        }),
      }),
    ).toBeNull();
    expect(jobs.queued).toHaveLength(1);
  });

  it("a READY pointer cannot stand in for a real immutable version", async () => {
    const { repository, artifacts } = memory();
    const jobs = queue();
    const svc = createArtifactService({
      repository,
      transactions,
      jobs: jobs.repository,
    });
    const input = { ...request(), workforce };
    const prepared = await svc.requestDocument(input);
    const id = prepared.artifact.artifactId;
    const stored = artifacts.get(id);
    if (stored === undefined) throw new Error("Expected the prepared artifact");
    artifacts.set(id, { ...stored, status: "READY", currentVersion: 1 });
    await expect(svc.findWorkforceDocument(input)).rejects.toBeInstanceOf(
      ArtifactCompositionFailedError,
    );
    await expect(svc.requestDocument(input)).rejects.toBeInstanceOf(
      ArtifactCompositionFailedError,
    );
    expect(jobs.queued).toHaveLength(1);

    artifacts.set(id, stored);
    const filed = await svc.completeDocumentJob(
      {
        id: workforce.jobId,
        tenantId: ACTOR.tenantId,
        organisationId: ACTOR.organisationId ?? "",
        artifactId: id,
        userId: ACTOR.userId,
        runId: RUN,
        kind: "PITCH_DECK",
        attempts: 1,
        input: { ...EXTRA, ...composed("First composition.") },
      },
      composed("Designed."),
    );
    expect(filed.current?.version).toBe(1);
    expect((await svc.findWorkforceDocument(input))?.status).toBe("READY");
  });

  it("a changed approved intent or subject fails closed on the existing binding", async () => {
    const { repository, artifacts } = memory();
    const jobs = queue();
    const svc = createArtifactService({
      repository,
      transactions,
      jobs: jobs.repository,
    });
    await svc.requestDocument({ ...request(), workforce });
    await expect(
      svc.requestDocument({
        ...request(),
        workforce: { ...workforce, intentSha256: "b".repeat(64) },
      }),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
    await expect(
      svc.requestDocument({ ...request(), workforce, artifactType: "MEMO" }),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
    expect(artifacts.size).toBe(1);
    expect(jobs.queued).toHaveLength(1);
  });

  it("replay still requires a fresh actor-bound firewall plan", async () => {
    const { repository } = memory();
    const jobs = queue();
    const svc = createArtifactService({
      repository,
      transactions,
      jobs: jobs.repository,
    });
    await svc.requestDocument({ ...request(), workforce });
    for (const override of [
      { revalidateAfter: "2000-01-01T00:00:00.000Z" },
      { tenantId: COMPANY },
      { actor: { userId: COMPANY, organisationId: ACTOR.organisationId } },
      { subjects: [] },
    ]) {
      await expect(
        svc.requestDocument({
          ...request(),
          workforce,
          permittedContextPlan: plan(override),
        }),
      ).rejects.toBeInstanceOf(ArtifactAuthorityError);
    }
    expect(jobs.queued).toHaveLength(1);
  });

  it("never falls back to a non-idempotent repository for a workforce request", async () => {
    const { repository, artifacts } = memory();
    const { createForWorkforce: _unsupported, ...ordinaryRepository } =
      repository;
    const jobs = queue();
    const svc = createArtifactService({
      repository: ordinaryRepository,
      transactions,
      jobs: jobs.repository,
    });
    await expect(
      svc.requestDocument({ ...request(), workforce }),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
    expect(artifacts.size).toBe(0);
    expect(jobs.queued).toHaveLength(0);
  });

  it("keeps the real Q run while deriving worker cost provenance from the trusted binding", async () => {
    const { repository } = memory();
    const jobs = queue();
    const svc = createArtifactService({
      repository,
      transactions,
      jobs: jobs.repository,
    });
    const runId = "f0000000-0000-4000-8000-0000000000b2";
    await svc.requestDocument({
      ...request(),
      workforce: { ...workforce, execution: { runId, budgetUsd: 0.08 } },
    });
    expect(jobs.queued[0]?.runId).toBe(RUN);
    expect(jobs.queued[0]?.input.workforce).toEqual({
      jobId: workforce.jobId,
      runId,
      budgetUsd: 0.08,
    });
  });
  it("a request is PREPARING with no version, and its job is queued with the draft", async () => {
    const { repository } = memory();
    const jobs = queue();
    const svc = createArtifactService({
      repository,
      transactions,
      jobs: jobs.repository,
    });
    const detail = await svc.requestDocument(request());
    expect(detail.artifact.status).toBe("PREPARING");
    expect(detail.current).toBeUndefined();
    expect(jobs.queued).toHaveLength(1);
    expect(jobs.queued[0]).toMatchObject({
      kind: "PITCH_DECK",
      runId: RUN,
      userId: ACTOR.userId,
      artifactId: detail.artifact.artifactId,
      input: { title: "Deck", grounding: ["First composition."] },
    });
  });

  it("a request the run's plan does not authorise queues nothing", async () => {
    const { repository, artifacts } = memory();
    const jobs = queue();
    const svc = createArtifactService({
      repository,
      transactions,
      jobs: jobs.repository,
    });
    await expect(
      svc.requestDocument(
        request({ permittedContextPlan: plan({ runId: COMPANY }) }),
      ),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
    expect(jobs.queued).toHaveLength(0);
    expect(artifacts.size).toBe(0);
  });

  it("the worker files version 1 into exactly that artifact, once", async () => {
    const { repository } = memory();
    const jobs = queue();
    const svc = createArtifactService({
      repository,
      transactions,
      jobs: jobs.repository,
    });
    const requested = await svc.requestDocument(request());
    const job = {
      id: "f0000000-0000-4000-8000-0000000000b1",
      tenantId: ACTOR.tenantId,
      organisationId: ACTOR.organisationId ?? "",
      artifactId: requested.artifact.artifactId,
      userId: ACTOR.userId,
      runId: RUN,
      kind: "PITCH_DECK" as const,
      attempts: 1,
      input: { ...EXTRA, ...composed("First composition.") },
    };
    const filed = await svc.completeDocumentJob(job, composed("Designed."));
    expect(filed.artifact.status).toBe("READY");
    expect(filed.current?.version).toBe(1);
    await expect(
      svc.completeDocumentJob(job, composed("Again.")),
    ).rejects.toBeInstanceOf(ArtifactNotRevisableError);
  });
});

describe("a workforce step's composed document (ANALYSIS)", () => {
  const workforce = {
    jobId: "f0000000-0000-4000-8000-0000000000c1",
    stepKey: "plan",
    intentSha256: "b".repeat(64),
  };
  const input = () => ({
    actorContext: ACTOR,
    permittedContextPlan: plan(),
    qRunId: RUN,
    subject: { kind: "COMPANY" as const, companyId: COMPANY },
    artifactType: "ANALYSIS",
    content: composed("The growth plan."),
    workforce,
  });

  it("is filed once per (job, step): a retry returns the first, writing nothing", async () => {
    const { repository, artifacts } = memory();
    const svc = createArtifactService({ repository, transactions });
    const first = await svc.prepareArtifact(input());
    const again = await svc.prepareArtifact({
      ...input(),
      content: composed("A second composition after a crash."),
    });
    expect(again.artifact.artifactId).toBe(first.artifact.artifactId);
    expect(again.artifact.currentVersion).toBe(1);
    expect(artifacts.size).toBe(1);
  });

  it("never falls back to a second document when the binding cannot be honoured", async () => {
    const { repository, artifacts } = memory();
    const { createForWorkforce: _unsupported, ...ordinaryRepository } =
      repository;
    const svc = createArtifactService({
      repository: ordinaryRepository,
      transactions,
    });
    await expect(svc.prepareArtifact(input())).rejects.toBeInstanceOf(
      ArtifactAuthorityError,
    );
    expect(artifacts.size).toBe(0);
  });
});

describe("editing one's own document", () => {
  async function prepared() {
    const { repository } = memory();
    const svc = createArtifactService({ repository, transactions });
    const detail = await svc.prepareArtifact({
      actorContext: ACTOR,
      permittedContextPlan: plan(),
      qRunId: RUN,
      subject: { kind: "COMPANY", companyId: COMPANY },
      artifactType: "PITCH_DECK",
      content: composed("First composition."),
    });
    return { svc, id: detail.artifact.artifactId };
  }

  it("appends a version, keeps the old one readable, and replays rather than duplicates", async () => {
    const { svc, id } = await prepared();
    const edit = () =>
      svc.editOwnDocument({
        actorContext: ACTOR,
        artifactId: id,
        baseVersion: 1,
        instruction: "Slide 1: shorter",
        runId: null,
        compose: (current) => ({ ...current, content: content("Shorter.") }),
      });
    expect((await edit()).status).toBe("EDITED");
    expect((await edit()).status).toBe("REPLAYED");
    expect((await svc.read(ACTOR, id)).current?.version).toBe(2);
    const v1 = await svc.readVersion(ACTOR, id, 1);
    expect(v1.current?.content.sections[0]?.body).toBe("First composition.");
  });

  it("refuses a different edit of a version that is no longer current", async () => {
    const { svc, id } = await prepared();
    await svc.editOwnDocument({
      actorContext: ACTOR,
      artifactId: id,
      baseVersion: 1,
      instruction: "Slide 1: shorter",
      runId: null,
      compose: (current) => ({ ...current, content: content("Shorter.") }),
    });
    const stale = await svc.editOwnDocument({
      actorContext: ACTOR,
      artifactId: id,
      baseVersion: 1,
      instruction: "Slide 2: swap the picture",
      runId: null,
      compose: () => composed("x"),
    });
    expect(stale.status).toBe("STALE");
  });

  it("another organisation's edit is not found, as for any stranger", async () => {
    const { svc, id } = await prepared();
    await expect(
      svc.editOwnDocument({
        actorContext: {
          ...ACTOR,
          organisationId: OrganisationIdSchema.parse(
            "d0000000-0000-4000-8000-000000000099",
          ),
        },
        artifactId: id,
        baseVersion: 1,
        instruction: "Slide 1: shorter",
        runId: null,
        compose: () => composed("x"),
      }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});
