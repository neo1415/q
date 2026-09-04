import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import { ListTaxonomyNodesResponseSchema } from "@capital-q/contracts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  TaxonomyNodeIdSchema,
  TaxonomyNodeNotFoundError,
  TaxonomyVocabularyIdSchema,
  TaxonomyVocabularyNotFoundError,
  type TaxonomyNode,
  type TaxonomyQueryPort,
  type TaxonomyVocabulary,
} from "@capital-q/taxonomy";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * HTTP adaptation of the read-only taxonomy routes over a recording double:
 * authentication, query validation, DTO shape (no validity windows or
 * metadata), cursor list and error mapping. Reference behaviour is proven
 * against the database in the taxonomy package.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const CONTEXT: ActorContext = {
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
const VOCABULARY: TaxonomyVocabulary = {
  id: TaxonomyVocabularyIdSchema.parse("9e323247-8a4b-575b-acdc-6f682f0d6a7b"),
  code: "industry",
  name: "Industry",
  description: null,
  version: 1,
  status: "ACTIVE",
  createdAt: "2026-09-04T00:00:00.000Z",
};
const ROOT: TaxonomyNode = {
  id: TaxonomyNodeIdSchema.parse("f0000000-0000-4000-8000-000000000001"),
  vocabularyId: VOCABULARY.id,
  vocabularyCode: "industry",
  canonicalCode: "financial_services",
  displayName: "Financial Services",
  description: null,
  parentNodeId: null,
  depth: 0,
  status: "ACTIVE",
  validFrom: null,
  validTo: null,
  metadata: {},
};
const CHILD: TaxonomyNode = {
  ...ROOT,
  id: TaxonomyNodeIdSchema.parse("f0000000-0000-4000-8000-000000000002"),
  canonicalCode: "fintech",
  displayName: "Fintech",
  parentNodeId: ROOT.id,
  depth: 1,
  metadata: { iso3166Alpha2: "NG" },
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function fakeQuery(overrides: Partial<TaxonomyQueryPort> = {}) {
  const calls: Record<string, unknown[]> = { listNodes: [] };
  const query: TaxonomyQueryPort = {
    listVocabularies: () => Promise.resolve([VOCABULARY]),
    getVocabularyByCode: notUnderTest,
    getNodeById: notUnderTest,
    findNodeById: notUnderTest,
    findNodeByCanonicalCode: notUnderTest,
    getNodeDetail: (nodeId) =>
      nodeId === CHILD.id
        ? Promise.resolve({
            node: CHILD,
            ancestors: [ROOT],
            aliases: [
              {
                id: "a0000000-0000-4000-8000-000000000001" as never,
                nodeId: CHILD.id,
                alias: "financial technology",
                locale: "en",
                aliasType: "SYNONYM",
                normalizedAlias: "financial technology",
              },
            ],
            edges: [],
          })
        : Promise.reject(new TaxonomyNodeNotFoundError()),
    listNodes: (input) => {
      calls["listNodes"]?.push(input);
      return input.vocabularyCode === "industry"
        ? Promise.resolve({ items: [ROOT, CHILD], nextCursor: "abc" })
        : Promise.reject(new TaxonomyVocabularyNotFoundError());
    },
    listChildren: notUnderTest,
    listAncestors: notUnderTest,
    listDescendants: notUnderTest,
    listAliases: notUnderTest,
    findNodesByAlias: notUnderTest,
    getVersionSet: () => Promise.resolve({ industry: 1 }),
    ...overrides,
  };
  return { query, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly query: TaxonomyQueryPort;
}): FastifyInstance {
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    taxonomy: {
      query: options.query,
      candidates: {
        findCandidates: () => Promise.reject(new Error("not under test")),
      },
    },
  }).app;
}

describe("taxonomy routes", () => {
  it("requires an authenticated context", async () => {
    const app = buildApp({ principal: null, query: fakeQuery().query });
    const response = await app.inject({
      method: "GET",
      url: "/v1/taxonomy/vocabularies",
    });
    expect(response.statusCode).toBe(401);
  });

  it("lists active vocabularies", async () => {
    const app = buildApp({ principal: PRINCIPAL, query: fakeQuery().query });
    const response = await app.inject({
      method: "GET",
      url: "/v1/taxonomy/vocabularies",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: VOCABULARY.id,
          code: "industry",
          name: "Industry",
          description: null,
          version: 1,
          status: "ACTIVE",
        },
      ],
    });
  });

  it("lists nodes with roots / parent / status / cursor parameters and hides internals", async () => {
    const { query, calls } = fakeQuery();
    const app = buildApp({ principal: PRINCIPAL, query });
    const response = await app.inject({
      method: "GET",
      url: "/v1/taxonomy/vocabularies/industry/nodes?roots=true&limit=2",
    });
    expect(response.statusCode).toBe(200);
    const body = ListTaxonomyNodesResponseSchema.parse(response.json());
    expect(body.nextCursor).toBe("abc");
    expect(body.items[1]).toEqual({
      id: CHILD.id,
      vocabularyCode: "industry",
      canonicalCode: "fintech",
      displayName: "Fintech",
      description: null,
      parentNodeId: ROOT.id,
      depth: 1,
      status: "ACTIVE",
    });
    expect(body.items[1]).not.toHaveProperty("metadata");
    expect(calls["listNodes"]?.[0]).toMatchObject({
      vocabularyCode: "industry",
      parentNodeId: null,
      limit: 2,
    });

    const children = await app.inject({
      method: "GET",
      url: `/v1/taxonomy/vocabularies/industry/nodes?parentNodeId=${ROOT.id}&status=DEPRECATED`,
    });
    expect(children.statusCode).toBe(200);
    expect(calls["listNodes"]?.[1]).toMatchObject({
      parentNodeId: ROOT.id,
      status: "DEPRECATED",
    });

    const conflicting = await app.inject({
      method: "GET",
      url: `/v1/taxonomy/vocabularies/industry/nodes?parentNodeId=${ROOT.id}&roots=true`,
    });
    expect(conflicting.statusCode).toBe(422);
    const unknownParam = await app.inject({
      method: "GET",
      url: "/v1/taxonomy/vocabularies/industry/nodes?q=payments",
    });
    expect(unknownParam.statusCode).toBe(422);
    const missing = await app.inject({
      method: "GET",
      url: "/v1/taxonomy/vocabularies/nope/nodes",
    });
    expect(missing.statusCode).toBe(404);
    const badCode = await app.inject({
      method: "GET",
      url: "/v1/taxonomy/vocabularies/Bad%20Code/nodes",
    });
    expect(badCode.statusCode).toBe(422);
  });

  it("returns a node with ancestors and aliases, and 404 for unknown ids", async () => {
    const app = buildApp({ principal: PRINCIPAL, query: fakeQuery().query });
    const response = await app.inject({
      method: "GET",
      url: `/v1/taxonomy/nodes/${CHILD.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: CHILD.id,
      canonicalCode: "fintech",
      ancestors: [
        {
          id: ROOT.id,
          canonicalCode: "financial_services",
          displayName: "Financial Services",
          depth: 0,
        },
      ],
      aliases: [
        { alias: "financial technology", locale: "en", aliasType: "SYNONYM" },
      ],
    });
    expect(response.json()).not.toHaveProperty("metadata");
    const unknown = await app.inject({
      method: "GET",
      url: `/v1/taxonomy/nodes/${ROOT.id}`,
    });
    expect(unknown.statusCode).toBe(404);
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/taxonomy/nodes/payments",
    });
    expect(malformed.statusCode).toBe(422);
  });

  it("registers no assignment, alias, classification-run, search or edit route", async () => {
    const app = buildApp({ principal: PRINCIPAL, query: fakeQuery().query });
    for (const [method, url] of [
      ["POST", "/v1/taxonomy/nodes"],
      ["PATCH", `/v1/taxonomy/nodes/${ROOT.id}`],
      ["POST", "/v1/taxonomy/assignments"],
      ["POST", "/v1/taxonomy/aliases"],
      ["POST", "/v1/taxonomy/classification-runs"],
      ["GET", "/v1/taxonomy/classification-runs"],
      ["GET", "/v1/taxonomy/search?q=payments"],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});
