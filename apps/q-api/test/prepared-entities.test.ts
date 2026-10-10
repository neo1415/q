import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  countRoundTrip,
  createRoundTripCounter,
  withRoundTripCounter,
} from "@capital-q/database";
import {
  createInMemoryKnownEntityStore,
  type KnownEntityRecord,
} from "@capital-q/q-research";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPreparedEntities,
  preparedEntityPrewarmLines,
  rehearsalCounterpart,
  type PreparedEntityStore,
} from "../src/composition/prepared-entities.js";
import {
  loadPreparedSeed,
  parsePreparedSeed,
  toPreparedUpsert,
} from "../src/composition/prepared-entity-seed.js";
import { liveContextPackage } from "../src/voice/live/context.js";

const seedPath = fileURLToPath(
  new URL("../../../scripts/seed/research/qatar-five.v1.json", import.meta.url),
);
const rawSeed: unknown = JSON.parse(readFileSync(seedPath, "utf8"));
const seed = parsePreparedSeed(rawSeed);
const options = { webOrigin: "https://app.example" };

/** W2's in-memory store with the version and the per-run round-trip count a Postgres store has. */
function memoryStore() {
  const inner = createInMemoryKnownEntityStore();
  const calls = { list: 0, version: 0 };
  const versionOf = (records: readonly KnownEntityRecord[]): string =>
    `${records.length}:${JSON.stringify(records).length}`;
  const store: PreparedEntityStore = {
    ...inner,
    listPrepared: () => {
      countRoundTrip("prepared");
      return inner.listPrepared();
    },
    listWithVersion: async () => {
      calls.list += 1;
      countRoundTrip("prepared");
      const records = await inner.listPrepared();
      return { version: versionOf(records), records };
    },
    version: async () => {
      calls.version += 1;
      countRoundTrip("prepared");
      return versionOf(await inner.listPrepared());
    },
  };
  return { store, inner, calls };
}

async function warmed() {
  const memory = memoryStore();
  await loadPreparedSeed(memory.store, seed, options);
  const entities = createPreparedEntities(memory.store);
  await entities.start();
  return { ...memory, entities };
}

afterEach(() => vi.restoreAllMocks());

describe("prepared research entities: the seed", () => {
  it("is five entities: two people, two organisations, one agency", () => {
    expect(seed.entities.map((e) => e.entity_kind).sort()).toEqual([
      "GOVERNMENT_AGENCY",
      "ORGANIZATION",
      "ORGANIZATION",
      "PERSON",
      "PERSON",
    ]);
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
    expect(shadi?.identity_read).toBe("PLAUSIBLE");
    for (const [id, source] of Object.entries(seed.sources)) {
      if (/linkedin\.com|qinvest\.com/u.test(source.url)) {
        expect(source.access, id).toBe("UNVERIFIED");
      }
    }
  });

  it("holds Arabic script only where a source printed it, and no pronunciation", () => {
    expect(
      seed.entities
        .filter((e) => e.arabic_names.length > 0)
        .map((e) => e.demo_id),
    ).toEqual(["qa-demo-alrayan"]);
    for (const e of seed.entities) {
      expect(e.pronunciation).toEqual([]);
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

  it("refuses a hotlinked image, a portrait of a person and an institution with a role", () => {
    const mutate = (change: (raw: Record<string, unknown>[]) => void) => {
      const raw = structuredClone(rawSeed) as {
        entities: Record<string, unknown>[];
      };
      change(raw.entities);
      return () => parsePreparedSeed(raw);
    };
    const find = (raw: Record<string, unknown>[], kind: string) => {
      const found = raw.find((e) => e["entity_kind"] === kind);
      if (found === undefined) throw new Error("seed entity missing");
      return found;
    };
    expect(
      mutate((raw) => {
        find(raw, "ORGANIZATION")["image"] = {
          status: "ATTACHED",
          url: "https://media.licdn.com/x.png",
          attribution: "x",
        };
      }),
    ).toThrow(/LinkedIn/u);
    expect(
      mutate((raw) => {
        find(raw, "PERSON")["image"] = {
          status: "ATTACHED",
          url: "https://example.org/p.jpg",
          attribution: "x",
        };
      }),
    ).toThrow(/portrait/u);
    expect(
      mutate((raw) => {
        find(raw, "ORGANIZATION")["role"] = "CEO";
      }),
    ).toThrow(/personal role/u);
  });
});

describe("prepared research entities: the loader", () => {
  it("is idempotent: a second load writes the same rows and the same ids", async () => {
    const { store, inner } = memoryStore();
    const first = await loadPreparedSeed(store, seed, options);
    const rows = JSON.stringify(inner.all());
    const second = await loadPreparedSeed(store, seed, options);
    expect(second).toEqual(first);
    expect(inner.all()).toHaveLength(5);
    expect(JSON.stringify(inner.all())).toBe(rows);
    expect(new Set(first.map((one) => one.externalPersonId)).size).toBe(5);
  });

  it("loads global public seeds with provenance, never a tenant or a personal mandate", async () => {
    const { inner } = await warmed();
    for (const record of inner.all()) {
      expect(record.researchStatus).toBe("PREPARED_PUBLIC_SEED");
      expect(record.requiresRefresh).toBe(true);
      expect(record.sources.length).toBeGreaterThan(0);
      expect(
        record.facts.every((f) =>
          /^(VERIFIED|UNVERIFIED|CONTRADICTED):/u.test(f.evidenceClass ?? ""),
        ),
      ).toBe(true);
      // A quote on a login-gated page is not stored as the person's words.
      expect(record.quotes).toEqual([]);
      if (record.entityKind !== "PERSON") expect(record.role).toBeNull();
      expect(JSON.stringify(record)).not.toMatch(/mandate/iu);
    }
    const muhannad = inner
      .all()
      .find((r) => r.profileKey === "qa-demo-muhannad-taslaq");
    expect(muhannad?.role).toBe("Director of Investments");
    expect(muhannad?.image.status).toBe("NOT_ATTACHED");
    const logo = inner
      .all()
      .find((r) => r.profileKey === "qa-demo-alrayan")?.image;
    expect(logo?.assetUrl).toBe(
      "https://app.example/research-entities/qa-demo-alrayan.png",
    );
    expect(logo?.attribution).toMatch(/official site logo/u);
  });

  it("maps the same seed to the same upsert", () => {
    const entity = seed.entities[0];
    if (entity === undefined) throw new Error("seed has entities");
    expect(toPreparedUpsert(seed, entity, options)).toEqual(
      toPreparedUpsert(seed, entity, options),
    );
  });
});

describe("prepared research entities: the hot cache", () => {
  it("a known name costs 0 web calls and 0 database round trips once warm", async () => {
    const { entities, calls } = await warmed();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const counter = createRoundTripCounter("warm");
    const found = withRoundTripCounter(counter, () =>
      [
        "Shadi Qishta",
        "muhannad taslaq",
        "Invest Qatar",
        "AlRayan Investment",
        "QInvest",
      ].map((name) => entities.lookup(name)),
    );
    expect(found.map((r) => r.kind)).toEqual(Array(5).fill("FOUND"));
    expect(counter.count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toEqual({ list: 1, version: 0 });
  });

  it("resolves aliases and W3 name variants to the right entity", async () => {
    const { entities } = await warmed();
    const key = (text: string) => {
      const found = entities.lookup(text);
      return found.kind === "FOUND" ? found.record.profileKey : found.kind;
    };
    expect(key("Al Rayan Investment LLC")).toBe("qa-demo-alrayan");
    expect(key("ARI Qatar")).toBe("qa-demo-alrayan");
    expect(key("الريان للاستثمار")).toBe("qa-demo-alrayan");
    expect(key("Q Invest")).toBe("qa-demo-qinvest");
    expect(key("InvestQatar")).toBe("qa-demo-invest-qatar");
    expect(key("IPA Qatar")).toBe("qa-demo-invest-qatar");
    expect(key("Shadi Qishta Doha")).toBe("qa-demo-shadi-qishta");
    expect(key("Qishta Shadi")).toBe("qa-demo-shadi-qishta");
    expect(key("Shadi Kishta")).toBe("qa-demo-shadi-qishta");
    expect(key("Mohannad Taslaq")).toBe("qa-demo-muhannad-taslaq");
  });

  it("does not claim a prepared match for someone else or for a generic word", async () => {
    const { entities } = await warmed();
    for (const text of [
      "Taslaq",
      "Shadi",
      "Ahmed Al Thani",
      "Qatar",
      "Invest",
      "Sarah Johnson",
      "",
    ]) {
      expect(entities.lookup(text).kind, text).not.toBe("FOUND");
    }
  });

  it("rebuilds from the store after a restart with one query", async () => {
    const { store } = await warmed();
    const restarted = createPreparedEntities(store);
    expect(restarted.lookup("Invest Qatar").kind).toBe("NONE");
    const counter = createRoundTripCounter("restart");
    await withRoundTripCounter(counter, () => restarted.start());
    expect(counter.count).toBe(1);
    expect(restarted.lookup("Invest Qatar").kind).toBe("FOUND");
    expect(restarted.all()).toHaveLength(5);
  });

  it("reloads when the store version changes, and only then", async () => {
    const { store, entities, calls } = await warmed();
    expect(await entities.refreshIfChanged()).toBe(false);
    expect(calls).toEqual({ list: 1, version: 1 });
    const entity = seed.entities[0];
    if (entity === undefined) throw new Error("seed has entities");
    // Same content: still unchanged. A corrected fact: reload.
    await loadPreparedSeed(store, seed, options);
    expect(await entities.refreshIfChanged()).toBe(false);
    const changed = structuredClone(seed);
    const first = changed.entities[0];
    if (first === undefined) throw new Error("seed has entities");
    first.one_line = "Finance executive in Doha.";
    await loadPreparedSeed(store, changed, options);
    expect(await entities.refreshIfChanged()).toBe(true);
    const line = preparedEntityPrewarmLines(entities.all()).find((l) =>
      l.startsWith("Shadi Qishta"),
    );
    expect(line).toContain("Finance executive in Doha.");
  });
});

describe("prepared research entities: counterparts and prewarm", () => {
  it("an organisation never gets a personal mandate; a person is a labelled simulation", async () => {
    const { entities } = await warmed();
    for (const record of entities.all()) {
      const counterpart = rehearsalCounterpart(record);
      if (record.entityKind === "PERSON") {
        expect(counterpart.kind).toBe("SOURCE_INFORMED_SIMULATION");
        expect(counterpart.label).toContain(`not ${record.displayName}`);
      } else {
        expect(counterpart.kind).toBe("ROLE_REPRESENTATIVE");
        expect(
          counterpart.kind === "ROLE_REPRESENTATIVE" &&
            counterpart.personalMandate,
        ).toBeNull();
        expect(counterpart.label).toMatch(/not a real person/u);
      }
    }
  });

  it("the Live context carries a compact list (names, kind, one line, ids), no facts", async () => {
    const { entities } = await warmed();
    const lines = preparedEntityPrewarmLines(entities.all());
    expect(lines).toHaveLength(5);
    const text = liveContextPackage({
      role: "founder",
      facts: null,
      referents: ["Acme Robotics"],
      preparedEntities: lines,
    });
    expect(text).toContain("Muhannad Taslaq (person, ");
    expect(text).toContain("Invest Qatar (government agency, ");
    expect(text).toContain("Acme Robotics");
    expect(text).not.toMatch(/Gulf Times|S16|30-day/u);
    expect(text?.length ?? 0).toBeLessThanOrEqual(1_600);
  });
});
