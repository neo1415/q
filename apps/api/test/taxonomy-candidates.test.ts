import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import { TaxonomyCandidateResponseSchema } from "@capital-q/contracts";
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
  TAXONOMY_CLASSIFIER_IDENTITY,
  TaxonomyClassifierNotAvailableError,
  TaxonomyVocabularyNotFoundError,
  type FindTaxonomyCandidatesInput,
  type TaxonomyCandidateFinder,
  type TaxonomyClassificationResult,
  type TaxonomyQueryPort,
} from "@capital-q/taxonomy";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * HTTP adaptation of `POST /v1/taxonomy/candidates` over a recording
 * double: authentication, body validation and bounds, response contract,
 * error mapping, no-store caching and the absence of any persistence or
 * provenance route. Classification behaviour itself is proven against the
 * database in the taxonomy package.
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

const RESULT: TaxonomyClassificationResult = {
  resolution: "EXACT",
  candidates: [
    {
      nodeId: "f0000000-0000-4000-8000-000000000001",
      vocabularyCode: "product_category",
      canonicalCode: "payment_infrastructure",
      displayName: "Payment Infrastructure",
      rank: 1,
      confidence: "0.9500",
      matchTypes: ["ALIAS_EXACT"],
      rationaleSummary: 'Exact curated alias match ("payments rails").',
    },
  ],
  taxonomyVersions: { product_category: 1 },
  classifier: TAXONOMY_CLASSIFIER_IDENTITY,
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function fakeFinder() {
  const calls: FindTaxonomyCandidatesInput[] = [];
  const finder: TaxonomyCandidateFinder = {
    findCandidates: (input) => {
      calls.push(input);
      if (input.strategy === "SEMANTIC" || input.strategy === "MODEL") {
        return Promise.reject(
          new TaxonomyClassifierNotAvailableError(input.strategy),
        );
      }
      if (input.vocabularyCodes?.includes("nope") === true) {
        return Promise.reject(new TaxonomyVocabularyNotFoundError());
      }
      return Promise.resolve(RESULT);
    },
  };
  return { finder, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly finder: TaxonomyCandidateFinder;
}): FastifyInstance {
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const query = {
    listVocabularies: notUnderTest,
  } as unknown as TaxonomyQueryPort;
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    taxonomy: { query, candidates: options.finder },
  }).app;
}

const post = (app: FastifyInstance, payload: string | object) =>
  app.inject({ method: "POST", url: "/v1/taxonomy/candidates", payload });

describe("POST /v1/taxonomy/candidates", () => {
  it("requires an authenticated context", async () => {
    const app = buildApp({ principal: null, finder: fakeFinder().finder });
    const response = await post(app, { text: "payments rails" });
    expect(response.statusCode).toBe(401);
  });

  it("returns the typed candidate response with no-store caching", async () => {
    const { finder, calls } = fakeFinder();
    const app = buildApp({ principal: PRINCIPAL, finder });
    const response = await post(app, {
      text: "payments rails",
      vocabularyCodes: ["product_category"],
      strategy: "AUTO",
      limit: 5,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = TaxonomyCandidateResponseSchema.parse(response.json());
    expect(body.resolution).toBe("EXACT");
    expect(body.candidates[0]).toMatchObject({
      canonicalCode: "payment_infrastructure",
      rank: 1,
      confidence: "0.9500",
    });
    expect(body.classifier).toEqual({
      provider: "capital_q",
      model: "deterministic_lexical",
      version: "taxonomy-lexical-v1",
    });
    expect(calls).toEqual([
      {
        text: "payments rails",
        vocabularyCodes: ["product_category"],
        strategy: "AUTO",
        limit: 5,
      },
    ]);
  });

  it("validates the body: empty text, size, limit, vocabularies, strategy, foreign fields", async () => {
    const { finder, calls } = fakeFinder();
    const app = buildApp({ principal: PRINCIPAL, finder });
    for (const payload of [
      {},
      { text: "" },
      { text: "   " },
      { text: "x".repeat(2049) },
      { text: "x", limit: 0 },
      { text: "x", limit: 21 },
      { text: "x", vocabularyCodes: [] },
      { text: "x", vocabularyCodes: ["industry", "industry"] },
      {
        text: "x",
        vocabularyCodes: Array.from({ length: 17 }, (_, i) => `v${i}`),
      },
      { text: "x", strategy: "LLM" },
      { text: "x", tenantId: "c0000000-0000-4000-8000-000000000009" },
      { text: "x", assignmentSource: "admin_curated" },
    ]) {
      const response = await post(app, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
      expect(response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    // A non-JSON body never reaches the contract: Fastify rejects it first.
    const notJson = await post(app, "payments rails");
    expect(notJson.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("maps unavailable strategies and unknown vocabularies to stable problem codes", async () => {
    const app = buildApp({ principal: PRINCIPAL, finder: fakeFinder().finder });
    const semantic = await post(app, {
      text: "payments",
      strategy: "SEMANTIC",
    });
    expect(semantic.statusCode).toBe(503);
    expect(semantic.json()).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      detail: expect.stringContaining("CLASSIFIER_NOT_AVAILABLE") as unknown,
    });
    const model = await post(app, { text: "payments", strategy: "MODEL" });
    expect(model.statusCode).toBe(503);
    const unknown = await post(app, {
      text: "payments",
      vocabularyCodes: ["nope"],
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("exposes no classification-run, candidate-decision or alias route", async () => {
    const app = buildApp({ principal: PRINCIPAL, finder: fakeFinder().finder });
    for (const [method, url] of [
      ["POST", "/v1/taxonomy/classification-runs"],
      ["GET", "/v1/taxonomy/classification-runs"],
      [
        "GET",
        "/v1/taxonomy/classification-runs/00000000-0000-4000-8000-000000000001",
      ],
      ["POST", "/v1/taxonomy/candidates/accept"],
      ["POST", "/v1/taxonomy/aliases"],
      ["GET", "/v1/taxonomy/candidates"],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});
