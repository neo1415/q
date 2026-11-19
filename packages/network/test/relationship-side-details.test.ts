import { describe, expect, it, vi } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  createRelationshipSideDetailService,
  exactAmount,
} from "../src/application/relationship-side-details.js";
import {
  InterestCompanyNotFoundError,
  InterestNotFoundError,
  RelationshipSideDetailsConflictError,
  RelationshipSideOwnerError,
} from "../src/domain/errors.js";

/**
 * Decision 106 gaps: a side's own pipeline fields on one relationship. The
 * side is the actor's own party under their active organisation; the
 * counterpart's row is never read or written; the owner is a member of the
 * side's own organisation; a save over a newer revision is refused; each
 * save is audited by field name, never value.
 */

const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});
const relationshipId = "00000000-0000-4000-8000-0000000000a1";
const investorId = "00000000-0000-4000-8000-000000000006";
const companyId = "00000000-0000-4000-8000-000000000007";
const member = {
  membership_id: "00000000-0000-4000-8000-0000000000c1",
  user_id: "00000000-0000-4000-8000-0000000000c2",
  name: "Ada Obi",
};

const row = (extra: Record<string, unknown> = {}) => ({
  relationship_id: relationshipId,
  stage: "DILIGENCE",
  stage_label: "Deep dive",
  owner_membership_id: member.membership_id,
  owner_user_id: member.user_id,
  owner_name: "Ada Obi",
  source: "Warm intro",
  introducer_name: "Tunde Bello",
  introducer_email: null,
  expected_amount: "500000.00",
  expected_currency: "USD",
  priority: "HIGH",
  revision: 3,
  updated_at: new Date("2026-11-18T10:00:00.000Z"),
  ...extra,
});

function fixture(
  options: {
    party?: boolean;
    rows?: unknown[];
    written?: number | null;
    company?: { organisationId: string } | null;
    pair?: { companyId: string; investorOrganisationId: string } | null;
  } = {},
) {
  const resolve = <T>(value: T) => vi.fn(() => Promise.resolve(value));
  const repository = {
    isParty: resolve(options.party ?? true),
    partiesOf: resolve(
      options.pair === undefined
        ? { companyId, investorOrganisationId: investorId }
        : options.pair,
    ),
    forRelationships: resolve(options.rows ?? [row()]),
    activeMembers: resolve([member]),
    write: resolve(options.written === undefined ? 4 : options.written),
  };
  const audit = { record: vi.fn(() => Promise.resolve("audit")) };
  const service = createRelationshipSideDetailService({
    sql: vi.fn() as never,
    transactions: {
      run: (work: (tx: unknown) => Promise<unknown>) => work({ sql: "tx" }),
    } as never,
    audit: audit as never,
    authorization: { requireCapability: resolve(undefined) } as never,
    companies: {
      findCanonicalCompany: resolve(
        options.company === null
          ? null
          : {
              id: companyId,
              tenantId: actor.tenantId,
              organisationId:
                options.company?.organisationId ?? actor.organisationId,
            },
      ),
    } as never,
    investorSubject: {
      investorOrganisationFor: resolve({ investorOrganisationId: investorId }),
    },
    sideDetails: repository as never,
  });
  return { service, repository, audit };
}

const investorSide = {
  tenantId: actor.tenantId,
  organisationId: actor.organisationId,
  party: "INVESTOR",
  partyId: investorId,
};

describe("a side's own pipeline fields (decision 106 gaps)", () => {
  it("reads the actor's own side's fields and its active members, organisation_private", async () => {
    const { service, repository } = fixture();
    const read = await service.read(actor, relationshipId);
    expect(repository.isParty).toHaveBeenCalledWith(
      expect.anything(),
      relationshipId,
      investorSide,
    );
    expect(repository.forRelationships).toHaveBeenCalledWith(
      expect.anything(),
      investorSide,
      [relationshipId],
    );
    expect(read).toEqual({
      details: {
        relationshipId,
        side: "INVESTOR",
        stage: "DILIGENCE",
        stageLabel: "Deep dive",
        owner: { membershipId: member.membership_id, name: "Ada Obi" },
        source: "Warm intro",
        introducerName: "Tunde Bello",
        introducerEmail: null,
        expected: { amount: "500000", currency: "USD" },
        priority: "HIGH",
        revision: 3,
        updatedAt: "2026-11-18T10:00:00.000Z",
        visibility: "organisation_private",
      },
      members: [{ membershipId: member.membership_id, name: "Ada Obi" }],
    });
  });

  it("reads nothing set as revision 0, never as zero values", async () => {
    const { service } = fixture({ rows: [] });
    const read = await service.read(actor, relationshipId);
    expect(read.details).toMatchObject({
      stage: null,
      owner: null,
      expected: null,
      priority: null,
      revision: 0,
      updatedAt: null,
    });
  });

  it("reads a founder's side from their own company, checked against their organisation", async () => {
    const { service, repository } = fixture();
    await service.read(actor, relationshipId, companyId);
    expect(repository.isParty).toHaveBeenCalledWith(
      expect.anything(),
      relationshipId,
      { ...investorSide, party: "COMPANY", partyId: companyId },
    );
  });

  it("refuses another organisation's company and a relationship the side is not a party to (other-side negative)", async () => {
    await expect(
      fixture({
        company: { organisationId: "00000000-0000-4000-8000-0000000000ff" },
      }).service.read(actor, relationshipId, companyId),
    ).rejects.toBeInstanceOf(InterestCompanyNotFoundError);
    const notParty = fixture({ party: false });
    await expect(
      notParty.service.read(actor, relationshipId),
    ).rejects.toBeInstanceOf(InterestNotFoundError);
    expect(notParty.repository.forRelationships).not.toHaveBeenCalled();
    await expect(
      fixture().service.read(actor, "not-a-uuid"),
    ).rejects.toBeInstanceOf(InterestNotFoundError);
  });

  it("saves only the fields named, over the revision seen, and audits the field names only", async () => {
    const { service, repository, audit } = fixture();
    await service.update(
      actor,
      relationshipId,
      {
        revision: 3,
        priority: "LOW",
        expected: { amount: "750000", currency: "EUR" },
        ownerMembershipId: member.membership_id,
      },
      { correlationId: "corr-1" as never },
    );
    expect(repository.write).toHaveBeenCalledWith("tx", {
      relationshipId,
      side: investorSide,
      userId: actor.userId,
      expectedRevision: 3,
      values: {
        priority: "LOW",
        expected: { amount: "750000", currency: "EUR" },
        owner: { membershipId: member.membership_id, userId: member.user_id },
      },
    });
    const record = audit.record.mock.calls[0] as unknown as [
      unknown,
      { metadata: unknown; actionType: string },
    ];
    expect(record[1].actionType).toBe("relationship.side_details.updated");
    expect(record[1].metadata).toEqual({
      side: "INVESTOR",
      fields: ["expected", "owner", "priority"],
      revision: 4,
    });
    expect(JSON.stringify(record[1].metadata)).not.toContain("750000");
  });

  it("refuses an owner who is not an active member of the side's organisation", async () => {
    const { service, repository } = fixture();
    await expect(
      service.update(
        actor,
        relationshipId,
        {
          revision: 3,
          ownerMembershipId: "00000000-0000-4000-8000-0000000000ee",
        },
        { correlationId: "corr-1" as never },
      ),
    ).rejects.toBeInstanceOf(RelationshipSideOwnerError);
    expect(repository.write).not.toHaveBeenCalled();
  });

  it("refuses a save over a newer revision, never overwriting it", async () => {
    const { service, audit } = fixture({ written: null });
    await expect(
      service.update(
        actor,
        relationshipId,
        { revision: 2, priority: "LOW" },
        { correlationId: "corr-1" as never },
      ),
    ).rejects.toBeInstanceOf(RelationshipSideDetailsConflictError);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("refuses money as a float or without a currency, at the contract", async () => {
    const { service } = fixture();
    for (const expected of [
      { amount: 250000, currency: "USD" },
      { amount: "250000" },
      { amount: "1e6", currency: "USD" },
      { amount: "0", currency: "USD" },
      { amount: "250000", currency: "usd" },
    ]) {
      await expect(
        service.update(
          actor,
          relationshipId,
          { revision: 3, expected },
          { correlationId: "corr-1" as never },
        ),
      ).rejects.toThrow();
    }
  });

  it("gives Q the asker's own side, whichever side their organisation is", async () => {
    // The actor's organisation is the company's: the founder side.
    const founder = fixture();
    await founder.service.own(actor, relationshipId);
    expect(founder.repository.isParty).toHaveBeenCalledWith(
      expect.anything(),
      relationshipId,
      { ...investorSide, party: "COMPANY", partyId: companyId },
    );
    // Another organisation's company: the investor side.
    const investor = fixture({
      company: { organisationId: "00000000-0000-4000-8000-0000000000ff" },
    });
    await investor.service.own(actor, relationshipId);
    expect(investor.repository.isParty).toHaveBeenCalledWith(
      expect.anything(),
      relationshipId,
      investorSide,
    );
    // No relationship, or not a party: nothing, never the counterpart's.
    expect(
      await fixture({ pair: null }).service.own(actor, relationshipId),
    ).toBeNull();
    expect(
      await fixture({ party: false }).service.own(actor, relationshipId),
    ).toBeNull();
  });

  it("summarises a pipeline page for the reader's own side", async () => {
    const { service } = fixture();
    const mine = await service.summaries(actor, [relationshipId, "bad"]);
    expect(mine.get(relationshipId)).toEqual({
      stage: "DILIGENCE",
      stageLabel: "Deep dive",
      priority: "HIGH",
      ownerName: "Ada Obi",
    });
  });

  it("reads numeric(17,2) back exactly", () => {
    expect(exactAmount("500000.00")).toBe("500000");
    expect(exactAmount("1500000.50")).toBe("1500000.5");
    expect(exactAmount("10.25")).toBe("10.25");
  });
});
