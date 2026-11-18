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
  COMPANY_B_NETWORK,
  INVESTOR_B,
  actorB,
  contextFor,
  planFor,
} from "./support.js";

/**
 * Model spend, 18 Nov 2026: the answer is sent its plan class's whole
 * catalogue, the same from turn to turn, so the provider's prompt cache
 * holds it. What a turn may call is still decided here, at execution:
 * the catalogue is never authority.
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

function investorPlan(): PermittedContextPlan {
  const specs: readonly {
    readonly kind: QKnowledgeScopeKind;
    readonly companyId?: string;
    readonly investorOrganisationId?: string;
  }[] = [
    { kind: "INVESTOR_PROFILE", investorOrganisationId: INVESTOR_B },
    { kind: "INVESTOR_MANDATE", investorOrganisationId: INVESTOR_B },
    { kind: "OWN_Q_CONVERSATION" },
    { kind: "NETWORK_VISIBLE_DATA" },
    { kind: "PUBLIC_EXTERNAL_DATA" },
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

describe("the plan class's stable catalogue", () => {
  const plan = investorPlan();
  const warmed = contextFor(actorB, plan);
  const question = {
    ...warmed,
    asksNoAction: true,
    focus: { areas: ["DISCOVERY"], tools: [], readsOnly: true },
  };

  it("is the same, in name order, whatever the turn's focus or holds", () => {
    const a = names(registry.catalogue(warmed));
    const b = names(registry.catalogue(question));
    expect(b).toEqual(a);
    expect(a).toEqual([...a].sort());
    expect(a.length).toBeGreaterThan(names(registry.eligible(question)).length);
  });

  it("still refuses at execution a catalogue tool this turn does not allow", async () => {
    expect(names(registry.catalogue(question))).toContain(EXPRESS);
    expect(registry.offeredByProviderName(question, EXPRESS)).toBeUndefined();
    const port = createQToolExecutor({ registry });
    expect(
      (await port.catalogue?.(question))?.map((t) => t.definition.name),
    ).toContain(EXPRESS);
    const outcome = await port.execute(
      {
        callId: "c1",
        name: EXPRESS,
        arguments: { companyId: COMPANY_B_NETWORK },
      },
      question,
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.result.ok).toBe(false);
  });

  it("holds only names, descriptions and schemas: no plan identifier", () => {
    const sent = JSON.stringify(
      registry.catalogue(warmed).map((record) => record.modelDefinition),
    );
    for (const id of [INVESTOR_B, COMPANY_B_NETWORK, actorB.userId]) {
      expect(sent).not.toContain(id);
    }
  });
});
