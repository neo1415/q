import { describe, expect, it } from "vitest";

import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  APP_ACTIONS,
  ARCHIVE_DOCUMENT,
  RENAME_DOCUMENT,
  type AppActionPorts,
  type DocumentChangePort,
  type ManagedDocument,
} from "../src/index.js";

/**
 * RECOVERY-2026-10 (security fix 2): archiving is named as archiving,
 * never "delete"; the approval card names the exact document by its own
 * title, read as the proposer; and removing the speaking guide, which
 * deletes every version for good, is prepared for approval from Q.
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
const DOC = "f0000000-0000-4000-8000-000000000001";

function ports(found: ManagedDocument | null): AppActionPorts {
  const documentChanges: DocumentChangePort = {
    getDocument: () =>
      found === null
        ? Promise.reject(new Error("NOT_FOUND"))
        : Promise.resolve(found),
    changeDocument: () => Promise.reject(new Error("not in this test")),
  };
  return { documentChanges };
}

const SEED: ManagedDocument = {
  id: DOC,
  title: "Seed deck.pdf",
  status: "ACTIVE",
  version: 3,
};

describe("destructive document actions name their exact target (RECOVERY)", () => {
  it("Q's tool is archive_document, and nothing is offered as a permanent delete", () => {
    expect(ARCHIVE_DOCUMENT.tool?.name).toBe("archive_document");
    expect(ARCHIVE_DOCUMENT.classification).toBe("CONSEQUENTIAL");
    const names = APP_ACTIONS.map((action) => action.tool?.name);
    expect(names).not.toContain("delete_document");
  });

  it("the archive card names the document by its own title and says it can be undone", async () => {
    const counterpart =
      (await ARCHIVE_DOCUMENT.counterpartOf?.(ports(SEED), ACTOR, {
        documentId: DOC,
        archived: true,
      })) ?? null;
    expect(counterpart).toBe("Seed deck.pdf");
    const card = ARCHIVE_DOCUMENT.card(
      { documentId: DOC, archived: true },
      { counterpart },
    );
    expect(card.summary).toBe('Archive "Seed deck.pdf"');
    expect(card.preview).toMatch(/bring it back/u);
    expect(card.preview).toMatch(/nothing is permanently deleted/u);
    expect(
      ARCHIVE_DOCUMENT.card(
        { documentId: DOC, archived: false },
        { counterpart },
      ).summary,
    ).toBe('Bring back "Seed deck.pdf"');
  });

  it("the rename card names the document it renames", async () => {
    const counterpart =
      (await RENAME_DOCUMENT.counterpartOf?.(ports(SEED), ACTOR, {
        documentId: DOC,
        title: "Seed deck final",
      })) ?? null;
    expect(
      RENAME_DOCUMENT.card(
        { documentId: DOC, title: "Seed deck final" },
        { counterpart },
      ).summary,
    ).toBe('Rename "Seed deck.pdf" to "Seed deck final"');
  });

  it("a document that is not theirs has no name on the card, and is refused", async () => {
    expect(
      await ARCHIVE_DOCUMENT.counterpartOf?.(ports(null), ACTOR, {
        documentId: DOC,
        archived: true,
      }),
    ).toBeNull();
    const verdict = await ARCHIVE_DOCUMENT.authorize(
      ports(null),
      {
        actor: ACTOR,
        idempotencyKey: "intent-test-0001",
        correlationId: "cor_test",
        surface: "Q",
      },
      { documentId: DOC, archived: true },
    );
    expect(verdict.ok).toBe(false);
  });

  it("removing the speaking guide (every version, for good) is prepared for approval", () => {
    const remove = APP_ACTIONS.find(
      (action) => action.name === "settings.etiquette_guide.remove",
    );
    expect(remove?.classification).toBe("CONSEQUENTIAL");
    expect(remove?.card({}).preview).toMatch(/cannot be brought back/u);
  });
});
