import { describe, expect, it } from "vitest";

import { IntakeRefusedError } from "@capital-q/gateq-intake";
import {
  createRelationshipEventRegistry,
  RELATIONSHIP_EVENT_DEFINITIONS,
  RELATIONSHIP_EVENT_DISCOVERED,
  RelationshipEventVisibilityNotAllowedError,
} from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import {
  createApplicationMaterials,
  createApplicationRelationshipJoin,
  GATEQ_APPLICATION_DISCOVERY_SCOPE,
  MaterialNotSharableError,
} from "../src/gateq/application-materials.js";

/**
 * F1 consent: a signed-in founder's ticked documents reach an application
 * only if every one is their own organisation's, and only with a real
 * guest credential. Nothing is half-shared.
 */

const FOUNDER = { userId: "u1", tenantId: "t1" } as unknown as ActorContext;
const OWN = "00000000-0000-4000-8000-0000000000d1";
const OTHERS = "00000000-0000-4000-8000-0000000000d9";
const TOKEN = `gqs_${"c".repeat(43)}`;

function build() {
  const attached: string[] = [];
  const materials = createApplicationMaterials({
    authoriseGuest: (token) =>
      token === TOKEN
        ? Promise.resolve({})
        : Promise.reject(new IntakeRefusedError("SESSION_INVALID")),
    ownDocument: (_actor, id) => Promise.resolve(id === OWN),
    attach: ({ documentId }) => {
      attached.push(documentId);
      return Promise.resolve();
    },
  });
  return { materials, attached };
}

describe("sharing documents with a GateQ application (F1)", () => {
  it("attaches the founder's own ticked documents, once each", async () => {
    const { materials, attached } = build();
    await expect(
      materials.share({
        actor: FOUNDER,
        sessionToken: TOKEN,
        documentIds: [OWN, OWN],
      }),
    ).resolves.toEqual({ attached: 1 });
    expect(attached).toEqual([OWN]);
  });

  it("refuses another organisation's document and shares nothing", async () => {
    const { materials, attached } = build();
    await expect(
      materials.share({
        actor: FOUNDER,
        sessionToken: TOKEN,
        documentIds: [OWN, OTHERS],
      }),
    ).rejects.toBeInstanceOf(MaterialNotSharableError);
    expect(attached).toEqual([]);
  });

  it("refuses a forged credential before looking at any document", async () => {
    const { materials, attached } = build();
    await expect(
      materials.share({
        actor: FOUNDER,
        sessionToken: `gqs_${"z".repeat(43)}`,
        documentIds: [OWN],
      }),
    ).rejects.toBeInstanceOf(IntakeRefusedError);
    expect(attached).toEqual([]);
  });
});

/**
 * F27: a signed-in founder with no prior relationship shares a document.
 * Before the fix the pair was ensured with `discovered` as
 * relationship_shared, which Network's registry refuses, so the share 500'd
 * after attaching and no relationship existed.
 */
describe("a shared application joins the canonical relationship (F27)", () => {
  const registry = createRelationshipEventRegistry(
    RELATIONSHIP_EVENT_DEFINITIONS,
  );

  function joinWith(relationships: Map<string, string>) {
    const recorded = new Map<string, string>();
    const join = createApplicationRelationshipJoin({
      link: () =>
        Promise.resolve({ companyId: "c1", investorOrganisationId: "i1" }),
      // Network's own rule for the origin event, as `ensure` applies it.
      ensureRelationship: (command) => {
        const key = `${command.companyId}:${command.investorOrganisationId}`;
        const existing = relationships.get(key);
        if (existing !== undefined) {
          return Promise.resolve({ relationshipId: existing });
        }
        registry.validate({
          eventType: RELATIONSHIP_EVENT_DISCOVERED,
          visibilityScope: command.visibilityScope,
          payload: { sourceReference: command.applicationId },
        });
        const id = `r${relationships.size + 1}`;
        relationships.set(key, id);
        return Promise.resolve({ relationshipId: id });
      },
      setRelationship: ({ applicationId, relationshipId }) => {
        if (!recorded.has(applicationId)) {
          recorded.set(applicationId, relationshipId);
        }
        return Promise.resolve();
      },
    });
    return { join, recorded };
  }

  it("the old scope is the exact refusal the seed hit", () => {
    expect(() =>
      registry.validate({
        eventType: RELATIONSHIP_EVENT_DISCOVERED,
        visibilityScope: "relationship_shared",
        payload: {},
      }),
    ).toThrow(RelationshipEventVisibilityNotAllowedError);
  });

  it("a founder with no relationship shares: succeeds, relationship recorded", async () => {
    const relationships = new Map<string, string>();
    const { join, recorded } = joinWith(relationships);
    const materials = createApplicationMaterials({
      authoriseGuest: () => Promise.resolve({}),
      ownDocument: () => Promise.resolve(true),
      attach: () => Promise.resolve(),
      link: async ({ actor }) => {
        await join({ applicationId: "a1", tenantId: "t1", actor });
      },
      onLinkFailed: (error) => {
        throw error;
      },
    });
    await expect(
      materials.share({
        actor: FOUNDER,
        sessionToken: TOKEN,
        documentIds: [OWN],
      }),
    ).resolves.toEqual({ attached: 1 });
    expect(GATEQ_APPLICATION_DISCOVERY_SCOPE).toBe("founder_private");
    expect(recorded.get("a1")).toBe("r1");
    expect(relationships.size).toBe(1);
  });

  it("is idempotent and reuses the one row for a second application", async () => {
    const relationships = new Map<string, string>();
    const { join, recorded } = joinWith(relationships);
    await join({ applicationId: "a1", tenantId: "t1", actor: FOUNDER });
    await join({ applicationId: "a1", tenantId: "t1", actor: FOUNDER });
    await join({ applicationId: "a2", tenantId: "t1", actor: FOUNDER });
    expect(relationships.size).toBe(1);
    expect(recorded.get("a1")).toBe("r1");
    expect(recorded.get("a2")).toBe("r1");
  });

  it("a failed link never fails a completed share", async () => {
    const failures: unknown[] = [];
    const attached: string[] = [];
    const materials = createApplicationMaterials({
      authoriseGuest: () => Promise.resolve({}),
      ownDocument: () => Promise.resolve(true),
      attach: ({ documentId }) => {
        attached.push(documentId);
        return Promise.resolve();
      },
      link: () => Promise.reject(new Error("network down")),
      onLinkFailed: (error) => failures.push(error),
    });
    await expect(
      materials.share({
        actor: FOUNDER,
        sessionToken: TOKEN,
        documentIds: [OWN],
      }),
    ).resolves.toEqual({ attached: 1 });
    expect(attached).toEqual([OWN]);
    expect(failures).toHaveLength(1);
  });
});
