import { describe, expect, it } from "vitest";

import type { QAnswerRequest } from "@capital-q/q-runtime";

import {
  counterpartNavigationRecords,
  createOpenRecordNavigationResolver,
  recordPageForRoute,
} from "../src/page-moves.js";
import {
  createOpenPageTool,
  createQToolExecutor,
  createQToolRegistry,
} from "@capital-q/q-tools";

import {
  createToolOpenRecordPort,
  type QOpenRecordPort,
} from "../src/references.js";

/**
 * Q Workspace W4.3 in the answer path: names the decision gives are found
 * as the person, through open_page's own authorise step; never an id from
 * the model, never a guess.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const founderRequest = {
  plan: { scopes: [] },
} as unknown as QAnswerRequest;
const investorRequest = {
  plan: {
    scopes: [
      {
        kind: "INVESTOR_MANDATE",
        subject: {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: "22222222-2222-4222-8222-222222222222",
        },
      },
    ],
  },
} as unknown as QAnswerRequest;

function openRecord(found: Record<string, string>) {
  const asked: { page: string; name: string | undefined }[] = [];
  const port: QOpenRecordPort = {
    open: (_request, target) => {
      asked.push({ page: target.page, name: target.name });
      const id = target.name === undefined ? undefined : found[target.name];
      return Promise.resolve(
        id === undefined
          ? null
          : { kind: "OPEN_RECORD_PAGE", page: target.page, id },
      );
    },
  };
  return { asked, port };
}

const ask = (
  over: Partial<
    Parameters<
      ReturnType<ReturnType<typeof createOpenRecordNavigationResolver>>
    >[0]
  >,
) => ({
  kind: "COMPANY" as const,
  name: "Silo Credit",
  document: null,
  route: "/company/[companyId]",
  tab: null,
  ...over,
});

describe("the record page a route shows", () => {
  it("reads it from the site map, a relationship's messages tab as its thread", () => {
    expect(recordPageForRoute("/company/[companyId]", "deck")).toBe("COMPANY");
    expect(
      recordPageForRoute("/relationships/company/[companyId]", "messages"),
    ).toBe("RELATIONSHIP_COMPANY_MESSAGES");
    expect(recordPageForRoute("/work", null)).toBeNull();
  });
});

describe("resolution as the person (open_page)", () => {
  it("finds a named record on the page the route shows", async () => {
    const { asked, port } = openRecord({ "Silo Credit": COMPANY });
    const resolve = createOpenRecordNavigationResolver(port)(founderRequest);
    expect(await resolve(ask({ tab: "deck" }))).toEqual({
      status: "FOUND",
      recordId: COMPANY,
      documentId: null,
    });
    await resolve(
      ask({ route: "/relationships/company/[companyId]", tab: "messages" }),
    );
    expect(asked).toEqual([
      { page: "COMPANY", name: "Silo Credit" },
      { page: "RELATIONSHIP_COMPANY_MESSAGES", name: "Silo Credit" },
    ]);
  });

  it("NONE for a name they cannot see, a document by title, a page with no record, and the Board", async () => {
    const { asked, port } = openRecord({});
    const resolve = createOpenRecordNavigationResolver(port)(founderRequest);
    expect(await resolve(ask({}))).toEqual({ status: "NONE" });
    expect(
      await resolve(ask({ tab: "dataroom", document: "Cap table" })),
    ).toEqual({ status: "NONE" });
    expect(await resolve(ask({ route: "/work" }))).toEqual({ status: "NONE" });
    expect(
      await resolve(
        ask({ kind: "THING", name: "Call Tunde", route: "/board" }),
      ),
    ).toEqual({ status: "NONE" });
    // Only the first was asked: the rest never reach a tool.
    expect(asked).toHaveLength(1);
  });
});

describe("the names the prompt lists", () => {
  it("their counterparts, as companies for an investor and investors for a founder", async () => {
    const names = () => Promise.resolve(["Silo Credit", "Kora Farms"]);
    const records = counterpartNavigationRecords(names);
    expect(
      (await records(investorRequest)).companies.map((c) => c.name),
    ).toEqual(["Silo Credit", "Kora Farms"]);
    expect((await records(founderRequest)).investors).toHaveLength(2);
    expect((await records(founderRequest)).companies).toEqual([]);
  });
});

describe("batch-9 replay: in the Q Workspace a record the decision names resolves through the real registry", () => {
  it("'Harbourline Cargo' on its team tab resolves to the record (open_page hidden from the model, not from code)", async () => {
    const actor = {
      userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
      tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actorType: "HUMAN",
    };
    const HARBOURLINE = "33333333-3333-4333-8333-333333333333";
    const ports = {
      clientActions: true,
      // The network search finds nothing more: the name is their own
      // relationship's.
      companies: {
        searchCompanies: () => Promise.resolve({ items: [], nextCursor: null }),
        // Another tenant's company, reachable through their relationship.
        findCanonicalCompanyProfile: () =>
          Promise.resolve({
            tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            canonicalName: "Harbourline Cargo",
          }),
      },
      relationships: {
        ownRelationships: () =>
          Promise.resolve({
            side: "INVESTOR",
            items: [
              {
                relationshipId: "r1",
                counterpart: {
                  kind: "COMPANY",
                  id: HARBOURLINE,
                  name: "Harbourline Cargo",
                },
              },
            ],
          }),
      },
      investorFeed: {
        decisions: () => Promise.resolve([]),
        page: () => Promise.resolve({ items: [], notes: [] }),
      },
    } as unknown as Parameters<typeof createOpenPageTool>[0];
    const tools = createQToolExecutor({
      registry: createQToolRegistry([createOpenPageTool(ports)]),
    });
    const request = {
      runId: "44444444-4444-4444-8444-444444444444",
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      correlationId: "cor_ws",
      capability: "ANSWER",
      actor,
      plan: {
        runId: "44444444-4444-4444-8444-444444444444",
        tenantId: actor.tenantId,
        actor: { userId: actor.userId, tenantId: actor.tenantId },
        purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
        maxSensitivity: "HIGHLY_CONFIDENTIAL",
        scopes: [
          {
            kind: "OWN_Q_CONVERSATION",
            filter: { tenantId: actor.tenantId, userId: actor.userId },
          },
        ],
        screen: {
          route: "COMPANY",
          workspace: { qPane: "open", pagePane: "open", at: "/home" },
        },
      },
    } as unknown as QAnswerRequest;
    const resolve = createOpenRecordNavigationResolver(
      createToolOpenRecordPort({ tools }),
    )(request);
    expect(
      await resolve({
        kind: "COMPANY",
        name: "Harbourline Cargo",
        document: null,
        route: "/company/[companyId]",
        tab: "team",
      }),
    ).toEqual({ status: "FOUND", recordId: HARBOURLINE, documentId: null });
  });
});
