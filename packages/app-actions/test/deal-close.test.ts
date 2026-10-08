import { describe, expect, it, vi } from "vitest";

import { CorrelationIdSchema, type DealViewDto } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import { APP_ACTIONS, type AppActionPorts } from "../src/index.js";
import { dealStatusSentence, termsPreview } from "../src/actions/deal-close.js";

/**
 * Deal close actions (2026-10-08): the approval card carries every term
 * (the approval binds to exactly that payload), a signature names the exact
 * terms version, Q never guesses the signed copy, the close files its
 * closing report, a pass files the investor's private pass report, and Q's
 * "where are we with Tensorgate?" is the record in plain words.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const context = {
  actor,
  idempotencyKey: "screen:deal-0001",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000001",
  ),
  surface: "Q" as const,
};
const REL = "11111111-0000-4000-8000-000000000001";
const TERMS = "33333333-0000-4000-8000-000000000001";
const DOC_A = "44444444-0000-4000-8000-000000000001";
const DOC_B = "44444444-0000-4000-8000-000000000002";
const named = (name: string) =>
  APP_ACTIONS.find((action) => action.name === name);

const baseView: DealViewDto = {
  relationshipId: REL,
  side: "COMPANY",
  stageVersion: "deal-stage.v1",
  stages: [
    { stage: "MET", reachedAt: "2026-09-18T10:00:00.000Z" },
    { stage: "DILIGENCE", reachedAt: "2026-09-22T10:00:00.000Z" },
    { stage: "SOFT_COMMIT", reachedAt: "2026-09-29T10:00:00.000Z" },
    { stage: "TERMS", reachedAt: "2026-10-01T10:00:00.000Z" },
    { stage: "SIGNED", reachedAt: null },
    { stage: "FUNDS_RECEIVED", reachedAt: null },
    { stage: "CLOSED", reachedAt: null },
  ],
  current: "TERMS",
  end: null,
  nextSteps: ["MARK_SIGNED", "CONFIRM_FUNDS"],
  terms: {
    termsId: TERMS,
    version: 2,
    status: "RECORDED",
    instrument: "SAFE",
    amount: "250000",
    currencyCode: "USD",
    valuationCap: "8000000",
    valuationBasis: "POST_MONEY",
    preMoneyValuation: null,
    discountPercent: null,
    proRata: null,
    otherTerms: null,
    termsDocumentId: DOC_A,
    recordedBySide: "INVESTOR",
    recordedBy: "Ada Obi",
    recordedAt: "2026-10-01T10:00:00.000Z",
    signedDocumentId: null,
    signedBy: null,
    signedAt: null,
  },
  termsHistory: [],
  close: null,
  checklist: [],
  updateCadence: null,
  passNoteDraft: null,
  sharedDocumentIds: [DOC_A, DOC_B],
  reports: [],
};

describe("deal close actions", () => {
  it("the terms card states every term, exactly; a different payload is a different card", () => {
    const preview = termsPreview({
      instrument: "SAFE",
      amount: "250000",
      currencyCode: "USD",
      valuationCap: "8000000",
      valuationBasis: "POST_MONEY",
      proRata: true,
    });
    expect(preview).toContain("SAFE, USD 250,000.00");
    expect(preview).toContain("cap USD 8,000,000.00 post-money");
    expect(preview).toContain("pro-rata right");
    expect(
      termsPreview({
        instrument: "SAFE",
        amount: "250001",
        currencyCode: "USD",
      }),
    ).not.toBe(
      termsPreview({
        instrument: "SAFE",
        amount: "250000",
        currencyCode: "USD",
      }),
    );
  });

  it("terms, signing and close are consequential (TERMS): never Q's alone", () => {
    for (const name of [
      "relationship.deal.terms",
      "relationship.deal.signed",
      "relationship.deal.close",
      "relationship.deal.change",
    ]) {
      expect(named(name)?.classification).toBe("CONSEQUENTIAL");
      expect(named(name)?.consequence).toBe("TERMS");
    }
  });

  it("Q's MARK_SIGNED binds the current terms version and the one unambiguous signed copy", async () => {
    const family = named("relationship.deal.change");
    const view = vi.fn(() => Promise.resolve(baseView));
    const ports = { deal: { view } } as unknown as AppActionPorts;
    const prepared = await family?.tool?.toCanonical(
      { relationship: REL, operation: "MARK_SIGNED" },
      context,
      ports,
    );
    expect(prepared).toEqual({
      operation: "MARK_SIGNED",
      input: {
        relationshipId: REL,
        idempotencyKey: "screen:deal-0001",
        input: { termsId: TERMS, signedDocumentId: DOC_B },
      },
    });
    const ambiguous = {
      deal: {
        view: () =>
          Promise.resolve({
            ...baseView,
            sharedDocumentIds: [
              DOC_A,
              DOC_B,
              "44444444-0000-4000-8000-000000000003",
            ],
          }),
      },
    } as unknown as AppActionPorts;
    expect(
      await family?.tool?.toCanonical(
        { relationship: REL, operation: "MARK_SIGNED" },
        context,
        ambiguous,
      ),
    ).toEqual({
      refused: expect.stringMatching(
        /Choose the signed copy/,
      ) as unknown as string,
    });
  });

  it("a close files the closing report once; a replayed close files nothing", async () => {
    const close = named("relationship.deal.close");
    const generateReport = vi.fn(() => Promise.resolve({ outcome: "OK" }));
    const run = (deduplicated: boolean) =>
      close?.run(
        {
          deal: {
            close: () =>
              Promise.resolve({
                outcome: "OK",
                relationshipId: REL,
                deduplicated,
              }),
            generateReport,
          },
        } as unknown as AppActionPorts,
        context,
        { relationshipId: REL, idempotencyKey: "screen:close-0001", input: {} },
      );
    await run(false);
    await run(true);
    expect(generateReport).toHaveBeenCalledTimes(1);
    expect(generateReport).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "CLOSING",
        idempotencyKey: "screen:close-0001:closing",
      }),
    );
  });

  it("a pass files the investor's private pass report; a failed report never undoes the pass", async () => {
    const pass = named("relationship.outcome.pass");
    const generateReport = vi.fn(() =>
      Promise.reject(new Error("compile failed")),
    );
    const out = await pass?.run(
      {
        outcomes: {
          pass: () =>
            Promise.resolve({
              outcome: "OK",
              relationshipId: REL,
              deduplicated: false,
            }),
        },
        deal: { generateReport },
      } as unknown as AppActionPorts,
      context,
      {
        relationshipId: REL,
        idempotencyKey: "screen:pass-0001",
        input: { shareWithFounder: false },
      },
    );
    expect(out).toEqual({
      outcome: "OK",
      relationshipId: REL,
      deduplicated: false,
    });
    expect(generateReport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "PASS" }),
    );
  });

  it("answers 'where are we with Tensorgate?' from the record", () => {
    expect(dealStatusSentence(baseView)).toBe(
      "Terms recorded on 2026-10-01. Terms v2: USD 250,000.00 (not signed yet). Next: record the signed copy, or confirm the money arrived.",
    );
    expect(
      dealStatusSentence({
        ...baseView,
        end: { kind: "PASSED", at: "2026-10-05T10:00:00.000Z" },
      }),
    ).toMatch(/^Not proceeding since 2026-10-05/);
  });
});
