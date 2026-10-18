import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  answerPreparedFollowUp,
  preparedEntityIdFor,
  cardFromKnownEntity,
  createInMemoryKnownEntityStore,
  decidePreparedFollowUp,
  sourceTally,
  type KnownEntityRecord,
} from "@capital-q/q-research";
import { knownEntityLaneOf } from "@capital-q/q-specialists";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createPreparedEntities,
  preparedEntityMatcher,
  preparedFollowUpPort,
} from "../src/composition/prepared-entities.js";
import {
  loadPreparedSeed,
  parsePreparedSeed,
  toPreparedUpsert,
} from "../src/composition/prepared-entity-seed.js";

/**
 * Follow-ups about the Qatar Five are answered by code from the stored
 * brief (live 2026-10-11: "tell me more about this person" searched the web
 * and said little). Fakes only: the port is pure, so it cannot reach the
 * web or a model; the tests check what it says and what it refuses to say.
 */

const root = new URL("../../../", import.meta.url);
const rawSeed: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("scripts/seed/research/qatar-five.v1.json", root)),
    "utf8",
  ),
);
const seed = parsePreparedSeed(rawSeed);
const options = { webOrigin: "https://app.example" };

let records: readonly KnownEntityRecord[] = [];
const byName = (name: string): KnownEntityRecord => {
  const found = records.find((r) => r.displayName.startsWith(name));
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
};
const port = () => preparedFollowUpPort({ all: () => records });

beforeAll(async () => {
  const store = createInMemoryKnownEntityStore();
  await loadPreparedSeed(store, seed, options);
  records = await store.listPrepared();
});

const FIVE: readonly {
  name: string;
  identity: string;
  asks: readonly [string, RegExp][];
}[] = [
  {
    name: "Shadi Qishta",
    identity: "Who is Shadi Qishta?",
    asks: [
      ["Tell me more about Shadi", /Midmac/u],
      ["What questions might Shadi raise?", /rehearsal guidance/u],
      ["What has Shadi Qishta said publicly?", /IFRS|telecom|Snoonu/u],
    ],
  },
  {
    name: "QInvest",
    identity: "Tell me about QInvest",
    asks: [
      ["What does QInvest actually do?", /Investment Banking/u],
      ["How should I pitch QInvest?", /Sharia-compliant/u],
      ["What are the sources for QInvest?", /could not be opened/u],
    ],
  },
  {
    name: "Muhannad Taslaq",
    identity: "Who is Muhannad Taslaq?",
    asks: [
      ["What has Muhannad said about founders?", /conviction|crisis/u],
      ["How should I pitch Muhannad?", /Questions they may raise/u],
      ["What does Muhannad care about?", /conviction|30-day/u],
    ],
  },
  {
    name: "Invest Qatar",
    identity: "What is Invest Qatar?",
    asks: [
      ["What does Invest Qatar actually do?", /introductions|setup/u],
      ["Tell me more about Invest Qatar", /not a venture fund/u],
      ["What questions might Invest Qatar ask me?", /base in Qatar/u],
    ],
  },
  {
    name: "AlRayan Investment",
    identity: "Who is AlRayan Investment?",
    asks: [
      ["How should I pitch AlRayan?", /Sharia/u],
      ["What does AlRayan Investment do?", /sukuk/u],
      ["Tell me about AlRayan's background", /2007/u],
    ],
  },
];

describe("prepared-entity follow-ups, answered by code", () => {
  it("loads five entities", () => {
    expect(records).toHaveLength(5);
  });

  for (const entity of FIVE) {
    describe(entity.name, () => {
      it("an identity question stays the instant card lane", () => {
        const entities = createPreparedEntities({
          store: createInMemoryKnownEntityStore(),
          index: { lookup: () => ({ kind: "NONE" }) } as never,
          version: () => Promise.resolve("0"),
        });
        // The matcher reads the warm index; a stub over the loaded records
        // stands in for it (the lane only needs names and kind).
        const match = preparedEntityMatcher({
          lookup: (text) => {
            const hit = records.filter((r) =>
              [r.displayName, ...r.aliases].some(
                (a) => a.toLowerCase() === text.toLowerCase(),
              ),
            );
            return hit.length === 1 && hit[0] !== undefined
              ? { kind: "FOUND", record: hit[0] }
              : { kind: "NONE" };
          },
        });
        expect(entities).toBeDefined();
        expect(knownEntityLaneOf(entity.identity, match)).not.toBeNull();
      });

      for (const [ask, expected] of entity.asks) {
        it(`"${ask}" is answered from the brief`, () => {
          const text = port()({ utterance: ask, lastShownEntityId: null });
          expect(text).not.toBeNull();
          expect(text).toMatch(expected);
          // Source honesty is part of every answer.
          expect(text).toMatch(/Sources: \d+ sources?, (all|\d+) read/u);
        });
      }
    });
  }
});

describe("pronoun follow-ups", () => {
  it("'tell me more about this person' means the person last shown", () => {
    const muhannad = byName("Muhannad");
    const text = port()({
      utterance: "Tell me more about this person",
      lastShownEntityId: muhannad.externalPersonId,
    });
    expect(text).toMatch(/Alchemist Doha/u);
    expect(text).toMatch(/Documented/u);
    expect(text).toMatch(/not Muhannad Taslaq's words/u);
  });

  it.each(["him", "he", "his"])("'%s' resolves for a person", (word) => {
    const decision = decidePreparedFollowUp({
      utterance: `What has ${word} said about founders?`,
      records,
      lastShownId: byName("Muhannad").externalPersonId,
    });
    expect(decision?.record.displayName).toBe("Muhannad Taslaq");
    expect(decision?.aspect).toBe("SAID");
  });

  it("'it' and 'this company' resolve for an organisation, not 'him'", () => {
    const iq = byName("Invest Qatar");
    const ctx = { records, lastShownId: iq.externalPersonId };
    expect(
      decidePreparedFollowUp({ utterance: "What does it do?", ...ctx })?.record,
    ).toBe(iq);
    expect(
      decidePreparedFollowUp({
        utterance: "Tell me more about this company",
        ...ctx,
      })?.record,
    ).toBe(iq);
    expect(
      decidePreparedFollowUp({ utterance: "What has he said?", ...ctx }),
    ).toBeNull();
  });

  it("with no entity shown, a pronoun is not ours", () => {
    expect(
      port()({ utterance: "Tell me more about him", lastShownEntityId: null }),
    ).toBeNull();
  });

  it("a name wins over the entity last shown", () => {
    const text = port()({
      utterance: "What does AlRayan do?",
      lastShownEntityId: byName("Muhannad").externalPersonId,
    });
    expect(text).toMatch(/sukuk/u);
  });

  it.each([
    "Tell me the latest news on Muhannad",
    "Search again for Shadi Qishta, what is new?",
    "Rehearse with Muhannad Taslaq",
    "Draft an email to Shadi about my round",
    "compare QInvest and AlRayan",
  ])("'%s' is left to fresh research or the other lanes", (said) => {
    expect(
      port()({
        utterance: said,
        lastShownEntityId: byName("Shadi").externalPersonId,
      }),
    ).toBeNull();
  });
});

describe("an unsupported field is named", () => {
  it("no statement on a topic: says so by name and what it does have", () => {
    const text = port()({
      utterance: "What has Shadi Qishta said about founders?",
      lastShownEntityId: null,
    });
    expect(text).toMatch(/no public statement from Shadi Qishta on founders/u);
    expect(text).not.toMatch(/little is known|couldn't find much/iu);
    expect(text).toMatch(/IFRS|Snoonu|telecom/u);
  });

  it("a supported topic is answered with the real words", () => {
    const text = port()({
      utterance: "What has Muhannad said about founders?",
      lastShownEntityId: null,
    });
    expect(text).toMatch(/We’re here to back conviction\./u);
    expect(text).not.toMatch(/no public statement/u);
  });

  it("an organisation with no statements says so", () => {
    const text = port()({
      utterance: "What has QInvest said about sukuk?",
      lastShownEntityId: null,
    });
    expect(text).toMatch(/no public statement from QInvest LLC on sukuk/u);
  });
});

describe("source status honesty", () => {
  it("the card says how many sources were read, never implying all", () => {
    const shadi = byName("Shadi");
    const card = cardFromKnownEntity(shadi);
    const tally = sourceTally(shadi.sources);
    expect(tally.total).toBe(6);
    expect(tally.read).toBe(5);
    expect(card?.attributionLine).toContain("6 sources, 5 read");
    expect(card?.uncertainty.join(" ")).toMatch(/6 sources, 5 read/u);
    const blocked = card?.sources.find((s) => s.id === "S01");
    expect(blocked?.status).toBe("BLOCKED_OR_UNAVAILABLE");
    expect(blocked?.readAt).toBeNull();
  });

  it("QInvest's unopened website is link-level, not read", () => {
    const qinvest = byName("QInvest");
    expect(sourceTally(qinvest.sources).phrase).toBe("6 sources, 2 read");
    const text = answerPreparedFollowUp({
      record: qinvest,
      aspect: "SOURCES",
      topicWords: [],
    });
    expect(text).toMatch(/qinvest\.com: could not be opened/u);
    expect(text).toMatch(/linkedin\.com: read on 2026-10-11/u);
  });

  it("a read source always has a read date and an excerpt; an unread one has neither", () => {
    for (const record of records) {
      for (const source of record.sources) {
        const read = [
          "CONTENT_READ",
          "FACT_EXTRACTED",
          "VERIFIED_AGAINST_SOURCE",
        ].includes(source.status ?? "LINK_DISCOVERED");
        expect(source.readAt != null).toBe(read);
        expect((source.excerpt ?? "").length > 0).toBe(read);
        expect(source.url.startsWith("https://")).toBe(true);
      }
    }
  });

  it("a fact never rests on a source that was not read unless it says so", () => {
    for (const record of records) {
      for (const fact of record.facts) {
        const cited = record.sources.filter((s) =>
          fact.sourceIds.includes(s.sourceId),
        );
        const anyRead = cited.some((s) =>
          [
            "CONTENT_READ",
            "FACT_EXTRACTED",
            "VERIFIED_AGAINST_SOURCE",
          ].includes(s.status ?? "LINK_DISCOVERED"),
        );
        if (!anyRead) expect(fact.status).toBe("LINK_DISCOVERED");
        if (fact.status === "VERIFIED_AGAINST_SOURCE")
          expect(anyRead).toBe(true);
      }
    }
  });
});

describe("no invented quotes", () => {
  const norm = (text: string): string => text.replace(/\s+/gu, " ").trim();

  it("no prepared public profile carries a quote (owner direction 2026-10-15)", () => {
    expect(records.flatMap((record) => record.quotes)).toEqual([]);
    const withQuote = structuredClone(rawSeed) as {
      entities: { short_public_quotes: unknown[] }[];
    };
    withQuote.entities[0]?.short_public_quotes.push({
      quote: "x",
      source_id: "S02",
      verification: {
        status: "VERIFIED",
        checkedAt: "",
        basis: "",
        note: null,
      },
      label: "x",
      speaker: "x",
    });
    expect(() => parsePreparedSeed(withQuote)).toThrow(/no quotes/u);
  });

  it("every quoted string an answer prints is inside a stored quote or excerpt", () => {
    for (const record of records) {
      const text = answerPreparedFollowUp({
        record,
        aspect: "OVERVIEW",
        topicWords: [],
      });
      const printed = [...text.matchAll(/"([^"]{12,})"/gu)].map(
        (m) => m[1] ?? "",
      );
      const stored = [
        ...record.quotes.map((q) => q.text),
        ...record.sources.map((s) => s.excerpt ?? ""),
      ].map(norm);
      for (const line of printed) {
        expect(
          stored.some((own) => own.includes(norm(line))),
          `${record.displayName}: ${line}`,
        ).toBe(true);
      }
    }
  });

  it("the unverifiable LinkedIn lines of the first seed are gone", () => {
    const all = records.flatMap((r) => r.quotes.map((q) => q.text));
    expect(all).not.toContain(
      "Watch what people spend, and everything else follows.",
    );
  });
});

describe("the migration is the seed", () => {
  it("20261227100000 carries exactly what the loader writes, for both research seeds", () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          "supabase/migrations/20261227100000_qatar_research_investors_and_evidence_axes.sql",
          root,
        ),
      ),
      "utf8",
    );
    const doc = /\$j\$(.*)\$j\$/su.exec(sql)?.[1] ?? "[]";
    const rows = JSON.parse(doc) as {
      id: string;
      profileKey: string;
      lastResearchedAt: string;
      facts: unknown;
      sources: unknown;
      quotes: unknown;
      profile: unknown;
    }[];
    const investors = parsePreparedSeed(
      JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL("scripts/seed/research/qatar-investors.v1.json", root),
          ),
          "utf8",
        ),
      ),
    );
    expect(rows).toHaveLength(seed.entities.length + investors.entities.length);
    for (const [from, entity] of [
      ...seed.entities.map((e) => [seed, e] as const),
      ...investors.entities.map((e) => [investors, e] as const),
    ]) {
      const want = toPreparedUpsert(from, entity, options);
      const got = rows.find((r) => r.profileKey === entity.demo_id);
      expect(got, entity.demo_id).toBeDefined();
      const plain = (value: unknown): unknown =>
        JSON.parse(JSON.stringify(value));
      expect(got?.id).toBe(preparedEntityIdFor(entity.demo_id));
      expect(got?.lastResearchedAt).toBe(want.lastResearchedAt);
      expect(got?.facts).toEqual(plain(want.facts));
      expect(got?.sources).toEqual(plain(want.sources));
      expect(got?.quotes).toEqual([]);
      expect(got?.profile).toEqual(plain(want.profile));
    }
    expect(sql).not.toMatch(/\bdelete\s+from\b/iu);
    // No login, membership, representative or mandate for a real organisation.
    expect(sql).not.toMatch(
      /organisation_memberships|investor_representatives|investor_mandates|auth\.users/u,
    );
  });

  it("every researched fact carries the three ADR-001 axes, and none is platform-verified", () => {
    for (const file of ["qatar-five.v1.json", "qatar-investors.v1.json"]) {
      const one = parsePreparedSeed(
        JSON.parse(
          readFileSync(
            fileURLToPath(new URL(`scripts/seed/research/${file}`, root)),
            "utf8",
          ),
        ),
      );
      for (const entity of one.entities) {
        for (const fact of entity.facts) {
          expect(
            fact.truth_class,
            `${entity.demo_id}: ${fact.claim}`,
          ).toBeDefined();
          expect(fact.evidence_status).toBeDefined();
          expect(fact.lifecycle_status).toBeDefined();
          expect(fact.uncertainty).toBeDefined();
          expect(fact.truth_class).not.toBe("VERIFIED");
          for (const id of fact.source_ids) {
            expect(one.sources[id]?.url).toMatch(/^https:\/\//u);
          }
        }
      }
    }
  });
});
