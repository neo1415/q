import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
  type QNavigationChoice,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  ContextFirewallPort,
  QToolCallOutcome,
  QToolPort,
} from "@capital-q/q-runtime";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createNavigationChooser } from "../src/composition/navigation-chooser.js";

/**
 * Lane 7 (owner 2026-10-21: "names must NOT be required"): the tie-break
 * for a pointing request. Candidates are opened as the person first; only
 * those they may open reach the one capped model call, which is faked here.
 */

const ACTOR: ActorContext = {
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

const NIXO = "9d1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f74";
const HALYARD = "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70";
const SECRET = "3e1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f79";

function planFor(runId: string): PermittedContextPlan {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId,
    tenantId: ACTOR.tenantId,
    actor: { userId: ACTOR.userId, organisationId: ACTOR.organisationId },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity: "PUBLIC",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
}

const firewall: ContextFirewallPort = {
  plan: (request) =>
    Promise.resolve({ outcome: "AUTHORISED", plan: planFor(request.runId) }),
};

/** open_page / open_company_document as the person: only `may` open. */
function tools(may: readonly string[]): QToolPort {
  return {
    offer: () => Promise.resolve([]),
    execute: (proposal) => {
      const args = proposal.arguments as {
        id?: string;
        documentId?: string;
        page?: string;
      };
      const id = args.id ?? args.documentId ?? "";
      const ok = may.includes(id);
      const outcome: QToolCallOutcome = {
        callId: "c",
        toolName: null,
        toolVersion: null,
        classification: null,
        status: ok ? "SUCCEEDED" : "DENIED",
        failureCode: ok ? null : "NOT_AVAILABLE",
        sensitivity: null,
        result: ok
          ? {
              ok: true,
              data: {
                status: "SCREEN_WILL_DO_IT",
                clientAction: {
                  kind: "OPEN_RECORD_PAGE",
                  page: args.page ?? "DATA_ROOM_DOCUMENT",
                  id,
                  ...(args.page === undefined ? { companyId: NIXO } : {}),
                },
              },
            }
          : {
              ok: false,
              error: { code: "NOT_AVAILABLE", safeMessage: "Not available." },
            },
        latencyMs: 1,
      };
      return Promise.resolve(outcome);
    },
  };
}

/** A listed key, null, or "HANG" (never answers). */
function gateway(answer: string | null) {
  const asked: string[] = [];
  const fake = {
    execute: (
      input: { messages: { content: string }[] },
      options?: { signal?: AbortSignal },
    ) => {
      asked.push(input.messages.map((m) => m.content).join("\n"));
      if (answer === "HANG") {
        return new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        });
      }
      return Promise.resolve({
        output: { kind: "STRUCTURED", value: { key: answer } },
      });
    },
  } as unknown as ModelGateway;
  return { gateway: fake, asked };
}

const CANDIDATES: QNavigationChoice[] = [
  { key: "c1", page: "COMPANY_DECK", id: NIXO, label: "Nixo · Pitch deck" },
  {
    key: "c2",
    page: "COMPANY_DECK",
    id: HALYARD,
    label: "Halyard · Pitch deck",
  },
  {
    key: "c3",
    page: "DATA_ROOM_DOCUMENT",
    id: SECRET,
    companyId: NIXO,
    label: "Secret side letter",
  },
];

describe("the navigation tie-break", () => {
  it("asks one capped model call over only what the person may open", async () => {
    const model = gateway("c2");
    const choose = createNavigationChooser({
      firewall,
      tools: tools([NIXO, HALYARD]),
      gateway: model.gateway,
    });
    const decided = await choose(ACTOR, {
      text: "open their deck",
      candidates: CANDIDATES,
    });
    expect(decided).toMatchObject({ kind: "CHOSEN", key: "c2", model: true });
    expect(model.asked).toHaveLength(1);
    // A document they may not open never reaches the model, even mentioned.
    expect(model.asked[0]).not.toMatch(/Secret side letter|c3/u);
    expect(model.asked[0]).toMatch(/Halyard · Pitch deck/u);
  });

  it("only one theirs to open: chosen with no model call", async () => {
    const model = gateway("c1");
    const choose = createNavigationChooser({
      firewall,
      tools: tools([HALYARD]),
      gateway: model.gateway,
    });
    expect(
      await choose(ACTOR, { text: "open that", candidates: CANDIDATES }),
    ).toMatchObject({ kind: "CHOSEN", key: "c2", model: false });
    expect(model.asked).toHaveLength(0);
  });

  it("a key not listed, or one they may not open, is NONE with what they may open", async () => {
    const model = gateway("c3");
    const choose = createNavigationChooser({
      firewall,
      tools: tools([NIXO, HALYARD]),
      gateway: model.gateway,
    });
    expect(
      await choose(ACTOR, { text: "open that", candidates: CANDIDATES }),
    ).toMatchObject({ kind: "NONE", allowed: ["c1", "c2"] });
  });

  it("past its budget it gives up: NONE, the screen decides", async () => {
    const model = gateway("HANG");
    const choose = createNavigationChooser({
      firewall,
      tools: tools([NIXO, HALYARD]),
      gateway: model.gateway,
      budgetMs: 80,
    });
    const started = Date.now();
    const decided = await choose(ACTOR, {
      text: "open their deck",
      candidates: CANDIDATES,
    });
    expect(decided).toMatchObject({ kind: "NONE", allowed: ["c1", "c2"] });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("nothing theirs, or the firewall refuses: NONE and no model", async () => {
    const model = gateway("c1");
    const refused = createNavigationChooser({
      firewall: {
        plan: () =>
          Promise.resolve({
            outcome: "DENIED",
            reason: "NO_AUTHORISED_CONTEXT",
            denied: [],
          }),
      },
      tools: tools([NIXO, HALYARD]),
      gateway: model.gateway,
    });
    expect(
      await refused(ACTOR, { text: "open that", candidates: CANDIDATES }),
    ).toMatchObject({ kind: "NONE", allowed: [] });
    const none = createNavigationChooser({
      firewall,
      tools: tools([]),
      gateway: model.gateway,
    });
    expect(
      await none(ACTOR, { text: "open that", candidates: CANDIDATES }),
    ).toMatchObject({ kind: "NONE", allowed: [] });
    expect(model.asked).toHaveLength(0);
  });
});
