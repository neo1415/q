import { describe, expect, it } from "vitest";

import type {
  PermittedContextPlan,
  QKnowledgeScopeKind,
} from "@capital-q/contracts";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type QToolPorts,
} from "../src/index.js";
import {
  COMPANY_A,
  COMPANY_B_NETWORK,
  INVESTOR_B,
  actorA,
  actorB,
  contextFor,
  planFor,
} from "./support.js";

/**
 * Replay of live run 0f483277 (17 Nov 2026, fictional investor Savanna,
 * conversation ff20af7e): "What does Halyard Security do and how is it
 * doing commercially?" was read QUESTION_TO_Q / THEIR_OWN_RECORDS, tool
 * null. Its offer was warmed before the reading (no focus), so
 * propose_express_interest was in hand; the first answer's actionTalk
 * triggered the said-not-done round ("call that tool now"), the model
 * called it, and the turn's only reply was an Express Interest card.
 *
 * Principle: a turn read as a question that asks for no action and takes up
 * no offer (asksNoAction) is never offered, loaded or allowed to execute a
 * tool that prepares an approval card. The reads that answer it stay.
 */

const STUB: unknown = {};
const GIVEN: Readonly<Record<string, unknown>> = {
  clientActions: true,
  relationships: { ownRelationships: STUB },
  pendingProposals: {
    inConversation: STUB,
    approve: STUB,
    decline: STUB,
    inboxItem: STUB,
  },
};
const EVERY_PORT = new Proxy(GIVEN, {
  get: (target, key: string): unknown => target[key] ?? STUB,
  has: () => true,
}) as unknown as QToolPorts;

const registry = createQToolRegistry(createDefaultQTools(EVERY_PORT));
const EXPRESS = "propose_express_interest";

type Spec = {
  readonly kind: QKnowledgeScopeKind;
  readonly companyId?: string;
  readonly investorOrganisationId?: string;
};

/** The run's firewall plan as stored (INVESTOR_QUESTION, its scopes). */
function investorQuestionPlan(): PermittedContextPlan {
  const specs: readonly Spec[] = [
    { kind: "INVESTOR_PROFILE", investorOrganisationId: INVESTOR_B },
    { kind: "INVESTOR_MANDATE", investorOrganisationId: INVESTOR_B },
    { kind: "OWN_PUBLIC_PRESENCE" },
    { kind: "OWN_Q_CONVERSATION" },
    { kind: "OWN_ONBOARDING" },
    { kind: "NETWORK_VISIBLE_DATA" },
    { kind: "PUBLIC_EXTERNAL_DATA" },
    { kind: "GENERAL_MODEL_KNOWLEDGE" },
    { kind: "COMPANY_PROFILE", companyId: COMPANY_B_NETWORK },
  ];
  return planFor(
    actorB,
    "INVESTOR_QUESTION",
    specs.map((spec) => ({ ...spec, sensitivity: "CONFIDENTIAL" as const })),
  );
}

const names = (records: readonly { definition: { providerName: string } }[]) =>
  records.map((record) => record.definition.providerName);

describe("a question that asks for no action prepares no approval card (run 0f483277)", () => {
  const plan = investorQuestionPlan();
  // As the warmed offer was made: no focus.
  const warmed = contextFor(actorB, plan);
  const question = { ...warmed, asksNoAction: true };

  it("before: the warmed offer held Express Interest, and it could execute", () => {
    expect(names(registry.eligible(warmed))).toContain(EXPRESS);
    expect(registry.offeredByProviderName(warmed, EXPRESS)).toBeDefined();
  });

  it("is not offered, not loadable by use_capability, and never executes", () => {
    expect(names(registry.eligible(question))).not.toContain(EXPRESS);
    expect(names(registry.available(question))).not.toContain(EXPRESS);
    expect(registry.offeredByProviderName(question, EXPRESS)).toBeUndefined();
    // No approval-card tool of any kind is in hand.
    expect(
      registry
        .eligible(question)
        .filter(
          (record) => record.definition.visibleStage === "WAITING_FOR_APPROVAL",
        ),
    ).toEqual([]);
  });

  it("keeps the reads that answer the question", () => {
    const offered = names(registry.eligible(question));
    for (const read of ["get_company", "read_company_figures"]) {
      expect(offered).toContain(read);
    }
  });

  it("the offered tool says it prepares a card, so a warmed offer is filtered too", async () => {
    const port = createQToolExecutor({ registry });
    const offered = await port.offer(warmed);
    const express = offered.find((tool) => tool.definition.name === EXPRESS);
    expect(express?.preparesCard).toBe(true);
    const read = offered.find((tool) => tool.definition.name === "get_company");
    expect(read?.preparesCard).toBeUndefined();
  });

  it("a call that reaches it anyway is refused with a plain instruction to answer", async () => {
    const port = createQToolExecutor({ registry });
    const outcome = await port.execute(
      {
        callId: "replay-express",
        name: EXPRESS,
        arguments: { companyId: COMPANY_B_NETWORK },
      },
      question,
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.error.safeMessage).toMatch(/asked a question/u);
    }
  });

  it("a founder's own stated figure (A8) keeps its own rule", () => {
    const founder = planFor(
      actorA,
      "OWN_COMPANY_QUESTION",
      (
        [
          { kind: "COMPANY_PROFILE", companyId: COMPANY_A },
          { kind: "OWN_Q_CONVERSATION" },
        ] as const
      ).map((spec) => ({ ...spec, sensitivity: "CONFIDENTIAL" as const })),
    );
    const context = { ...contextFor(actorA, founder), asksNoAction: true };
    expect(names(registry.eligible(context))).toContain(
      "propose_company_figure",
    );
  });
});
