import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import {
  ELIGIBILITY_CRITERIA,
  type EligibilityResult,
} from "../src/eligibility/contracts.js";
import type { EligibilityService } from "../src/eligibility/service.js";
import { FEATURE_SCHEMA_VERSION } from "../src/features/contracts.js";
import { RANKER_VERSION } from "../src/ranking/contracts.js";
import {
  decodeSlateCursor,
  encodeSlateCursor,
  SLATE_POLICY_V1,
} from "../src/slates/contracts.js";
import type {
  CompanyCard,
  CompanyCardPort,
  SlateKey,
} from "../src/slates/ports.js";
import {
  createSlateReadService,
  SlateCursorRejectedError,
  type SlateReadServiceDependencies,
} from "../src/slates/reader.js";
import type {
  RefreshRequester,
  RequestRefreshInput,
} from "../src/slates/refresh.js";
import { memorySlates } from "./support/memory-slates.js";

/**
 * Serving a slate over fakes (CQ-REC-006 Checkpoint D): pages follow
 * (slate, rank), the cursor is opaque and never authority, the read-time
 * guard withholds what REC-001 no longer allows, an unservable slate
 * restarts honestly, a missing slate asks for a rebuild, and nothing
 * internal reaches a page.
 */

const MARKER = "REC006_PRIVATE_FOUNDER_DATA_MUST_NOT_CHANGE_SLATE";
const TENANT = "11111111-0000-4000-8000-000000000001";
const ORG = "11111111-0000-4000-8000-000000000002";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const MANDATE = "33333333-0000-4000-8000-000000000031";
const OTHER_INVESTOR = "11111111-0000-4000-8000-000000000014";
const OTHER_MANDATE = "33333333-0000-4000-8000-000000000032";
const COMPANY_TENANT = "22222222-0000-4000-8000-000000000001";
const id = (n: number) =>
  `44444444-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-09-19T12:00:00.000Z");

const actor: ActorContext = {
  userId: "11111111-0000-4000-8000-000000000003",
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "11111111-0000-4000-8000-000000000004",
  actorType: "HUMAN",
};
const KEY: SlateKey = {
  tenantId: TENANT,
  investorOrganisationId: INVESTOR,
  mandateId: MANDATE,
  mode: "INVESTOR_DISCOVER",
};

const VERSIONS = {
  eligibilityPolicyVersion: "eligibility.v2" as const,
  structuredGeneratorVersion: "structured-mandate.v2" as const,
  semanticGeneratorVersion: "semantic-mandate.v1" as const,
  featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  rankerVersion: RANKER_VERSION,
  rankingConfigVersion: "ranking-config.v1",
  taxonomyVersion: null,
};

async function publish(
  store: ReturnType<typeof memorySlates>,
  key: SlateKey,
  count: number,
  options: { readonly expiresAt?: string; readonly publishedAt?: string } = {},
) {
  const slate = await store.repo.beginBuild({
    ...key,
    mandateVersion: 1,
    versions: VERSIONS,
    generatedAt: "2026-09-19T09:00:00.000Z",
  });
  await store.repo.insertItems(
    slate.id,
    key.tenantId,
    Array.from({ length: count }, (_, index) => ({
      companyId: id(index + 1),
      companyTenantId: COMPANY_TENANT,
      rank: index + 1,
      internalScore: 0.9 - index * 0.1,
      reasonCodes: ["STAGE_ALIGNED", "FACTOR_MISSING"],
      featureSnapshotId: "66666666-0000-4000-8000-000000000001",
      featureSnapshotFingerprint: "a".repeat(64),
      candidateProvenance: {
        structured: {
          generatorVersion: "structured-mandate.v2",
          reasonCodes: ["STAGE_OVERLAP"],
        },
        semantic: null,
      },
    })),
  );
  const published = await store.repo.publish(
    { run: () => Promise.reject(new Error("unused")) },
    {
      slateId: slate.id,
      generationFingerprint: "b".repeat(64),
      itemCount: count,
      diagnostics: {
        structuredCandidates: count,
        semanticCandidates: 0,
        semanticUnavailable: false,
        mergedCandidates: count,
        featureSnapshots: count,
        ranked: count,
        scored: count,
        buildDurationMs: 1,
      },
      publishedAt: options.publishedAt ?? "2026-09-19T10:00:00.000Z",
      expiresAt: options.expiresAt ?? "2026-09-20T10:00:00.000Z",
    },
  );
  return published.slate;
}

const eligible = (
  companyId: string,
  decision: EligibilityResult["decision"],
): EligibilityResult => ({
  eligibilityPolicyVersion: "eligibility.v2",
  mode: "INVESTOR_DISCOVER",
  companyId,
  investorOrganisationId: INVESTOR,
  mandateId: MANDATE,
  mandateVersion: 1,
  taxonomyVersion: null,
  decision,
  reasonCodes:
    decision === "ELIGIBLE" ? [] : ["COMPANY_NOT_DISCOVERABLE_BY_INVESTOR"],
  criteria: ELIGIBILITY_CRITERIA.map((criterion) => ({
    criterion,
    outcome: decision === "ELIGIBLE" ? ("PASS" as const) : ("FAIL" as const),
    reasonCode: null,
    detail: null,
  })),
  evaluatedAt: NOW.toISOString(),
});

function harness(
  options: {
    readonly ineligible?: readonly string[];
    readonly requester?: boolean;
    readonly cards?: readonly string[];
    readonly investor?: boolean;
    readonly mandate?: "FOUND" | "NONE";
  } = {},
) {
  const store = memorySlates();
  let now = NOW;
  const evaluated: string[][] = [];
  const eligibility: EligibilityService = {
    evaluate: (query) => {
      evaluated.push([...query.companyIds]);
      return Promise.resolve({
        context: {
          tenantId: TENANT,
          investorOrganisationId: INVESTOR,
          mode: "INVESTOR_DISCOVER",
          mandateId: MANDATE,
          taxonomyVersion: null,
          eligibilityPolicyVersion: "eligibility.v2",
        },
        results: query.companyIds.map((companyId) =>
          eligible(
            companyId,
            (options.ineligible ?? []).includes(companyId)
              ? "INELIGIBLE"
              : "ELIGIBLE",
          ),
        ),
      });
    },
  };
  const cards: CompanyCardPort = {
    cardsByIds: (ids) =>
      Promise.resolve(
        new Map<string, CompanyCard>(
          ids
            .filter(
              (c) => options.cards === undefined || options.cards.includes(c),
            )
            .map((companyId) => [
              companyId,
              {
                companyId,
                canonicalName: `Company ${companyId.slice(-2)}`,
                websiteUrl: null,
                headquartersCountry: "NG",
                currentStageCode: "seed",
                shortDescription: `${MARKER.slice(0, 6)}-free description`,
              },
            ]),
        ),
      ),
  };
  const requested: RequestRefreshInput[] = [];
  const requester: RefreshRequester = {
    request: (input) => {
      requested.push(input);
      return Promise.resolve({
        kind: "ENQUEUED",
        request: {
          id: "77777777-0000-4000-8000-000000000001",
          tenantId: input.tenantId,
          investorOrganisationId: input.investorOrganisationId,
          mandateId: input.mandateId,
          mode: input.mode,
          status: "PENDING",
          priority: input.priority,
          reason: input.reason,
          requestSequence: 1,
          claimedSequence: null,
          attempts: 0,
        },
      });
    },
  };
  const ports: SlateReadServiceDependencies["ports"] = {
    investorSubject: {
      investorOrganisationFor: () =>
        Promise.resolve(
          options.investor === false
            ? null
            : { investorOrganisationId: INVESTOR },
        ),
    },
    mandates: {
      activeMandate: () =>
        Promise.resolve(
          options.mandate === "NONE"
            ? { kind: "NONE" }
            : {
                kind: "FOUND",
                mandate: {
                  mandateId: MANDATE,
                  investorOrganisationId: INVESTOR,
                  version: 1,
                  status: "ACTIVE",
                  constraints: [],
                  taxonomyPreferences: [],
                },
              },
        ),
    },
  };
  const reader = createSlateReadService({
    ports,
    eligibility,
    slates: store.repo,
    cards,
    requester: options.requester === false ? undefined : requester,
    clock: () => now,
  });
  return {
    store,
    reader,
    evaluated,
    requested,
    setNow: (next: Date) => {
      now = next;
    },
  };
}

describe("slate reader (CQ-REC-006)", () => {
  it("pages by (slate, rank) with an opaque continuation key, and exposes cards and public alignment codes only", async () => {
    const h = harness();
    const slate = await publish(h.store, KEY, 5);
    const first = await h.reader.pageCompanies({ actor, limit: 2 });
    expect(first.slateId).toBe(slate.id);
    expect(first.rankingVersion).toBe("ranking-config.v1");
    expect(first.items.map((i) => i.companyId)).toEqual([id(1), id(2)]);
    expect(first.items[0]).toEqual({
      companyId: id(1),
      canonicalName: "Company 01",
      websiteUrl: null,
      headquartersCountry: "NG",
      currentStageCode: "seed",
      shortDescription: "REC006-free description",
      reasonCodes: ["STAGE_ALIGNED"],
    });
    expect(first.notes).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const cursor = decodeSlateCursor(first.nextCursor ?? "");
    expect(cursor).toEqual({ v: 1, slateId: slate.id, afterRank: 2 });
    // Nothing internal, whatever the shape of the page.
    const text = JSON.stringify(first);
    for (const forbidden of [
      "internalScore",
      "featureSnapshot",
      "candidateProvenance",
      "fingerprint",
      "FACTOR_MISSING",
      'rank"',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toContain(MARKER);

    const second = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((i) => i.companyId)).toEqual([id(3), id(4)]);
    const third = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.items.map((i) => i.companyId)).toEqual([id(5)]);
    expect(third.nextCursor).toBeNull();
    // Page size is bounded by the policy, never by the caller.
    const big = await h.reader.pageCompanies({ actor, limit: 999 });
    expect(big.items.length).toBe(5);
    expect(
      h.evaluated.every((ids) => ids.length <= SLATE_POLICY_V1.pageSizeMax),
    ).toBe(true);
    // One eligibility batch per page.
    expect(h.evaluated.length).toBe(4);
  });

  it("the read-time guard withholds a company REC-001 no longer allows, and one without a declared card", async () => {
    const h = harness({ ineligible: [id(2)], cards: [id(1), id(2), id(4)] });
    await publish(h.store, KEY, 4);
    const page = await h.reader.pageCompanies({ actor, limit: 4 });
    expect(page.items.map((i) => i.companyId)).toEqual([id(1), id(4)]);
    expect(page.nextCursor).toBeNull();
    // The guard saw the whole page: withholding is a filter, not a re-rank.
    expect(h.evaluated[0]).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it("a cursor is not authority: another investor's slate, a forged value and a stale format are all refused alike", async () => {
    const h = harness();
    await publish(h.store, KEY, 2);
    const theirs = await publish(
      h.store,
      {
        ...KEY,
        investorOrganisationId: OTHER_INVESTOR,
        mandateId: OTHER_MANDATE,
      },
      2,
    );
    await expect(
      h.reader.pageCompanies({
        actor,
        cursor: encodeSlateCursor({ v: 1, slateId: theirs.id, afterRank: 1 }),
      }),
    ).rejects.toBeInstanceOf(SlateCursorRejectedError);
    await expect(
      h.reader.pageCompanies({ actor, cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(SlateCursorRejectedError);
    await expect(
      h.reader.pageCompanies({
        actor,
        cursor: Buffer.from(
          JSON.stringify({ v: 2, slateId: theirs.id, afterRank: 0 }),
        ).toString("base64url"),
      }),
    ).rejects.toBeInstanceOf(SlateCursorRejectedError);
    await expect(
      h.reader.pageCompanies({
        actor,
        cursor: encodeSlateCursor({
          v: 1,
          slateId: "99999999-0000-4000-8000-000000000001",
          afterRank: 0,
        }),
      }),
    ).rejects.toBeInstanceOf(SlateCursorRejectedError);
    expect(h.requested).toEqual([]);
  });

  it("a superseded slate keeps serving its remaining pages; an invalidated one restarts from the current slate and says so", async () => {
    const h = harness();
    const old = await publish(h.store, KEY, 4);
    const first = await h.reader.pageCompanies({ actor, limit: 2 });
    const fresh = await publish(h.store, KEY, 3);
    expect((await h.store.repo.findById(old.id))?.status).toBe("SUPERSEDED");
    // The reader keeps the old ordering for the client mid-scroll.
    const continued = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(continued.slateId).toBe(old.id);
    expect(continued.items.map((i) => i.companyId)).toEqual([id(3), id(4)]);
    expect(continued.notes).toEqual([]);
    // A fresh start serves the new slate.
    expect((await h.reader.pageCompanies({ actor, limit: 2 })).slateId).toBe(
      fresh.id,
    );

    await h.store.repo.invalidate(
      fresh.id,
      "MANDATE_HARD_CHANGED",
      NOW.toISOString(),
    );
    // The superseded slate is still inside its expiry: still servable.
    const restarted = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(restarted.slateId).toBe(old.id);
    // Past the old slate's expiry the cursor names nothing servable: the
    // page restarts from whatever is current and says so.
    h.setNow(new Date("2026-09-21T12:00:00.000Z"));
    const rebuilt = await publish(h.store, KEY, 1, {
      publishedAt: "2026-09-21T11:00:00.000Z",
      expiresAt: "2026-09-22T11:00:00.000Z",
    });
    const after = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(after.notes).toEqual(["SLATE_RESTARTED"]);
    expect(after.slateId).toBe(rebuilt.id);
    expect(after.items.map((i) => i.companyId)).toEqual([id(1)]);
  });

  it("no servable slate: an empty page that says a rebuild was requested, once per page, and an expired slate is not served", async () => {
    const h = harness();
    const none = await h.reader.pageCompanies({ actor });
    expect(none).toEqual({
      slateId: null,
      rankingVersion: "ranking-config.v1",
      items: [],
      notes: ["RECOMMENDATIONS_REFRESHING"],
      nextCursor: null,
    });
    expect(h.requested).toHaveLength(1);
    expect(h.requested[0]).toMatchObject({
      ...KEY,
      reason: "NO_CURRENT_SLATE",
      priority: "NORMAL",
    });

    await publish(h.store, KEY, 2, { expiresAt: "2026-09-19T11:00:00.000Z" });
    const expired = await h.reader.pageCompanies({ actor });
    expect(expired.slateId).toBeNull();
    expect(expired.notes).toEqual(["RECOMMENDATIONS_REFRESHING"]);
    expect(h.requested[1]).toMatchObject({ reason: "SLATE_EXPIRED" });

    // Without a requester the page is still honest.
    const quiet = harness({ requester: false });
    expect((await quiet.reader.pageCompanies({ actor })).notes).toEqual([
      "RECOMMENDATIONS_REFRESHING",
    ]);
    expect(quiet.requested).toEqual([]);
  });

  it("an empty slate is a valid answer, and no mandate or no investor organisation is not a slate", async () => {
    const h = harness();
    const empty = await publish(h.store, KEY, 0);
    const page = await h.reader.pageCompanies({ actor });
    expect(page.slateId).toBe(empty.id);
    expect(page.items).toEqual([]);
    expect(page.notes).toEqual(["NO_DISCOVERABLE_COUNTERPARTS"]);
    expect(h.evaluated).toEqual([]);

    const noMandate = harness({ mandate: "NONE" });
    expect((await noMandate.reader.pageCompanies({ actor })).notes).toEqual([
      "NO_ACTIVE_MANDATE",
    ]);
    const founder = harness({ investor: false });
    expect((await founder.reader.pageCompanies({ actor })).notes).toEqual([
      "NO_ACTIVE_MANDATE",
    ]);
    expect(noMandate.requested).toEqual([]);
  });
});
