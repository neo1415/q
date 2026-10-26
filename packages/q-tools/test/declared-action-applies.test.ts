import { describe, expect, it } from "vitest";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type QToolPorts,
} from "../src/index.js";
import { COMPANY_A, actorA, contextFor, planFor } from "./support.js";

/**
 * Guard F-106-reshown-card (2026-10-26, run 352e44e1): "Savanna Seed asked
 * about … Draft a short reply" chose answer_investor_question with no
 * question open, read its inputs for 1.5 s and was refused. A declared
 * action that cannot apply to them right now is left off the list the
 * reader and router choose from; the offer and execution are unchanged.
 */
const STUB: unknown = {};
type Inbox = { readonly items: readonly unknown[] };
const question = (answered: boolean) => ({
  kind: "QUESTIONS",
  relationshipId: "r1",
  investorOrganisationName: "Savanna Seed Partners",
  state: "OPEN",
  questions: [
    {
      questionId: "q1",
      question: "What is your gross margin per litre?",
      assumptionLabel: null,
      answer: answered ? "41%" : null,
    },
  ],
});

function available(inbox: () => Promise<Inbox>) {
  const given: Record<string, unknown> = {
    ownCompanyId: () => Promise.resolve(COMPANY_A),
    founderRequests: { inbox: () => inbox() },
  };
  const own = new Proxy(given, {
    get: (target, key: string): unknown => target[key] ?? STUB,
  });
  const composed: Record<string, unknown> = { appActions: own };
  const ports = new Proxy(composed, {
    get: (target, key: string): unknown => target[key] ?? STUB,
    has: () => true,
  }) as unknown as QToolPorts;
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(ports)),
  });
  const plan = planFor(
    actorA,
    "OWN_COMPANY_QUESTION",
    // A founder's own conversation: what the live run had.
    (["OWN_Q_CONVERSATION", "COMPANY_PROFILE"] as const).map((kind) => ({
      kind,
      sensitivity: "CONFIDENTIAL" as const,
      ...(kind === "COMPANY_PROFILE" ? { companyId: COMPANY_A } : {}),
    })),
  );
  // Their own conversation is theirs by user (authorize requires it).
  const context = contextFor(actorA, {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actorA.userId } }
        : scope,
    ),
  });
  return {
    names: async () =>
      ((await executor.available?.(context)) ?? []).map(
        (tool) => tool.definition.name,
      ),
    offered: async () =>
      (
        await executor.offer({
          ...context,
          focus: { areas: [], tools: ["answer_investor_question"] },
        })
      ).map((tool) => tool.definition.name),
  };
}

describe("a declared action that cannot apply right now", () => {
  it("is not on the reader's list when no question is open", async () => {
    const run = available(() => Promise.resolve({ items: [question(true)] }));
    const names = await run.names();
    expect(names).not.toContain("answer_investor_question");
    expect(names).toContain("propose_chat_message");
    // Named, it is still offered; its own refusal still decides.
    expect(await run.offered()).toContain("answer_investor_question");
  });

  it("is listed when a question is open", async () => {
    const run = available(() => Promise.resolve({ items: [question(false)] }));
    expect(await run.names()).toContain("answer_investor_question");
  });

  it("is kept when its check fails", async () => {
    const run = available(() => Promise.reject(new Error("inbox down")));
    expect(await run.names()).toContain("answer_investor_question");
  });
});
