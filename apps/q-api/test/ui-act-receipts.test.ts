import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  Q_UI_ACT_RECEIPTS_PATH,
  type QUiActReport,
} from "@capital-q/contracts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createLogger } from "@capital-q/observability";

import { registerProblemHandling } from "../src/http/problem-handler.js";
import {
  createUiActReceiptLedger,
  receiptFacts,
  recentUiActReceipts,
  registerUiActReceiptRoutes,
  UI_ACT_RECEIPT_TTL_MS,
  UI_ACT_RECEIPTS_PER_PERSON,
  type UiActReceiptLedger,
} from "../src/http/ui-act-receipts.js";

/**
 * RECOVERY-2026-10 (C2): the receipts of Q's UI acts reach the Q API as
 * the person, are kept for the person only, and become plain facts for
 * the next turn. No provider, no database.
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
const STRANGER: ActorContext = {
  ...ACTOR,
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
};
const BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";

function report(
  n: number,
  status: QUiActReport["receipt"]["status"] = "DONE",
): QUiActReport {
  const actId = `uia_receipt${String(n).padStart(4, "0")}`;
  return {
    intent: {
      kind: "UI_ACT",
      actId,
      act: "SELECT_TAB",
      target: "tab.mandate",
    },
    receipt: { actId, status, seq: n },
  };
}

async function server(receipts: UiActReceiptLedger, as: ActorContext | null) {
  const app = Fastify();
  // The service's own problem responses (401, 400), as app.ts registers.
  registerProblemHandling(app, createLogger({ level: "silent" }));
  registerUiActReceiptRoutes(app, {
    authenticator: {
      // A request without the bearer token is nobody.
      authenticate: (request) =>
        Promise.resolve(
          request.headers.authorization === `Bearer ${BEARER}`
            ? {
                authUserId: AuthUserIdSchema.parse(
                  "a0000000-0000-4000-8000-000000000001",
                ),
              }
            : null,
        ),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          as === null
            ? { status: "NO_MEMBERSHIP" as const }
            : { status: "RESOLVED" as const, context: as },
        ),
    },
    receipts,
  });
  await app.ready();
  return app;
}

describe("UI act receipts reach the Q API as the person (RECOVERY C2)", () => {
  it("keeps the person's receipts, keyed by the actor the server resolved", async () => {
    const ledger = createUiActReceiptLedger();
    const app = await server(ledger, ACTOR);
    const response = await app.inject({
      method: "POST",
      url: Q_UI_ACT_RECEIPTS_PATH,
      headers: { authorization: `Bearer ${BEARER}` },
      payload: { reports: [report(1, "TARGET_MISSING"), report(2)] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: 2 });
    expect(
      recentUiActReceipts(ledger, ACTOR).map((r) => r.receipt.status),
    ).toEqual(["TARGET_MISSING", "DONE"]);
    // Another person reads nothing of it.
    expect(recentUiActReceipts(ledger, STRANGER)).toEqual([]);
    await app.close();
  });

  it("refuses without a session, and refuses a body that is not the contract", async () => {
    const ledger = createUiActReceiptLedger();
    const app = await server(ledger, ACTOR);
    const anonymous = await app.inject({
      method: "POST",
      url: Q_UI_ACT_RECEIPTS_PATH,
      payload: { reports: [report(1)] },
    });
    expect(anonymous.statusCode).toBe(401);
    const mismatched = report(3);
    const invalid = await app.inject({
      method: "POST",
      url: Q_UI_ACT_RECEIPTS_PATH,
      headers: { authorization: `Bearer ${BEARER}` },
      payload: {
        reports: [
          {
            ...mismatched,
            receipt: { ...mismatched.receipt, actId: "uia_someoneelse" },
          },
        ],
      },
    });
    expect(invalid.statusCode).toBe(422);
    const labels = await app.inject({
      method: "POST",
      url: Q_UI_ACT_RECEIPTS_PATH,
      headers: { authorization: `Bearer ${BEARER}` },
      payload: {
        reports: [
          {
            ...report(4),
            intent: { ...report(4).intent, target: "Mandate tab" },
          },
        ],
      },
    });
    expect(labels.statusCode).toBe(422);
    expect(recentUiActReceipts(ledger, ACTOR)).toEqual([]);
    await app.close();
  });

  it("counts a retried receipt once, bounds what it keeps, and forgets after the TTL", () => {
    let now = 0;
    const ledger = createUiActReceiptLedger({ now: () => now });
    expect(ledger.record(ACTOR, [report(1), report(1)], undefined)).toBe(1);
    expect(ledger.record(ACTOR, [report(1)], undefined)).toBe(0);
    ledger.record(
      ACTOR,
      Array.from({ length: 40 }, (_, i) => report(i + 10)),
      undefined,
    );
    expect(ledger.recent(ACTOR)).toHaveLength(UI_ACT_RECEIPTS_PER_PERSON);
    now = UI_ACT_RECEIPT_TTL_MS + 1;
    expect(ledger.recent(ACTOR)).toEqual([]);
  });

  it("keeps the page the browser reported with them, for the next turn", () => {
    const ledger = createUiActReceiptLedger();
    ledger.record(ACTOR, [report(1)], {
      v: 2,
      seq: 7,
      inView: [],
      sections: [],
      dialogs: [],
      controls: [{ id: "tab.mandate", kind: "TAB", state: "SELECTED" }],
    });
    expect(ledger.lastManifest(ACTOR)?.controls?.[0]?.id).toBe("tab.mandate");
    expect(ledger.lastManifest(STRANGER)).toBeUndefined();
  });

  it("says what happened in code's words, never claiming a missing act as done", () => {
    const facts = receiptFacts([report(1, "TARGET_MISSING"), report(2)]);
    expect(facts).toEqual([
      "SELECT_TAB tab.mandate: NOT done: that control is not on their screen (TARGET_MISSING).",
      "SELECT_TAB tab.mandate: done on their screen (DONE).",
    ]);
  });
});
