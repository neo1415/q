import { describe, expect, it, vi } from "vitest";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { QArtifactContent } from "@capital-q/contracts";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  ArtifactCompositionFailedError,
  ArtifactNotFoundError,
  ArtifactNotRevisableError,
  canRevise,
  createArtifactService,
  nextVersion,
  parseContent,
  type ArtifactComposer,
  type ArtifactRepository,
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

function composer(overrides: Partial<ArtifactComposer> = {}): ArtifactComposer {
  return {
    type: "INVESTMENT_BRIEF",
    compose: ({ previous, instruction }) =>
      Promise.resolve({
        title: previous === undefined ? "Investment brief" : "Investment brief",
        summary:
          previous === undefined
            ? "What the record supports."
            : `Revised: ${instruction ?? ""}`,
        content: content(
          previous === undefined ? "First composition." : "Second composition.",
        ),
      }),
    ...overrides,
  };
}

function service(
  repository: ArtifactRepository,
  composers: readonly ArtifactComposer[] = [composer()],
) {
  return createArtifactService({ repository, transactions, composers });
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

describe("QX-003C · preparing one", () => {
  it("composes a first version and leaves the artifact ready to read", async () => {
    const { repository } = inMemoryRepository();
    const detail = await service(repository).prepare({
      actor: ACTOR,
      type: "INVESTMENT_BRIEF",
      companyId: "f0000000-0000-4000-8000-000000000001",
      investorOrganisationId: null,
      instruction: null,
    });

    expect(detail.artifact.status).toBe("READY");
    expect(detail.artifact.currentVersion).toBe(1);
    expect(detail.current?.version).toBe(1);
    expect(detail.current?.content.sections[0]?.body).toBe(
      "First composition.",
    );
    expect(detail.artifact.subject).toEqual({
      kind: "COMPANY",
      companyId: "f0000000-0000-4000-8000-000000000001",
    });
    expect(detail.history).toHaveLength(1);
  });

  it("leaves a visible failed artifact when Q could not compose it", async () => {
    const { repository, artifacts } = inMemoryRepository();
    const failing = composer({
      compose: () => Promise.reject(new Error("the model refused")),
    });
    await expect(
      service(repository, [failing]).prepare({
        actor: ACTOR,
        type: "INVESTMENT_BRIEF",
        companyId: null,
        investorOrganisationId: null,
        instruction: null,
      }),
    ).rejects.toBeInstanceOf(ArtifactCompositionFailedError);

    // Not a vanished artifact: one that says what happened.
    const [stored] = [...artifacts.values()];
    expect(stored?.status).toBe("FAILED");
    expect(stored?.currentVersion).toBe(0);
  });

  it("refuses a kind of artifact this build does not compose", async () => {
    const { repository } = inMemoryRepository();
    await expect(
      service(repository).prepare({
        actor: ACTOR,
        type: "PITCH_DECK",
        companyId: null,
        investorOrganisationId: null,
        instruction: null,
      }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});

describe("QX-003F · Edit with Q", () => {
  it("appends a second version and leaves the first exactly as it was", async () => {
    const { repository } = inMemoryRepository();
    const subject = service(repository);
    const first = await subject.prepare({
      actor: ACTOR,
      type: "INVESTMENT_BRIEF",
      companyId: null,
      investorOrganisationId: null,
      instruction: null,
    });
    const artifactId = first.artifact.artifactId;

    const second = await subject.revise({
      actor: ACTOR,
      artifactId,
      instruction: "Say more about the team.",
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
    const first = await subject.prepare({
      actor: ACTOR,
      type: "INVESTMENT_BRIEF",
      companyId: null,
      investorOrganisationId: null,
      instruction: null,
    });
    const artifactId = first.artifact.artifactId;

    // Somebody else's revision lands while this one is being composed.
    const racing = composer({
      compose: async (input) => {
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
        return {
          title: "Mine",
          summary: "Composed second.",
          content: content(`Mine: ${input.instruction ?? ""}`),
        };
      },
    });

    const mine = await service(repository, [racing]).revise({
      actor: ACTOR,
      artifactId,
      instruction: "my change",
    });

    expect(mine.artifact.currentVersion).toBe(3);
    // Theirs is untouched and still readable.
    const theirs = versions.find((v) => v.version === 2);
    expect(theirs?.title).toBe("Theirs");
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("refuses to revise something with nothing to revise", async () => {
    const { repository, artifacts } = inMemoryRepository();
    const failing = composer({
      compose: () => Promise.reject(new Error("the model refused")),
    });
    const subject = service(repository, [failing]);
    await expect(
      subject.prepare({
        actor: ACTOR,
        type: "INVESTMENT_BRIEF",
        companyId: null,
        investorOrganisationId: null,
        instruction: null,
      }),
    ).rejects.toBeInstanceOf(ArtifactCompositionFailedError);
    const [stored] = [...artifacts.values()];

    await expect(
      subject.revise({
        actor: ACTOR,
        artifactId: stored?.id ?? "",
        instruction: "try again",
      }),
    ).rejects.toBeInstanceOf(ArtifactNotRevisableError);
  });

  it("keeps the version it has when a revision cannot be composed", async () => {
    const { repository } = inMemoryRepository();
    const flaky = composer();
    const subject = service(repository, [flaky]);
    const first = await subject.prepare({
      actor: ACTOR,
      type: "INVESTMENT_BRIEF",
      companyId: null,
      investorOrganisationId: null,
      instruction: null,
    });

    vi.spyOn(flaky, "compose").mockRejectedValueOnce(new Error("refused"));
    await expect(
      subject.revise({
        actor: ACTOR,
        artifactId: first.artifact.artifactId,
        instruction: "change it",
      }),
    ).rejects.toBeInstanceOf(ArtifactCompositionFailedError);

    // A revision that failed has damaged nothing: V1 is still current and
    // the artifact is still READY, not FAILED.
    const after = await subject.read(ACTOR, first.artifact.artifactId);
    expect(after.artifact.status).toBe("READY");
    expect(after.artifact.currentVersion).toBe(1);
    expect(after.current?.content.sections[0]?.body).toBe("First composition.");
  });
});

describe("QX-003C · reading somebody else's", () => {
  it("is the same answer as reading one that does not exist", async () => {
    const { repository } = inMemoryRepository();
    const subject = service(repository);
    const mine = await subject.prepare({
      actor: ACTOR,
      type: "INVESTMENT_BRIEF",
      companyId: null,
      investorOrganisationId: null,
      instruction: null,
    });

    const stranger: ActorContext = {
      ...ACTOR,
      tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000002"),
    };
    await expect(
      subject.read(stranger, mine.artifact.artifactId),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
    await expect(
      subject.read(stranger, "a90000000-0000-4000-8000-000000000009"),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
    await expect(
      subject.revise({
        actor: stranger,
        artifactId: mine.artifact.artifactId,
        instruction: "change somebody else's brief",
      }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(await subject.list(stranger, { limit: 20 })).toEqual({ items: [] });
  });
});
