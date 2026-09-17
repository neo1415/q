import { z } from "zod";

import type { PermittedContextPlan, QTaskClass } from "@capital-q/contracts";
import type { QToolExecutionContext } from "@capital-q/q-runtime";
import {
  allow,
  defineQTool,
  type AnyQToolDefinition,
} from "@capital-q/q-tools";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

/** Fixtures shared by the connector tests. Nothing here touches a network. */

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const USER = "22222222-2222-4222-8222-222222222222";
export const ORG = "33333333-3333-4333-8333-333333333333";
export const RUN = "44444444-4444-4444-8444-444444444444";

export const ACTOR: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

/**
 * A plan with the scope kinds a test wants, shaped the way the registry,
 * the executor and the plan helpers read it. Not validated against the
 * contract schema: these tests are about the connectors, and the plan is
 * the firewall's to prove.
 */
export function planWith(
  kinds: readonly string[],
  taskClass: QTaskClass = "GENERAL_QUESTION",
): PermittedContextPlan {
  return {
    contractVersion: 1,
    policyVersion: "context-firewall-v2",
    planId: "66666666-6666-4666-8666-666666666666",
    fingerprint: "a".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER, organisationId: ORG },
    purpose: { capability: "ANSWER", taskClass },
    subjects: [],
    scopes: kinds.map((kind) => ({
      kind,
      contextLabel: "public_external",
      sensitivity: "PUBLIC",
      layer: "STRUCTURED_STATE",
      factCategories: [],
      projection: "FULL",
      rights: {
        canUseForReasoning: true,
        canDiscloseExistence: true,
        canQuote: true,
        canProvideLink: true,
      },
      filter: { tenantId: TENANT },
    })),
    denied: [],
    maxSensitivity: "CONFIDENTIAL",
    allowedLayers: ["STRUCTURED_STATE"],
    combinationConstraints: [],
    evaluatedAt: "2026-09-17T10:00:00.000Z",
    revalidateAfter: "2026-09-17T10:05:00.000Z",
    revalidateOnResume: true,
  } as unknown as PermittedContextPlan;
}

export function contextWith(
  plan: PermittedContextPlan,
  overrides: Partial<QToolExecutionContext> = {},
): QToolExecutionContext {
  return {
    actor: ACTOR,
    runId: RUN as QToolExecutionContext["runId"],
    correlationId: `cor_${RUN}` as QToolExecutionContext["correlationId"],
    capability: "ANSWER",
    plan,
    ...overrides,
  };
}

export const LookupInputSchema = z.object({ companyId: z.string() }).strict();
export const LookupOutputSchema = z.object({ name: z.string() }).strict();

/** A registry-shaped SAFE_READ tool with no domain behind it. */
export function fakeLookupTool(): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof LookupInputSchema>,
    z.infer<typeof LookupOutputSchema>,
    null
  >({
    id: "test.lookup",
    version: 1,
    status: "ACTIVE",
    providerName: "lookup_company",
    description: "Returns a test company's name.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: ["GENERAL_QUESTION"],
    requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "test",
    visibleStage: null,
    input: LookupInputSchema,
    output: LookupOutputSchema,
    authorize: () => Promise.resolve(allow("PUBLIC", null)),
    execute: (input) => Promise.resolve({ name: `Company ${input.companyId}` }),
  });
}
