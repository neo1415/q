import { describe, expect, it } from "vitest";

import { APP_ACTIONS } from "@capital-q/app-actions";
import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  Claim,
  StatedFigureCorrectionEvidence,
} from "@capital-q/evidence";
import type { QToolExecutionContext } from "@capital-q/q-runtime";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  fakeAuthorization,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * ADR 0081 (owner decision 105): a founder's own statement of their own
 * company's figure, in this turn, is recorded at once with no card --
 * through the same declaration, claim path and Write Gate the approved
 * card runs. Everything outside that scope still comes as the card.
 */

const CONVERSATION = "70000000-0000-4000-8000-000000000001";
const MESSAGE = "71000000-0000-4000-8000-000000000001";
const MESSAGE_2 = "71000000-0000-4000-8000-000000000002";

function founderPlan(actor = actorA): PermittedContextPlan {
  const plan = planFor(actor, "OWN_COMPANY_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    {
      kind: "COMPANY_PROFILE",
      sensitivity: "CONFIDENTIAL",
      companyId: COMPANY_A,
    },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  };
}

type Write = { readonly name: string; readonly input: unknown };

/** An Evidence service that keeps what it is told, in memory. */
function evidence() {
  const writes: Write[] = [];
  const claims = new Map<string, Claim>();
  let next = 0;
  const id = () =>
    `c1000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
  const service: StatedFigureCorrectionEvidence = {
    listClaims: (query) =>
      Promise.resolve(
        [...claims.values()].filter(
          (claim) =>
            claim.subjectId === query.subject.subjectId &&
            (query.claimKey === undefined || claim.claimKey === query.claimKey),
        ),
      ),
    registerEvidenceSource: (command) => {
      writes.push({ name: "source", input: command.input });
      return Promise.resolve({ id: id() } as never);
    },
    createClaim: (command) => {
      writes.push({ name: "claim", input: command.input });
      const input = command.input;
      const claim = {
        id: id(),
        subjectType: input.subject.subjectType,
        subjectId: input.subject.subjectId,
        claimKey: input.claimKey,
        claimType: input.claimType,
        statement: input.statement,
        structuredValue: input.structuredValue ?? null,
        truthClass: input.truthClass,
        evidenceStatus: input.evidenceStatus,
        lifecycleStatus: input.lifecycleStatus ?? "CURRENT",
        validFrom: input.validFrom ?? null,
        visibilityScope: input.visibilityScope ?? "organisation_private",
        currentRevisionNumber: 1,
      } as unknown as Claim;
      claims.set(claim.id, claim);
      return Promise.resolve(claim);
    },
    createEvidenceItem: (command) => {
      writes.push({ name: "item", input: command.input });
      return Promise.resolve({ id: id() } as never);
    },
    linkClaimEvidence: (command) => {
      writes.push({ name: "link", input: command.input });
      return Promise.resolve({} as never);
    },
    getClaim: (query) => {
      const claim = claims.get(query.claimId);
      return claim === undefined
        ? Promise.reject(new Error("not found"))
        : Promise.resolve({ claim, revisions: [], evidence: [] });
    },
    reviseClaim: (command) => {
      writes.push({ name: "revise", input: command.input });
      const claim = claims.get(command.input.claimId);
      if (claim === undefined) return Promise.reject(new Error("not found"));
      const { claimId: _id, changeReason: _r, ...change } = command.input;
      const revised = {
        ...claim,
        ...change,
        currentRevisionNumber: claim.currentRevisionNumber + 1,
      } as unknown as Claim;
      claims.set(claim.id, revised);
      return Promise.resolve(revised);
    },
  };
  return { service, writes, claims };
}

function world(options: { readonly denyAll?: boolean } = {}) {
  const prepared: { actionType: string; payload: unknown }[] = [];
  const store = evidence();
  const ports = fakePorts({
    ...(options.denyAll === true
      ? { authorization: fakeAuthorization({ denyAll: true }) }
      : {}),
    appActions: {
      ownCompanyId: (actor) =>
        Promise.resolve(actor.userId === actorA.userId ? COMPANY_A : null),
      companyFigures: store.service,
      claimWithdrawals: store.service,
    },
    appApprovals: {
      prepareForApproval: (entry) => {
        prepared.push({ actionType: entry.actionType, payload: entry.payload });
        return "PREPARED";
      },
    },
  });
  const registry = createQToolRegistry(createDefaultQTools(ports));
  const executor = createQToolExecutor({ registry });
  return { executor, registry, prepared, store };
}

const turn = (
  said: string,
  options: {
    readonly clear?: boolean;
    readonly actor?: typeof actorA;
    readonly plan?: PermittedContextPlan;
    readonly message?: string;
    readonly qWords?: readonly string[];
    readonly asksNoAction?: boolean;
  } = {},
): QToolExecutionContext => ({
  ...contextFor(options.actor ?? actorA, options.plan ?? founderPlan()),
  conversation: {
    latestUserText: said,
    earlierUserText: [],
    earlierQText: [...(options.qWords ?? [])],
    conversationId: CONVERSATION,
    messageId: options.message ?? MESSAGE,
  },
  ...(options.clear === false ? {} : { ownStatementClear: true }),
  ...(options.asksNoAction === true ? { asksNoAction: true } : {}),
});

const figure = (args: Record<string, unknown>) => ({
  callId: "c-figure",
  name: "propose_company_figure",
  arguments: args,
});

const MRR = {
  metric: "MRR",
  amount: 120000,
  currency: "USD",
  period: "2026-10",
  said: "our MRR is now $120k for October",
  statedNow: true,
};
const SAID = "Quick update: our MRR is now $120k for October.";

const dataOf = (outcome: { readonly result: unknown }) =>
  (outcome.result as { readonly data?: { status?: string; says?: string } })
    .data;

describe("ADR 0081: the founder's own figure is recorded at once, with no card", () => {
  it("typed: recorded with no card, in the exact shape the approved card writes", async () => {
    const direct = world();
    const outcome = await direct.executor.execute(figure(MRR), turn(SAID));
    expect(dataOf(outcome)?.status).toBe("DONE");
    expect(dataOf(outcome)?.says).toBe(
      "Recorded your MRR of USD 120,000 for October 2026, as your own statement (self-reported), private to your company: investors don't see it. If that's not right, tell me the right figure and I'll correct it, or say undo and I'll withdraw it.",
    );
    expect(direct.prepared).toEqual([]);

    // The same figure through the card, approved: the same claim, item
    // and link; only the source says how it was taken.
    const card = world();
    await card.executor.execute(figure(MRR), turn(SAID, { clear: false }));
    expect(card.prepared).toHaveLength(1);
    const action = APP_ACTIONS.find((a) => a.name === "company.figure.record");
    if (action === undefined) throw new Error("no figure action");
    await action.run(
      {
        companyFigures: card.store.service,
        ownCompanyId: () => Promise.resolve(COMPANY_A),
      },
      {
        actor: actorA,
        idempotencyKey: "approved-card",
        correlationId: "cor_test",
        surface: "Q",
      },
      card.prepared[0]?.payload,
    );
    const shape = (writes: readonly Write[]) =>
      writes
        .filter((write) => write.name !== "source")
        .map((write) =>
          write.name === "link"
            ? { name: write.name }
            : { name: write.name, input: write.input },
        );
    expect(shape(direct.store.writes)).toEqual(shape(card.store.writes));
    const claim = direct.store.writes.find((write) => write.name === "claim");
    expect(claim?.input).toMatchObject({
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      structuredValue: { kind: "MONEY", amount: "120000", currency: "USD" },
      validFrom: "2026-10-31T00:00:00.000Z",
    });
    // Visibility is the card's (Evidence's private default), never wider.
    expect(claim?.input).not.toHaveProperty("visibilityScope");
    const source = direct.store.writes.find((write) => write.name === "source");
    expect(source?.input).toMatchObject({
      sourceType: "CONVERSATION",
      reliabilityClass: "USER_STATEMENT",
      metadata: {
        via: "q_conversation",
        approvedCard: false,
        delegation: "ADR-0081",
      },
    });
  });

  it("spoken, read clearly: recorded the same way (a count, no currency)", async () => {
    const { executor, prepared, store } = world();
    const outcome = await executor.execute(
      figure({
        metric: "CUSTOMERS",
        amount: 14,
        period: "2026-11",
        said: "we have 14 customers now",
        statedNow: true,
      }),
      turn("yeah so we have 14 customers now"),
    );
    expect(dataOf(outcome)?.says).toContain(
      "Recorded your customers of 14 for November 2026",
    );
    expect(prepared).toEqual([]);
    expect(store.writes.map((w) => w.name)).toEqual([
      "source",
      "claim",
      "item",
      "link",
    ]);
  });

  it("a number not in their words still gets a card", async () => {
    const { executor, prepared, store } = world();
    const outcome = await executor.execute(
      figure({ ...MRR, said: "our MRR is now up for October" }),
      turn("Quick update: our MRR is now up for October."),
    );
    expect(dataOf(outcome)?.status).toBe("PREPARED");
    expect(prepared).toHaveLength(1);
    expect(store.writes).toEqual([]);
  });

  it("a figure not stated in this turn (an earlier message, or not marked) still gets a card", async () => {
    const earlier = world();
    await earlier.executor.execute(figure(MRR), {
      ...turn("Can you show me my chart?"),
      conversation: {
        latestUserText: "Can you show me my chart?",
        earlierUserText: [SAID],
        conversationId: CONVERSATION,
        messageId: MESSAGE,
      },
    });
    expect(earlier.prepared).toHaveLength(1);
    expect(earlier.store.writes).toEqual([]);
    const unmarked = world();
    await unmarked.executor.execute(
      figure({ ...MRR, statedNow: undefined }),
      turn(SAID),
    );
    expect(unmarked.prepared).toHaveLength(1);
    expect(unmarked.store.writes).toEqual([]);
  });

  it("a low-confidence or garbled transcript still gets a card", async () => {
    const { executor, prepared, store } = world();
    const outcome = await executor.execute(
      figure(MRR),
      turn(SAID, { clear: false }),
    );
    expect(dataOf(outcome)?.status).toBe("PREPARED");
    expect(prepared).toHaveLength(1);
    expect(store.writes).toEqual([]);
  });

  it("an investor cannot record any company's figure; a member without the capability gets the card", async () => {
    const investor = world();
    const investorPlan = planFor(actorB, "COUNTERPARTY_COMPANY_QUESTION", [
      { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
      {
        kind: "COMPANY_PROFILE",
        sensitivity: "NETWORK_VISIBLE",
        companyId: COMPANY_B_NETWORK,
      },
    ]);
    const refused = await investor.executor.execute(
      figure(MRR),
      turn(SAID, { actor: actorB, plan: investorPlan }),
    );
    expect(refused.result).toMatchObject({ ok: false });
    expect(investor.store.writes).toEqual([]);
    expect(investor.prepared).toEqual([]);

    const noCapability = world({ denyAll: true });
    const outcome = await noCapability.executor.execute(
      figure(MRR),
      turn(SAID),
    );
    expect(dataOf(outcome)?.status).toBe("PREPARED");
    expect(noCapability.store.writes).toEqual([]);
  });

  it("a retry of the same message records once, under the same key", async () => {
    const { executor, store } = world();
    const first = await executor.execute(figure(MRR), turn(SAID));
    const retry = await executor.execute(figure(MRR), turn(SAID));
    expect(dataOf(first)?.status).toBe("DONE");
    expect(dataOf(retry)?.says).toBe(
      "Your MRR of USD 120,000 for October 2026 was already recorded, so nothing changed.",
    );
    expect(store.writes.filter((w) => w.name === "claim")).toHaveLength(1);
    const key = (
      store.writes[0]?.input as { metadata: { idempotencyKey: string } }
    ).metadata.idempotencyKey;
    expect(key).toMatch(/^q-own-[0-9a-f]{40}$/u);
  });

  it("undo withdraws it with a new revision, no card, bound to what Q said it recorded", async () => {
    const { executor, prepared, store } = world();
    const recorded = await executor.execute(figure(MRR), turn(SAID));
    const line = dataOf(recorded)?.says ?? "";
    const undo = await executor.execute(
      {
        callId: "c-undo",
        name: "propose_withdraw_company_claim",
        arguments: {
          metric: "MRR",
          period: "2026-10",
          amount: 120000,
          reason: "undo that",
          undoesRecorded: true,
        },
      },
      turn("Undo that", { message: MESSAGE_2, qWords: [line] }),
    );
    expect(dataOf(undo)?.status).toBe("DONE");
    expect(dataOf(undo)?.says).toContain(
      "Undone: your MRR of USD 120,000 for October 2026 is withdrawn.",
    );
    expect(prepared).toEqual([]);
    const revision = store.writes.find((w) => w.name === "revise");
    expect(revision?.input).toMatchObject({
      lifecycleStatus: "SUPERSEDED",
      expectedRevisionNumber: 1,
      changeReason: "Withdrawn by the company: undo that",
    });
    expect(
      [...store.claims.values()].map((claim) => claim.lifecycleStatus),
    ).toEqual(["SUPERSEDED"]);

    // Without Q having said it recorded that figure here, it is a card.
    const other = world();
    await other.executor.execute(figure(MRR), turn(SAID));
    await other.executor.execute(
      {
        callId: "c-undo",
        name: "propose_withdraw_company_claim",
        arguments: {
          metric: "MRR",
          period: "2026-10",
          reason: "it was wrong",
          undoesRecorded: true,
        },
      },
      turn("Withdraw the October MRR, it was wrong", { message: MESSAGE_2 }),
    );
    expect(other.prepared.map((p) => p.actionType)).toEqual([
      "app.company.claim.withdraw",
    ]);
    expect(other.store.writes.some((w) => w.name === "revise")).toBe(false);
  });

  it("a correction revises the figure Q recorded here: a new revision, never an overwrite", async () => {
    const { executor, prepared, store } = world();
    const recorded = await executor.execute(figure(MRR), turn(SAID));
    const line = dataOf(recorded)?.says ?? "";
    const corrected = await executor.execute(
      figure({
        ...MRR,
        amount: 110000,
        said: "Actually October MRR was $110k",
      }),
      turn("Actually October MRR was $110k.", {
        message: MESSAGE_2,
        qWords: [line],
      }),
    );
    expect(dataOf(corrected)?.says).toContain(
      "Recorded your MRR of USD 110,000 for October 2026, correcting the figure I recorded earlier",
    );
    expect(prepared).toEqual([]);
    expect(store.writes.filter((w) => w.name === "claim")).toHaveLength(1);
    expect(store.writes.find((w) => w.name === "revise")?.input).toMatchObject({
      expectedRevisionNumber: 1,
      structuredValue: { amount: "110000", currency: "USD" },
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      changeReason:
        "Corrected by the founder in conversation: Actually October MRR was $110k",
    });
  });

  it("240e0b9a0 holds: on a question turn other card tools stay withheld; their own figure is still recorded", async () => {
    const { executor, prepared, store } = world();
    const asked = "Our MRR is now $120k for October -- how does that compare?";
    const recorded = await executor.execute(
      figure({ ...MRR, said: "Our MRR is now $120k for October" }),
      turn(asked, { asksNoAction: true }),
    );
    expect(dataOf(recorded)?.status).toBe("DONE");
    const withheld = await executor.execute(
      {
        callId: "c-withdraw",
        name: "propose_withdraw_company_claim",
        arguments: {
          metric: "MRR",
          period: "2026-10",
          reason: "wrong",
          undoesRecorded: true,
        },
      },
      turn(asked, {
        asksNoAction: true,
        message: MESSAGE_2,
        qWords: [dataOf(recorded)?.says ?? ""],
      }),
    );
    expect(withheld.result).toMatchObject({ ok: false });
    expect(withheld.failureCode).toBe("TOOL_NOT_ELIGIBLE");
    expect(prepared).toEqual([]);
    expect(store.writes.some((w) => w.name === "revise")).toBe(false);
  });
});
