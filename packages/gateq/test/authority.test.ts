import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { GatewayPublicIdSchema } from "../src/contracts/index.js";

import type {
  CompanyQualificationProjection,
  Gateway,
  GatewayCriterion,
  GatewayPolicy,
  GatewayVersion,
  GatewayVersionId,
  NewGatewayCriterion,
} from "../src/contracts/index.js";
import {
  createGateQService,
  GatewayNotFoundError,
  GatewayVersionNotDraftError,
  type GateQService,
} from "../src/application/use-cases.js";
import { QUALIFICATION_POLICY_VERSION } from "../src/domain/qualification.js";

/**
 * Who may do what to a gateway (CQ-GATE-001 §6, §25), and the version
 * separation that makes a draft safe to work on (§26 O, P, Q).
 *
 * The store is in memory and the authorization port is a fake, because the
 * question here is the service's own logic: which organisation it reads
 * authority from, what it refuses, and what it tells a caller who should
 * not have asked. The database's own guarantees are proved separately in
 * pgTAP.
 */

const TENANT_A = "c0000000-0000-4000-8000-00000000000a";
const TENANT_B = "c0000000-0000-4000-8000-00000000000b";
const ORG_A = "d0000000-0000-4000-8000-00000000000a";
const ORG_B = "d0000000-0000-4000-8000-00000000000b";
const INVESTOR_A = "11111111-0000-4000-8000-00000000000a";
const NOW = new Date("2026-09-21T12:00:00.000Z");

const actorOf = (
  tenantId: string,
  organisationId: string,
  userId: string,
): ActorContext =>
  ActorContextSchema.parse({
    userId,
    tenantId,
    organisationId,
    membershipId: randomUUID(),
    actorType: "HUMAN",
  });

const ADMIN_A = actorOf(
  TENANT_A,
  ORG_A,
  "b0000000-0000-4000-8000-00000000000a",
);
const MEMBER_A = actorOf(
  TENANT_A,
  ORG_A,
  "b0000000-0000-4000-8000-00000000000c",
);
const ADMIN_B = actorOf(
  TENANT_B,
  ORG_B,
  "b0000000-0000-4000-8000-00000000000b",
);
/** A founder: their own company's organisation, nothing to do with an investor. */
const FOUNDER = actorOf(
  TENANT_A,
  "d0000000-0000-4000-8000-0000000000ff",
  "b0000000-0000-4000-8000-0000000000ff",
);

class Denied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationDeniedError";
  }
}

/**
 * The capability model as the database seeds it: an admin of the owning
 * organisation may do everything, an ordinary member may only read, and
 * nobody else holds anything at all.
 */
function world() {
  const gatewayRows = new Map<string, Gateway>();
  const versionRows = new Map<string, GatewayVersion>();
  const criterionRows = new Map<string, GatewayCriterion[]>();
  const admins = new Map<string, string>([
    [ADMIN_A.userId, ORG_A],
    [ADMIN_B.userId, ORG_B],
  ]);
  const members = new Map<string, string>([[MEMBER_A.userId, ORG_A]]);
  const audited: string[] = [];

  const transactions = {
    run: async <T>(work: (tx: { sql: unknown }) => Promise<T>): Promise<T> =>
      work({ sql: null }),
  };

  const service: GateQService = createGateQService({
    gateways: {
      create: (_tx, gateway) => {
        const row: Gateway = {
          ...gateway,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        };
        gatewayRows.set(row.id, row);
        return Promise.resolve(row);
      },
      findById: (id) => Promise.resolve(gatewayRows.get(id) ?? null),
      findByPublicId: (publicId) =>
        Promise.resolve(
          [...gatewayRows.values()].find((g) => g.publicId === publicId) ??
            null,
        ),
      listForInvestorOrganisation: (query) =>
        Promise.resolve(
          [...gatewayRows.values()].filter(
            (g) =>
              g.tenantId === query.tenantId &&
              g.investorOrganisationId === query.investorOrganisationId,
          ),
        ),
      setStatus: (_tx, id, status) => {
        const row = gatewayRows.get(id);
        if (row === undefined) throw new Error("no such gateway");
        const next = { ...row, status };
        gatewayRows.set(id, next);
        return Promise.resolve(next);
      },
    },
    versions: {
      createDraft: (_tx, input) => {
        const taken = [...versionRows.values()].filter(
          (v) => v.gatewayId === input.gatewayId,
        );
        const version: GatewayVersion = {
          id: randomUUID() as GatewayVersionId,
          gatewayId: input.gatewayId,
          tenantId: input.tenantId as GatewayVersion["tenantId"],
          versionNumber: taken.length + 1,
          status: "DRAFT",
          inboundMode: input.inboundMode,
          publicTitle: input.publicTitle,
          publicDescription: input.publicDescription,
          qualificationPolicyVersion: input.qualificationPolicyVersion,
          createdByUserId:
            input.createdByUserId as GatewayVersion["createdByUserId"],
          publishedByUserId: null,
          publishedAt: null,
          supersededAt: null,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        };
        versionRows.set(version.id, version);
        criterionRows.set(version.id, materialise(version.id, input.criteria));
        return Promise.resolve(version);
      },
      findById: (id) => Promise.resolve(versionRows.get(id) ?? null),
      listForGateway: (gatewayId) =>
        Promise.resolve(
          [...versionRows.values()].filter((v) => v.gatewayId === gatewayId),
        ),
      findPublished: (gatewayId) =>
        Promise.resolve(
          [...versionRows.values()].find(
            (v) => v.gatewayId === gatewayId && v.status === "PUBLISHED",
          ) ?? null,
        ),
      replaceDraft: (_tx, input) => {
        const current = versionRows.get(input.versionId);
        if (current === undefined || current.status !== "DRAFT") {
          throw new Error("no such draft");
        }
        const next: GatewayVersion = {
          ...current,
          inboundMode: input.inboundMode,
          publicTitle: input.publicTitle,
          publicDescription: input.publicDescription,
        };
        versionRows.set(next.id, next);
        criterionRows.set(next.id, materialise(next.id, input.criteria));
        return Promise.resolve(next);
      },
      publish: (_tx, input) => {
        const draft = versionRows.get(input.versionId);
        if (draft === undefined) throw new Error("no such version");
        let supersededVersionId: GatewayVersionId | null = null;
        for (const version of versionRows.values()) {
          if (
            version.gatewayId === draft.gatewayId &&
            version.status === "PUBLISHED"
          ) {
            supersededVersionId = version.id;
            versionRows.set(version.id, {
              ...version,
              status: "SUPERSEDED",
              supersededAt: input.publishedAt,
            });
          }
        }
        const published: GatewayVersion = {
          ...draft,
          status: "PUBLISHED",
          publishedAt: input.publishedAt,
          publishedByUserId:
            input.publishedByUserId as GatewayVersion["publishedByUserId"],
        };
        versionRows.set(published.id, published);
        return Promise.resolve({ version: published, supersededVersionId });
      },
      criteriaFor: (versionId) =>
        Promise.resolve(criterionRows.get(versionId) ?? []),
    },
    policies: {
      publishedPolicy: (gatewayId) =>
        Promise.resolve(policyFor(gatewayRows.get(gatewayId) ?? null)),
      publishedPolicyByPublicId: (publicId) =>
        Promise.resolve(
          policyFor(
            [...gatewayRows.values()].find((g) => g.publicId === publicId) ??
              null,
          ),
        ),
    },
    companies: {
      projectionFor: (query) =>
        Promise.resolve({
          companyId: query.companyId,
          tenantId: query.tenantId,
          classifications: [],
          headquartersCountry: "NG",
          currentStageCode: "seed",
          raise: null,
        } satisfies CompanyQualificationProjection),
    },
    organisations: {
      displayNameFor: () => Promise.resolve("Acme Ventures"),
    },
    authorization: {
      requireCapability: (input) => {
        const { actor, resource } = input;
        if (actor.tenantId !== resource.tenantId) {
          throw new Denied("another tenant");
        }
        const adminOf = admins.get(actor.userId);
        if (adminOf === resource.organisationId) return Promise.resolve(true);
        const memberOf = members.get(actor.userId);
        if (
          memberOf === resource.organisationId &&
          input.capability === "investor.gateway.view"
        ) {
          return Promise.resolve(true);
        }
        throw new Denied(String(input.capability));
      },
    },
    transactions: transactions as never,
    audit: {
      record: (_tx, input) => {
        audited.push(String((input as { actionType: string }).actionType));
        return Promise.resolve(randomUUID() as never);
      },
    },
    clock: () => NOW,
  });

  function materialise(
    versionId: string,
    criteria: readonly NewGatewayCriterion[],
  ): GatewayCriterion[] {
    return criteria.map((criterion) => ({
      ...criterion,
      id: randomUUID() as GatewayCriterion["id"],
      versionId: versionId as GatewayCriterion["versionId"],
    }));
  }

  function policyFor(gateway: Gateway | null): GatewayPolicy | null {
    if (gateway === null) return null;
    const version = [...versionRows.values()].find(
      (v) => v.gatewayId === gateway.id && v.status === "PUBLISHED",
    );
    if (version === undefined) return null;
    return {
      gateway,
      version,
      criteria: criterionRows.get(version.id) ?? [],
    };
  }

  return { service, audited, gatewayRows, versionRows, admins };
}

const GEO_CRITERION: NewGatewayCriterion = {
  position: 1,
  requiredness: "REQUIRED",
  label: "Where you are",
  config: { type: "GEOGRAPHY", allowedCountries: ["NG"] },
};

async function gatewayFor(w: ReturnType<typeof world>): Promise<Gateway> {
  return w.service.createGateway({
    actor: ADMIN_A,
    investorOrganisationId: INVESTOR_A,
    organisationId: ORG_A,
    name: "Seed programme",
  });
}

describe("who may configure a gateway", () => {
  it("1: an admin of the owning organisation can create and configure one", async () => {
    const w = world();
    const gateway = await gatewayFor(w);
    expect(gateway.investorOrganisationId).toBe(INVESTOR_A);
    expect(gateway.publicId).toMatch(/^gq_/);

    const draft = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      criteria: [GEO_CRITERION],
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.qualificationPolicyVersion).toBe(QUALIFICATION_POLICY_VERSION);

    const published = await w.service.publishVersion({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      versionId: draft.id,
    });
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedByUserId).toBe(ADMIN_A.userId);
    expect(w.audited).toEqual([
      "gateq.gateway.created",
      "gateq.draft.created",
      "gateq.version.published",
    ]);
  });

  it("2 and 3: another organisation can neither read nor change it", async () => {
    // And it is told "no such gateway", not "not yours": an id must not be
    // probeable for existence.
    const w = world();
    const gateway = await gatewayFor(w);
    for (const call of [
      () => w.service.getPolicy({ actor: ADMIN_B, gatewayId: gateway.id }),
      () => w.service.listVersions({ actor: ADMIN_B, gatewayId: gateway.id }),
      () =>
        w.service.createDraft({
          actor: ADMIN_B,
          gatewayId: gateway.id,
          inboundMode: "OPEN",
          publicTitle: "Hijacked",
          criteria: [],
        }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(GatewayNotFoundError);
    }
  });

  it("2: an admin of another organisation in the same tenant is refused too", async () => {
    // Tenant is not organisation. Sharing a tenant grants nothing.
    const w = world();
    const gateway = await gatewayFor(w);
    w.admins.set(ADMIN_B.userId, ORG_B);
    const sameTenantStranger = actorOf(
      TENANT_A,
      ORG_B,
      "b0000000-0000-4000-8000-0000000000ab",
    );
    await expect(
      w.service.createDraft({
        actor: sameTenantStranger,
        gatewayId: gateway.id,
        inboundMode: "OPEN",
        publicTitle: "Hijacked",
        criteria: [],
      }),
    ).rejects.toThrow("investor.gateway.edit");
  });

  it("4: an ordinary member may read the policy and may not publish", async () => {
    const w = world();
    const gateway = await gatewayFor(w);
    const draft = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      criteria: [GEO_CRITERION],
    });

    await expect(
      w.service.listVersions({ actor: MEMBER_A, gatewayId: gateway.id }),
    ).resolves.toHaveLength(1);
    await expect(
      w.service.publishVersion({
        actor: MEMBER_A,
        gatewayId: gateway.id,
        versionId: draft.id,
      }),
    ).rejects.toThrow("investor.gateway.publish");
    await expect(
      w.service.createDraft({
        actor: MEMBER_A,
        gatewayId: gateway.id,
        inboundMode: "OPEN",
        publicTitle: "Opened",
        criteria: [],
      }),
    ).rejects.toThrow("investor.gateway.edit");
  });

  it("9: a founder cannot touch an investor's gateway", async () => {
    const w = world();
    const gateway = await gatewayFor(w);
    await expect(
      w.service.createDraft({
        actor: FOUNDER,
        gatewayId: gateway.id,
        inboundMode: "OPEN",
        publicTitle: "Let me in",
        criteria: [],
      }),
    ).rejects.toThrow("investor.gateway.edit");
    await expect(
      w.service.getPolicy({ actor: FOUNDER, gatewayId: gateway.id }),
    ).rejects.toThrow("investor.gateway.view");
  });

  it("8: the creator leaving does not orphan the gateway", async () => {
    // Authority is read from the gateway's organisation, not from who set
    // it up. Another admin can carry on; the creator, having left, cannot.
    const w = world();
    const gateway = await gatewayFor(w);
    const draft = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      criteria: [GEO_CRITERION],
    });

    const successor = actorOf(
      TENANT_A,
      ORG_A,
      "b0000000-0000-4000-8000-0000000000a2",
    );
    w.admins.set(successor.userId, ORG_A);
    w.admins.delete(ADMIN_A.userId);

    await expect(
      w.service.publishVersion({
        actor: successor,
        gatewayId: gateway.id,
        versionId: draft.id,
      }),
    ).resolves.toMatchObject({ status: "PUBLISHED" });
    expect(w.gatewayRows.get(gateway.id)?.createdByUserId).toBe(ADMIN_A.userId);

    await expect(
      w.service.createDraft({
        actor: ADMIN_A,
        gatewayId: gateway.id,
        inboundMode: "OPEN",
        publicTitle: "Back in",
        criteria: [],
      }),
    ).rejects.toThrow("investor.gateway.edit");
  });
});

describe("drafts and publication", () => {
  it("O: editing a draft does not move the published gateway", async () => {
    const w = world();
    const gateway = await gatewayFor(w);
    const first = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      criteria: [GEO_CRITERION],
    });
    await w.service.publishVersion({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      versionId: first.id,
    });

    const second = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "OPEN",
      publicTitle: "Opening up",
      criteria: [],
    });
    await w.service.replaceDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      versionId: second.id,
      inboundMode: "CLOSED",
      publicTitle: "Actually closing",
      criteria: [],
    });

    // The world still sees the published version, unchanged.
    const live = await w.service.publicGateway(gateway.publicId);
    expect(live?.inboundMode).toBe("QUALIFIED");
    expect(live?.title).toBe("Seed-stage fintech");
    const qualification = await w.service.qualifyCompany({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      companyId: "44444444-0000-4000-8000-000000000001",
      companyTenantId: TENANT_A,
    });
    expect(qualification.inboundMode).toBe("QUALIFIED");
    expect(qualification.gatewayVersionNumber).toBe(1);
  });

  it("P: publishing moves new evaluations forward and leaves the old version standing", async () => {
    const w = world();
    const gateway = await gatewayFor(w);
    const first = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      criteria: [GEO_CRITERION],
    });
    await w.service.publishVersion({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      versionId: first.id,
    });
    const before = await w.service.qualifyCompany({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      companyId: "44444444-0000-4000-8000-000000000001",
      companyTenantId: TENANT_A,
    });

    const second = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "OPEN",
      publicTitle: "Open to all",
      criteria: [],
    });
    await w.service.publishVersion({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      versionId: second.id,
    });
    const after = await w.service.qualifyCompany({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      companyId: "44444444-0000-4000-8000-000000000001",
      companyTenantId: TENANT_A,
    });

    expect(before.gatewayVersionNumber).toBe(1);
    expect(after.gatewayVersionNumber).toBe(2);
    expect(after.inboundMode).toBe("OPEN");
    // The earlier result still names version 1, and version 1 is still
    // there to be read: a stored decision stays attributable.
    expect(before.gatewayVersionId).not.toBe(after.gatewayVersionId);
    expect(w.versionRows.get(before.gatewayVersionId)?.status).toBe(
      "SUPERSEDED",
    );
  });

  it("a published version cannot be edited or republished through the service", async () => {
    const w = world();
    const gateway = await gatewayFor(w);
    const draft = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      criteria: [GEO_CRITERION],
    });
    await w.service.publishVersion({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      versionId: draft.id,
    });
    for (const call of [
      () =>
        w.service.replaceDraft({
          actor: ADMIN_A,
          gatewayId: gateway.id,
          versionId: draft.id,
          inboundMode: "OPEN",
          publicTitle: "Rewritten",
          criteria: [],
        }),
      () =>
        w.service.publishVersion({
          actor: ADMIN_A,
          gatewayId: gateway.id,
          versionId: draft.id,
        }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(GatewayVersionNotDraftError);
    }
  });
});

describe("the public identifier", () => {
  it("5, 6 and 7: it reaches the published projection and nothing else", async () => {
    const w = world();
    const gateway = await gatewayFor(w);
    const draft = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      publicDescription: "We read every application.",
      criteria: [GEO_CRITERION],
    });

    // 6: before publication there is nothing to see, even holding the id.
    expect(await w.service.publicGateway(gateway.publicId)).toBeNull();

    await w.service.publishVersion({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      versionId: draft.id,
    });
    const projection = await w.service.publicGateway(gateway.publicId);
    expect(projection).not.toBeNull();
    if (projection === null) return;

    // 5 and 7: what a public caller gets is a fixed whitelist, and the
    // configured values, the ids and the people are not in it.
    expect(Object.keys(projection).sort()).toEqual(
      [
        "acceptingApplications",
        "criteria",
        "description",
        "inboundMode",
        "organisationDisplayName",
        "publicId",
        "publishedAt",
        "title",
      ].sort(),
    );
    const text = JSON.stringify(projection);
    for (const forbidden of [
      gateway.id,
      draft.id,
      INVESTOR_A,
      ORG_A,
      TENANT_A,
      ADMIN_A.userId,
      '"NG"',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("an unknown public identifier is simply nothing", async () => {
    const w = world();
    const unknown = GatewayPublicIdSchema.parse(
      "gq_00000000000000000000000000",
    );
    expect(await w.service.publicGateway(unknown)).toBeNull();
  });
});

describe("GateQ owns its own policy", () => {
  it("Q: it holds no mandate, and no mandate can reach it", () => {
    // Structural rather than behavioural: the package does not depend on
    // the investors context at all, so changing an ACTIVE mandate has no
    // path by which it could rewrite a published gateway version.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    for (const forbidden of [
      "@capital-q/investors",
      "@capital-q/discovery",
      "@capital-q/companies",
      "@capital-q/q-core",
      "@capital-q/q-knowledge",
      "@capital-q/model-gateway",
      "@capital-q/evidence",
      "@capital-q/network",
    ]) {
      expect(Object.keys(manifest.dependencies)).not.toContain(forbidden);
    }
  });

  it("R and S: it never touches a ranker or a relationship", async () => {
    const w = world();
    const gateway = await gatewayFor(w);
    const draft = await w.service.createDraft({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      criteria: [GEO_CRITERION],
    });
    await w.service.publishVersion({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      versionId: draft.id,
    });
    const result = await w.service.qualifyCompany({
      actor: ADMIN_A,
      gatewayId: gateway.id,
      companyId: "44444444-0000-4000-8000-000000000001",
      companyTenantId: TENANT_A,
    });
    // The audit trail records configuration acts only. Qualifying somebody
    // is a read: it creates no relationship and no state.
    expect(w.audited).toEqual([
      "gateq.gateway.created",
      "gateq.draft.created",
      "gateq.version.published",
    ]);
    expect(result.outcome).toBe("QUALIFIED");
  });
});
