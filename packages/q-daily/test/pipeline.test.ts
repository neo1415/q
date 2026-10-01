import { describe, expect, it } from "vitest";

import { QDailyEditionSchema, type QDailyEdition } from "@capital-q/contracts";

import {
  createDailyEditionService,
  createDailyReaderService,
  DAILY_BUDGET,
  editionEmail,
  type DailyEmail,
  type DailyNewsIndex,
  type DailyReaderStore,
  type DailyStoryWriterInput,
  type DailyStoryWriterPort,
  type DailyTakePort,
  type DailyWorkerStore,
  type DueReader,
  type InterestProfile,
  type StoredClusterIssue,
} from "../src/index.js";

const NOW = new Date("2026-10-01T10:00:00Z");
const USER = "00000000-0000-4000-8000-000000000001";
const TENANT = "00000000-0000-4000-8000-0000000000a1";

const PROFILE: InterestProfile = {
  userId: USER,
  tenantId: TENANT,
  readerName: "Kola",
  email: "kola@fictional.capitalq.local",
  role: "INVESTOR",
  sectors: ["Fintech"],
  stages: ["Seed"],
  markets: ["Nigeria"],
  ownName: "Ventures Platform",
  knownNames: ["Chowdeck"],
  raise: null,
};

const COMPANIES = [
  "Paystack",
  "Moniepoint",
  "Kuda",
  "Carbon",
  "Piggyvest",
  "Cowrywise",
  "Flutterwave",
  "Opay",
  "Palmpay",
  "Fairmoney",
  "Lemfi",
  "Raenest",
  "Bamboo",
  "Risevest",
  "Chaka",
  "Trove",
  "Mono",
  "Okra",
  "Brass",
  "Sudo",
  "Anchor",
  "Union54",
  "Tingo",
  "Wema",
];

/** A news index that counts every call and answers from a table. */
function fakeIndex(): DailyNewsIndex & {
  searches: string[];
  extracts: number;
} {
  const searches: string[] = [];
  let extracts = 0;
  return {
    searches,
    get extracts() {
      return extracts;
    },
    search: (request) => {
      searches.push(request.query);
      const named = request.query.includes("Chowdeck");
      const hits = Array.from({ length: 6 }, (_, index) => ({
        url: named
          ? `https://techcabal.com/chowdeck-${index}`
          : `https://news${searches.length}.example/fintech-${index}`,
        title: named
          ? `Chowdeck expands to ${["Accra", "Abuja", "Nairobi", "Kigali", "Cairo", "Dakar"][index]}`
          : `${COMPANIES[(searches.length - 1) * 6 + index] ?? "Zed"} raises $${searches.length * 10 + index} million for fintech growth`,
        snippet: named
          ? "Chowdeck, the Lagos delivery startup, opens a new city."
          : `${COMPANIES[(searches.length - 1) * 6 + index] ?? "Zed"} raised $${searches.length * 10 + index} million in a Seed round, the company said.`,
        publishedAt: "2026-09-30T08:00:00Z",
        relevance: 0.8,
      }));
      return Promise.resolve({ hits, latencyMs: 1 });
    },
    extract: (request) => {
      extracts += 1;
      return Promise.resolve({
        pages: request.urls.map((url) => ({
          url,
          title: null,
          text: `“We will hire across Lagos,” said the founder. Full text for ${url}.`,
        })),
        failedUrls: [],
        latencyMs: 1,
      });
    },
  };
}

/** A writer that behaves like a model: one invents a number, one alters a quote. */
function fakeWriter(): DailyStoryWriterPort & {
  calls: DailyStoryWriterInput[];
} {
  const calls: DailyStoryWriterInput[] = [];
  return {
    calls,
    write: (input) => {
      calls.push(input);
      const source = input.sources[0];
      const title = source?.title ?? "";
      const amount = /\$(\d+) million/.exec(title)?.[0] ?? null;
      const company = title.split(" ")[0] ?? "Chowdeck";
      const invent = calls.length === 2;
      return Promise.resolve({
        relevant: true,
        headline: invent
          ? `${company} raises $99 million`
          : `${company} closes a round`,
        standfirst: `${source?.publisher ?? ""} reports the round.`,
        paragraphs: [
          `${source?.publisher ?? ""} reports that ${company} raised ${amount ?? "money"}.`,
        ],
        quotes: [
          {
            text: "We will hire across Lagos,",
            speaker: "the founder",
            sourceIndex: 0,
          },
          {
            text: "We will hire across the whole of Africa",
            speaker: null,
            sourceIndex: 0,
          },
        ],
        deal:
          amount === null
            ? null
            : { company, amount, round: "Seed", sourceIndex: 0 },
      });
    },
  };
}

function fakeTake(
  ids: (stories: readonly { id: string }[]) => string[],
): DailyTakePort & { calls: number } {
  const port = {
    calls: 0,
    take: (input: Parameters<DailyTakePort["take"]>[0]) => {
      port.calls += 1;
      return Promise.resolve({
        noTake: false,
        paragraphs: [
          "Seed rounds in fintech look busy; worth watching who leads them.",
        ],
        storyIds: ids(input.stories),
      });
    },
  };
  return port;
}

function memoryStore(due: readonly DueReader[]): DailyWorkerStore & {
  editions: QDailyEdition[];
  clusters: Map<string, StoredClusterIssue>;
  rescheduled: Map<string, Date | null>;
  emailed: string[];
} {
  const editions: QDailyEdition[] = [];
  const clusters = new Map<string, StoredClusterIssue>();
  const rescheduled = new Map<string, Date | null>();
  const emailed: string[] = [];
  let pending = [...due];
  return {
    editions,
    clusters,
    rescheduled,
    emailed,
    ensureDefaults: () => Promise.resolve(0),
    claimDue: (_now, limit) => {
      const claimed = pending.slice(0, limit);
      pending = pending.slice(limit);
      return Promise.resolve(claimed);
    },
    editionsToday: () => Promise.resolve(editions.length),
    profileOf: (userId) =>
      Promise.resolve({
        ...PROFILE,
        userId,
        email: `${userId}@fictional.capitalq.local`,
      }),
    clusterIssue: (key, date) =>
      Promise.resolve(clusters.get(`${key}/${date}`) ?? null),
    saveClusterIssue: (issue) => {
      const stored = {
        id: `c-${clusters.size + 1}`,
        stories: issue.stories,
        searchesUsed: issue.searchesUsed,
        modelCallsUsed: issue.modelCallsUsed,
      };
      clusters.set(`${issue.clusterKey}/${issue.issueDate}`, stored);
      return Promise.resolve(stored);
    },
    nextNumber: () => Promise.resolve(1),
    saveEdition: (edition) => {
      editions.push(edition.content);
      return Promise.resolve(edition.id);
    },
    markEmailed: (id, outcome) => {
      if (outcome.ok) emailed.push(id);
      return Promise.resolve();
    },
    reschedule: (userId, next) => {
      rescheduled.set(userId, next);
      return Promise.resolve();
    },
  };
}

function reader(userId: string): DueReader {
  return {
    userId,
    tenantId: TENANT,
    frequency: "WEEKLY",
    email: true,
    sections: ["YOUR_SECTOR", "YOUR_MARKET", "DEALS", "PEOPLE", "Q_TAKE"],
    timeZone: "Africa/Lagos",
    requested: false,
  };
}

describe("an edition, end to end with fakes", () => {
  it("is cited, checked, within budget, emailed and rescheduled", async () => {
    const index = fakeIndex();
    const writer = fakeWriter();
    const take = fakeTake((stories) => [stories[0]?.id ?? "", "not-a-story"]);
    const store = memoryStore([reader(USER)]);
    const sent: DailyEmail[] = [];
    const service = createDailyEditionService({
      store,
      index,
      feeds: () => Promise.resolve([]),
      writer,
      take,
      email: {
        available: true,
        send: (email) => {
          sent.push(email);
          return Promise.resolve();
        },
      },
      webOrigin: "https://app.example",
    });

    const result = await service.tick(NOW, "corr-1");
    expect(result).toMatchObject({ prepared: 1, emailed: 1, skipped: 0 });

    const edition = QDailyEditionSchema.parse(store.editions[0]);
    // Budget (G7): cluster + personal searches, writes and one take.
    expect(index.searches.length).toBeLessThanOrEqual(
      DAILY_BUDGET.clusterSearches + DAILY_BUDGET.personalSearches,
    );
    expect(writer.calls.length).toBeLessThanOrEqual(
      DAILY_BUDGET.clusterStoryWrites + DAILY_BUDGET.personalStoryWrites,
    );
    expect(index.extracts).toBeLessThanOrEqual(DAILY_BUDGET.extractCalls + 1);
    expect(take.calls).toBe(1);

    // Personal names are searched only in the personal step, never in the
    // shared cluster's searches (§8).
    const clusterSearches = index.searches.slice(
      0,
      DAILY_BUDGET.clusterSearches,
    );
    expect(clusterSearches.join(" ")).not.toContain("Chowdeck");
    expect(index.searches).toContain('"Chowdeck"');

    const stories = [
      ...(edition.lead === null ? [] : [edition.lead]),
      ...edition.sections.flatMap((section) => section.stories),
      ...edition.briefs,
    ];
    expect(stories.length).toBeGreaterThan(3);
    // Every story cites a source (G4).
    for (const story of stories)
      expect(story.sources.length).toBeGreaterThan(0);
    // The invented $99 million never printed; that story fell back to its source.
    expect(JSON.stringify(edition)).not.toContain("$99 million");
    expect(stories.some((story) => !story.written)).toBe(true);
    // Only the verbatim quote survived.
    const quotes = stories.flatMap((story) =>
      story.quotes.map((quote) => quote.text),
    );
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((text) => text === "We will hire across Lagos,")).toBe(
      true,
    );
    // People you know in the news.
    expect(edition.sections.map((section) => section.code)).toContain("PEOPLE");
    // The deals diagram from amounts printed in dollars.
    expect(edition.chart?.bars.length ?? 0).toBeGreaterThanOrEqual(2);
    // Q's take is Q inference and cites only real stories.
    expect(edition.qTake?.truthClass).toBe("Q_INFERENCE");
    expect(edition.qTake?.storyIds).toEqual([stories[0]?.id]);

    expect(sent[0]?.to).toBe(`${USER}@fictional.capitalq.local`);
    expect(sent[0]?.subject).toMatch(/^The Q Daily · /);
    expect(sent[0]?.html).toContain("https://app.example/daily/");
    expect(sent[0]?.html).toContain("Q's inference");
    expect(store.rescheduled.get(USER)?.toISOString()).toBe(
      "2026-10-05T06:00:00.000Z",
    );
  });

  it("reuses one shared gathering for readers with the same public interests", async () => {
    const index = fakeIndex();
    const writer = fakeWriter();
    const store = memoryStore([
      reader(USER),
      {
        ...reader("00000000-0000-4000-8000-000000000002"),
        sections: ["YOUR_SECTOR", "DEALS"],
      },
    ]);
    const service = createDailyEditionService({
      store,
      index,
      writer,
      webOrigin: null,
    });
    await service.tick(NOW, "corr-2");
    expect(store.clusters.size).toBe(1);
    // Second reader: no PEOPLE section, so no further searches at all.
    expect(index.searches.length).toBeLessThanOrEqual(
      DAILY_BUDGET.clusterSearches + DAILY_BUDGET.personalSearches,
    );
    const second = store.editions[1];
    expect(second?.sections.map((section) => section.code)).not.toContain(
      "PEOPLE",
    );
    expect(second?.qTake).toBeNull();
  });

  it("respects the daily cap", async () => {
    const store = memoryStore([reader(USER)]);
    const service = createDailyEditionService({
      store,
      index: fakeIndex(),
      webOrigin: null,
      maxEditionsPerDay: 0,
    });
    expect(await service.tick(NOW, "corr-3")).toMatchObject({ prepared: 0 });
    expect(store.editions).toHaveLength(0);
  });

  it("prints a quiet edition when there is no provider and no feed", async () => {
    const store = memoryStore([reader(USER)]);
    const service = createDailyEditionService({ store, webOrigin: null });
    await service.tick(NOW, "corr-4");
    const edition = store.editions[0];
    expect(edition?.lead).toBeNull();
    const email = editionEmail(QDailyEditionSchema.parse(edition), null);
    expect(email.html).toContain("A quiet week in your markets");
  });
});

describe("the email", () => {
  it("escapes source text and stays well under Gmail's clip", async () => {
    const index = fakeIndex();
    const hostile: DailyNewsIndex = {
      ...index,
      search: async (request, context) => {
        const result = await index.search(request, context);
        return {
          ...result,
          hits: result.hits.map((hit) => ({
            ...hit,
            title: `${hit.title} <script>alert(1)</script>`,
            snippet: `${hit.snippet} ${"Long words ".repeat(50)}`,
          })),
        };
      },
    };
    const store = memoryStore([reader(USER)]);
    await createDailyEditionService({
      store,
      index: hostile,
      webOrigin: null,
    }).tick(NOW, "c");
    const email = editionEmail(QDailyEditionSchema.parse(store.editions[0]), {
      edition: "https://app.example/daily/x",
      settings: "https://app.example/settings#q-daily",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(new TextEncoder().encode(email.html).byteLength).toBeLessThan(
      60_000,
    );
    expect(email.text).toContain(
      "Read the full edition: https://app.example/daily/x",
    );
  });
});

describe("the reader's own preferences and requests", () => {
  function readerStore(): DailyReaderStore & {
    saved: unknown[];
    requested: number;
    setLast: (date: Date) => void;
  } {
    let row: Awaited<ReturnType<DailyReaderStore["preferences"]>> = null;
    let last: Date | null = null;
    const store = {
      saved: [] as unknown[],
      requested: 0,
      preferences: () => Promise.resolve(row),
      timeZoneOf: () => Promise.resolve("Africa/Lagos"),
      savePreferences: (
        _u: string,
        _t: string,
        preferences: Parameters<DailyReaderStore["savePreferences"]>[2],
      ) => {
        store.saved.push(preferences);
        row = {
          frequency: preferences.frequency,
          email: preferences.email,
          sections: [...preferences.sections],
          nextDueAt: preferences.nextDueAt?.toISOString() ?? null,
          requestedAt: row?.requestedAt ?? null,
        };
        return Promise.resolve();
      },
      request: (_u: string, _t: string, now: Date) => {
        store.requested += 1;
        if (row !== null) row = { ...row, requestedAt: now.toISOString() };
        return Promise.resolve();
      },
      latest: () => Promise.resolve(null),
      edition: () => Promise.resolve(null),
      archive: () => Promise.resolve([]),
      lastEditionAt: () => Promise.resolve(last),
      setLast: (date: Date) => {
        last = date;
      },
    };
    return store;
  }
  const actor = { userId: USER, tenantId: TENANT };

  it("defaults to weekly with every section, and saves changes", async () => {
    const store = readerStore();
    const service = createDailyReaderService({ store });
    const home = await service.home(actor, null, NOW);
    expect(home.preferences.frequency).toBe("WEEKLY");
    expect(home.preferences.sections).toHaveLength(5);
    expect(home.preparing).toBe(false);
    const daily = await service.setPreferences(
      actor,
      { frequency: "DAILY", sections: ["DEALS", "Q_TAKE"] },
      NOW,
    );
    expect(daily).toMatchObject({
      frequency: "DAILY",
      sections: ["DEALS", "Q_TAKE"],
      nextDueAt: "2026-10-02T06:00:00.000Z",
    });
    const off = await service.setPreferences(actor, { frequency: "OFF" }, NOW);
    expect(off.nextDueAt).toBeNull();
    expect(await service.request(actor, NOW)).toEqual({
      status: "OFF",
      retryAfter: null,
    });
  });

  it("queues one edition on request, then refuses too soon", async () => {
    const store = readerStore();
    const service = createDailyReaderService({ store });
    expect((await service.request(actor, NOW)).status).toBe("QUEUED");
    expect((await service.request(actor, NOW)).status).toBe("ALREADY_QUEUED");
    const fresh = readerStore();
    fresh.setLast(new Date(NOW.getTime() - 60 * 60 * 1000));
    const again = await createDailyReaderService({ store: fresh }).request(
      actor,
      NOW,
    );
    expect(again.status).toBe("TOO_SOON");
    expect(fresh.requested).toBe(0);
  });
});
