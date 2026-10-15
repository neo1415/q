import { describe, expect, it, vi } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { createRelationshipNoteService } from "../src/application/relationship-notes.js";
import {
  InterestCompanyNotFoundError,
  InterestNotFoundError,
  RelationshipNoteSupersededError,
} from "../src/domain/errors.js";

const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});
const relationshipId = "00000000-0000-4000-8000-0000000000a1";
const noteId = "00000000-0000-4000-8000-0000000000b1";
const earlierId = "00000000-0000-4000-8000-0000000000b0";
const investorId = "00000000-0000-4000-8000-000000000006";
const companyId = "00000000-0000-4000-8000-000000000007";

const row = (extra: Record<string, unknown> = {}) => ({
  id: noteId,
  body: "Strong team; check churn.",
  author_user_id: actor.userId,
  author_name: "Ada Obi",
  created_at: new Date("2026-10-15T10:00:00.000Z"),
  supersedes_note_id: null,
  ...extra,
});

function fixture(
  options: {
    party?: boolean;
    own?: Record<string, unknown> | null;
    findOwn?: (id: string) => unknown;
    insertError?: Error;
    company?: { tenantId: string; organisationId: string } | null;
  } = {},
) {
  const resolve = <T>(value: T) => vi.fn(() => Promise.resolve(value));
  const notes = {
    isParty: resolve(options.party ?? true),
    listCurrent: resolve([row()]),
    findOwn: vi.fn((_sql: unknown, id: string) =>
      Promise.resolve(options.findOwn?.(id) ?? options.own ?? null),
    ),
    insert: vi.fn(() =>
      options.insertError === undefined
        ? Promise.resolve(noteId)
        : Promise.reject(options.insertError),
    ),
  };
  const service = createRelationshipNoteService({
    sql: vi.fn() as never,
    authorization: { requireCapability: resolve(undefined) } as never,
    companies: {
      findCanonicalCompany: resolve(
        options.company === null
          ? null
          : {
              id: companyId,
              tenantId: options.company?.tenantId ?? actor.tenantId,
              organisationId:
                options.company?.organisationId ?? actor.organisationId,
            },
      ),
    } as never,
    investorSubject: {
      investorOrganisationFor: resolve({ investorOrganisationId: investorId }),
    },
    notes: notes as never,
  });
  return { service, notes };
}

const investorSide = {
  tenantId: actor.tenantId,
  organisationId: actor.organisationId,
  companyId: null,
  investorOrganisationId: investorId,
};

describe("CRM private notes (S3)", () => {
  it("lists only the actor's own side's current notes, organisation_private", async () => {
    const { service, notes } = fixture();
    const list = await service.list(actor, relationshipId);
    expect(notes.isParty).toHaveBeenCalledWith(
      expect.anything(),
      relationshipId,
      investorSide,
    );
    expect(notes.listCurrent).toHaveBeenCalledWith(
      expect.anything(),
      relationshipId,
      investorSide,
    );
    expect(list).toEqual({
      visibility: "organisation_private",
      items: [
        {
          id: noteId,
          body: "Strong team; check churn.",
          authorName: "Ada Obi",
          authoredByMe: true,
          createdAt: "2026-10-15T10:00:00.000Z",
          supersedesNoteId: null,
        },
      ],
    });
  });

  it("reads a founder's side from their own company, checked against their organisation", async () => {
    const { service, notes } = fixture();
    await service.list(actor, relationshipId, companyId);
    expect(notes.listCurrent).toHaveBeenCalledWith(
      expect.anything(),
      relationshipId,
      { ...investorSide, companyId, investorOrganisationId: null },
    );
  });

  it("refuses another organisation's company id, before any note is read", async () => {
    const { service, notes } = fixture({
      company: {
        tenantId: "00000000-0000-4000-8000-0000000000ff",
        organisationId: "00000000-0000-4000-8000-0000000000fe",
      },
    });
    await expect(
      service.list(actor, relationshipId, companyId),
    ).rejects.toBeInstanceOf(InterestCompanyNotFoundError);
    expect(notes.listCurrent).not.toHaveBeenCalled();
  });

  it("says not-found for a relationship the side is no party of, and for a malformed id", async () => {
    const { service, notes } = fixture({ party: false });
    await expect(service.list(actor, relationshipId)).rejects.toBeInstanceOf(
      InterestNotFoundError,
    );
    await expect(service.list(actor, "nope")).rejects.toBeInstanceOf(
      InterestNotFoundError,
    );
    expect(notes.listCurrent).not.toHaveBeenCalled();
  });

  it("writes a note for the actor's side and membership, and answers a retry with the first write", async () => {
    let written = false;
    const { service, notes } = fixture({
      findOwn: () => (written ? row() : null),
    });
    notes.insert.mockImplementation(() => {
      written = true;
      return Promise.resolve(noteId);
    });
    const note = await service.add(actor, relationshipId, noteId, {
      body: "  Strong team; check churn.  ",
    });
    expect(note.id).toBe(noteId);
    expect(notes.insert).toHaveBeenCalledWith(expect.anything(), {
      id: noteId,
      relationshipId,
      side: investorSide,
      userId: actor.userId,
      membershipId: actor.membershipId,
      body: "Strong team; check churn.",
      supersedesNoteId: null,
    });
    await service.add(actor, relationshipId, noteId, { body: "again" });
    expect(notes.insert).toHaveBeenCalledTimes(1);
  });

  it("corrects only a note of the same side, and once", async () => {
    const missing = fixture({ findOwn: () => null });
    await expect(
      missing.service.add(actor, relationshipId, noteId, {
        body: "Corrected",
        supersedesNoteId: earlierId,
      }),
    ).rejects.toBeInstanceOf(InterestNotFoundError);
    expect(missing.notes.insert).not.toHaveBeenCalled();

    const twice = fixture({
      findOwn: (id) => (id === earlierId ? row({ id: earlierId }) : null),
      insertError: Object.assign(new Error("duplicate"), { code: "23505" }),
    });
    await expect(
      twice.service.add(actor, relationshipId, noteId, {
        body: "Corrected",
        supersedesNoteId: earlierId,
      }),
    ).rejects.toBeInstanceOf(RelationshipNoteSupersededError);
  });

  it("refuses an empty or oversized note before touching storage", async () => {
    const { service, notes } = fixture();
    await expect(
      service.add(actor, relationshipId, noteId, { body: "   " }),
    ).rejects.toThrow();
    await expect(
      service.add(actor, relationshipId, noteId, { body: "x".repeat(4001) }),
    ).rejects.toThrow();
    expect(notes.isParty).not.toHaveBeenCalled();
  });
});
