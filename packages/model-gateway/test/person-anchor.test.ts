import { describe, expect, it } from "vitest";

import type { QToolCallOutcome } from "@capital-q/q-runtime";

import { pageTiesPerson, tiedToRecordPerson } from "../src/q/person-anchor.js";
import { admitDiscoveries } from "../src/q/web-discovery.js";

/**
 * Live 2026-11-06 (6c8d108cf): a page may speak about a person Capital Q
 * holds against a record only when it ties them: it names the person AND
 * the company, or names them on the company's own site. A bare name match
 * is never enough. The same rule admits a founder in web discovery.
 */

const ANCHOR = { person: "Adaeze Nwachukwu", company: "Ledgerfold" };

describe("pageTiesPerson", () => {
  it("excludes a namesake page that never names the company", () => {
    expect(
      pageTiesPerson(
        {
          text: "Adaeze Nwachukwu worked in economic intelligence at Access Bank.",
          domain: "profiles.example",
        },
        ANCHOR,
      ),
    ).toBe(false);
  });

  it("includes a page naming both, or naming the person on the company's own site", () => {
    expect(
      pageTiesPerson(
        { text: "Ledgerfold co-founder Adaeze Nwachukwu said…" },
        ANCHOR,
      ),
    ).toBe(true);
    expect(
      pageTiesPerson(
        {
          text: "Our team: Adaeze Nwachukwu, CEO.",
          domain: "www.ledgerfold.ng",
        },
        ANCHOR,
      ),
    ).toBe(true);
    // The company alone is not about the person.
    expect(
      pageTiesPerson({ text: "Ledgerfold raised a seed round." }, ANCHOR),
    ).toBe(false);
    // Part of a longer word is not the company.
    expect(
      pageTiesPerson(
        { text: "Adaeze Nwachukwu joined Ledgerfolding Ltd." },
        ANCHOR,
      ),
    ).toBe(false);
  });
});

describe("tiedToRecordPerson", () => {
  const outcome = (
    sources: readonly Record<string, unknown>[],
  ): QToolCallOutcome => ({
    callId: "c",
    toolName: "public_web.search",
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "PUBLIC",
    result: {
      ok: true,
      data: {
        status: "OK",
        sources,
        comparison: sources.map((s) => ({ sourceIndex: s["index"] })),
      },
    },
    latencyMs: 1,
  });
  const NAMESAKE = {
    index: 1,
    url: "https://profiles.example/adaeze",
    domain: "profiles.example",
    title: "Adaeze Nwachukwu",
    excerpt: "Economic intelligence at Access Bank.",
  };
  const TIED = {
    index: 2,
    url: "https://press.example/ledgerfold",
    domain: "press.example",
    title: "Ledgerfold's founders",
    excerpt: "Adaeze Nwachukwu, Ledgerfold's CEO, led SME lending.",
  };

  it("leaves out the namesake and its note, keeps the tied page", () => {
    const tied = tiedToRecordPerson(
      {
        name: "research_public_web",
        arguments: {
          entityName: "Adaeze Nwachukwu",
          query: "Adaeze Nwachukwu",
        },
      },
      outcome([NAMESAKE, TIED]),
      ANCHOR,
    );
    expect(tied.dropped).toBe(1);
    const data = (
      tied.outcome.result as {
        data: { sources: { index: number }[]; comparison: unknown[] };
      }
    ).data;
    expect(data.sources.map((s) => s.index)).toEqual([2]);
    expect(data.comparison).toEqual([{ sourceIndex: 2 }]);
  });

  it("with nothing tied, keeps nothing and says so for the answer", () => {
    const tied = tiedToRecordPerson(
      {
        name: "research_public_web",
        arguments: { query: "Adaeze Nwachukwu career" },
      },
      outcome([NAMESAKE]),
      ANCHOR,
    );
    const data = (
      tied.outcome.result as { data: { sources: unknown[]; guidance: string } }
    ).data;
    expect(data.sources).toEqual([]);
    expect(data.guidance).toContain(
      "No public page found here ties Adaeze Nwachukwu to Ledgerfold",
    );
  });

  it("leaves a search about someone else as it is", () => {
    const tied = tiedToRecordPerson(
      {
        name: "research_public_web",
        arguments: { query: "Lagos SME lending market" },
      },
      outcome([NAMESAKE]),
      ANCHOR,
    );
    expect(tied.dropped).toBe(0);
  });
});

describe("web discovery shares the rule for founders", () => {
  it("admits a founder only from a page that names founder and company together", () => {
    const pages = [
      {
        index: 1,
        url: "https://list.example/a",
        domain: "list.example",
        title: "Fintech list",
        publishedAt: null,
        retrievedAt: "2026-11-06",
        excerpt: "Owo Rails builds payment rails for Lagos merchants.",
        extracted: true,
      },
      {
        index: 2,
        url: "https://profiles.example/bisi",
        domain: "profiles.example",
        title: "Bisi Adewale",
        publishedAt: null,
        retrievedAt: "2026-11-06",
        excerpt: "Bisi Adewale is a banker in Abuja.",
        extracted: true,
      },
    ];
    const [owo] = admitDiscoveries(
      [
        {
          name: "Owo Rails",
          founders: ["Bisi Adewale"],
          does: null,
          sector: null,
          stage: null,
          place: null,
        },
      ],
      pages,
    );
    expect(owo?.name).toBe("Owo Rails");
    expect(owo?.founders).toEqual([]);
  });
});
