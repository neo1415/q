import { describe, expect, it } from "vitest";

import {
  ExternalPersonSubjectSchema,
  PersonBriefSchema,
  type ExternalPersonSubject,
  type PersonBrief,
} from "@capital-q/contracts";
import type { KnownEntityRecord } from "@capital-q/q-research";

import {
  buildExternalPersona,
  claimsToBeRealPerson,
  externalLiveInstructions,
  isReported,
} from "../src/composition/external-persona.js";
import {
  briefFromSeed,
  createExternalSubjectResolver,
} from "../src/composition/external-resolve.js";

/**
 * Founder policy 2026-10-10: publicly reported but unconfirmed evidence
 * (search-indexed profiles, third-party reports) is used in the persona,
 * worded softly; only UNKNOWN and contradicted evidence is left out. The
 * persona still never claims to be the person and never quotes them.
 */

const subject: ExternalPersonSubject = ExternalPersonSubjectSchema.parse({
  externalPersonId: "00000000-0000-4000-8000-0000000e0001",
  displayName: "Shadi Qishta",
  nameVariants: [],
  profileUrl: null,
  role: null,
  organization: null,
  location: "Doha, Qatar",
  evidenceBundleId: null,
  briefVersion: 1,
  confidence: "PLAUSIBLE",
});
const source = (i: number, evidenceClass: string | null) => ({
  id: `S0${String(i)}`,
  url: `https://www.linkedin.com/posts/s${String(i)}`,
  domain: "linkedin.com",
  title: `Post ${String(i)}`,
  publishedAt: null,
  retrievedAt: "2026-10-10",
  provider: "search",
  evidenceClass,
});
const a = (
  topic: PersonBrief["assertions"][number]["topic"],
  text: string,
  assertionClass: PersonBrief["assertions"][number]["assertionClass"],
  ref: number,
) => ({ topic, text, assertionClass, sourceRefs: [ref], asOf: null });
const brief = PersonBriefSchema.parse({
  externalPersonId: subject.externalPersonId,
  version: 1,
  builtAt: "2026-10-10",
  freshUntil: "2026-11-10",
  sources: [
    source(0, "third-party public report, verify current role"),
    source(1, "publicly documented"),
    source(2, "publicly documented"),
  ],
  assertions: [
    a(
      "RECURRING_TOPICS",
      "financial transparency and IFRS",
      "PUBLIC_STATEMENT",
      1,
    ),
    a(
      "INVESTMENT_INTERESTS",
      "consumer purchasing power",
      "REASONABLE_INFERENCE",
      0,
    ),
    a("SECTORS", "telecom and AI partnerships", "PUBLIC_STATEMENT", 2),
    a(
      "MARKET_VIEWS",
      "regional ecommerce logistics",
      "VERIFIED_PUBLIC_FACT",
      2,
    ),
    a(
      "PUBLIC_STATEMENTS",
      "a figure later disproved",
      "CONTRADICTORY_OR_STALE",
      1,
    ),
  ],
});
const founder = {
  companyName: "Acme Freight",
  businessText: "Freight software.",
};

describe("unconfirmed evidence is used, softly worded", () => {
  const built = buildExternalPersona({ subject, brief, founder, readBy: 1 });

  it("includes reported and inferred themes, excludes contradicted", () => {
    const texts = built.themes.map((t) => t.text);
    expect(texts).toContain("consumer purchasing power");
    expect(texts).toContain("financial transparency and IFRS");
    expect(texts).not.toContain("a figure later disproved");
  });

  it("marks everything but a self-standing verified fact as reported", () => {
    const byText = new Map(built.themes.map((t) => [t.text, t.reported]));
    expect(byText.get("consumer purchasing power")).toBe(true);
    expect(byText.get("financial transparency and IFRS")).toBe(true);
    expect(byText.get("regional ecommerce logistics")).toBe(false);
    // A verified fact from a source flagged for recheck is still reported.
    expect(
      isReported(
        a("BACKGROUND", "x", "VERIFIED_PUBLIC_FACT", 0),
        brief.sources,
      ),
    ).toBe(true);
  });

  it("words reported priorities softly and tells the voice not to state them as fact", () => {
    expect(built.persona.priorities.join(" ")).toMatch(/Reportedly: /);
    const text = externalLiveInstructions({ subject, built, founder });
    expect(text).toContain("Reportedly: consumer purchasing power");
    expect(text).toMatch(/publicly reported but unconfirmed/);
    expect(text).toMatch(/never quote anyone/);
    expect(claimsToBeRealPerson(built.persona.summary, ["Shadi Qishta"])).toBe(
      false,
    );
  });
});

const seed = (over: Partial<KnownEntityRecord> = {}): KnownEntityRecord => ({
  externalPersonId: "00000000-0000-4000-8000-0000000e0002",
  profileKey: "seed:shadi",
  entityKind: "PERSON",
  researchStatus: "PREPARED_PUBLIC_SEED",
  requiresRefresh: true,
  displayName: "Shadi Qishta",
  aliases: ["Shadi Qishta"],
  profileUrl: null,
  role: null,
  organization: null,
  location: "Doha",
  confidence: "STRONG",
  facts: [
    {
      claim: "Publicly discusses IFRS adoption and investor confidence.",
      sourceIds: ["S02"],
      evidenceClass: "publicly documented",
    },
    {
      claim: "Recent reports mention a Business Ventures role at Midmac.",
      sourceIds: ["S06"],
      evidenceClass: "third-party public report, verify current role",
    },
  ],
  sources: [
    {
      sourceId: "S02",
      url: "https://example.org/s02",
      description: "IFRS post",
      publishedAt: null,
      evidenceClass: "publicly documented",
    },
    {
      sourceId: "S06",
      url: "https://example.org/s06",
      description: "Appointment mention",
      publishedAt: null,
      evidenceClass: "third-party report",
    },
  ],
  quotes: [],
  image: {
    status: "NOT_ATTACHED",
    assetUrl: null,
    attribution: null,
    licenseNote: null,
  },
  profile: {},
  lastResearchedAt: "2026-10-09T00:00:00.000Z",
  ...over,
});

describe("resolving an entity for a rehearsal", () => {
  const scope = { tenantId: "t1", userId: "u1" };

  it("keeps a seed fact flagged for recheck as an unconfirmed report, not as contradicted", () => {
    const made = briefFromSeed(seed());
    expect(made?.assertions.map((x) => x.assertionClass)).toEqual([
      "PUBLIC_STATEMENT",
      "REASONABLE_INFERENCE",
    ]);
    expect(made?.assertions[0]?.topic).toBe("RECURRING_TOPICS");
  });

  it("resolves the asker's own record with its newest brief", async () => {
    const resolve = createExternalSubjectResolver({
      researched: {
        find: (_s, by) =>
          Promise.resolve(
            by.externalPersonId === subject.externalPersonId
              ? { subject: { ...subject, briefVersion: 0 }, sources: [] }
              : null,
          ),
        latestBrief: () => Promise.resolve(brief),
        remember: () => Promise.resolve(undefined),
      },
      known: { listPrepared: () => Promise.resolve([]) },
    });
    const found = await resolve(scope, subject.externalPersonId);
    expect(found?.subject.briefVersion).toBe(1);
    expect(found?.brief?.version).toBe(1);
  });

  it("resolves a prepared seed, and nothing for an id that is neither owned nor a seed", async () => {
    const resolve = createExternalSubjectResolver({
      researched: {
        find: () => Promise.resolve(null),
        latestBrief: () => Promise.resolve(null),
        remember: () => Promise.resolve(undefined),
      },
      known: { listPrepared: () => Promise.resolve([seed()]) },
    });
    const found = await resolve(scope, seed().externalPersonId);
    expect(found?.subject.displayName).toBe("Shadi Qishta");
    expect(found?.subject.briefVersion).toBe(1);
    expect(
      await resolve(scope, "00000000-0000-4000-8000-0000000e0999"),
    ).toBeNull();
  });
});
