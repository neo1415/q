import { describe, expect, it } from "vitest";

import type { DataRoomView } from "@capital-q/contracts";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createArtifactSourceEntitlement } from "../src/composition/artifact-sources.js";

/**
 * SEC-01: an artifact's recorded source documents are re-checked through
 * the data room's own view, as the person. OPEN or the company's own team
 * keeps it; anything else (a revoked grant, a gone document, a room they
 * cannot see) closes it.
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

const COMPANY = "f0000000-0000-4000-8000-000000000001";
const DOC_A = "aa000000-0000-4000-8000-000000000001";
const DOC_B = "aa000000-0000-4000-8000-000000000002";

function investorRoom(
  documents: readonly { id: string; access: "OPEN" | "REQUESTABLE" }[],
): DataRoomView {
  return {
    viewer: "INVESTOR",
    companyId: COMPANY,
    folders: [],
    documents: documents.map((document) => ({
      documentId: document.id,
      title: "Financials",
      folderCode: "financials",
      shownAs: document.access === "OPEN" ? "SHARED" : "ON_REQUEST",
      access: document.access,
      kind: "pdf",
      pageCount: 3,
      updatedAt: "2026-11-01T00:00:00.000Z",
      validUntil: null,
      openedAt: null,
      accessEndsAt: null,
    })),
  };
}

function check(room: DataRoomView | null, companyOf = COMPANY) {
  const viewsAsked: string[] = [];
  const entitled = createArtifactSourceEntitlement({
    documentCompany: (id) =>
      Promise.resolve(
        id === DOC_A || id === DOC_B ? { companyId: companyOf } : null,
      ),
    dataRoomView: (actor, companyId) => {
      expect(actor.userId).toBe(ACTOR.userId);
      viewsAsked.push(companyId);
      return Promise.resolve(room);
    },
  });
  return { entitled, viewsAsked };
}

describe("SEC-01 · artifact source entitlement through the data room", () => {
  it("every source OPEN to them: entitled, one view per company", async () => {
    const { entitled, viewsAsked } = check(
      investorRoom([
        { id: DOC_A, access: "OPEN" },
        { id: DOC_B, access: "OPEN" },
      ]),
    );
    expect(
      await entitled(ACTOR, [
        { kind: "data_room_document", id: DOC_A },
        { kind: "retrieved_document", id: DOC_B },
        { kind: "retrieved_document", id: DOC_A },
      ]),
    ).toBe(true);
    expect(viewsAsked).toEqual([COMPANY]);
  });

  it("a revoked grant (no longer OPEN, or no longer listed) closes it", async () => {
    const requestable = check(
      investorRoom([
        { id: DOC_A, access: "OPEN" },
        { id: DOC_B, access: "REQUESTABLE" },
      ]),
    );
    expect(
      await requestable.entitled(ACTOR, [
        { kind: "data_room_document", id: DOC_A },
        { kind: "data_room_document", id: DOC_B },
      ]),
    ).toBe(false);
    const unlisted = check(investorRoom([{ id: DOC_A, access: "OPEN" }]));
    expect(
      await unlisted.entitled(ACTOR, [
        { kind: "data_room_document", id: DOC_B },
      ]),
    ).toBe(false);
  });

  it("the company's own team sees every document of its room", async () => {
    const { entitled } = check({
      viewer: "OWNER",
      companyId: COMPANY,
      stageCode: "seed",
      countryCode: null,
      folders: [],
      documents: [
        {
          documentId: DOC_A,
          title: "Deck",
          folderCode: "company",
          checklistItemCode: null,
          level: "PRIVATE",
          visibilityScope: "organisation_private",
          kind: "pdf",
          pageCount: 10,
          updatedAt: "2026-11-01T00:00:00.000Z",
          validUntil: null,
          sharedWith: 0,
          openedBy: 0,
          version: 1,
        },
      ],
      checklist: [],
      requests: [],
    });
    expect(
      await entitled(ACTOR, [{ kind: "retrieved_document", id: DOC_A }]),
    ).toBe(true);
  });

  it("a room they cannot see, or a document that is gone, closes it", async () => {
    expect(
      await check(null).entitled(ACTOR, [
        { kind: "data_room_document", id: DOC_A },
      ]),
    ).toBe(false);
    const gone = "aa000000-0000-4000-8000-0000000000ff";
    expect(
      await check(investorRoom([{ id: gone, access: "OPEN" }])).entitled(
        ACTOR,
        [{ kind: "retrieved_document", id: gone }],
      ),
    ).toBe(false);
  });

  it("an error propagates, so the artifact service closes the artifact", async () => {
    const entitled = createArtifactSourceEntitlement({
      documentCompany: () => Promise.reject(new Error("evidence down")),
      dataRoomView: () => Promise.resolve(null),
    });
    await expect(
      entitled(ACTOR, [{ kind: "data_room_document", id: DOC_A }]),
    ).rejects.toThrow("evidence down");
  });
});
