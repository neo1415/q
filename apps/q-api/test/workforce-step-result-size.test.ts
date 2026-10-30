import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  jsonBytes,
  ResearchDossierSchema,
  type ResearchDossier,
} from "../src/composition/workforce/deep-research.js";
import {
  checkpointKey,
  createInMemoryAgentWorkQueue,
  RESULTS_MAX_BYTES,
  STEP_RESULT_MAX_BYTES,
  storedStepResult,
} from "../src/composition/workforce/queue.js";

/**
 * Production 2026-10-29 (ed9be6cc4): a deep research step finished (40
 * sources, 60 facts) and was marked FAILED, because its result was written
 * beside its own ~128 KB checkpoint and broke agent_work_queue's results
 * cap (pg_column_size <= 131072). Synthetic, invented sources only.
 */

const pad = (text: string, length: number) =>
  text.padEnd(length, " lorem ipsum dolor sit amet").slice(0, length);

/** A dossier the size the production run made, or the schema's largest. */
function dossierOf(options: {
  readonly sources: number;
  readonly facts: number;
  readonly urlChars: number;
  readonly titleChars: number;
  readonly statementChars: number;
  readonly writerChars: number;
}): ResearchDossier {
  const url = (index: number) =>
    pad(`https://www.example-${index}.test/markets/2026/`, options.urlChars);
  const title = (index: number) =>
    pad(`Zedland widget payments report ${index}`, options.titleChars);
  return {
    version: 1,
    sources: Array.from({ length: options.sources }, (_, at) => ({
      index: at + 1,
      url: url(at + 1),
      domain: `www.example-${at + 1}.test`,
      title: title(at + 1),
      publishedAt: "2026-05-01",
      tier: "OTHER" as const,
      tierKind: null,
    })),
    facts: Array.from({ length: options.facts }, (_, at) => {
      const source = (at % options.sources) + 1;
      return {
        id: `F${at + 1}`,
        statement: pad(
          `Zedland widget payment volume grew in period ${at}`,
          options.statementChars,
        ),
        figure: "USD 1.2bn",
        asOf: "2026-03-31",
        source,
        lane: "market_size",
        kind: "FIGURE",
        domain: `www.example-${source}.test`,
        title: title(source),
        url: url(source),
        publishedAt: "2026-05-01",
        measure: "payment volume",
        entity: "Zedland",
        tier: "OTHER" as const,
        tierKind: null,
        evidenceStatus: "SELF_REPORTED" as const,
        lifecycleStatus:
          at === options.facts - 1
            ? ("CONTRADICTORY" as const)
            : ("CURRENT" as const),
        corroboratedBy: [`F${((at + 1) % options.facts) + 1}`],
        contradicts: at === options.facts - 1 ? ["F1"] : [],
      };
    }),
    lanes: Array.from({ length: 14 }, (_, at) => ({
      lane: `lane_${at}`,
      query: pad(`zedland widget payments question ${at}`, 120),
      status: "OK",
      sources: 3,
    })),
    investigation: {
      rounds: 2,
      stop: "NO_GAPS",
      open: [],
      couldNotRun: [],
      searches: 26,
      modelCalls: 17,
      ms: 61_591,
      scope: "Zedland, from their words.",
    },
    brief: {
      summary: pad("What the question needs.", 600),
      writer: pad("The writer's brief.", options.writerChars),
    },
  };
}

/** What production made: 40 sources, 60 facts, the full writer brief. */
const PRODUCTION = {
  sources: 40,
  facts: 60,
  urlChars: 110,
  titleChars: 90,
  statementChars: 260,
  writerChars: 12_000,
};
/** The largest dossier ResearchDossierSchema admits. */
const LARGEST = {
  sources: 80,
  facts: 80,
  urlChars: 2_000,
  titleChars: 400,
  statementChars: 400,
  writerChars: 12_000,
};

function researchResult(dossier: ResearchDossier) {
  return {
    status: "DONE" as const,
    summary: "Researched 40 public sources.",
    outputs: {
      note: { query: "zedland", truthClass: "UNKNOWN", sources: [] },
      dossier,
    },
  };
}

describe("a finished step's kept result fits the job's row", () => {
  it("measures the production dossier and keeps a compacted, valid copy", () => {
    const dossier = dossierOf(PRODUCTION);
    // The production-sized dossier alone (~78 KB) is past one step's share.
    expect(jsonBytes(dossier)).toBeGreaterThan(STEP_RESULT_MAX_BYTES);
    const stored = storedStepResult(researchResult(dossier), "run-1");
    expect(jsonBytes(stored)).toBeLessThanOrEqual(STEP_RESULT_MAX_BYTES);
    expect(stored.status).toBe("DONE");
    expect(stored.outputs?.["dossierCompacted"]).toBe(true);
    const kept = ResearchDossierSchema.parse(stored.outputs?.["dossier"]);
    // Ranked facts: the top ones stay, and both sides of a contradiction.
    expect(kept.facts[0]?.id).toBe("F1");
    expect(
      kept.facts.some((fact) => fact.lifecycleStatus === "CONTRADICTORY"),
    ).toBe(true);
    // Every kept fact's source is still there; no reference dangles.
    const ids = new Set(kept.facts.map((fact) => fact.id));
    for (const fact of kept.facts) {
      expect(kept.sources.some((one) => one.index === fact.source)).toBe(true);
      for (const id of fact.corroboratedBy ?? [])
        expect(ids.has(id)).toBe(true);
    }
  });

  it("leaves a result that fits as it is", () => {
    const small = dossierOf({
      ...PRODUCTION,
      sources: 4,
      facts: 6,
      writerChars: 500,
    });
    const stored = storedStepResult(researchResult(small), "run-1");
    expect(stored.outputs?.["dossier"]).toEqual(small);
    expect(stored.outputs?.["dossierCompacted"]).toBeUndefined();
  });

  it("drops the checkpoint and records the large dossier under the cap", async () => {
    const queue = createInMemoryAgentWorkQueue();
    const owner = { tenantId: randomUUID(), userId: randomUUID() };
    const jobId = randomUUID();
    await queue.enqueue(owner, { jobId, plan: {}, trace: {} });
    await queue.claim("worker-1", 60_000, 1);
    // A checkpoint as large as production's (~128 KB).
    await queue.recordCheckpoint?.(jobId, "worker-1", "research", {
      status: "CHECKPOINT",
      blob: pad("", 126_000),
    });
    for (const shape of [PRODUCTION, LARGEST]) {
      await queue.recordStep(
        jobId,
        "worker-1",
        "research",
        researchResult(dossierOf(shape)),
        "run-1",
      );
      const [row] = await queue.forOwner(owner, [jobId]);
      expect(jsonBytes(row?.results)).toBeLessThanOrEqual(RESULTS_MAX_BYTES);
      expect(row?.results[checkpointKey("research")]).toBeUndefined();
      const step = row?.results["research"] as
        { status: string; outputs?: Record<string, unknown> } | undefined;
      expect(step?.status).toBe("DONE");
      // A compacted dossier, or (the schema's largest cannot fit at all)
      // one left out by name; never a write past the cap.
      const kept = ResearchDossierSchema.safeParse(step?.outputs?.["dossier"]);
      expect(
        kept.success ||
          (step?.outputs?.["omittedOutputs"] as string[]).includes("dossier"),
      ).toBe(true);
      if (shape === PRODUCTION) expect(kept.success).toBe(true);
    }
  });

  it("keeps several research steps' results on one row", async () => {
    const queue = createInMemoryAgentWorkQueue();
    const owner = { tenantId: randomUUID(), userId: randomUUID() };
    const jobId = randomUUID();
    await queue.enqueue(owner, { jobId, plan: {}, trace: {} });
    await queue.claim("worker-1", 60_000, 1);
    for (const key of [
      "research-a",
      "research-b",
      "research-c",
      "research-d",
    ]) {
      await queue.recordStep(
        jobId,
        "worker-1",
        key,
        researchResult(dossierOf(LARGEST)),
        "run-1",
      );
    }
    const [row] = await queue.forOwner(owner, [jobId]);
    expect(jsonBytes(row?.results)).toBeLessThanOrEqual(RESULTS_MAX_BYTES);
    // Past room for its outputs, a step is still kept as DONE.
    expect(
      (row?.results["research-d"] as { status: string } | undefined)?.status,
    ).toBe("DONE");
  });
});
