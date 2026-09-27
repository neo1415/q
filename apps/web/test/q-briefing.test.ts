import { afterEach, describe, expect, it, vi } from "vitest";

import {
  composeBriefing,
  MAX_BRIEFING_ITEMS,
  type BriefingFacts,
} from "../src/features/home/briefing";
import {
  readBriefingFacts,
  type BriefingReads,
} from "../src/features/home/briefing-facts";
import {
  decideBriefing,
  resetBriefingDecisions,
} from "../src/features/home/briefing-gate";

/**
 * Q's briefing on arrival (R35): composed by code from authorised reads,
 * per role, with nothing when there is nothing, and never a founder's
 * private facts in an investor's briefing.
 */

const NOW = new Date("2026-09-27T09:00:00.000Z");
const SINCE = "2026-09-20T09:00:00.000Z";
const RECENT = "2026-09-26T12:00:00.000Z";
const OLD = "2026-08-01T12:00:00.000Z";
const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY = "12121212-1212-4121-8121-121212121212";
const INVESTOR_ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const APPROVAL = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";
const REL = "66666666-6666-4666-8666-666666666666";
const INTEREST = "77777777-7777-4777-8777-777777777777";

/** Founder-private material: must never reach an investor's briefing. */
const PRIVATE = "FOUNDER_PRIVATE_MARKER_runway_14_months";

function relationship(
  overrides: Partial<{
    state: "DISCOVERED" | "INTEREST_EXPRESSED" | "CONNECTED" | "DECLINED";
    stateSince: string;
    kind: "COMPANY" | "INVESTOR_ORGANISATION";
    id: string;
    name: string;
  }> = {},
) {
  return {
    relationshipId: REL,
    counterpart: {
      kind: overrides.kind ?? "COMPANY",
      id: overrides.id ?? COMPANY,
      name: overrides.name ?? "Acme Robotics",
    },
    state: overrides.state ?? "CONNECTED",
    stateSince: overrides.stateSince ?? RECENT,
    nextStep: "SCHEDULE_MEETING" as const,
  };
}

function reads(overrides: Partial<BriefingReads> = {}) {
  const calls: string[] = [];
  const track =
    <T>(name: string, value: () => Promise<T>) =>
    () => {
      calls.push(name);
      return value();
    };
  const all: BriefingReads = {
    pendingApprovals: track("pendingApprovals", () =>
      Promise.resolve({ contractVersion: 1 as const, items: [] }),
    ),
    investorRelationships: track("investorRelationships", () =>
      Promise.resolve({ items: [] }),
    ),
    companyRelationships: track("companyRelationships", () =>
      Promise.resolve({ items: [] }),
    ),
    incomingInterest: track("incomingInterest", () =>
      Promise.resolve({ items: [] }),
    ),
    readiness: track("readiness", () =>
      Promise.reject(new Error("not assessed")),
    ),
    companySlate: track("companySlate", () =>
      Promise.resolve({
        slateId: null,
        rankingVersion: "v1",
        items: [],
        notes: [],
        nextCursor: null,
      }),
    ),
    setupNudge: track("setupNudge", () => Promise.resolve({ nudge: null })),
    ...overrides,
  };
  return { reads: all, calls };
}

describe("composeBriefing", () => {
  it("is nothing when there is nothing (no filler)", () => {
    expect(composeBriefing({ role: "FOUNDER", since: SINCE })).toBeNull();
    expect(
      composeBriefing({
        role: "INVESTOR",
        since: SINCE,
        approvals: [],
        relationships: [],
        pitches: [],
        mandate: "ACTIVE",
      }),
    ).toBeNull();
    // A read that failed (absent) says nothing either way.
    expect(
      composeBriefing({
        role: "INVESTOR",
        since: SINCE,
        pitches: [{ companyId: COMPANY, name: "Acme" }],
      }),
    ).toBeNull();
  });

  it("founder: what needs them first, then what changed, then gaps; each card a real page", () => {
    const facts: BriefingFacts = {
      role: "FOUNDER",
      since: SINCE,
      approvals: [
        {
          approvalId: APPROVAL,
          summary: "Make your company visible to investors",
          conversationId: CONVERSATION,
        },
      ],
      interest: [{ interestId: INTEREST, investorName: "Northwind Capital" }],
      relationships: [
        {
          relationshipId: REL,
          counterpartName: "Harbour Ventures",
          counterpartId: INVESTOR_ORG,
          href: `/relationships/investor/${INVESTOR_ORG}`,
          state: "CONNECTED",
          stateSince: RECENT,
        },
        {
          relationshipId: "old",
          counterpartName: "Old Fund",
          counterpartId: "x",
          href: "/relationships/investor/x",
          state: "CONNECTED",
          stateSince: OLD,
        },
      ],
      readinessGaps: [
        {
          requirement: "DISCOVERY_VISIBILITY_CONFIRMED",
          description: "Confirm who can discover your company.",
          href: "/company/visibility",
        },
      ],
    };
    const briefing = composeBriefing(facts);
    expect(briefing?.line).toBe("A few things need you.");
    expect(briefing?.items.map((i) => [i.title, i.href])).toEqual([
      ["Waiting for your approval", `/home?c=${CONVERSATION}`],
      ["Northwind Capital expressed interest", "/company/interest"],
      [
        "You're connected with Harbour Ventures",
        `/relationships/investor/${INVESTOR_ORG}`,
      ],
      ["One step before investors can find you", "/company/visibility"],
    ]);
    expect(briefing?.spoken).toBe(
      "A few things need you. Waiting for your approval. Northwind Capital expressed interest. You're connected with Harbour Ventures.",
    );
  });

  it("investor: relationship news, then pitches not yet acted on, then the mandate", () => {
    const briefing = composeBriefing({
      role: "INVESTOR",
      since: SINCE,
      approvals: [],
      relationships: [
        {
          relationshipId: REL,
          counterpartName: "Acme Robotics",
          counterpartId: COMPANY,
          href: `/relationships/company/${COMPANY}`,
          state: "DECLINED",
          stateSince: RECENT,
        },
      ],
      pitches: [
        { companyId: COMPANY, name: "Acme Robotics" },
        { companyId: OTHER_COMPANY, name: "Beacon Health" },
      ],
      mandate: "NO_PREFERENCES",
    });
    expect(briefing?.line).toBe("Here's what changed this week.");
    expect(briefing?.items.map((i) => i.title)).toEqual([
      "Acme Robotics didn't take it forward",
      // Acme already has a relationship: only Beacon is new to them.
      "A pitch from Beacon Health",
      "Your mandate has no preferences yet",
    ]);
    expect(briefing?.items.map((i) => i.href)).toEqual([
      `/relationships/company/${COMPANY}`,
      "/discover",
      "/profile",
    ]);
  });

  it("stays a briefing, not a feed", () => {
    const many = Array.from({ length: 9 }, (_, n) => ({
      relationshipId: `r${String(n)}`,
      counterpartName: `Fund ${String(n)}`,
      counterpartId: `f${String(n)}`,
      href: `/relationships/investor/f${String(n)}`,
      state: "CONNECTED" as const,
      stateSince: RECENT,
    }));
    const briefing = composeBriefing({
      role: "FOUNDER",
      since: SINCE,
      relationships: many,
      interest: [
        { interestId: "a", investorName: "A" },
        { interestId: "b", investorName: "B" },
        { interestId: "c", investorName: "C" },
      ],
      readinessGaps: [
        { requirement: "X", description: "x", href: "/company/x" },
      ],
    });
    expect(briefing?.items.length).toBeLessThanOrEqual(MAX_BRIEFING_ITEMS);
    expect(briefing?.items[0]).toMatchObject({
      title: "3 investors expressed interest",
      description: "A, B and 1 more",
    });
  });
});

describe("readBriefingFacts (authorised reads only)", () => {
  it("founder: reads the company's own inbox, relationships, readiness and approvals", async () => {
    const { reads: r, calls } = reads({
      incomingInterest: () =>
        Promise.resolve({
          items: [
            {
              interestId: INTEREST,
              investorOrganisationId: INVESTOR_ORG,
              investorName: "Northwind Capital",
              investorType: "VC",
              expressedAt: RECENT,
              response: "PENDING",
              respondedAt: null,
              connection: null,
            },
          ],
        }),
    });
    const facts = await readBriefingFacts(
      { kind: "FOUNDER", companyId: COMPANY, label: "Acme" },
      r,
      NOW,
    );
    // (The inbox read is the override above, which is not tracked.)
    expect(new Set(calls)).toEqual(
      new Set([
        "pendingApprovals",
        "companyRelationships",
        "readiness",
        "setupNudge",
      ]),
    );
    expect(calls).not.toContain("investorRelationships");
    expect(calls).not.toContain("companySlate");
    expect(facts).toMatchObject({
      role: "FOUNDER",
      interest: [{ interestId: INTEREST, investorName: "Northwind Capital" }],
      // Readiness failed: absent, not "no gaps".
      readinessGaps: undefined,
    });
  });

  it("NEGATIVE: an investor's briefing never reads founder-private sources, and carries nothing a response smuggles", async () => {
    const leaking = () => Promise.reject(new Error(PRIVATE));
    const { reads: r, calls } = reads({
      // Founder-only reads that would leak if ever called for an investor.
      incomingInterest: vi.fn(leaking),
      readiness: vi.fn(leaking),
      companyRelationships: vi.fn(leaking),
      // The investor's own slate, with a field the contract does not have.
      companySlate: () =>
        Promise.resolve({
          slateId: null,
          rankingVersion: "v1",
          items: [
            {
              companyId: OTHER_COMPANY,
              canonicalName: "Beacon Health",
              websiteUrl: null,
              headquartersCountry: null,
              currentStageCode: null,
              shortDescription: null,
              reasons: [],
              reasonCodes: [],
              pitch: {
                mediaAssetId: RUN,
                aspectRatio: null,
                durationSeconds: 60,
                captionState: "READY",
              },
              founderPrivateNote: PRIVATE,
            } as never,
          ],
          notes: [],
          nextCursor: null,
        }),
      investorRelationships: () =>
        Promise.resolve({
          items: [relationship({ state: "DISCOVERED", stateSince: OLD })],
        }),
    });
    const facts = await readBriefingFacts(
      {
        kind: "INVESTOR",
        investorOrganisationId: INVESTOR_ORG,
        label: "Northwind",
      },
      r,
      NOW,
    );
    expect(calls).not.toContain("incomingInterest");
    expect(calls).not.toContain("readiness");
    expect(calls).not.toContain("companyRelationships");
    expect(r.incomingInterest).not.toHaveBeenCalled();
    expect(r.readiness).not.toHaveBeenCalled();
    expect(r.companyRelationships).not.toHaveBeenCalled();
    expect(facts).not.toBeNull();
    const briefing = composeBriefing(facts as BriefingFacts);
    expect(briefing?.items.map((i) => i.title)).toEqual([
      "A pitch from Beacon Health",
    ]);
    expect(JSON.stringify(facts)).not.toContain(PRIVATE);
    expect(JSON.stringify(briefing)).not.toContain(PRIVATE);
  });

  it("nobody Capital Q knows no side for gets no briefing, and reads nothing", async () => {
    const { reads: r, calls } = reads();
    expect(await readBriefingFacts({ kind: "NONE" }, r, NOW)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("with nothing new, an investor gets no briefing", async () => {
    const { reads: r } = reads();
    const facts = await readBriefingFacts(
      { kind: "INVESTOR", investorOrganisationId: INVESTOR_ORG, label: null },
      r,
      NOW,
    );
    expect(composeBriefing(facts as BriefingFacts)).toBeNull();
  });
});

describe("decideBriefing (once a day, per browser)", () => {
  afterEach(() => {
    resetBriefingDecisions();
    vi.unstubAllGlobals();
  });

  const briefing = composeBriefing({
    role: "FOUNDER",
    since: SINCE,
    interest: [{ interestId: INTEREST, investorName: "Northwind Capital" }],
  });

  it("gives a briefing once, then not again the same day unless something is new", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
    });
    expect(decideBriefing(briefing, NOW)).toBe(briefing);
    // Same page load: the same answer for the cards and the voice.
    expect(decideBriefing(briefing, NOW)).toBe(briefing);
    resetBriefingDecisions();
    // A later visit the same day: already briefed.
    expect(decideBriefing(briefing, NOW)).toBeNull();
    resetBriefingDecisions();
    // The next day: briefed again.
    expect(decideBriefing(briefing, new Date("2026-09-28T08:00:00.000Z"))).toBe(
      briefing,
    );
  });

  it("without storage, still gives it (never lost)", () => {
    expect(decideBriefing(briefing, NOW)).toBe(briefing);
    expect(decideBriefing(null, NOW)).toBeNull();
  });
});
