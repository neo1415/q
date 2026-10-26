import { describe, expect, it } from "vitest";

import { DECK_SECTIONS, type UtcTimestamp } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createCompanyDeckService,
  type CompanyDeckRecord,
} from "../src/index.js";

/**
 * Coordinator 2026-10-26 (fit_top_candidates still ~800 round trips): the
 * fit read each shown company's deck one by one, and each asked the
 * investor's findability alone (a subject, a mandate and an eligibility
 * evaluation per company). `views` asks it once for all of them, and
 * decides exactly as `view` does company by company: owner, investor who
 * can find it, investor who cannot, a founder elsewhere, a deck shared or
 * not, no deck, no company.
 */

const NOW = "2026-10-06T09:00:00.000Z" as UtcTimestamp;
const OWN_ORG = "00000000-0000-4000-8000-0000000009a0";
const id = (n: number) => `00000000-0000-4000-8000-0000000009c${String(n)}`;
const C = {
  own: id(1),
  ownUnmanaged: id(2),
  publicDeck: id(3),
  privateDeck: id(4),
  sharedDeck: id(5),
  downloadable: id(6),
  notFindable: id(7),
  noDeck: id(8),
  unknown: id(9),
};
const ALL = Object.values(C);

const actor = (userId: string, organisationId: string) =>
  ({ userId, organisationId, tenantId: "t", actorType: "HUMAN" }) as never;
const founder: ActorContext = actor(
  "00000000-0000-4000-8000-0000000009a1",
  OWN_ORG,
);
const investor: ActorContext = actor(
  "00000000-0000-4000-8000-0000000009b1",
  "inv-org",
);
const stranger: ActorContext = actor(
  "00000000-0000-4000-8000-0000000009b2",
  "other-org",
);
const founderElsewhere: ActorContext = actor(
  "00000000-0000-4000-8000-0000000009b3",
  "founder-org",
);

function deckOf(companyId: string): CompanyDeckRecord | null {
  if (companyId === C.noDeck) return null;
  return {
    documentId: `doc-${companyId}`,
    tenantId: "t",
    title: "Deck",
    versionId: `v-${companyId}`,
    versionNumber: 2,
    uploadedAt: "2026-09-28T10:00:00.000Z",
    downloadAudience:
      companyId === C.downloadable ? "INVESTORS" : "ORGANISATION",
    scanned: true,
    level:
      companyId === C.privateDeck ||
      companyId === C.sharedDeck ||
      companyId === C.downloadable
        ? "PRIVATE"
        : "PUBLIC",
  };
}

function world(options: { batched: boolean; amongFails?: boolean }) {
  const calls = { one: 0, among: 0 };
  // The one rule both forms ask: the investor finds every company but one.
  const finds = (who: ActorContext, companyId: string) =>
    who === investor && companyId !== C.notFindable;
  const service = createCompanyDeckService({
    sql: {} as DatabaseExecutor,
    transactions: {
      run: (work) => work({ sql: {} } as never),
    },
    store: {
      currentDeck: (_sql, companyId) => Promise.resolve(deckOf(companyId)),
      extractionFor: (_sql, versionId) =>
        Promise.resolve({
          id: `x-${versionId}`,
          documentId: "d",
          documentVersionId: versionId,
          pageCount: 10,
          sections: DECK_SECTIONS.map((section) => ({
            section,
            status: "PRESENT" as const,
            summary: "What the deck says.",
            pages: [2],
            facts: [],
            confidence: "MEDIUM" as const,
            criteria: {
              clear: true,
              strong: false,
              exceptional: false,
              note: "Private coaching note",
            },
          })),
          createdAt: "2026-09-28T11:00:00.000Z",
          confirmed: true,
        }),
      confirmExtraction: () => Promise.resolve(false),
    },
    company: (companyId) =>
      Promise.resolve(
        companyId === C.unknown
          ? null
          : {
              id: companyId,
              tenantId: "t",
              organisationId:
                companyId === C.own || companyId === C.ownUnmanaged
                  ? OWN_ORG
                  : `org-${companyId}`,
              name: "Company",
              stageCode: "seed",
              countryCode: "NG",
            },
      ),
    isInvestor: (who) => Promise.resolve(who === investor || who === stranger),
    investorMayFind: (who, companyId) => {
      calls.one += 1;
      return Promise.resolve(finds(who, companyId));
    },
    ...(options.batched
      ? {
          investorMayFindAmong: (who: ActorContext, ids: readonly string[]) => {
            calls.among += 1;
            return options.amongFails === true
              ? Promise.reject(new Error("down"))
              : Promise.resolve(new Set(ids.filter((c) => finds(who, c))));
          },
        }
      : {}),
    ownerMayManage: (_who, company) =>
      Promise.resolve(company.id !== C.ownUnmanaged),
    sharedWithActor: (_who, companyId) =>
      Promise.resolve(companyId === C.sharedDeck),
    coach: () => ({ rubricVersion: 1 }) as never,
    signedInline: () =>
      Promise.resolve({ url: "https://storage.example/deck", expiresAt: NOW }),
    nameOf: () => Promise.resolve("Reader"),
    audit: { record: () => Promise.resolve() } as never,
    newCorrelationId: () => "cor",
    now: () => NOW,
  });
  return { service, calls };
}

const oneByOne = async (
  service: ReturnType<typeof world>["service"],
  who: ActorContext,
) =>
  new Map(
    await Promise.all(
      ALL.map(
        async (companyId) =>
          [companyId, await service.view(who, companyId)] as const,
      ),
    ),
  );

describe("the decks of many companies, read together, decide as one by one", () => {
  for (const [label, who] of [
    ["an investor", investor],
    ["an investor who finds none", stranger],
    ["their own founder", founder],
    ["a founder elsewhere", founderElsewhere],
  ] as const) {
    it(`${label}: every company's view is the one view gives`, async () => {
      const { service } = world({ batched: true });
      expect(await service.views(who, ALL)).toEqual(
        await oneByOne(service, who),
      );
    });
  }

  it("an investor's findability is asked once for all of them", async () => {
    const { service, calls } = world({ batched: true });
    const views = await service.views(investor, ALL);
    expect(calls).toEqual({ one: 0, among: 1 });
    // What each answer is, so equality above is not two empty maps.
    expect(views.get(C.publicDeck)?.deck).not.toBeNull();
    expect(views.get(C.sharedDeck)?.deck).not.toBeNull();
    expect(views.get(C.downloadable)?.deck?.downloadable).toBe(true);
    expect(views.get(C.privateDeck)?.deck).toBeNull();
    expect(views.get(C.notFindable)).toBeNull();
    expect(views.get(C.unknown)).toBeNull();
  });

  it("without the batched rule, each is asked alone and the answers are the same", async () => {
    const batched = world({ batched: true });
    const alone = world({ batched: false });
    expect(await alone.service.views(investor, ALL)).toEqual(
      await batched.service.views(investor, ALL),
    );
    expect(alone.calls.one).toBeGreaterThan(0);
  });

  it("a failed findability read shows none of the companies (privacy wins)", async () => {
    const { service } = world({ batched: true, amongFails: true });
    const views = await service.views(investor, ALL);
    for (const companyId of ALL) {
      expect(views.get(companyId), companyId).toBeNull();
    }
  });
});
