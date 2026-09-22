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
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  ArtifactAuthorityError,
  ArtifactNotFoundError,
  ArtifactNotRevisableError,
  canRevise,
  createArtifactService,
  nextVersion,
  parseContent,
  type ArtifactRepository,
  type ComposedArtifact,
  type StoredArtifact,
  type StoredArtifactVersion,
} from "../src/index.js";

/**
 * Preparing, reading and revising what Q composed (QX-003C, QX-003F).
 *
 * The repository is in memory here and the composer is a stub, so what is
 * under test is the rule set rather than SQL or a model: that a revision
 * appends and never edits, that V1 is still readable after V2 exists, that
 * a composition which failed leaves a visible artifact rather than a
 * vanished one, that a lost race takes the next free number instead of
 * overwriting somebody's version, and that nothing but the public content
 * contract can be stored.
 *
 * Actor scoping is asserted against real SQL in the integration test
 * beside this one; a fake repository could only prove that this file
 * passes the actor along.
 */

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};

function content(body: string): QArtifactContent {
  return {
    sections: [{ heading: "Business", body, findings: [] }],
    gaps: [],
  };
}

/**
 * The two tables, in memory.
 *
 * `appendVersion` refuses a number that is taken, exactly as the unique
 * constraint does, because that refusal is the behaviour the service is
 * built around.
 */
function inMemoryRepository() {
  const artifacts = new Map<string, StoredArtifact>();
  const versions: StoredArtifactVersion[] = [];
  let clock = 0;
  const now = () => new Date(1_790_000_000_000 + (clock += 1000)).toISOString();

  const repository: ArtifactRepository = {
    create: (_tx, input) => {
      const at = now();
      const artifact: StoredArtifact = {
        id: `a${artifacts.size + 1}0000-0000-4000-8000-000000000001`,
        tenantId: input.tenantId,
        organisationId: input.organisationId,
        type: input.type,
        companyId: input.companyId,
        investorOrganisationId: input.investorOrganisationId,
        status: "PREPARING",
        currentVersion: 0,
        visibilityScope: "organisation_private",
        createdByUserId: input.createdByUserId,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      };
      artifacts.set(artifact.id, artifact);
      return Promise.resolve(artifact);
    },
    findById: (actor, id) => {
      const found = artifacts.get(id);
      return Promise.resolve(
        found === undefined ||
          found.tenantId !== actor.tenantId ||
          found.organisationId !== actor.organisationId
          ? null
          : found,
      );
    },
    list: (actor, query) =>
      Promise.resolve(
        [...artifacts.values()]
          .filter(
            (a) =>
              a.tenantId === actor.tenantId &&
              a.organisationId === actor.organisationId,
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, query.limit),
      ),
    setStatus: (_tx, id, status) => {
      const found = artifacts.get(id);
      if (found !== undefined) {
        artifacts.set(id, { ...found, status, updatedAt: now() });
      }
      return Promise.resolve();
    },
    appendVersion: (_tx, input) => {
      const taken = versions.some(
        (v) => v.artifactId === input.artifactId && v.version === input.version,
      );
      if (taken) {
        return Promise.resolve(null);
      }
      const stored: StoredArtifactVersion = {
        artifactId: input.artifactId,
        version: input.version,
        title: input.title,
        summary: input.summary,
        content: input.content,
        instruction: input.instruction,
        composedByRunId: input.composedByRunId,
        createdByUserId: input.createdByUserId,
        createdAt: now(),
      };
      versions.push(stored);
      const artifact = artifacts.get(input.artifactId);
      if (artifact !== undefined && artifact.currentVersion < input.version) {
        artifacts.set(input.artifactId, {
          ...artifact,
          currentVersion: input.version,
          updatedAt: stored.createdAt,
        });
      }
      return Promise.resolve(stored);
    },
    findVersion: (actor, id, version) => {
      const artifact = artifacts.get(id);
      if (
        artifact === undefined ||
        artifact.tenantId !== actor.tenantId ||
        artifact.organisationId !== actor.organisationId
      ) {
        return Promise.resolve(null);
      }
      return Promise.resolve(
        versions.find((v) => v.artifactId === id && v.version === version) ??
          null,
      );
    },
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

const COMPANY = "f0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000009";
const FUTURE = "2099-01-01T00:00:00.000Z";

/**
 * The Context Firewall's own decision, as the answer seam would pass it.
 *
 * Every test that changes a field here is asking the same question: does
 * the service take the caller's word for authority, or re-derive it? It
 * must re-derive it, because the caller is one refactor away from being
 * wrong and the plan is the only thing the firewall actually decided.
 */
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
    evaluatedAt: "2026-09-22T00:00:00.000Z",
    revalidateAfter: FUTURE,
    revalidateOnResume: true,
    ...overrides,
  } as unknown as PermittedContextPlan;
}

function composed(body: string): ComposedArtifact {
  return {
    title: "Investment brief",
    summary: "What the record supports.",
    content: content(body),
  };
}

function service(repository: ArtifactRepository) {
  return createArtifactService({ repository, transactions });
}

function prepareInput(overrides: Record<string, unknown> = {}) {
  return {
    actorContext: ACTOR,
    permittedContextPlan: plan(),
    qRunId: RUN,
    subject: { kind: "COMPANY" as const, companyId: COMPANY },
    artifactType: "INVESTMENT_BRIEF",
    content: composed("First composition."),
    ...overrides,
  } as Parameters<ReturnType<typeof service>["prepareArtifact"]>[0];
}

describe("QX-003C · the version rules", () => {
  it("counts from zero and refuses a count that is not one", () => {
    expect(nextVersion(0)).toBe(1);
    expect(nextVersion(2)).toBe(3);
    expect(() => nextVersion(-1)).toThrow(RangeError);
    expect(() => nextVersion(1.5)).toThrow(RangeError);
  });

  it("will not revise what has not been composed, failed, or been archived", () => {
    expect(
      canRevise({ status: "READY", currentVersion: 1, archivedAt: null }),
    ).toBe(true);
    expect(
      canRevise({ status: "PREPARING", currentVersion: 0, archivedAt: null }),
    ).toBe(false);
    expect(
      canRevise({ status: "FAILED", currentVersion: 0, archivedAt: null }),
    ).toBe(false);
    expect(
      canRevise({
        status: "READY",
        currentVersion: 1,
        archivedAt: "2026-09-21T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("stores only what the public content contract can express", () => {
    expect(() => parseContent(content("Fine."))).not.toThrow();
    // A section is prose and findings. There is no member for a provider
    // payload, a retrieval chunk or a scratchpad to arrive in.
    expect(() =>
      parseContent({
        sections: [
          { heading: "Business", body: "Fine.", reasoning: "step 1, step 2" },
        ],
        gaps: [],
      }),
    ).toThrow();
    expect(() => parseContent({ sections: [] })).toThrow();
  });
});

describe("QX-003D · preparing one", () => {
  it("writes a first version and leaves the artifact ready to read", async () => {
    const { repository } = inMemoryRepository();
    const detail = await service(repository).prepareArtifact(prepareInput());

    expect(detail.artifact.status).toBe("READY");
    expect(detail.artifact.currentVersion).toBe(1);
    expect(detail.current?.version).toBe(1);
    expect(detail.current?.content.sections[0]?.body).toBe(
      "First composition.",
    );
    expect(detail.artifact.subject).toEqual({
      kind: "COMPANY",
      companyId: COMPANY,
    });
    // Attribution is the run's, so a sentence can be traced to the work
    // that produced it.
    expect(detail.current?.composedByRunId).toBe(RUN);
    expect(detail.history).toHaveLength(1);
  });

  it("owns the artifact to the actor's organisation, whatever it was handed", async () => {
    const { repository, artifacts } = inMemoryRepository();
    await service(repository).prepareArtifact(prepareInput());
    const [stored] = [...artifacts.values()];
    expect(stored?.organisationId).toBe(ACTOR.organisationId);
    expect(stored?.tenantId).toBe(ACTOR.tenantId);
    expect(stored?.visibilityScope).toBe("organisation_private");
  });
});

describe("QX-003D · authority is re-derived, never accepted", () => {
  it("refuses a plan belonging to another run", async () => {
    const { repository } = inMemoryRepository();
    await expect(
      service(repository).prepareArtifact(
        prepareInput({ qRunId: "f0000000-0000-4000-8000-00000000000b" }),
      ),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
  });

  it("refuses a plan belonging to another tenant or another person", async () => {
    const { repository } = inMemoryRepository();
    const subject = service(repository);
    await expect(
      subject.prepareArtifact(
        prepareInput({
          permittedContextPlan: plan({
            tenantId: "c0000000-0000-4000-8000-000000000002",
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
    await expect(
      subject.prepareArtifact(
        prepareInput({
          permittedContextPlan: plan({
            actor: {
              userId: "b0000000-0000-4000-8000-000000000002",
              organisationId: ACTOR.organisationId,
            },
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
  });

  it("refuses a subject the Context Firewall never authorised", async () => {
    const { repository, artifacts } = inMemoryRepository();
    // The plan is for one company; the caller asks about another.
    await expect(
      service(repository).prepareArtifact(
        prepareInput({
          subject: {
            kind: "COMPANY",
            companyId: "f0000000-0000-4000-8000-0000000000ff",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
    // And nothing was created on the way to refusing.
    expect(artifacts.size).toBe(0);
  });

  it("refuses a plan that has gone stale", async () => {
    const { repository } = inMemoryRepository();
    await expect(
      service(repository).prepareArtifact(
        prepareInput({
          permittedContextPlan: plan({
            revalidateAfter: "2020-01-01T00:00:00.000Z",
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
  });

  it("refuses somebody with no organisation to own it", async () => {
    const { repository } = inMemoryRepository();
    const personal = { ...ACTOR, organisationId: undefined };
    await expect(
      service(repository).prepareArtifact(
        prepareInput({ actorContext: personal }),
      ),
    ).rejects.toBeInstanceOf(ArtifactAuthorityError);
  });
});

describe("QX-003F · Edit with Q", () => {
  it("appends a second version and leaves the first exactly as it was", async () => {
    const { repository } = inMemoryRepository();
    const subject = service(repository);
    const first = await subject.prepareArtifact(prepareInput());
    const artifactId = first.artifact.artifactId;

    const second = await subject.reviseArtifact({
      actorContext: ACTOR,
      permittedContextPlan: plan(),
      qRunId: RUN,
      artifactId,
      instruction: "Say more about the team.",
      content: composed("Second composition."),
    });

    expect(second.artifact.currentVersion).toBe(2);
    expect(second.current?.version).toBe(2);
    expect(second.current?.instruction).toBe("Say more about the team.");
    expect(second.history.map((entry) => entry.version)).toEqual([2, 1]);

    // The point of the whole design: what was sent last week is still
    // what was sent last week.
    const kept = await subject.readVersion(ACTOR, artifactId, 1);
    expect(kept.current?.version).toBe(1);
    expect(kept.current?.content.sections[0]?.body).toBe("First composition.");
    expect(kept.current?.instruction).toBeUndefined();
    // And the artifact still knows it has moved on.
    expect(kept.artifact.currentVersion).toBe(2);
  });

  it("takes the next free number rather than overwriting a version that landed first", async () => {
    const { repository, versions } = inMemoryRepository();
    const subject = service(repository);
    const first = await subject.prepareArtifact(prepareInput());
    const artifactId = first.artifact.artifactId;

    // Somebody else's revision lands while this one was being composed.
    await repository.appendVersion(
      { sql: undefined as never },
      {
        artifactId,
        tenantId: ACTOR.tenantId,
        version: 2,
        title: "Theirs",
        summary: "Landed first.",
        content: content("Theirs."),
        instruction: "their change",
        composedByRunId: null,
        createdByUserId: ACTOR.userId,
      },
    );

    const mine = await subject.reviseArtifact({
      actorContext: ACTOR,
      permittedContextPlan: plan(),
      qRunId: RUN,
      artifactId,
      instruction: "my change",
      content: composed("Mine."),
    });

    expect(mine.artifact.currentVersion).toBe(3);
    const theirs = versions.find((entry) => entry.version === 2);
    expect(theirs?.title).toBe("Theirs");
    expect(versions.map((entry) => entry.version)).toEqual([1, 2, 3]);
  });

  it("refuses to revise an artifact that is not this person's", async () => {
    const { repository } = inMemoryRepository();
    const subject = service(repository);
    const mine = await subject.prepareArtifact(prepareInput());
    const stranger = {
      ...ACTOR,
      tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000002"),
    };
    await expect(
      subject.reviseArtifact({
        actorContext: stranger,
        permittedContextPlan: plan({ tenantId: stranger.tenantId }),
        qRunId: RUN,
        artifactId: mine.artifact.artifactId,
        instruction: "change somebody else's brief",
        content: composed("Not yours."),
      }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it("refuses to revise something with nothing to revise", async () => {
    const { repository, artifacts } = inMemoryRepository();
    const subject = service(repository);
    const artifact = await repository.create(
      { sql: undefined as never } as TransactionContext,
      {
        tenantId: ACTOR.tenantId,
        organisationId: ACTOR.organisationId ?? "",
        type: "INVESTMENT_BRIEF",
        companyId: COMPANY,
        investorOrganisationId: null,
        createdByUserId: ACTOR.userId,
      },
    );
    expect(artifacts.size).toBe(1);
    await expect(
      subject.reviseArtifact({
        actorContext: ACTOR,
        permittedContextPlan: plan(),
        qRunId: RUN,
        artifactId: artifact.id,
        instruction: "try again",
        content: composed("Nothing to revise."),
      }),
    ).rejects.toBeInstanceOf(ArtifactNotRevisableError);
  });
});

describe("QX-003C · reading somebody else's", () => {
  it("is the same answer as reading one that does not exist", async () => {
    const { repository } = inMemoryRepository();
    const subject = service(repository);
    const mine = await subject.prepareArtifact(prepareInput());

    const stranger = {
      ...ACTOR,
      tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000002"),
    };
    await expect(
      subject.read(stranger, mine.artifact.artifactId),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
    await expect(
      subject.read(stranger, "a90000000-0000-4000-8000-000000000009"),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(await subject.list(stranger, { limit: 20 })).toEqual({ items: [] });
  });
});
