import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createResolvePageTargetTool,
  type MaterialDocument,
  type ProfileMaterialPort,
  type QToolPorts,
  type ResolvePageTargetInput,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  COMPANY_B_PRIVATE,
  contextFor,
  fakePorts,
  INVESTOR_B,
  planFor,
} from "./support.js";

/**
 * Q Workspace W2.3: the instance behind a site-map place is resolved for
 * the person asking, through the owning services' own reads as them, and
 * only where the Context Firewall's plan admits it. Another tenant's
 * thread, deck, document or artifact never resolves -- not even as "it
 * exists" -- whether named by name or by id.
 */

const RELATIONSHIP_B = "71000000-0000-4000-8000-000000000001";
const RELATIONSHIP_B2 = "71000000-0000-4000-8000-000000000002";
const OTHER_COMPANY = "c0000000-0000-4000-8000-0000000000aa";
const DECK_DOC = "00000000-0000-4000-8000-00000000d001";
const CAP_TABLE = "00000000-0000-4000-8000-00000000d002";
const CERT = "00000000-0000-4000-8000-00000000d003";
const PRIVATE_DOC = "00000000-0000-4000-8000-00000000d0ff";
const ARTIFACT_B = "00000000-0000-4000-8000-00000000a001";
const ARTIFACT_A = "00000000-0000-4000-8000-00000000a0aa";
const BOARD_ITEM_B = "00000000-0000-4000-8000-00000000b001";
const BOARD_ITEM_B2 = "00000000-0000-4000-8000-00000000b002";

/** Their own conversation: the actor-wide scope bound to this person. */
function ownPlan(
  actor: ActorContext,
  userId: string = actor.userId,
): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId } }
        : scope,
    ),
  };
}

/** A plan bound to one company's profile (what a company question admits). */
const companyPlan = (actor: ActorContext, companyId: string) =>
  planFor(actor, "COUNTERPARTY_COMPANY_QUESTION", [
    { kind: "COMPANY_PROFILE", companyId, sensitivity: "CONFIDENTIAL" },
  ]);

const doc = (
  documentId: string,
  title: string,
  folder: string,
  documentType: string | null,
): MaterialDocument => ({
  documentId,
  title,
  folder,
  documentType,
  access: "OPEN",
  pageCount: 1,
  updatedAt: "2026-11-01T00:00:00.000Z",
  opening: null,
});

/**
 * The data room's own authorisation, faked: actor B sees Beacon's
 * (network) room; nobody but its own members sees the private company's.
 */
const material: ProfileMaterialPort = {
  dataRoom: () => Promise.resolve(null),
  ownCompanyId: (actor) =>
    Promise.resolve(actor.userId === actorA.userId ? COMPANY_A : null),
  deck: (actor, companyId) =>
    Promise.resolve(
      companyId === COMPANY_B_NETWORK && actor.userId === actorB.userId
        ? {
            viewer: "INVESTOR" as const,
            companyId,
            deck: {
              documentId: DECK_DOC,
              title: "Seed deck v4",
              versionNumber: 4,
              pageCount: 18,
              uploadedAt: "2026-11-01T00:00:00.000Z",
              downloadable: false,
              scanned: false,
            },
            extraction: null,
            coaching: null,
          }
        : null,
    ),
  documents: (actor, companyId) => {
    if (companyId === COMPANY_B_NETWORK && actor.userId === actorB.userId) {
      return Promise.resolve([
        doc(CAP_TABLE, "Cap table, October 2026", "Legal", "CAP_TABLE"),
        doc(
          CERT,
          "Certificate of Incorporation",
          "Corporate",
          "CERTIFICATE_OF_INCORPORATION",
        ),
      ]);
    }
    if (companyId === COMPANY_B_PRIVATE && actor.userId === actorA.userId) {
      return Promise.resolve([
        doc(PRIVATE_DOC, "Cap table (private)", "Legal", "CAP_TABLE"),
      ]);
    }
    return Promise.resolve(null);
  },
};

function ports(): QToolPorts {
  return fakePorts({
    relationships: {
      ...fakePorts().relationships,
      withCompany: () => Promise.resolve(null),
      withInvestor: () => Promise.resolve(null),
      byRelationship: () => Promise.resolve(null),
      incomingInterest: () => Promise.resolve([]),
      mayExpressInterest: () => Promise.resolve(false),
      mayAnswerInterest: () => Promise.resolve(false),
      // Only actor B is a party, to Beacon and to an investor.
      ownRelationships: (actor: ActorContext) =>
        Promise.resolve(
          actor.userId === actorB.userId
            ? {
                side: "INVESTOR" as const,
                items: [
                  {
                    relationshipId: RELATIONSHIP_B,
                    counterpart: {
                      kind: "COMPANY" as const,
                      id: COMPANY_B_NETWORK,
                      name: "Tamarind Pay",
                    },
                    state: "CONNECTED",
                    stateSince: "2026-11-01T00:00:00.000Z",
                    nextStep: "NONE",
                    milestones: [],
                  },
                  {
                    relationshipId: RELATIONSHIP_B2,
                    counterpart: {
                      kind: "INVESTOR_ORGANISATION" as const,
                      id: INVESTOR_B,
                      name: "Brightwell Capital",
                    },
                    state: "CONNECTED",
                    stateSince: "2026-11-01T00:00:00.000Z",
                    nextStep: "NONE",
                    milestones: [],
                  },
                ],
              }
            : { side: "INVESTOR" as const, items: [] },
        ),
    } as unknown as QToolPorts["relationships"],
    documents: {
      list: (actor: ActorContext) =>
        Promise.resolve(
          actor.userId === actorB.userId
            ? [
                {
                  artifactId: ARTIFACT_B,
                  type: "MEMO",
                  status: "READY",
                  title: "IC memo for Tamarind Pay",
                  currentVersion: 1,
                  updatedAt: "2026-11-01T00:00:00.000Z",
                },
              ]
            : [],
        ),
    } as unknown as QToolPorts["documents"],
    // Their own board: the service lists only the actor's own items.
    board: {
      list: (actor: ActorContext) =>
        Promise.resolve({
          items:
            actor.userId === actorB.userId
              ? [
                  { id: BOARD_ITEM_B, title: "Follow up with Brightwell" },
                  { id: BOARD_ITEM_B2, title: "Prepare the IC memo" },
                ]
              : [],
          columns: [],
          visibility: "personal_private",
        }),
    } as unknown as QToolPorts["board"],
  });
}

const tool = createResolvePageTargetTool(ports(), material);

async function resolveAs(
  actor: ActorContext,
  plan: PermittedContextPlan,
  input: ResolvePageTargetInput,
) {
  const parsed = tool.input.parse(input) as ResolvePageTargetInput;
  return tool.authorize(parsed, contextFor(actor, plan));
}

describe("resolve_page_target: a thread", () => {
  it("finds their own thread by the counterpart's name, with its page", async () => {
    const decision = await resolveAs(actorB, ownPlan(actorB), {
      target: "RELATIONSHIP_THREAD",
      counterpart: "tamarind pay",
    });
    expect(decision).toMatchObject({
      outcome: "ALLOW",
      grant: {
        status: "FOUND",
        relationshipId: RELATIONSHIP_B,
        companyId: COMPANY_B_NETWORK,
        route: "/relationships/company/[companyId]/messages",
        path: `/relationships/company/${COMPANY_B_NETWORK}/messages`,
      },
    });
    expect(
      tool.output.safeParse((decision as { grant: unknown }).grant).success,
    ).toBe(true);
  });

  it("an investor counterpart's thread is on the investor page", async () => {
    const decision = await resolveAs(actorB, ownPlan(actorB), {
      target: "RELATIONSHIP_THREAD",
      counterpart: "Brightwell",
    });
    expect(decision).toMatchObject({
      grant: {
        status: "FOUND",
        relationshipId: RELATIONSHIP_B2,
        path: `/relationships/investor/${INVESTOR_B}/messages`,
      },
    });
  });

  it("another tenant's person: NONE, by name or by id (never 'exists')", async () => {
    for (const input of [
      { target: "RELATIONSHIP_THREAD", counterpart: "Tamarind Pay" },
      { target: "RELATIONSHIP_THREAD", counterpartId: COMPANY_B_NETWORK },
    ] as const) {
      const decision = await resolveAs(actorA, ownPlan(actorA), input);
      expect(decision).toMatchObject({
        outcome: "ALLOW",
        grant: { status: "NONE", candidates: [] },
      });
      expect(JSON.stringify(decision)).not.toContain(RELATIONSHIP_B);
    }
  });

  it("is refused outside their own conversation (scope bound to someone else)", async () => {
    const decision = await resolveAs(actorB, ownPlan(actorB, actorA.userId), {
      target: "RELATIONSHIP_THREAD",
      counterpart: "Tamarind Pay",
    });
    expect(decision.outcome).toBe("DENY");
  });
});

describe("resolve_page_target: a deck and a data-room document", () => {
  it("finds the deck's document and version for a company the plan admits", async () => {
    const decision = await resolveAs(
      actorB,
      companyPlan(actorB, COMPANY_B_NETWORK),
      { target: "DECK", counterpartId: COMPANY_B_NETWORK },
    );
    expect(decision).toMatchObject({
      grant: {
        status: "FOUND",
        documentId: DECK_DOC,
        versionNumber: 4,
        route: "/company/[companyId]",
        path: `/company/${COMPANY_B_NETWORK}`,
      },
    });
  });

  it("finds 'the cap table' by meaning among what the data room shows them", async () => {
    const decision = await resolveAs(
      actorB,
      companyPlan(actorB, COMPANY_B_NETWORK),
      { target: "DATA_ROOM_DOCUMENT", document: "the cap table" },
    );
    expect(decision).toMatchObject({
      grant: {
        status: "FOUND",
        documentId: CAP_TABLE,
        companyId: COMPANY_B_NETWORK,
      },
    });
  });

  it("refuses a company the plan does not admit, before the data room is asked (cross-tenant)", async () => {
    const asked: string[] = [];
    const watched: ProfileMaterialPort = {
      ...material,
      documents: (actor, companyId) => {
        asked.push(companyId);
        return material.documents?.(actor, companyId) ?? Promise.resolve(null);
      },
      deck: (actor, companyId) => {
        asked.push(companyId);
        return material.deck(actor, companyId);
      },
    };
    const guarded = createResolvePageTargetTool(ports(), watched);
    for (const target of ["DECK", "DATA_ROOM_DOCUMENT"] as const) {
      const decision = await guarded.authorize(
        { target, counterpartId: COMPANY_B_PRIVATE, document: "cap table" },
        contextFor(actorB, companyPlan(actorB, COMPANY_B_NETWORK)),
      );
      expect(decision.outcome, target).toBe("DENY");
    }
    expect(asked).toEqual([]);
  });

  it("a document id from another company's room never resolves", async () => {
    const decision = await resolveAs(
      actorB,
      companyPlan(actorB, COMPANY_B_NETWORK),
      {
        target: "DATA_ROOM_DOCUMENT",
        counterpartId: COMPANY_B_NETWORK,
        documentId: PRIVATE_DOC,
      },
    );
    expect(decision).toMatchObject({ grant: { status: "NONE" } });
    expect(JSON.stringify(decision)).not.toContain("private");
  });

  it("an admitted company whose room the service refuses them: NONE", async () => {
    const decision = await resolveAs(
      actorA,
      companyPlan(actorA, COMPANY_B_NETWORK),
      { target: "DATA_ROOM_DOCUMENT", document: "cap table" },
    );
    expect(decision).toMatchObject({ grant: { status: "NONE" } });
    expect(JSON.stringify(decision)).not.toContain(CAP_TABLE);
  });

  it("several likely documents come back to ask which", async () => {
    const decision = await resolveAs(
      actorB,
      companyPlan(actorB, COMPANY_B_NETWORK),
      {
        target: "DATA_ROOM_DOCUMENT",
        document: "the legal and corporate documents",
      },
    );
    expect(decision).toMatchObject({ grant: { status: "WHICH_ONE" } });
  });

  it("their own company when nothing is named or in view", async () => {
    const decision = await resolveAs(actorA, companyPlan(actorA, COMPANY_A), {
      target: "DECK",
    });
    // Their own company is admitted; the fake room has no deck for it.
    expect(decision).toMatchObject({ grant: { status: "NONE" } });
    const other = await resolveAs(actorA, companyPlan(actorA, OTHER_COMPANY), {
      target: "DECK",
    });
    expect(other).toMatchObject({ grant: { status: "NONE" } });
  });
});

describe("resolve_page_target: their own document", () => {
  it("finds it by its title in their own list, with the viewer path", async () => {
    const decision = await resolveAs(actorB, ownPlan(actorB), {
      target: "OWN_DOCUMENT",
      document: "the IC memo for Tamarind",
    });
    expect(decision).toMatchObject({
      grant: {
        status: "FOUND",
        artifactId: ARTIFACT_B,
        route: "/documents",
        path: `/documents?open=${ARTIFACT_B}`,
      },
    });
  });

  it("another person's artifact id never resolves", async () => {
    for (const [actor, artifactId] of [
      [actorA, ARTIFACT_B],
      [actorB, ARTIFACT_A],
    ] as const) {
      const decision = await resolveAs(actor, ownPlan(actor), {
        target: "OWN_DOCUMENT",
        documentId: artifactId,
      });
      expect(decision).toMatchObject({ grant: { status: "NONE" } });
    }
  });
});

describe("resolve_page_target: a company's or investor's page", () => {
  it("finds a company they reach by hand, by name, with its profile path", async () => {
    const decision = await resolveAs(actorB, ownPlan(actorB), {
      target: "COMPANY",
      counterpart: "Tamarind",
    });
    expect(decision).toMatchObject({
      outcome: "ALLOW",
      grant: {
        status: "FOUND",
        companyId: COMPANY_B_NETWORK,
        route: "/company/[companyId]",
        path: `/company/${COMPANY_B_NETWORK}`,
      },
    });
  });

  it("their own company by its id", async () => {
    const decision = await resolveAs(actorA, ownPlan(actorA), {
      target: "COMPANY",
      counterpartId: COMPANY_A,
    });
    expect(decision).toMatchObject({
      grant: { status: "FOUND", companyId: COMPANY_A },
    });
  });

  it("another tenant's private company never resolves, by id or by name", async () => {
    for (const input of [
      { target: "COMPANY", counterpartId: COMPANY_B_PRIVATE },
      { target: "COMPANY", counterpartId: OTHER_COMPANY },
    ] as const) {
      const decision = await resolveAs(actorA, ownPlan(actorA), input);
      expect(decision).toMatchObject({ grant: { status: "NONE" } });
    }
  });

  it("finds an investor they have a relationship with; another person's investor is NONE", async () => {
    const found = await resolveAs(actorB, ownPlan(actorB), {
      target: "INVESTOR",
      counterpart: "Brightwell Capital",
    });
    expect(found).toMatchObject({
      grant: {
        status: "FOUND",
        investorOrganisationId: INVESTOR_B,
        route: "/investors/[investorOrganisationId]",
        path: `/investors/${INVESTOR_B}`,
      },
    });
    for (const input of [
      { target: "INVESTOR", counterpartId: INVESTOR_B },
      { target: "INVESTOR", counterpart: "Brightwell Capital" },
    ] as const) {
      const decision = await resolveAs(actorA, ownPlan(actorA), input);
      expect(decision).toMatchObject({ grant: { status: "NONE" } });
      expect(JSON.stringify(decision)).not.toContain(INVESTOR_B);
    }
  });
});

describe("resolve_page_target: an item on their own board", () => {
  it("finds it by its title, with the board path and its itemId", async () => {
    const decision = await resolveAs(actorB, ownPlan(actorB), {
      target: "BOARD_ITEM",
      document: "the follow-up with Brightwell",
    });
    expect(decision).toMatchObject({
      grant: {
        status: "FOUND",
        itemId: BOARD_ITEM_B,
        route: "/board",
        path: "/board",
      },
    });
  });

  it("another person's item id never resolves; outside their conversation it is refused", async () => {
    const other = await resolveAs(actorA, ownPlan(actorA), {
      target: "BOARD_ITEM",
      documentId: BOARD_ITEM_B,
    });
    expect(other).toMatchObject({ grant: { status: "NONE" } });
    expect(JSON.stringify(other)).not.toContain("Brightwell");
    const refused = await resolveAs(actorB, ownPlan(actorB, actorA.userId), {
      target: "BOARD_ITEM",
      documentId: BOARD_ITEM_B,
    });
    expect(refused.outcome).toBe("DENY");
  });
});
