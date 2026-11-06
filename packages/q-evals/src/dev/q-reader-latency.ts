import { parseDatabaseConfig } from "@capital-q/config/database";
import { createRequestDatabaseClient } from "@capital-q/database";
import type {
  FakeBehaviour,
  ModelProviderRequest,
} from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import { TURN_READER_SCHEMA_NAME } from "@capital-q/q-core";

import { Q_IQ_DATASET } from "../datasets/q-iq/index.js";
import { runQIq } from "../runner/q-iq.js";
import { createQIqWorldSubject } from "../runner/q-iq-world.js";

/**
 * Reader-latency lane (Q intelligence step 11 follow-up): time to Q's first
 * sentence with the TURN READER on the path, through the REAL runtime, with
 * a scripted model whose latencies mirror production (no provider call, no
 * cost).
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq \
 *     node packages/q-evals/dist/dev/q-reader-latency.js \
 *       [--limit 30] [--reader-ms 4000] [--answer-first-ms 1500] \
 *       [--reader-per-input-token-ms 0] [--out f.json]
 *
 * q-speed.ts measures Capital Q's own time with the reader off (FAKE mode
 * reads no turn). Here every turn is read: the scripted model answers the
 * reader's schema with a neutral reading after `--reader-ms` (production
 * live18: 3.9-4.9 s), plus, when given, `--reader-per-input-token-ms` for
 * each input token the provider could not have cached from the previous
 * reading of the same conversation (estimated at four characters a token,
 * the gateway's own estimate). The answer's first words come after
 * `--answer-first-ms` (production: about 1-2 s).
 *
 * Prints p50/p95 of the production log fields per stage, and the reader's
 * prompt size: whole, and the part a prefix cache could not reuse.
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

/** The gateway's own pre-call estimate: about four characters a token. */
function tokensOf(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * OpenAI-style prefix caching: the longest prefix shared with an earlier
 * request, in 128-token blocks, once at least 1,024 tokens. Characters
 * stand in for tokens (x4), which is what the estimate above uses too.
 */
function cachedChars(text: string, earlier: readonly string[]): number {
  let best = 0;
  for (const before of earlier) {
    const max = Math.min(text.length, before.length);
    let at = 0;
    while (at < max && text.charCodeAt(at) === before.charCodeAt(at)) at += 1;
    if (at > best) best = at;
  }
  const blocks = Math.floor(best / (128 * 4));
  return blocks * 128 * 4 >= 1_024 * 4 ? blocks * 128 * 4 : 0;
}

/** A plain question to Q, nothing bound: the reading the default path takes. */
const NEUTRAL_READING = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  answerKind: "LOOKUP",
} as const;

const TURN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "q turn timing": ["readMs", "beforeAnswerMs", "sinceMessageMs", "stateMs"],
  "q answer produced": [
    "firstTextMs",
    "firstPublishedMs",
    "firstSentenceSinceMessageMs",
    "totalSinceRunMs",
  ],
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
  const limit = Number(arg("--limit") ?? 30);
  const readerMs = Number(arg("--reader-ms") ?? 4_000);
  const answerFirstMs = Number(arg("--answer-first-ms") ?? 1_500);
  const perInputTokenMs = Number(arg("--reader-per-input-token-ms") ?? 0);
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
    { serviceName: "q-reader-latency", environment: "local" },
    {
      level: "info",
      destination: {
        write: (chunk: string) => {
          outer.push(chunk);
        },
      },
    },
  );
  // The reader's prompts in this case's conversation, oldest first.
  let caseReads: string[] = [];
  const prompt = {
    chars: [] as number[],
    tokens: [] as number[],
    uncachedTokens: [] as number[],
    delayMs: [] as number[],
  };
  const readerBehaviour = (request: ModelProviderRequest): FakeBehaviour => {
    const text = request.messages.map((m) => m.content).join("\n\n");
    // A hedge or a correction re-sends the same words: counted once.
    const repeat = caseReads.includes(text);
    const uncached = text.length - cachedChars(text, caseReads);
    const delayMs = Math.round(readerMs + perInputTokenMs * tokensOf(uncached));
    const dump = arg("--dump");
    if (dump !== undefined) {
      void import("node:fs").then(({ writeFileSync }) => {
        writeFileSync(dump, JSON.stringify(request.messages, null, 1));
      });
    }
    if (!repeat) {
      prompt.chars.push(text.length);
      prompt.tokens.push(tokensOf(text.length));
      prompt.uncachedTokens.push(tokensOf(uncached));
      prompt.delayMs.push(delayMs);
      caseReads.push(text);
    }
    return { kind: "JSON", value: NEUTRAL_READING, delayMs };
  };
  try {
    const q = await createQIqWorldSubject({
      db,
      providerMode: "FAKE",
      turnReader: true,
      logger,
      scriptedReply: (evalCase, turn) => {
        if (turn === 0) caseReads = [];
        return evalCase.turns[turn]?.reference ?? "";
      },
    });
    // Each turn's script (the case's reference answer) is routed: the
    // reader's schema gets the reading, everything else the answer, after
    // its own delay.
    const world = q.world();
    const setScript = world.setScript;
    Object.assign(world, {
      setScript: (script: readonly FakeBehaviour[]) => {
        setScript(
          script.map((behaviour): FakeBehaviour => ({
            kind: "ROUTED",
            pick: (request) =>
              request.output.kind === "STRUCTURED" &&
              request.output.schemaName === TURN_READER_SCHEMA_NAME
                ? readerBehaviour(request)
                : behaviour.kind === "JSON" || behaviour.kind === "TEXT"
                  ? { ...behaviour, delayMs: answerFirstMs }
                  : behaviour,
          })),
        );
      },
    });
    const cases = Q_IQ_DATASET.cases.slice(0, limit);
    let result;
    try {
      result = await runQIq(q.subject, cases);
    } finally {
      await q.close();
    }
    const fields = new Map<string, number[]>();
    const counts = new Map<string, number>();
    // Per run: from their message to the turn's routing (sinceMessageMs),
    // then from the answer seam's start to the model's first words
    // (firstTextMs). Their sum is the first words since the message; the
    // seam starts right after "q turn timing", so it errs a little low.
    const sinceMessage = new Map<string, number>();
    const firstText = new Map<string, number>();
    for (const line of [...q.world().logLines, ...outer]) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== "object") continue;
      const record = parsed as Record<string, unknown>;
      const msg = record["msg"];
      if (typeof msg !== "string") continue;
      counts.set(msg, (counts.get(msg) ?? 0) + 1);
      if (msg === "q turn timing" && record["speculationAdopted"] === true) {
        counts.set(
          "speculation adopted",
          (counts.get("speculation adopted") ?? 0) + 1,
        );
      }
      const runId = record["qRunId"] ?? record["runId"];
      if (typeof runId === "string") {
        const since = record["sinceMessageMs"];
        const first = record["firstTextMs"];
        if (msg === "q turn timing" && typeof since === "number") {
          sinceMessage.set(runId, since);
        }
        if (msg === "q answer produced" && typeof first === "number") {
          firstText.set(runId, first);
        }
      }
      for (const key of TURN_FIELDS[msg] ?? []) {
        const value = record[key];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const list = fields.get(key) ?? [];
        list.push(value);
        fields.set(key, list);
      }
    }
    const summary = (values: readonly number[]) => ({
      n: values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
    });
    const firstWords = [...sinceMessage].flatMap(([runId, since]) => {
      const first = firstText.get(runId);
      return first === undefined ? [] : [since + first];
    });
    fields.set("firstWordsSinceMessageMs", firstWords);
    const report = {
      config: { limit, readerMs, answerFirstMs, perInputTokenMs },
      cases: result.casesRun,
      turns: result.cases.reduce((n, c) => n + c.replies.length, 0),
      score: result.summary.overall.score,
      replyLatencyP50Ms: result.latencyP50Ms,
      replyLatencyP95Ms: result.latencyP95Ms,
      stages: Object.fromEntries(
        [...fields]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, values]) => [name, summary(values)]),
      ),
      readerPrompt: {
        chars: summary(prompt.chars),
        estimatedTokens: summary(prompt.tokens),
        estimatedUncachedTokens: summary(prompt.uncachedTokens),
        scriptedDelayMs: summary(prompt.delayMs),
      },
      lines: Object.fromEntries(
        [
          "q early reading not used",
          "q voice speculation",
          "speculation adopted",
          "a turn to Q was not read on the first try",
        ].map((name) => [name, counts.get(name) ?? 0]),
      ),
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
