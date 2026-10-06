import { describe, expect, it } from "vitest";

import {
  MODEL_TOOLS_MAX,
  Q_KNOWLEDGE_SCOPE_KINDS,
  Q_TASK_CLASSES,
  type QKnowledgeScopeKind,
} from "@capital-q/contracts";

import {
  createDefaultQTools,
  createQToolRegistry,
  Q_TURN_TOOLS_MAX,
  type QToolPorts,
} from "../src/index.js";
import { COMPANY_A, actorA, contextFor, planFor } from "./support.js";

/**
 * R33 (lead decision 2026-09-27): a run is offered the always-on core plus
 * the tools that serve its purpose, never more than one model request
 * carries. Measured on the worst case: every port composed and every scope
 * kind in the plan, for each purpose.
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

const CORE = [
  // Lead 2026-10-04: anything else this run may use, loaded mid-turn.
  "use_capability",
  "set_theme",
  "reload_page",
  "open_website",
  "set_q_motion",
  "set_voice",
  "sign_out",
  "open_page",
  // Founder report 2026-09-30: scroll, go back, open a page's dialog.
  "control_screen",
  "set_discover_filters",
  // Q room R4: a card in the room, asked for mid-anything.
  "show",
  // Q room W3: "next page", "close it" for the document open in the room.
  "control_document",
  "approve_pending_proposal",
  "decline_pending_proposal",
  "list_pending_approvals",
  // Setup reminders: "stop reminding me" must work whenever Q has said it.
  "set_onboarding_reminders",
  "continue_onboarding",
  // R35: their own interests and relationships, whatever the turn is about.
  "list_my_relationships",
  // Founder directive 2026-09-28: "change my deck" can come mid-anything.
  "revise_my_document",
  // AUTO (ADR 0030): "what are you working on" and "stop" from any turn.
  "list_q_work",
  "stop_q_work",
  // ADR 0040: their own records of any kind, so Q never says "no record".
  "read_my",
];

const registry = createQToolRegistry(createDefaultQTools(EVERY_PORT));

function worstCase(purpose: (typeof Q_TASK_CLASSES)[number]) {
  return contextFor(
    actorA,
    planFor(
      actorA,
      purpose,
      Q_KNOWLEDGE_SCOPE_KINDS.map((kind: QKnowledgeScopeKind) => ({
        kind,
        sensitivity: "CONFIDENTIAL" as const,
        ...(kind === "COMPANY_PROFILE" ? { companyId: COMPANY_A } : {}),
      })),
    ),
  );
}

describe("the tools a run is offered are bounded by relevance, not by the alphabet", () => {
  it.each(Q_TASK_CLASSES)(
    "%s: relevant tools fit one request, and the core is always there",
    (purpose) => {
      const context = worstCase(purpose);
      const ranked = registry
        .ranked(context)
        .map((r) => r.definition.providerName);
      const offered = registry
        .eligible(context)
        .map((r) => r.definition.providerName);
      expect(ranked.length).toBeLessThanOrEqual(MODEL_TOOLS_MAX);
      // Lead 2026-10-02: no turn is offered more than Q_TURN_TOOLS_MAX,
      // the unfocused fallback included.
      expect(offered.length).toBeLessThanOrEqual(Q_TURN_TOOLS_MAX);
      expect(offered).toEqual(expect.arrayContaining(CORE));
      // The core leads, so no bound can ever cut it.
      expect(offered.slice(0, CORE.length).sort()).toEqual([...CORE].sort());
    },
  );

  it("narrows by purpose: an investor's mandate change is not offered for a question about their own company", () => {
    const own = registry
      .eligible(worstCase("OWN_COMPANY_QUESTION"))
      .map((r) => r.definition.providerName);
    expect(own).not.toContain("change_my_mandate");
    expect(own).toContain("change_my_raise");
  });

  it("is deterministic for the same catalogue and plan", () => {
    const context = worstCase("GENERAL_QUESTION");
    const a = registry.eligible(context).map((r) => r.definition.id);
    const b = registry.eligible(context).map((r) => r.definition.id);
    expect(a).toEqual(b);
  });
});
