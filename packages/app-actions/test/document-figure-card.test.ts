import { describe, expect, it } from "vitest";

import type {
  DocumentFigureEvidence,
  StatedFigureEvidence,
} from "@capital-q/evidence";
import { ActorContextSchema } from "@capital-q/security";

import {
  APP_ACTIONS,
  documentFigureCardInput,
  type AppActionPorts,
} from "../src/index.js";

/**
 * A8: a figure read from a founder's own document is a card on the same
 * declared action as a figure they tell Q (company.figure.record). Only
 * code sets its document provenance; on approval it is recorded through
 * Evidence as a document-supported claim; an investor is never offered it.
 */

const founder = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const investor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000009",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000009",
  membershipId: "e0000000-0000-4000-8000-000000000009",
  actorType: "HUMAN",
});
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const document = {
  sourceId: "f0000000-0000-4000-8000-000000000001",
  documentId: "f1000000-0000-4000-8000-000000000001",
  documentVersionId: "f2000000-0000-4000-8000-000000000001",
  page: 4,
  title: "Maji Loop deck",
};
const figure = {
  metric: "MRR" as const,
  value: { kind: "MONEY" as const, amount: "42000", currency: "USD" },
  asOf: "2026-10-31",
  said: "MRR $42,000 in October 2026",
};

const action = APP_ACTIONS.find((a) => a.name === "company.figure.record");

function ports(recorded: unknown[] = []) {
  const written: string[] = [];
  const stated: StatedFigureEvidence = {
    listClaims: () => Promise.resolve(recorded as never),
    registerEvidenceSource: () => {
      written.push("stated");
      return Promise.reject(new Error("not this path"));
    },
    createClaim: () => {
      written.push("stated");
      return Promise.reject(new Error("not this path"));
    },
    createEvidenceItem: () => Promise.reject(new Error("not this path")),
    linkClaimEvidence: () => Promise.reject(new Error("not this path")),
  };
  const fromDocument: DocumentFigureEvidence = {
    ...stated,
    getEvidenceSource: () =>
      Promise.resolve({
        id: document.sourceId,
        sourceType: "DOCUMENT",
        subjectType: "COMPANY",
        subjectId: COMPANY,
        metadata: { documentVersionId: document.documentVersionId },
      } as never),
    createClaim: (command) => {
      written.push(`claim:${command.input.evidenceStatus}`);
      return Promise.resolve({ id: "claim-1" } as never);
    },
    createEvidenceItem: () => {
      written.push("item");
      return Promise.resolve({ id: "item-1" } as never);
    },
    linkClaimEvidence: (command) => {
      written.push(`link:${command.input.relationship}`);
      return Promise.resolve({} as never);
    },
  };
  const own: Partial<AppActionPorts> = {
    ownCompanyId: (actor) =>
      Promise.resolve(actor.userId === founder.userId ? COMPANY : null),
    companyFigures: stated,
    documentFigures: fromDocument,
  };
  return { ports: own as AppActionPorts, written };
}

const context = (actor = founder) => ({
  actor,
  idempotencyKey: "q-key",
  correlationId: "cor_test" as never,
  surface: "Q" as const,
});

describe("a figure from their own document, on the figure card", () => {
  it("is never something the model can propose: the tool has no provenance field", () => {
    const tool = action?.tool;
    expect(tool).toBeDefined();
    expect(
      tool?.input.safeParse({
        metric: "MRR",
        amount: 42000,
        currency: "USD",
        period: "2026-10",
        said: "MRR $42,000 in October 2026",
        document,
      }).success,
    ).toBe(false);
  });

  it("names the document, its page and its words on the card", async () => {
    const { ports: p } = ports();
    const input = await documentFigureCardInput(p, founder, {
      companyId: COMPANY,
      figure,
      document,
    });
    expect(input).not.toBeNull();
    const card = action?.card(input);
    expect(card?.summary).toBe(
      'Keep your MRR of USD 42,000 for October 2026, from "Maji Loop deck" (page 4)',
    );
    expect(card?.preview).toContain('"MRR $42,000 in October 2026"');
    expect(card?.preview).toContain("investors don't see it");
  });

  it("names a different figure already recorded for that date, kept beside it", async () => {
    const { ports: p } = ports([
      {
        id: "earlier",
        claimKey: "financial.mrr",
        lifecycleStatus: "CURRENT",
        validFrom: "2026-10-31T00:00:00.000Z",
        structuredValue: {
          kind: "MONEY",
          amount: "40000",
          currency: "USD",
          asOf: "2026-10-31",
        },
      },
    ]);
    const input = await documentFigureCardInput(p, founder, {
      companyId: COMPANY,
      figure,
      document,
    });
    expect(input?.alongside).toEqual(["USD 40,000 for October 2026"]);
  });

  it("on approval, records a document-supported claim through Evidence", async () => {
    const { ports: p, written } = ports();
    const input = await documentFigureCardInput(p, founder, {
      companyId: COMPANY,
      figure,
      document,
    });
    expect(await action?.authorize(p, context(), input)).toEqual({ ok: true });
    const out = await action?.run(p, context(), input);
    expect(out).toMatchObject({ outcome: "RECORDED", claimId: "claim-1" });
    expect(written).toEqual([
      "claim:DOCUMENT_SUPPORTED",
      "item",
      "link:SUPPORTS",
    ]);
  });

  it("is refused for an investor: figures are recorded for their own company only", async () => {
    const { ports: p, written } = ports();
    const input = await documentFigureCardInput(p, founder, {
      companyId: COMPANY,
      figure,
      document,
    });
    expect(await action?.authorize(p, context(investor), input)).toMatchObject({
      ok: false,
    });
    expect(written).toEqual([]);
  });
});
