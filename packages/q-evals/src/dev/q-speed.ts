import { parseDatabaseConfig } from "@capital-q/config/database";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createLogger } from "@capital-q/observability";

import { Q_IQ_DATASET } from "../datasets/q-iq/index.js";
import { runQIq } from "../runner/q-iq.js";
import { createQIqWorldSubject } from "../runner/q-iq-world.js";

/**
 * Q intelligence step 11: where a Q turn's time goes, per stage, through
 * the REAL runtime with the scripted model (no provider call, no cost).
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq \
 *     node packages/q-evals/dist/dev/q-speed.js [--limit 60] [--out f.json]
 *
 * Runs Q-IQ cases (multi-turn, one stored conversation each) and reads the
 * turn log lines Q writes in production ("q answer produced", "q
 * conversation state read"), printing p50/p95 per stage. The scripted
 * model answers at once, so these figures are Capital Q's own time around
 * the model: database reads, the prepare, the checks. The model's own
 * time comes from production logs (firstTextMs, latencyMs).
 */

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[at] ?? null;
}

/** Every numeric field of a log line, flattened ("prepareMs.assemble"). */
function numbers(
  value: unknown,
  prefix: string,
  into: Map<string, number[]>,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    const list = into.get(prefix) ?? [];
    list.push(value);
    into.set(prefix, list);
    return;
  }
  if (typeof value === "boolean") {
    numbers(value ? 1 : 0, prefix, into);
    return;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, field] of Object.entries(value)) {
      numbers(field, prefix.length === 0 ? key : `${prefix}.${key}`, into);
    }
  }
}

const STAGE_LINES: Readonly<Record<string, readonly string[]>> = {
  "q answer produced": [
    "prepareMs",
    "phases",
    "firstTextMs",
    "firstPublishedMs",
    "firstSentenceSinceMessageMs",
    "retrievalRefineMs",
    "checks",
    "totalMs",
    "totalSinceRunMs",
  ],
  "q conversation state read": ["stateMs", "stateCached"],
};

async function main(): Promise<number> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (
    databaseUrl === undefined ||
    !/127\.0\.0\.1|localhost/.test(databaseUrl)
  ) {
    throw new Error(
      "DATABASE_URL must be a LOCAL database: Q-IQ writes fixture rows",
    );
  }
  const limit = Number(arg("--limit") ?? Q_IQ_DATASET.cases.length);
  const db = createRequestDatabaseClient(
    parseDatabaseConfig({
      NODE_ENV: "test",
      CAPITAL_Q_ENV: "local",
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_MAX: "8",
      DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
    }),
  );
  const outer: string[] = [];
  const logger = createLogger(
    { serviceName: "q-speed", environment: "local" },
    {
      level: "debug",
      destination: {
        write: (chunk: string) => {
          outer.push(chunk);
        },
      },
    },
  );
  try {
    const q = await createQIqWorldSubject({
      db,
      providerMode: "FAKE",
      logger,
    });
    const cases = Q_IQ_DATASET.cases.slice(0, limit);
    let result;
    try {
      result = await runQIq(q.subject, cases);
    } finally {
      await q.close();
    }
    const fields = new Map<string, number[]>();
    for (const line of [...q.world().logLines, ...outer]) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== "object") continue;
      const record = parsed as Record<string, unknown>;
      const keys =
        typeof record["msg"] === "string"
          ? STAGE_LINES[record["msg"]]
          : undefined;
      if (keys === undefined) continue;
      for (const key of keys) numbers(record[key], key, fields);
    }
    const stages = Object.fromEntries(
      [...fields]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, values]) => [
          name,
          {
            n: values.length,
            p50: percentile(values, 0.5),
            p95: percentile(values, 0.95),
          },
        ]),
    );
    const report = {
      cases: result.casesRun,
      turns: result.cases.reduce((n, c) => n + c.replies.length, 0),
      score: result.summary.overall.score,
      replyLatencyP50Ms: result.latencyP50Ms,
      replyLatencyP95Ms: result.latencyP95Ms,
      stages,
    };
    const text = JSON.stringify(report, null, 2);
    const out = arg("--out");
    if (out !== undefined) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(out, `${text}\n`);
    }
    console.log(text);
    return 0;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
