import { describe, expect, it } from "vitest";

import type {
  PermittedContextPlan,
  QKnowledgeScopeKind,
  QTaskClass,
} from "@capital-q/contracts";
import type { QToolFocus } from "@capital-q/q-runtime";

import {
  createDefaultQTools,
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
 * A8 live (13 Nov 2026, founder.maji-loop): "Good news: we hit $120k MRR
 * in October." was read as an ANSWER (a reply to Q), and no approval card
 * was made. A figure a founder tells Q can come with any turn of their
 * own company's purpose -- news, a reply, a question -- so the figure tool
 * is in reach on every such turn whose plan holds their own company,
 * whatever the turn's focus, and ranked right after the core so no bound
 * cuts it. An investor's plan never
 * offers it, and never lets it execute.
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
// Every port composed: factories only capture ports, none is called here.
const EVERY_PORT = new Proxy(GIVEN, {
  get: (target, key: string): unknown => target[key] ?? STUB,
  has: () => true,
}) as unknown as QToolPorts;

const registry = createQToolRegistry(createDefaultQTools(EVERY_PORT));
const TOOL = "propose_company_figure";

type Spec = {
  readonly kind: QKnowledgeScopeKind;
  readonly companyId?: string;
  readonly investorOrganisationId?: string;
};

/** A founder's own-company plan: their company, private to their organisation. */
function founderPlan(purpose: QTaskClass): PermittedContextPlan {
  const specs: readonly Spec[] = [
    { kind: "COMPANY_PROFILE", companyId: COMPANY_A },
    { kind: "COMPANY_CAPITAL_OBJECTIVE", companyId: COMPANY_A },
    { kind: "EVIDENCE_DOCUMENTS", companyId: COMPANY_A },
    { kind: "OWN_Q_CONVERSATION" },
    { kind: "OWN_ONBOARDING" },
    { kind: "NETWORK_VISIBLE_DATA" },
    { kind: "PUBLIC_EXTERNAL_DATA" },
    { kind: "GENERAL_MODEL_KNOWLEDGE" },
  ];
  return planFor(
    actorA,
    purpose,
    specs.map((spec) => ({ ...spec, sensitivity: "CONFIDENTIAL" as const })),
  );
}

/**
 * An investor's plan: their own firm and mandate, and a founder's company
 * they may see on the network (never their own organisation's).
 */
function investorPlan(purpose: QTaskClass): PermittedContextPlan {
  const specs: readonly Spec[] = [
    { kind: "INVESTOR_PROFILE", investorOrganisationId: INVESTOR_B },
    { kind: "INVESTOR_MANDATE", investorOrganisationId: INVESTOR_B },
    { kind: "COMPANY_PROFILE", companyId: COMPANY_B_NETWORK },
    { kind: "OWN_Q_CONVERSATION" },
    { kind: "NETWORK_VISIBLE_DATA" },
  ];
  const plan = planFor(
    actorB,
    purpose,
    specs.map((spec) => ({ ...spec, sensitivity: "CONFIDENTIAL" as const })),
  );
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "COMPANY_PROFILE"
        ? { ...scope, contextLabel: "network_visible" }
        : scope,
    ),
  };
}

// The focus shapes a turn can take (q-specialists toolFocusOf).
const FOCUSES: Readonly<Record<string, QToolFocus | undefined>> = {
  // The reader found nothing to narrow by: the purpose's whole list.
  unfocused: undefined,
  // Live: an ANSWER continuing a turn about the screen.
  "an answer continuing a screen turn": { areas: ["Screens"], tools: [] },
  // A plain question to Q: reads and the core only.
  "a plain question": {
    areas: [],
    tools: [
      "extract_public_web",
      "lookup_public_profile",
      "research_public_web",
    ],
    widen: true,
    readsOnly: true,
  },
  // A request about a relationship, naming another action.
  "a request about a relationship": {
    areas: ["Relationships"],
    tools: ["propose_email"],
  },
};

const offered = (plan: PermittedContextPlan, focus: QToolFocus | undefined) => {
  const base = contextFor(
    plan.actor.userId === actorA.userId ? actorA : actorB,
    plan,
  );
  const context = focus === undefined ? base : { ...base, focus };
  return {
    context,
    names: registry
      .eligible(context)
      .map((record) => record.definition.providerName),
  };
};

describe("a founder's stated figure is always within reach of the card", () => {
  it.each(Object.entries(FOCUSES))(
    "founder, own-company turn, %s: offered just after the core, and may execute",
    (_label, focus) => {
      const { context, names } = offered(
        founderPlan("OWN_COMPANY_QUESTION"),
        focus,
      );
      expect(names).toContain(TOOL);
      const core = registry
        .list()
        .filter((record) => record.definition.core === true)
        .map((record) => record.definition.providerName);
      const firstOther = names.findIndex((name) => !core.includes(name));
      expect(names[firstOther]).toBe(TOOL);
      expect(registry.offeredByProviderName(context, TOOL)).toBeDefined();
    },
  );

  it("founder, a turn planned for another purpose: unchanged (named, or loaded on need)", () => {
    const { context, names } = offered(founderPlan("RELATIONSHIP_QUESTION"), {
      areas: ["Screens"],
      tools: [],
    });
    expect(names).not.toContain(TOOL);
    expect(registry.offeredByProviderName(context, TOOL)).toBeUndefined();
    const named = offered(founderPlan("RELATIONSHIP_QUESTION"), {
      areas: [],
      tools: [TOOL],
    });
    expect(named.names).toContain(TOOL);
    expect(registry.offeredByProviderName(named.context, TOOL)).toBeDefined();
  });

  it.each(Object.entries(FOCUSES))(
    "investor, %s: never offered and never executes",
    (_label, focus) => {
      for (const purpose of [
        "INVESTOR_QUESTION",
        "COUNTERPARTY_COMPANY_QUESTION",
      ] as const) {
        const { context, names } = offered(investorPlan(purpose), focus);
        expect(names, purpose).not.toContain(TOOL);
        expect(
          registry.offeredByProviderName(context, TOOL),
          purpose,
        ).toBeUndefined();
      }
    },
  );

  it("the description asks for the card by meaning, and forbids implying it is recorded", () => {
    const record = registry
      .list()
      .find((r) => r.definition.providerName === TOOL);
    expect(record?.definition.offeredOnOwnTurns).toBe(true);
    const description = record?.modelDefinition.description ?? "";
    expect(description).toContain("in any words or language");
    expect(description).toContain(
      "Remembering what they said does not record it",
    );
    expect(description).toContain("never say or imply it is recorded");
  });
});
