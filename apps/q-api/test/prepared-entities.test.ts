import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  countRoundTrip,
  createRoundTripCounter,
  withRoundTripCounter,
} from "@capital-q/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPreparedEntityCache,
  preparedEntityPrewarmLines,
  rehearsalCounterpart,
  type PreparedEntityStorePort,
} from "../src/composition/prepared-entities.js";
import {
  parsePreparedSeed,
  preparedEntitySetFromSeed,
} from "../src/composition/prepared-entity-seed.js";
import { liveContextPackage } from "../src/voice/live/context.js";

const seedPath = fileURLToPath(
  new URL("../../../scripts/seed/research/qatar-five.v1.json", import.meta.url),
);
const rawSeed: unknown = JSON.parse(readFileSync(seedPath, "utf8"));
const seed = parsePreparedSeed(rawSeed);

/** A store that counts every database trip the way the real one would. */
function fakeStore(version = "v1") {
  let current = version;
  const calls = { load: 0, version: 0 };
  const store: PreparedEntityStorePort = {
    load: () => {
      calls.load += 1;
      countRoundTrip("prepared-entities");
      return Promise.resolve({
        ...preparedEntitySetFromSeed(seed),
        version: current,
      });
    },
    version: () => {
      calls.version += 1;
      countRoundTrip("prepared-entities");
      return Promise.resolve(current);
    },
  };
  return {
    store,
    calls,
    bump: (next: string) => {
      current = next;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("prepared research entities: the seed", () => {
  it("is five entities: two people, two organisations, one agency", () => {
    const kinds = seed.entities.map((e) => e.entity_kind).sort();
    expect(kinds).toEqual([
      "GOVERNMENT_AGENCY",
      "ORGANIZATION",
      "ORGANIZATION",
      "PERSON",
      "PERSON",
    ]);
    expect(seed.entities.every((e) => e.requires_refresh)).toBe(true);
  });

  it("never upgrades a claim beyond its evidence", () => {
    const shadi = seed.entities.find(
      (e) => e.demo_id === "qa-demo-shadi-qishta",
    );
    const role = shadi?.facts.find((f) => f.source_ids.includes("S06"));
    expect(role?.verification.status).toBe("UNVERIFIED");
    expect(role?.evidence_class).toBe(
      "third-party public report, verify current role",
    );
    for (const [id, source] of Object.entries(seed.sources)) {
      if (/linkedin\.com|qinvest\.com/u.test(source.url)) {
        expect(source.access, id).toBe("UNVERIFIED");
      }
    }
  });

  it("holds no portrait of a real person and no pronunciation", () => {
    for (const entity of seed.entities) {
      if (entity.entity_kind === "PERSON") {
        expect(entity.image.status).toBe("NOT_ATTACHED");
      }
      expect(entity.pronunciation).toEqual([]);
    }
  });

  it("holds Arabic script only where a source printed it", () => {
    const withArabic = seed.entities.filter((e) => e.arabic_names.length > 0);
    expect(withArabic.map((e) => e.demo_id)).toEqual(["qa-demo-alrayan"]);
    for (const e of seed.entities) {
      for (const alias of e.aliases) {
        expect(/\p{Script=Arabic}/u.test(alias)).toBe(false);
      }
    }
    const raw = structuredClone(rawSeed) as {
      entities: { aliases: string[] }[];
    };
    raw.entities[0]?.aliases.push("شادي");
    expect(() => parsePreparedSeed(raw)).toThrow(/unsourced Arabic/u);
  });

  it("refuses a hotlinked portrait", () => {
    const raw = structuredClone(rawSeed) as {
      entities: { entity_kind: string; image: Record<string, unknown> }[];
    };
    const org = raw.entities.find((e) => e.entity_kind === "ORGANIZATION");
    if (org === undefined) throw new Error("seed has an organisation");
    org.image = {
      status: "ATTACHED",
      url: "https://media.licdn.com/x.png",
      attribution: "x",
    };
    expect(() => parsePreparedSeed(raw)).toThrow(/LinkedIn/u);
  });
});

describe("prepared research entities: the hot cache", () => {
  it("loads once at start, then a known name costs 0 web calls and 0 database round trips", async () => {
    const { store, calls } = fakeStore();
    const cache = createPreparedEntityCache(store);
    const startCounter = createRoundTripCounter("start");
    await withRoundTripCounter(startCounter, () => cache.start());
    expect(startCounter.count).toBe(1);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const counter = createRoundTripCounter("warm");
    const found = withRoundTripCounter(counter, () => [
      cache.lookup("Shadi Qishta"),
      cache.lookup("muhannad taslaq"),
      cache.lookup("Invest Qatar"),
      cache.lookup("AlRayan Investment"),
      cache.lookup("QInvest"),
    ]);
    expect(found.every((r) => r.kind === "FOUND")).toBe(true);
    expect(counter.count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toEqual({ load: 1, version: 0 });
  });

  it("resolves aliases and spelling variants to the right entity", async () => {
    const cache = createPreparedEntityCache(fakeStore().store);
    await cache.start();
    const id = (text: string) => {
      const r = cache.lookup(text);
      return r.kind === "FOUND" ? r.entity.id : r.kind;
    };
    expect(id("Al Rayan Investment LLC")).toBe("qa-demo-alrayan");
    expect(id("ARI Qatar")).toBe("qa-demo-alrayan");
    expect(id("al-rayan investments")).toBe("qa-demo-alrayan");
    expect(id("الريان للاستثمار")).toBe("qa-demo-alrayan");
    expect(id("Q Invest")).toBe("qa-demo-qinvest");
    expect(id("qinvest llc")).toBe("qa-demo-qinvest");
    expect(id("InvestQatar")).toBe("qa-demo-invest-qatar");
    expect(id("IPA Qatar")).toBe("qa-demo-invest-qatar");
    // W3 variants: word order and alternate romanisations of a person.
    expect(id("Shadi Qishta, Doha")).toBe("qa-demo-shadi-qishta");
    expect(id("Qishta Shadi")).toBe("qa-demo-shadi-qishta");
    expect(id("Shadi Kishta")).toBe("qa-demo-shadi-qishta");
    expect(id("Mohannad Taslaq")).toBe("qa-demo-muhannad-taslaq");
  });

  it("does not claim a prepared match for someone else", async () => {
    const cache = createPreparedEntityCache(fakeStore().store);
    await cache.start();
    for (const text of [
      "Taslaq",
      "Shadi",
      "Ahmed Al Thani",
      "Qatar",
      "Invest",
      "Sarah Johnson",
    ]) {
      expect(cache.lookup(text).kind, text).not.toBe("FOUND");
    }
    const cold = createPreparedEntityCache(fakeStore().store);
    expect(cold.lookup("Shadi Qishta").kind).toBe("NOT_PREPARED");
  });

  it("rebuilds from the store after a restart with one query", async () => {
    await createPreparedEntityCache(fakeStore().store).start();
    const restarted = createPreparedEntityCache(fakeStore().store);
    expect(restarted.lookup("Invest Qatar").kind).toBe("NOT_PREPARED");
    const counter = createRoundTripCounter("restart");
    await withRoundTripCounter(counter, () => restarted.start());
    expect(counter.count).toBe(1);
    expect(restarted.lookup("Invest Qatar").kind).toBe("FOUND");
    expect(restarted.all()).toHaveLength(5);
  });

  it("rebuilds when the store version changes, and only then", async () => {
    const { store, calls, bump } = fakeStore("v1");
    const cache = createPreparedEntityCache(store);
    await cache.start();
    expect(await cache.refreshIfChanged()).toBe(false);
    expect(calls).toEqual({ load: 1, version: 1 });
    bump("v2");
    expect(await cache.refreshIfChanged()).toBe(true);
    expect(cache.version()).toBe("v2");
    expect(calls.load).toBe(2);
    cache.invalidate();
    expect(cache.lookup("Invest Qatar").kind).toBe("NOT_PREPARED");
    expect(await cache.refreshIfChanged()).toBe(true);
    expect(cache.lookup("Invest Qatar").kind).toBe("FOUND");
  });
});

describe("prepared research entities: counterparts and prewarm", () => {
  it("an organisation never gets a personal mandate; a person is a labelled simulation", async () => {
    const cache = createPreparedEntityCache(fakeStore().store);
    await cache.start();
    for (const entity of cache.all()) {
      const counterpart = rehearsalCounterpart(entity);
      if (entity.kind === "PERSON") {
        expect(counterpart.kind).toBe("SOURCE_INFORMED_SIMULATION");
        expect(counterpart.label).toMatch(/not /u);
      } else {
        expect(counterpart.kind).toBe("ROLE_REPRESENTATIVE");
        expect(
          counterpart.kind === "ROLE_REPRESENTATIVE" &&
            counterpart.personalMandate,
        ).toBe(null);
        expect(counterpart.label).toMatch(/not a real person/u);
      }
    }
  });

  it("the Live context carries a compact list: names, kind, one line, ids; no facts", async () => {
    const cache = createPreparedEntityCache(fakeStore().store);
    await cache.start();
    const lines = preparedEntityPrewarmLines(cache.all());
    expect(lines).toHaveLength(5);
    const text = liveContextPackage({
      role: "founder",
      facts: null,
      referents: [],
      preparedEntities: lines,
    });
    expect(text).toContain("qa-demo-muhannad-taslaq");
    expect(text).toContain("Invest Qatar (government agency");
    expect(text).not.toMatch(/Gulf Times|S16|30-day/u);
    expect(text?.length ?? 0).toBeLessThanOrEqual(1_600);
  });
});
