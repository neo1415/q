import { describe, expect, it } from "vitest";

import { APP_ACTIONS } from "@capital-q/app-actions";
import type { PermittedContextPlan } from "@capital-q/contracts";
import type { StatedFigureEvidence } from "@capital-q/evidence";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * A8, claim extraction in chat: "we hit $120k MRR in October" becomes a
 * card for the founder's approval, and nothing else. The turn's own run
 * reads the figure as propose_company_figure's arguments; code checks the
 * quote is the founder's own words, keeps money in its currency, names a
 * figure already recorded for that date, and writes nothing until the
 * approved card runs.
 */

const EARLIER = "0f000000-0000-4000-8000-0000000000e1";

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

function world(
  options: {
    readonly recorded?: boolean;
    readonly recordedAmount?: string;
  } = {},
) {
  const prepared: { actionType: string; payload: unknown }[] = [];
  const writes: string[] = [];
  const write = (name: string) => () => {
    writes.push(name);
    return Promise.reject(new Error("Q prepares; it never writes"));
  };
  const companyFigures: StatedFigureEvidence = {
    listClaims: () =>
      Promise.resolve(
        options.recorded === true
          ? [
              {
                id: EARLIER,
                claimKey: "financial.mrr",
                lifecycleStatus: "CURRENT",
                validFrom: "2026-10-31T00:00:00.000Z",
                structuredValue: {
                  kind: "MONEY",
                  amount: options.recordedAmount ?? "110000",
                  currency: "USD",
                  asOf: "2026-10-31",
                },
              } as never,
            ]
          : [],
      ),
    registerEvidenceSource: write("source"),
    createClaim: write("claim"),
    createEvidenceItem: write("item"),
    linkClaimEvidence: write("link"),
  };
  const ports = fakePorts({
    appActions: {
      // Only actorA has a company of their own; actorB is an investor.
      ownCompanyId: (actor) =>
        Promise.resolve(actor.userId === actorA.userId ? COMPANY_A : null),
      companyFigures,
    },
    appApprovals: {
      prepareForApproval: (entry) => {
        prepared.push({ actionType: entry.actionType, payload: entry.payload });
        return "PREPARED";
      },
    },
  });
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(ports)),
  });
  return { executor, prepared, writes };
}

const call = (args: Record<string, unknown>) => ({
  callId: "c-figure",
  name: "propose_company_figure",
  arguments: args,
});

const saying = (
  plan: PermittedContextPlan,
  latestUserText: string,
  actor = actorA,
) => ({
  ...contextFor(actor, plan),
  conversation: { latestUserText, earlierUserText: [] },
});

const MRR = {
  metric: "MRR",
  amount: 120000,
  currency: "USD",
  period: "2026-10",
  said: "we hit $120k MRR in October",
};

describe("a figure a founder tells Q becomes a card, never a record", () => {
  it("prepares their dated MRR for approval and writes nothing", async () => {
    const { executor, prepared, writes } = world();
    const outcome = await executor.execute(
      call(MRR),
      saying(founderPlan(), "Good news: we hit $120k MRR in October."),
    );
    expect(outcome.result).toMatchObject({ ok: true });
    expect(prepared).toEqual([
      {
        actionType: "app.company.figure.record",
        payload: {
          companyId: COMPANY_A,
          figure: {
            metric: "MRR",
            value: { kind: "MONEY", amount: "120000", currency: "USD" },
            asOf: "2026-10-31",
            said: "we hit $120k MRR in October",
          },
          alongside: [],
        },
      },
    ]);
    expect(writes).toEqual([]);
    const action = APP_ACTIONS.find((a) => a.name === "company.figure.record");
    const card = action?.card(prepared[0]?.payload);
    expect(card?.summary).toBe(
      "Record your MRR of USD 120,000 for October 2026",
    );
    expect(card?.preview).toContain("investors don't see it");
  });

  it("another language: the quote is theirs, the figure keeps its own currency", async () => {
    const { executor, prepared } = world();
    await executor.execute(
      call({
        metric: "CUSTOMERS",
        amount: 42,
        period: null,
        said: "Ya tenemos 42 clientes de pago",
      }),
      saying(founderPlan(), "Ya tenemos 42 clientes de pago."),
    );
    expect(prepared[0]?.payload).toMatchObject({
      figure: { metric: "CUSTOMERS", value: { kind: "COUNT", value: 42 } },
    });
    const { executor: eur, prepared: eurPrepared } = world();
    await eur.execute(
      call({
        metric: "ARR",
        amount: 1500000,
        currency: "EUR",
        period: "2026-09",
        said: "1,5 Mio. € ARR im September",
      }),
      saying(founderPlan(), "Wir lagen bei 1,5 Mio. € ARR im September."),
    );
    expect(eurPrepared[0]?.payload).toMatchObject({
      figure: { value: { amount: "1500000", currency: "EUR" } },
    });
  });

  it("a quote that is not in their messages is refused: a figure Q found or paraphrased has no provenance", async () => {
    const { executor, prepared } = world();
    const paraphrased = await executor.execute(
      call({ ...MRR, said: "MRR reached $120,000 in October" }),
      saying(founderPlan(), "we hit $120k MRR in October"),
    );
    expect(paraphrased.result).toMatchObject({ ok: false });
    const noConversation = await executor.execute(
      call(MRR),
      contextFor(actorA, founderPlan()),
    );
    expect(noConversation.result).toMatchObject({ ok: false });
    expect(prepared).toEqual([]);
  });

  it("a date still ahead is a target, not a figure reached", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      call({ ...MRR, period: "2099-12", said: "we'll hit $120k MRR" }),
      saying(founderPlan(), "By December 2099 we'll hit $120k MRR"),
    );
    expect(outcome.result).toMatchObject({ ok: false });
    expect(prepared).toEqual([]);
  });

  it("money without its currency is asked about, never assumed", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      call({ ...MRR, currency: undefined }),
      saying(founderPlan(), "we hit $120k MRR in October"),
    );
    expect(outcome.result).toMatchObject({ ok: false });
    expect(prepared).toEqual([]);
  });

  it("a different figure already recorded for that month is named on the card; both will stay", async () => {
    const { executor, prepared, writes } = world({ recorded: true });
    await executor.execute(
      call(MRR),
      saying(founderPlan(), "we hit $120k MRR in October"),
    );
    expect(prepared[0]?.payload).toMatchObject({
      alongside: ["USD 110,000 for October 2026"],
    });
    const action = APP_ACTIONS.find((a) => a.name === "company.figure.record");
    expect(action?.card(prepared[0]?.payload as never).preview).toContain(
      "both are kept, marked as conflicting",
    );
    expect(writes).toEqual([]);
  });

  it("live 14 Nov: a correction of an approved figure gets its own card naming the one on record", async () => {
    // "$120k MRR in October" was approved; then "Actually October MRR was
    // $110k." Q made no card and said the MRR was corrected and both kept.
    const { executor, prepared, writes } = world({
      recorded: true,
      recordedAmount: "120000",
    });
    const outcome = await executor.execute(
      call({
        ...MRR,
        amount: 110000,
        said: "Actually October MRR was $110k.",
      }),
      saying(founderPlan(), "Actually October MRR was $110k."),
    );
    expect(outcome.result).toMatchObject({ ok: true });
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.payload).toMatchObject({
      figure: {
        metric: "MRR",
        value: { kind: "MONEY", amount: "110000", currency: "USD" },
        asOf: "2026-10-31",
      },
      alongside: ["USD 120,000 for October 2026"],
    });
    const action = APP_ACTIONS.find((a) => a.name === "company.figure.record");
    const card = action?.card(prepared[0]?.payload as never);
    expect(card?.summary).toBe(
      "Record your MRR of USD 110,000 for October 2026",
    );
    expect(card?.preview).toContain("USD 120,000 for October 2026");
    // Nothing is written, so nothing may be said corrected or kept yet.
    expect(writes).toEqual([]);
    // The tool says, by meaning, that a correction is prepared the same way.
    const tool = action?.tool;
    expect(tool?.description).toMatch(
      /A correction .* is prepared the same way/u,
    );
    expect(tool?.description).toMatch(/recorded, corrected, kept or on file/u);
  });

  it("an investor cannot record a figure on any company, theirs to see or not", async () => {
    const { executor, prepared } = world();
    const investorPlan = planFor(actorB, "COUNTERPARTY_COMPANY_QUESTION", [
      { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
      {
        kind: "COMPANY_PROFILE",
        sensitivity: "NETWORK_VISIBLE",
        companyId: COMPANY_A,
      },
    ]);
    const outcome = await executor.execute(
      call(MRR),
      saying(investorPlan, "we hit $120k MRR in October", actorB),
    );
    expect(outcome.result).toMatchObject({ ok: false });
    expect(prepared).toEqual([]);
  });

  it("the approved card runs only for the founder's own company", async () => {
    const action = APP_ACTIONS.find((a) => a.name === "company.figure.record");
    expect(action).toBeDefined();
    if (action === undefined) return;
    const ports = {
      ownCompanyId: (actor: { readonly userId: string }) =>
        Promise.resolve(actor.userId === actorA.userId ? COMPANY_A : null),
    };
    const context = (actor: typeof actorA) => ({
      actor,
      idempotencyKey: "k",
      correlationId: "cor_test" as const,
      surface: "Q" as const,
    });
    const payload = { companyId: COMPANY_A } as never;
    expect(
      await action.authorize(ports as never, context(actorA), payload),
    ).toEqual({ ok: true });
    expect(
      await action.authorize(ports as never, context(actorB), payload),
    ).toMatchObject({ ok: false });
  });
});
