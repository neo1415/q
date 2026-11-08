import { describe, expect, it } from "vitest";

import {
  Q_KNOWLEDGE_SCOPE_KINDS,
  type QKnowledgeScopeKind,
  type QTaskClass,
} from "@capital-q/contracts";

import {
  createDefaultQTools,
  createQToolRegistry,
  type QToolPorts,
} from "../src/index.js";
import { COMPANY_A, actorA, contextFor, planFor } from "./support.js";

/**
 * Owner live 8 Nov (batch 13, q-api logs 07:11-07:29): "web search doesn't
 * work at all, even when I gave it the specific name". The turns were read
 * research EXPLICIT, yet no public web tool ran, and use_capability could
 * not load research_public_web ("loaded confirm_deck_reading", then []).
 *
 * Root cause: a conversation that carries one of their relationships is
 * planned as RELATIONSHIP_QUESTION (q-firewall deriveTaskClass), and the
 * public web tools did not list that purpose, so the registry left them
 * out of what was offered, what a turn's focus could name, and what
 * use_capability could load. Public sources are not bound to the subject
 * the question carries: the actor-wide PUBLIC_EXTERNAL_DATA scope (still
 * required, and still checked again in each tool's authorize step) is
 * what decides whether the web may be read.
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

const PUBLIC_WEB = [
  "research_public_web",
  "lookup_public_profile",
  "extract_public_web",
  "find_public_entity",
  "brief_public_entity",
];

function plan(
  purpose: QTaskClass,
  kinds: readonly QKnowledgeScopeKind[] = Q_KNOWLEDGE_SCOPE_KINDS,
) {
  return contextFor(
    actorA,
    planFor(
      actorA,
      purpose,
      kinds.map((kind) => ({
        kind,
        sensitivity: "CONFIDENTIAL" as const,
        ...(kind === "COMPANY_PROFILE" ? { companyId: COMPANY_A } : {}),
      })),
    ),
  );
}

const names = (list: readonly { definition: { providerName: string } }[]) =>
  list.map(({ definition }) => definition.providerName);

describe("the public web is reachable from every question (batch 13)", () => {
  it("a question carrying their relationship keeps the public web tools: offered, nameable, loadable", () => {
    const context = plan("RELATIONSHIP_QUESTION");
    const available = names(registry.available(context));
    const focused = names(
      registry.eligible({
        ...context,
        focus: { areas: [], tools: ["research_public_web"] },
      }),
    );
    for (const tool of PUBLIC_WEB) expect(available).toContain(tool);
    expect(focused).toContain("research_public_web");
  });

  it("still needs the actor-wide public scope: a plan without it gets none", () => {
    const context = plan(
      "RELATIONSHIP_QUESTION",
      Q_KNOWLEDGE_SCOPE_KINDS.filter((kind) => kind !== "PUBLIC_EXTERNAL_DATA"),
    );
    const available = names(registry.available(context));
    for (const tool of PUBLIC_WEB) expect(available).not.toContain(tool);
  });
});
