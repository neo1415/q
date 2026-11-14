import { describe, expect, it } from "vitest";

import {
  ClaimProposalBlockedError,
  documentFigureProposals,
  DOCUMENT_FIGURE_CLAIM_KEYS,
  ExtractionPassageSchema,
} from "@capital-q/evidence";
import { ActorContextSchema } from "@capital-q/security";

import { ModelGatewayError } from "../src/errors.js";
import { createModelClaimProposer } from "../src/extraction/claim-proposer.js";
import type { ModelGateway } from "../src/gateway.js";
import { acceptStructuredOutput } from "../src/policy/structured.js";

/**
 * A8 live 2026-11-14: a fictional founder's 4-slide deck (Oct MRR USD
 * 42,000 "as at 31 October 2026", Sep USD 37,500, a June 2027 target)
 * came back with month-shaped asOf values. v1's schema took only a full
 * day, refused the whole batch, and the failure was logged as "no eligible
 * provider". Nothing was proposed.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

const DECK = [
  "[Page 3]",
  "Oct MRR: USD 42,000 (as at 31 October 2026)",
  "Sep MRR: USD 37,500 (September 2026)",
  "[Page 4]",
  "Target: USD 100,000 MRR by June 2027",
].join("\n");

const passage = ExtractionPassageSchema.parse({
  sourceId: "f0000000-0000-4000-8000-000000000001",
  subject: {
    subjectType: "COMPANY",
    subjectId: "a0000000-0000-4000-8000-000000000001",
  },
  locator: {
    kind: "document",
    documentVersionId: "f2000000-0000-4000-8000-000000000001",
  },
  text: DECK,
  description: "The company's own pitch deck, uploaded by its founder.",
});

const claim = (
  excerpt: string,
  amount: number,
  asOf: string | null,
  assertionKind = "SOURCE_ASSERTION",
) => ({
  claimKey: "financial.mrr",
  statement: `MRR was USD ${String(amount)}.`,
  value: { kind: "MONEY", amount, currency: "USD" },
  assertionKind,
  excerpt,
  asOf,
});

/** The gateway's own acceptance over a canned answer, as the gateway runs it. */
function gatewayAnswering(answer: unknown): {
  readonly gateway: ModelGateway;
  readonly seen: { invalidListItems?: unknown }[];
} {
  const seen: { invalidListItems?: unknown }[] = [];
  const gateway: ModelGateway = {
    execute: (_request, options) => {
      seen.push({ invalidListItems: options?.invalidListItems });
      if (options?.schema === undefined) throw new Error("no schema");
      const accepted = acceptStructuredOutput(
        JSON.stringify(answer),
        options.schema,
        { invalidListItems: options.invalidListItems },
      );
      if (!accepted.ok) {
        return Promise.reject(
          new ModelGatewayError("structured output refused", {
            failureClass: "INVALID_MODEL_OUTPUT",
            attempts: 2,
            candidates: [],
            ...(accepted.refusals === undefined
              ? {}
              : { refusals: accepted.refusals }),
          }),
        );
      }
      return Promise.resolve({
        providerCode: "fake",
        modelCode: "fake-model",
        output: {
          kind: "STRUCTURED",
          value: accepted.value,
          ...(accepted.dropped === undefined
            ? {}
            : { dropped: accepted.dropped }),
        },
      } as never);
    },
  };
  return { gateway, seen };
}

function proposerWith(gateway: ModelGateway) {
  const warnings: { fields: unknown; message: string }[] = [];
  const logger = {
    warn: (fields: unknown, message: string) => {
      warnings.push({ fields, message });
    },
  };
  const proposer = createModelClaimProposer({
    gateway,
    logger: logger as never,
    sensitivity: { sensitivityFor: () => Promise.resolve("CONFIDENTIAL") },
  });
  return { proposer, warnings };
}

describe("figures read from a deck by the model claim proposer", () => {
  it("takes the live answer's month and day forms: cards for October and September, none for the 2027 target", async () => {
    const { gateway, seen } = gatewayAnswering({
      claims: [
        claim(
          "Oct MRR: USD 42,000 (as at 31 October 2026)",
          42_000,
          "2026-10-31",
        ),
        claim("Sep MRR: USD 37,500 (September 2026)", 37_500, "2026-09"),
        claim(
          "Target: USD 100,000 MRR by June 2027",
          100_000,
          "2027-06",
          "SOURCE_ESTIMATE",
        ),
      ],
      absent: [],
    });
    const { proposer } = proposerWith(gateway);
    const batch = await proposer.propose({
      passage,
      claimKeys: DOCUMENT_FIGURE_CLAIM_KEYS,
      actor,
    });
    expect(seen).toEqual([{ invalidListItems: "DROP" }]);
    // A month is dated at its end, by code; the day the deck gave is kept.
    expect(batch.proposals.map((p) => p.asOf)).toEqual([
      "2026-10-31",
      "2026-09-30",
      "2027-06-30",
    ]);
    expect(batch.provenance.promptVersionId).toBe("claim-extraction/v2");

    const figures = documentFigureProposals({
      proposals: batch.proposals,
      passages: [{ text: DECK, page: 3 }],
      today: "2026-11-14",
    });
    expect(
      figures.map((f) => [f.figure.metric, f.figure.asOf, f.figure.value]),
    ).toEqual([
      [
        "MRR",
        "2026-10-31",
        { kind: "MONEY", amount: "42000", currency: "USD" },
      ],
      [
        "MRR",
        "2026-09-30",
        { kind: "MONEY", amount: "37500", currency: "USD" },
      ],
    ]);
  });

  it("drops one claim whose date is no date, and keeps the others", async () => {
    const { gateway } = gatewayAnswering({
      claims: [
        claim(
          "Oct MRR: USD 42,000 (as at 31 October 2026)",
          42_000,
          "2026-10-31",
        ),
        claim("Sep MRR: USD 37,500 (September 2026)", 37_500, "September 2026"),
        claim("Sep MRR: USD 37,500 (September 2026)", 37_500, "2026-09"),
      ],
      absent: [],
    });
    const { proposer, warnings } = proposerWith(gateway);
    const batch = await proposer.propose({
      passage,
      claimKeys: DOCUMENT_FIGURE_CLAIM_KEYS,
      actor,
    });
    expect(batch.proposals.map((p) => p.asOf)).toEqual([
      "2026-10-31",
      "2026-09-30",
    ]);
    // Reported by path and code, never by the value the model wrote.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("dropped");
    expect(JSON.stringify(warnings[0]?.fields)).toContain("claims.1.asOf");
    expect(JSON.stringify(warnings[0]?.fields)).not.toContain("September 2026");
  });

  it("never invents a calendar day: 31 February is dropped, not re-dated", async () => {
    const { gateway } = gatewayAnswering({
      claims: [claim("Oct MRR: USD 42,000", 42_000, "2026-02-31")],
      absent: [],
    });
    const { proposer } = proposerWith(gateway);
    const batch = await proposer.propose({
      passage,
      claimKeys: DOCUMENT_FIGURE_CLAIM_KEYS,
      actor,
    });
    expect(batch.proposals).toEqual([]);
  });

  it("reports an answer the schema refused as SCHEMA_REFUSED, with the refused paths, never as no eligible provider", async () => {
    // A refused field outside any list refuses the whole answer.
    const { gateway } = gatewayAnswering({ claims: "none", absent: [] });
    const { proposer } = proposerWith(gateway);
    const error: unknown = await proposer
      .propose({ passage, claimKeys: DOCUMENT_FIGURE_CLAIM_KEYS, actor })
      .then(
        () => null,
        (rejected: unknown) => rejected,
      );
    expect(error).toBeInstanceOf(ClaimProposalBlockedError);
    const blocked = error as ClaimProposalBlockedError;
    expect(blocked.reason).toBe("SCHEMA_REFUSED");
    expect(blocked.failureClass).toBe("INVALID_MODEL_OUTPUT");
    expect(blocked.refusals.join(" ")).toContain("claims");
  });

  it("keeps the other reasons apart: policy, unreachable, and a model that failed", async () => {
    const failing = (failureClass: string): ModelGateway => ({
      execute: () =>
        Promise.reject(
          new ModelGatewayError("failed", {
            failureClass: failureClass as never,
            attempts: 1,
            candidates: [],
          }),
        ),
    });
    const reasons: string[] = [];
    for (const failureClass of [
      "POLICY_INELIGIBLE",
      "PROVIDER_OUTAGE",
      "TIMEOUT",
    ]) {
      const { proposer } = proposerWith(failing(failureClass));
      await proposer
        .propose({ passage, claimKeys: DOCUMENT_FIGURE_CLAIM_KEYS, actor })
        .catch((error: unknown) => {
          if (error instanceof ClaimProposalBlockedError) {
            reasons.push(error.reason);
          }
        });
    }
    expect(reasons).toEqual([
      "PROVIDER_INELIGIBLE",
      "PROVIDER_UNAVAILABLE",
      "MODEL_FAILED",
    ]);
  });
});
