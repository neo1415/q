import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import type {
  CompanyEligibilityFacts,
  DiscoverabilityViewpoint,
  EligibilityPorts,
  MandateSnapshotForEligibility,
} from "../src/eligibility/ports.js";
import { createEligibilityService } from "../src/eligibility/service.js";

/**
 * Organisation-safe recommendation authority (CQ-PERM-ORG-VIEW-001).
 *
 * A slate belongs to an Investor Organisation and every member reads it, so
 * what goes into it must not depend on which member happened to build it.
 * The pipeline had exactly one person-scoped read -- the disclosure
 * evaluator's `permittedToView` -- and it was asked as whichever human the
 * worker resolved. These tests hold the correction at the seam where it is
 * decided.
 *
 * The discoverability port below deliberately answers DIFFERENTLY for a
 * member and for the organisation, which is what the real evaluator does
 * when a `specifically_shared` grant names a USER or a MEMBERSHIP. A fake
 * that ignored the viewpoint would pass whatever the code did.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const INVESTOR_ORGANISATION = "d0000000-0000-4000-8000-00000000000b";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const MANDATE = "33333333-0000-4000-8000-000000000031";

/** Two colleagues of the same investor organisation. */
const member = (userId: string, membershipId: string): ActorContext =>
  ActorContextSchema.parse({
    userId,
    tenantId: TENANT,
    organisationId: INVESTOR_ORGANISATION,
    membershipId,
    actorType: "HUMAN",
  });

const MEMBER_A = member(
  "b0000000-0000-4000-8000-00000000000a",
  "e0000000-0000-4000-8000-00000000000a",
);
const MEMBER_B = member(
  "b0000000-0000-4000-8000-00000000000b",
  "e0000000-0000-4000-8000-00000000000b",
);

/** Everyone in the organisation can see this one. */
const SHARED_COMPANY = "44444444-0000-4000-8000-000000000001";
/** Shared with MEMBER_A personally, and with nobody else. */
const PRIVATE_TO_A = "44444444-0000-4000-8000-000000000002";
const COMPANY_TENANT = "22222222-0000-4000-8000-000000000001";

const MANDATE_SNAPSHOT: MandateSnapshotForEligibility = {
  mandateId: MANDATE,
  investorOrganisationId: INVESTOR,
  status: "ACTIVE",
  version: 1,
  // No constraints and no taxonomy rules: nothing but disclosure decides.
  constraints: [],
  taxonomyPreferences: [],
};

function company(companyId: string): CompanyEligibilityFacts {
  return {
    companyId,
    tenantId: COMPANY_TENANT,
    organisationId: "d0000000-0000-4000-8000-00000000000a",
    companyStatus: "active" as const,
    // Both companies are declared network-visible: the classification half
    // of the gate passes, so the disclosure half is what decides.
    marketplaceVisibility: "network_visible",
    marketplaceParticipation: "ELIGIBLE" as const,
    currentStageCode: "seed",
    headquartersCountry: "NG",
  };
}

type Asked = DiscoverabilityViewpoint;

function ports(): {
  readonly ports: EligibilityPorts;
  readonly asked: Asked[];
} {
  const asked: Asked[] = [];
  const eligibilityPorts: EligibilityPorts = {
    companies: {
      findMany: (ids) => Promise.resolve(ids.map((id) => company(id))),
    },
    classifications: {
      listActive: () => Promise.resolve(new Map()),
    },
    mandates: {
      activeMandate: () =>
        Promise.resolve({ kind: "FOUND", mandate: MANDATE_SNAPSHOT }),
    },
    investorSubject: {
      investorOrganisationFor: (actor) =>
        Promise.resolve(
          actor.organisationId === INVESTOR_ORGANISATION
            ? { investorOrganisationId: INVESTOR }
            : null,
        ),
    },
    discoverability: {
      permittedToView: (viewpoint, ids) => {
        asked.push(viewpoint);
        return Promise.resolve(
          new Map(
            ids.map((id) => {
              if (id === SHARED_COMPANY) return [id, true];
              // The personal grant: visible to MEMBER_A as themselves,
              // and to no one else -- not to a colleague, and not to the
              // organisation asked as an organisation.
              const onlyForA =
                viewpoint.kind === "ACTOR" &&
                viewpoint.actor.userId === MEMBER_A.userId;
              return [id, onlyForA];
            }),
          ),
        );
      },
    },
    relationships: {
      standings: (_investor, ids) =>
        Promise.resolve(new Map(ids.map((id) => [id, { kind: "NONE" }]))),
    },
    taxonomyVersions: {
      currentVersions: () => Promise.resolve({}),
    },
  };
  return { asked, ports: eligibilityPorts };
}

const service = (p: EligibilityPorts) =>
  createEligibilityService({
    ports: p,
    clock: () => new Date("2026-09-18T12:00:00.000Z"),
  });

const decisionsFor = async (
  actor: ActorContext,
  viewpoint?: "ACTOR" | "INVESTOR_ORGANISATION",
) => {
  const p = ports();
  const evaluation = await service(p.ports).evaluate({
    actor,
    mode: "INVESTOR_DISCOVER",
    mandateId: MANDATE,
    companyIds: [SHARED_COMPANY, PRIVATE_TO_A],
    ...(viewpoint === undefined ? {} : { viewpoint }),
  });
  return {
    eligible: evaluation.results
      .filter((r) => r.decision === "ELIGIBLE")
      .map((r) => r.companyId)
      .sort(),
    asked: p.asked,
  };
};

describe("the organisation viewpoint", () => {
  it("2: a member's personal grant does not put a company in the organisation's pool", async () => {
    // The defect, at the seam that decides it. Asked as MEMBER_A the extra
    // company is visible; asked as the organisation it is not, and the
    // organisation's artefact is what a slate is.
    const asMember = await decisionsFor(MEMBER_A, "ACTOR");
    expect(asMember.eligible).toEqual([PRIVATE_TO_A, SHARED_COMPANY].sort());

    const asOrganisation = await decisionsFor(
      MEMBER_A,
      "INVESTOR_ORGANISATION",
    );
    expect(asOrganisation.eligible).toEqual([SHARED_COMPANY]);
  });

  it("1: the same evaluation from a different member gives the same answer", async () => {
    // Which member the worker resolved must not change what the
    // organisation computes -- including when the creator has gone and the
    // build falls back to a colleague.
    const byA = await decisionsFor(MEMBER_A, "INVESTOR_ORGANISATION");
    const byB = await decisionsFor(MEMBER_B, "INVESTOR_ORGANISATION");
    expect(byA.eligible).toEqual(byB.eligible);
    expect(byA.eligible).toEqual([SHARED_COMPANY]);
  });

  it("carries no user or membership into the disclosure question", async () => {
    // There is nothing for a person's access to enter through: the
    // viewpoint has no field for one.
    const { asked } = await decisionsFor(MEMBER_A, "INVESTOR_ORGANISATION");
    expect(asked).toHaveLength(1);
    const viewpoint = asked[0];
    expect(viewpoint?.kind).toBe("INVESTOR_ORGANISATION");
    const serialised = JSON.stringify(viewpoint);
    expect(serialised).not.toContain(MEMBER_A.userId);
    expect(serialised).not.toContain(MEMBER_A.membershipId);
  });

  it("an omitted viewpoint is the actor's, so nothing silently widens", async () => {
    // The default must be the narrower, per-person question: a caller that
    // forgets to say gets their own authority, never the organisation's.
    const { asked } = await decisionsFor(MEMBER_A);
    expect(asked[0]?.kind).toBe("ACTOR");
  });

  it("10: a privileged runner does not broaden disclosure", async () => {
    // Execution authority is not disclosure authority. Whoever runs the
    // build, the organisation viewpoint asks the same question, and an
    // actor with no organisation resolves to no investor subject at all.
    const stranger = member(
      "b0000000-0000-4000-8000-00000000000f",
      "e0000000-0000-4000-8000-00000000000f",
    );
    const outsider = ActorContextSchema.parse({
      ...stranger,
      organisationId: "d0000000-0000-4000-8000-0000000000ff",
    });
    const p = ports();
    await expect(
      service(p.ports).evaluate({
        actor: outsider,
        mode: "INVESTOR_DISCOVER",
        companyIds: [SHARED_COMPANY],
        viewpoint: "INVESTOR_ORGANISATION",
      }),
    ).rejects.toThrow();
    // Nothing was even asked of the disclosure evaluator.
    expect(p.asked).toHaveLength(0);
  });
});

describe("which paths use which viewpoint", () => {
  it("the build asks as the organisation; reading and acting ask as the person", () => {
    // Stated as a fact about the source, because the distinction is the
    // whole packet and a later edit could quietly flip one of them.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const read = (p: string) => readFileSync(join(root, "src", p), "utf8");

    // Candidate generation feeds the slate every member reads.
    for (const path of ["candidates/service.ts", "semantic/service.ts"]) {
      expect(read(path), path).toContain('viewpoint: "INVESTOR_ORGANISATION"');
    }
    // The reader withholds per person, and acting on a company is that
    // person's act: both must stay the actor's own question.
    for (const path of ["slates/reader.ts", "interactions/service.ts"]) {
      expect(read(path), path).not.toContain("INVESTOR_ORGANISATION");
    }
  });
});
