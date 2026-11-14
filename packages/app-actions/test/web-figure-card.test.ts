import { describe, expect, it } from "vitest";

import type {
  StatedFigureEvidence,
  WebFigureEvidence,
} from "@capital-q/evidence";
import { ActorContextSchema } from "@capital-q/security";

import {
  APP_ACTIONS,
  webFigureCardInput,
  type AppActionPorts,
} from "../src/index.js";

/**
 * A8, research -> claims: a figure a public page states about a founder's
 * own company is a card on the same declared action (company.figure.record).
 * Only code sets its web provenance; on approval it is recorded through
 * Evidence as their self-reported claim; an investor is never offered it.
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
const SAID = "monthly recurring revenue reached $42,000 in October";
const web = {
  sourceId: "f0000000-0000-4000-8000-000000000001",
  itemId: "f3000000-0000-4000-8000-000000000001",
  url: "https://news.example.com/maji-loop-growth",
  title: "Maji Loop grows",
  publishedOn: "2026-11-03",
  retrievedAt: "2026-11-14T09:00:00.000Z",
};
const figure = {
  metric: "MRR" as const,
  value: { kind: "MONEY" as const, amount: "42000", currency: "USD" },
  asOf: "2026-10-31",
  said: SAID,
};

const action = APP_ACTIONS.find((a) => a.name === "company.figure.record");

function ports() {
  const written: string[] = [];
  const stated: StatedFigureEvidence = {
    listClaims: () => Promise.resolve([]),
    registerEvidenceSource: () => Promise.reject(new Error("not this path")),
    createClaim: () => Promise.reject(new Error("not this path")),
    createEvidenceItem: () => Promise.reject(new Error("not this path")),
    linkClaimEvidence: () => Promise.reject(new Error("not this path")),
  };
  const fromWeb: WebFigureEvidence = {
    ...stated,
    getEvidenceSource: () =>
      Promise.resolve({
        id: web.sourceId,
        sourceType: "PUBLIC_WEB",
        subjectType: "COMPANY",
        subjectId: COMPANY,
        sourceUrl: web.url,
        title: web.title,
        retrievedAt: web.retrievedAt,
        publishedAt: "2026-11-03T00:00:00.000Z",
      } as never),
    getEvidenceItem: () =>
      Promise.resolve({
        id: web.itemId,
        sourceId: web.sourceId,
        summary: `Lagos startup Maji Loop says its ${SAID}.`,
        structuredValue: { extracted: true },
      } as never),
    createClaim: (command) => {
      written.push(
        `claim:${command.input.truthClass}/${command.input.evidenceStatus}`,
      );
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
    webFigures: fromWeb,
  };
  return { ports: own as AppActionPorts, written };
}

const context = (actor = founder) => ({
  actor,
  idempotencyKey: "q-key",
  correlationId: "cor_test" as never,
  surface: "Q" as const,
});

describe("a figure from a public page, on the figure card", () => {
  it("is never something the model can propose: the tool has no provenance field", () => {
    expect(
      action?.tool?.input.safeParse({
        metric: "MRR",
        amount: 42000,
        currency: "USD",
        period: "2026-10",
        said: SAID,
        web,
      }).success,
    ).toBe(false);
  });

  it("names the page, its date and its words, and says it is not verification", async () => {
    const { ports: p } = ports();
    const input = await webFigureCardInput(p, founder, {
      companyId: COMPANY,
      figure,
      web,
    });
    expect(input).not.toBeNull();
    const card = action?.card(input);
    expect(card?.summary).toContain('reported by "Maji Loop grows"');
    expect(card?.summary).toContain("news.example.com, 2026-11-03");
    expect(card?.preview).toContain(`"${SAID}"`);
    expect(card?.preview).toContain(web.url);
    expect(card?.preview).toContain("not verification");
    expect(card?.preview).toContain("investors don't see it");
  });

  it("on approval, records their self-reported claim with the page as provenance", async () => {
    const { ports: p, written } = ports();
    const input = await webFigureCardInput(p, founder, {
      companyId: COMPANY,
      figure,
      web,
    });
    expect(await action?.authorize(p, context(), input)).toEqual({ ok: true });
    const out = await action?.run(p, context(), input);
    expect(out).toMatchObject({ outcome: "RECORDED", claimId: "claim-1" });
    expect(written).toEqual([
      "claim:USER_CLAIM/SELF_REPORTED",
      "item",
      "link:SUPPORTS",
    ]);
  });

  it("is refused for an investor, and writes nothing", async () => {
    const { ports: p, written } = ports();
    const input = await webFigureCardInput(p, founder, {
      companyId: COMPANY,
      figure,
      web,
    });
    expect(await action?.authorize(p, context(investor), input)).toMatchObject({
      ok: false,
    });
    expect(written).toEqual([]);
  });

  it("has one source: a document and a page together do not fit", async () => {
    const { ports: p } = ports();
    const input = await webFigureCardInput(p, founder, {
      companyId: COMPANY,
      figure,
      web,
    });
    expect(
      action?.input.safeParse({
        ...input,
        document: {
          sourceId: web.sourceId,
          documentId: web.itemId,
          documentVersionId: web.itemId,
          page: 1,
          title: "deck",
        },
      }).success,
    ).toBe(false);
  });
});
