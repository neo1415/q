import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  type DeckCoaching,
  type DeckSectionReading,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createCompanyDeckService,
  type CompanyDeckRecord,
  type CompanyDeckReading,
} from "../src/index.js";

/**
 * Overnight A4-A6: the pitch-deck tab. Who sees the deck, whether it
 * downloads, that Q's sections reach an investor only once the founder
 * confirmed them (the Write Gate) and never with the rubric, and that the
 * coaching is the owner's alone.
 */

const COMPANY = "00000000-0000-4000-8000-0000000009c1";
const ORG = "00000000-0000-4000-8000-0000000009a0";
const DOC = "00000000-0000-4000-8000-0000000009d1";
const EXTRACTION = "00000000-0000-4000-8000-0000000009e1";
const NOW = "2026-10-06T09:00:00.000Z" as UtcTimestamp;

const actor = (userId: string, organisationId: string) =>
  ({
    userId,
    organisationId,
    tenantId: "t",
    actorType: "HUMAN",
  }) as unknown as ActorContext;
const founder = actor("00000000-0000-4000-8000-0000000009a1", ORG);
const investor = actor("00000000-0000-4000-8000-0000000009b1", "inv-org");
const stranger = actor("00000000-0000-4000-8000-0000000009b2", "other-org");
const founderElsewhere = actor(
  "00000000-0000-4000-8000-0000000009b3",
  "founder-org",
);

const reading = (
  section: (typeof DECK_SECTIONS)[number],
): DeckSectionReading => ({
  section,
  status: "PRESENT",
  summary: "What the deck says.",
  pages: [2],
  facts: [],
  confidence: "MEDIUM",
  criteria: {
    clear: true,
    strong: false,
    exceptional: false,
    note: "Private coaching note",
  },
});

function world(deck: Partial<CompanyDeckRecord> = {}, confirmed = false) {
  const record: CompanyDeckRecord = {
    documentId: DOC,
    tenantId: "t",
    title: "Kora Health deck",
    versionId: "v3",
    versionNumber: 3,
    uploadedAt: "2026-09-28T10:00:00.000Z",
    downloadAudience: "ORGANISATION",
    scanned: true,
    level: "PUBLIC",
    ...deck,
  };
  let isConfirmed = confirmed;
  const audits: string[] = [];
  const extraction = (): CompanyDeckReading => ({
    id: EXTRACTION,
    documentId: DOC,
    documentVersionId: "v3",
    pageCount: 14,
    sections: DECK_SECTIONS.map(reading),
    createdAt: "2026-09-28T11:00:00.000Z",
    confirmed: isConfirmed,
  });
  const tx = { sql: {} } as unknown as TransactionContext;
  const service = createCompanyDeckService({
    sql: {} as DatabaseExecutor,
    transactions: { run: (work) => work(tx) },
    store: {
      currentDeck: () => Promise.resolve(record),
      extractionFor: () => Promise.resolve(extraction()),
      confirmExtraction: () => {
        const was = isConfirmed;
        isConfirmed = true;
        return Promise.resolve(!was);
      },
    },
    company: (id) =>
      Promise.resolve(
        id === COMPANY
          ? {
              id,
              tenantId: "t",
              organisationId: ORG,
              name: "Kora Health",
              stageCode: "seed",
              countryCode: "NG",
            }
          : null,
      ),
    isInvestor: (who) => Promise.resolve(who === investor || who === stranger),
    investorMayFind: (who) => Promise.resolve(who === investor),
    ownerMayManage: () => Promise.resolve(true),
    sharedWithActor: () => Promise.resolve(false),
    coach: () => ({ rubricVersion: 1 }) as unknown as DeckCoaching,
    signedInline: () =>
      Promise.resolve({ url: "https://storage.example/deck", expiresAt: NOW }),
    nameOf: () => Promise.resolve("Daniel Reyes"),
    audit: {
      record: (_tx: unknown, entry: { actionType: string }) => {
        audits.push(entry.actionType);
        return Promise.resolve();
      },
    } as never,
    newCorrelationId: () => "cor",
    now: () => NOW,
  });
  return { service, audits };
}

describe("the pitch-deck tab", () => {
  it("shows a public deck view-only to an investor who can find the company, with their name over it", async () => {
    const { service } = world();
    const view = await service.view(investor, COMPANY);
    expect(view?.deck).toMatchObject({
      downloadable: false,
      versionNumber: 3,
      pageCount: 14,
    });
    expect(await service.open(investor, COMPANY)).toMatchObject({
      downloadable: false,
      watermark: "Daniel Reyes · 2026-10-06 · view only",
    });
  });

  it("lets it download only where the founder chose so (ADR 0041)", async () => {
    const { service } = world({
      downloadAudience: "INVESTORS",
      level: "PRIVATE",
    });
    expect((await service.view(investor, COMPANY))?.deck?.downloadable).toBe(
      true,
    );
    expect(await service.open(investor, COMPANY)).toMatchObject({
      downloadable: true,
      watermark: null,
    });
  });

  it("shows no deck where the founder kept it private, and nothing at all to anyone the pitch rule does not admit", async () => {
    const { service } = world({ level: "PRIVATE" });
    expect((await service.view(investor, COMPANY))?.deck).toBeNull();
    expect(await service.open(investor, COMPANY)).toBeNull();
    expect(await service.view(stranger, COMPANY)).toBeNull();
    expect(await service.view(founderElsewhere, COMPANY)).toBeNull();
  });

  it("keeps Q's reading from investors until the founder confirms it (Write Gate), and never sends the rubric", async () => {
    const { service, audits } = world();
    expect((await service.view(investor, COMPANY))?.extraction).toBeNull();
    const own = await service.view(founder, COMPANY);
    expect(own?.extraction?.confirmed).toBe(false);
    expect(own?.coaching).not.toBeNull();
    // A stale reading cannot be confirmed.
    expect(
      await service.confirm({
        actor: founder,
        companyId: COMPANY,
        documentId: DOC,
        extractionId: "00000000-0000-4000-8000-0000000009ef",
      }),
    ).toEqual({ outcome: "REFUSED", code: "STALE" });
    expect(
      await service.confirm({
        actor: investor,
        companyId: COMPANY,
        documentId: DOC,
        extractionId: EXTRACTION,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    expect(
      (
        await service.confirm({
          actor: founder,
          companyId: COMPANY,
          documentId: DOC,
          extractionId: EXTRACTION,
        })
      ).outcome,
    ).toBe("OK");
    expect(audits).toEqual(["deck.extraction_confirmed"]);
    const after = await service.view(investor, COMPANY);
    expect(after?.extraction?.sections).toHaveLength(12);
    expect(after?.coaching).toBeNull();
    expect(JSON.stringify(after)).not.toContain("criteria");
    expect(JSON.stringify(after)).not.toContain("Private coaching note");
  });
});
