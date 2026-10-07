import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  type DeckCoaching,
  type DeckSectionReading,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createCompanyDeckService,
  type CompanyDeckReading,
  type DeckSectionReview,
} from "../src/index.js";

/**
 * F26: a founder reviews Q's reading one section at a time (confirm, "this
 * is wrong", or their own words), the rest can still be confirmed, and an
 * investor sees only what the founder confirmed or wrote. "Read again" is
 * owner-only, bound to the reading on screen, and capped at two.
 */

const COMPANY = "00000000-0000-4000-8000-0000000019c1";
const ORG = "00000000-0000-4000-8000-0000000019a0";
const DOC = "00000000-0000-4000-8000-0000000019d1";
const EXTRACTION = "00000000-0000-4000-8000-0000000019e1";

const actor = (userId: string, organisationId: string) =>
  ({
    userId,
    organisationId,
    tenantId: "t",
    actorType: "HUMAN",
  }) as unknown as ActorContext;
const founder = actor("00000000-0000-4000-8000-0000000019a1", ORG);
const investor = actor("00000000-0000-4000-8000-0000000019b1", "inv-org");

const section = (code: (typeof DECK_SECTIONS)[number]): DeckSectionReading => ({
  section: code,
  status: code === "BUSINESS_MODEL" ? "CONTRADICTORY" : "PRESENT",
  summary:
    code === "BUSINESS_MODEL"
      ? "Most slides state a 1.4% fee, while slide 8 states 4%."
      : "What the deck says.",
  pages: [8],
  facts:
    code === "BUSINESS_MODEL"
      ? [
          {
            label: "Fee",
            value: "1.4%",
            unknownReason: null,
            kind: "FIGURE",
            asOf: null,
            pages: [8],
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            confidence: "MEDIUM",
          },
          {
            label: "Fee (slide 8)",
            value: null,
            unknownReason: "CONTRADICTORY",
            kind: "FIGURE",
            asOf: null,
            pages: [8],
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            confidence: "LOW",
          },
        ]
      : [],
  confidence: "MEDIUM",
  criteria: { clear: true, strong: false, exceptional: false, note: null },
});

function world() {
  const reviews: DeckSectionReview[] = [];
  let confirmed = false;
  let used = 0;
  let pending = false;
  const audits: string[] = [];
  const reading = (): CompanyDeckReading => ({
    id: EXTRACTION,
    documentId: DOC,
    documentVersionId: "v1",
    pageCount: 12,
    sections: DECK_SECTIONS.map(section),
    createdAt: "2026-10-07T09:00:00.000Z",
    confirmed,
    readingNumber: 1,
    setAside: [],
    reviews: [...reviews],
    readAgain: { used, pending },
  });
  const tx = { sql: {} } as unknown as TransactionContext;
  const service = createCompanyDeckService({
    sql: {} as DatabaseExecutor,
    transactions: { run: (work) => work(tx) },
    store: {
      currentDeck: () =>
        Promise.resolve({
          documentId: DOC,
          tenantId: "t",
          title: "Mizan deck",
          versionId: "v1",
          versionNumber: 1,
          uploadedAt: "2026-10-07T08:00:00.000Z",
          downloadAudience: "ORGANISATION",
          scanned: true,
          level: "PUBLIC",
        }),
      extractionFor: () => Promise.resolve(reading()),
      confirmExtraction: () => {
        confirmed = true;
        return Promise.resolve(true);
      },
      reviewSection: (_tx, input) => {
        reviews.push({
          section: input.section,
          action: input.action,
          correction: input.correction,
        });
        return Promise.resolve();
      },
      requestReadAgain: () => {
        if (used >= 2) return Promise.resolve(false);
        used += 1;
        pending = true;
        return Promise.resolve(true);
      },
    },
    company: (id) =>
      Promise.resolve(
        id === COMPANY
          ? {
              id,
              tenantId: "t",
              organisationId: ORG,
              name: "Mizan",
              stageCode: "seed",
              countryCode: "NG",
            }
          : null,
      ),
    isInvestor: (who) => Promise.resolve(who === investor),
    investorMayFind: () => Promise.resolve(true),
    ownerMayManage: () => Promise.resolve(true),
    sharedWithActor: () => Promise.resolve(false),
    coach: () => ({ rubricVersion: 1 }) as unknown as DeckCoaching,
    signedInline: () =>
      Promise.resolve({ url: "https://x", expiresAt: "2026-10-07T10:00:00Z" }),
    nameOf: () => Promise.resolve(null),
    audit: {
      record: (_tx: unknown, entry: { actionType: string }) => {
        audits.push(entry.actionType);
        return Promise.resolve();
      },
    } as never,
    newCorrelationId: () => "cor" as never,
  });
  return {
    service,
    audits,
    finish: () => {
      pending = false;
    },
  };
}

const ids = { companyId: COMPANY, documentId: DOC, extractionId: EXTRACTION };

describe("reviewing the deck reading section by section (F26)", () => {
  it("dismisses the false contradiction, confirms the rest, and the investor sees only what was confirmed", async () => {
    const { service, audits } = world();
    expect((await service.view(investor, COMPANY))?.extraction).toBeNull();

    const dismissed = await service.reviewSection({
      actor: founder,
      ...ids,
      section: "BUSINESS_MODEL",
      action: "DISMISS",
      correction: null,
    });
    expect(dismissed).toMatchObject({
      outcome: "OK",
      value: { state: "DISMISSED" },
    });
    await service.confirm({ actor: founder, ...ids });

    const owner = await service.view(founder, COMPANY);
    expect(owner?.extraction?.confirmed).toBe(true);
    expect(
      owner?.extraction?.sectionStates?.find(
        (s) => s.section === "BUSINESS_MODEL",
      )?.state,
    ).toBe("DISMISSED");

    const seen = await service.view(investor, COMPANY);
    const model = seen?.extraction?.sections.find(
      (s) => s.section === "BUSINESS_MODEL",
    );
    expect(model?.status).toBe("UNCLEAR");
    expect(model?.summary).toBeNull();
    expect(
      seen?.extraction?.sections.find((s) => s.section === "TRACTION")?.status,
    ).toBe("PRESENT");
    expect(seen?.extraction?.setAside).toBeUndefined();
    expect(audits).toContain("deck.section_reviewed");
  });

  it("a correction is the founder's words, without Q's contradiction", async () => {
    const { service } = world();
    await service.reviewSection({
      actor: founder,
      ...ids,
      section: "BUSINESS_MODEL",
      action: "CORRECT",
      correction: "A 1.4% fee on each financing.",
    });
    const seen = await service.view(investor, COMPANY);
    const model = seen?.extraction?.sections.find(
      (s) => s.section === "BUSINESS_MODEL",
    );
    expect(model).toMatchObject({
      status: "PRESENT",
      summary: "A 1.4% fee on each financing.",
    });
    expect(model?.facts.map((f) => f.value)).toEqual(["1.4%"]);
    // Only that section was reviewed: the rest stay unknown to investors.
    expect(
      seen?.extraction?.sections.find((s) => s.section === "TRACTION")?.status,
    ).toBe("UNCLEAR");
  });

  it("only the owner reviews", async () => {
    const { service } = world();
    expect(
      await service.reviewSection({
        actor: investor,
        ...ids,
        section: "TRACTION",
        action: "CONFIRM",
        correction: null,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
  });

  it("Read again: bound to the reading on screen, idempotent while waiting, two per version", async () => {
    const { service, audits, finish } = world();
    expect(
      await service.readAgain({ actor: founder, ...ids, extractionId: DOC }),
    ).toEqual({ outcome: "REFUSED", code: "STALE" });
    expect(await service.readAgain({ actor: founder, ...ids })).toEqual({
      outcome: "OK",
      value: { requested: true, left: 1 },
    });
    // A second press while the first waits spends nothing.
    expect(await service.readAgain({ actor: founder, ...ids })).toEqual({
      outcome: "OK",
      value: { requested: true, left: 1 },
    });
    finish();
    expect(await service.readAgain({ actor: founder, ...ids })).toEqual({
      outcome: "OK",
      value: { requested: true, left: 0 },
    });
    finish();
    expect(await service.readAgain({ actor: founder, ...ids })).toEqual({
      outcome: "REFUSED",
      code: "LIMIT",
    });
    expect(
      audits.filter((a) => a === "deck.read_again_requested"),
    ).toHaveLength(2);
    expect(
      (await service.view(founder, COMPANY))?.extraction?.readAgain,
    ).toEqual({ left: 0, pending: false });
  });
});
