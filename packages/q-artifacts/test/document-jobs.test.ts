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
  const versions: StoredArtifactVersion[] = [];
  const own = (actor: ActorContext, a: StoredArtifact | undefined) =>
    a !== undefined &&
    a.tenantId === actor.tenantId &&
    a.organisationId === actor.organisationId
      ? a
      : null;
  const repository: ArtifactRepository = {
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
    expect(jobs.queued).toEqual([
      expect.objectContaining({
        kind: "PITCH_DECK",
        runId: RUN,
        userId: ACTOR.userId,
        artifactId: detail.artifact.artifactId,
        input: expect.objectContaining({
          title: "Deck",
          grounding: ["First composition."],
        }),
      }),
    ]);
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
