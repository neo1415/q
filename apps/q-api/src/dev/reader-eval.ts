/**
 * Turn reader before/after (coordinator 2026-10-26, TURN_READER v68): the
 * same turns read by v67 twice (how much the model varies on its own) and
 * by v68 once, compared on the fields that route a turn. A case changed
 * only when v67 agreed with itself and v68 read it differently.
 *
 *   (cd apps/q-api && node src/dev/reader-eval.ts --dry-run)
 *   EVAL_TENANT_ID=… EVAL_USER_ID=… (q-api's own environment: DATABASE_URL,
 *   the OpenAI key) node src/dev/reader-eval.ts (from apps/q-api)
 *
 * Fictional turns only; every call is recorded in ai_ops.model_usage under
 * the eval's tenant, so its exact cost is read from there. No tool runs,
 * nothing is written but the usage rows.
 */
import { randomUUID } from "node:crypto";

import { loadDatabaseConfig } from "@capital-q/config/database";
import { parseQApiConfig } from "@capital-q/config/q-api";
import { createRequestDatabaseClient } from "@capital-q/database";
import {
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  createProcessLocalProviderHealth,
} from "@capital-q/model-gateway";
import { createOpenAIModelProvider } from "@capital-q/model-gateway/providers/openai";
import {
  createQTurnReader,
  type QTurnReading,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  type PromptRegistry,
} from "@capital-q/q-core";
import { Q_CAPABILITIES } from "@capital-q/q-tools";

/** Observed on production, 48 h to 2026-10-26: 619 reader calls, $1.673. */
const COST_PER_READ_USD = 0.0027;

type Case = {
  readonly id: string;
  readonly area: string;
  readonly said: string;
  readonly recent?: readonly { role: "USER" | "Q"; text: string }[];
  readonly shown?: string;
};

const FIVE_SHOWN =
  'T1: said "Ranked by fit with your mandate, the top five: Dawaledger at 7.6, Marketlight Grids at 7.6, Tarmacly at 7.6, Harbourline Cargo at 7.6 and Koolboks at 7." | showed [{"#":1,"kind":"ANSWER_CARDS","cards":[{"#":1,"name":"Dawaledger"},{"#":2,"name":"Marketlight Grids"},{"#":3,"name":"Tarmacly"},{"#":4,"name":"Harbourline Cargo"},{"#":5,"name":"Koolboks"}]}]';
const TWO_SHOWN =
  'T1: said "Two fit best: Anchor at 8.1 and Afyascan at 7.9." | showed [{"#":1,"kind":"ANSWER_CARDS","cards":[{"#":1,"name":"Anchor"},{"#":2,"name":"Afyascan"}]}]';
const ONBOARDING_Q = {
  role: "Q" as const,
  text: "What stage are you raising at, and roughly how much?",
};

export const CASES: readonly Case[] = [
  // Compare
  {
    id: "cmp-top-two",
    area: "compare",
    said: "How do the top two stack up?",
    shown: FIVE_SHOWN,
  },
  {
    id: "cmp-first-three",
    area: "compare",
    said: "Compare the first three in a table.",
    shown: FIVE_SHOWN,
  },
  {
    id: "cmp-they",
    area: "compare",
    said: "How do they stack up?",
    shown: TWO_SHOWN,
  },
  {
    id: "cmp-named",
    area: "compare",
    said: "Which is better, Anchor or Afyascan?",
  },
  {
    id: "cmp-fit-choice",
    area: "compare",
    said: "Would you pick Mizan or Silo Credit for my fund?",
  },
  { id: "cmp-fr", area: "compare", said: "Compare-les.", shown: TWO_SHOWN },
  {
    id: "cmp-second-fact",
    area: "compare",
    said: "What was the second one's raise?",
    shown: FIVE_SHOWN,
  },
  // ADVICE
  { id: "adv-next", area: "ADVICE", said: "What should I do next?" },
  { id: "adv-raise", area: "ADVICE", said: "What could stop my raise?" },
  {
    id: "adv-safe",
    area: "ADVICE",
    said: "What is a SAFE, and should I use one?",
  },
  {
    id: "adv-pitch",
    area: "ADVICE",
    said: "What do you think of my pitch video?",
  },
  { id: "adv-mandate", area: "ADVICE", said: "Is my mandate too narrow?" },
  // Public facts
  {
    id: "pub-founder",
    area: "PUBLIC_FACTS",
    said: "Who is the founder of Paystack?",
  },
  {
    id: "pub-yc",
    area: "PUBLIC_FACTS",
    said: "Which African fintechs did YC back this year?",
  },
  {
    id: "pub-market",
    area: "PUBLIC_FACTS",
    said: "How big is the mini-grid market in Nigeria?",
  },
  {
    id: "pub-news",
    area: "PUBLIC_FACTS",
    said: "Any news on Flutterwave this week?",
  },
  // Requests to act
  {
    id: "act-five",
    area: "TOOL_REQUEST",
    said: "Show me the five companies that best fit my mandate.",
  },
  { id: "act-pass", area: "TOOL_REQUEST", said: "Pass on Ajopot." },
  {
    id: "act-save",
    area: "TOOL_REQUEST",
    said: "Put Ajopot in my saved list.",
  },
  {
    id: "act-share",
    area: "TOOL_REQUEST",
    said: "Share our financial model with Savanna Seed Partners.",
  },
  {
    id: "act-reminder",
    area: "TOOL_REQUEST",
    said: "Remind me tomorrow at 9 to call Zino.",
  },
  { id: "act-open", area: "TOOL_REQUEST", said: "Open the data room." },
  {
    id: "act-filters",
    area: "TOOL_REQUEST",
    said: "Only verified fintechs in Kenya.",
  },
  {
    id: "act-investors",
    area: "TOOL_REQUEST",
    said: "Just find me three Qatari investors.",
  },
  {
    id: "act-board",
    area: "TOOL_REQUEST",
    said: "Save that plan to my board.",
  },
  {
    id: "act-team",
    area: "TOOL_REQUEST",
    said: "We're going into diligence on Harbourline Cargo next week. Get the team ready.",
  },
  // Outward drafts
  {
    id: "out-email",
    area: "outward",
    said: "Draft a short update email to Savanna Seed Partners about our latest traction.",
  },
  {
    id: "out-reply",
    area: "outward",
    said: "Savanna Seed asked about our gross margin per litre. Draft a short reply saying we will share it after reconciling September, then send it.",
  },
  {
    id: "out-note",
    area: "outward",
    said: "Draft a short note to Basketari's founders asking about their repeat-order rate.",
  },
  {
    id: "out-meeting",
    area: "outward",
    said: "Get me a meeting with Zino Aviation next week.",
  },
  {
    id: "out-interest",
    area: "outward",
    said: "Express interest in Clinicrest.",
  },
  {
    id: "out-pidgin",
    area: "outward",
    said: "Abeg send Savanna small message say we go share am next week.",
  },
  // Onboarding replies
  {
    id: "onb-stage",
    area: "onboarding",
    said: "Seed, about $1.5 million.",
    recent: [ONBOARDING_Q],
  },
  {
    id: "onb-skip",
    area: "onboarding",
    said: "Skip that for now.",
    recent: [ONBOARDING_Q],
  },
  {
    id: "onb-correct",
    area: "onboarding",
    said: "No, pre-seed, not seed.",
    recent: [ONBOARDING_Q],
  },
  {
    id: "onb-question",
    area: "onboarding",
    said: "Why do you need that?",
    recent: [ONBOARDING_Q],
  },
  {
    id: "onb-yes",
    area: "onboarding",
    said: "Yes, that's right.",
    recent: [
      {
        role: "Q",
        text: "So you're raising a $1.5 million seed round. Right?",
      },
    ],
  },
  // Not for Q, small talk, control
  { id: "oth-aside", area: "other", said: "Hold on, Tunde, I'm on a call." },
  { id: "oth-thanks", area: "other", said: "Thanks, that's helpful." },
  { id: "oth-scroll", area: "other", said: "Scroll down." },
];

/** What decides the route a turn takes; free text varies and is not compared. */
export function routeOf(reading: QTurnReading | null | undefined): string {
  if (reading === null || reading === undefined) return "UNREAD";
  const r = reading as unknown as Record<string, unknown>;
  const pick = (value: unknown, keys: readonly string[]): unknown =>
    value === null || typeof value !== "object"
      ? (value ?? null)
      : Object.fromEntries(
          keys.map((key) => [
            key,
            (value as Record<string, unknown>)[key] ?? null,
          ]),
        );
  return JSON.stringify({
    kind: r["kind"],
    question: pick(r["question"], ["kind"]),
    tool: pick(r["tool"], ["kind"]),
    appAction: pick(r["appAction"], ["tool"]),
    askedAction: r["askedAction"] ?? null,
    handOver: r["handOver"] != null,
    compare: pick(r["compare"], ["count"]),
    fromShown: r["fromShown"] != null,
    replyTo: pick(r["replyTo"], ["kind"]),
    discoverWhom: r["discoverWhom"] ?? null,
    addressedToQ: r["addressedToQ"] ?? true,
    teamJob: r["teamJob"] ?? false,
    nextSteps: r["nextSteps"] ?? false,
    control: r["control"] ?? null,
  });
}

const say = (...lines: readonly string[]): void => {
  process.stdout.write(`${lines.join("\n")}\n`);
};

function pinned(version: number): PromptRegistry {
  const registry = createDefaultPromptRegistry();
  const record = registry.get("TURN_READER", version);
  if (record === undefined)
    throw new Error(`TURN_READER v${version} is not registered`);
  return {
    ...registry,
    getActive: (id) => (id === "TURN_READER" ? record : registry.getActive(id)),
  };
}

const ACTIONS = Q_CAPABILITIES.flatMap((capability) =>
  capability.performedBy.kind === "TOOL"
    ? [
        {
          name: capability.performedBy.providerName,
          does: capability.does,
          ...(capability.short === undefined
            ? {}
            : { short: capability.short }),
          ...(capability.area === undefined ? {} : { area: capability.area }),
        },
      ]
    : [],
);

async function main(): Promise<void> {
  const reads = CASES.length * 3;
  say(
    `${String(CASES.length)} cases x 3 reads (v67, v67 again, v68) = ${String(reads)} reads, ~$${(reads * COST_PER_READ_USD).toFixed(2)}`,
  );
  if (process.argv.includes("--dry-run")) return;
  const tenantId = process.env["EVAL_TENANT_ID"];
  const userId = process.env["EVAL_USER_ID"];
  if (tenantId === undefined || userId === undefined) {
    throw new Error(
      "EVAL_TENANT_ID and EVAL_USER_ID (a fictional account) are required",
    );
  }
  const config = parseQApiConfig(process.env);
  const openai = config.secrets.modelProviders.openai;
  if (openai === undefined) throw new Error("the OpenAI key is not configured");
  const database = createRequestDatabaseClient(loadDatabaseConfig());
  const logger = createLogger(
    { serviceName: "q-reader-eval", environment: "local" },
    { level: "warn" },
  );
  const gateway = createModelGateway({
    catalog: createPostgresModelCatalog({ sql: database.sql }),
    registry: createModelProviderRegistry([
      createOpenAIModelProvider({ apiKey: openai.reveal() }),
    ]),
    usage: createPostgresModelUsageRepository({ sql: database.sql }),
    health: createProcessLocalProviderHealth(),
    logger,
  });
  const reader = (version: number) =>
    createQTurnReader({ gateway, logger, registry: pinned(version) });
  const [before, again, after] = [reader(67), reader(67), reader(68)];
  const started = new Date().toISOString();
  let changed = 0;
  let noisy = 0;
  for (const turn of CASES) {
    const input = {
      utterance: turn.said,
      recentTurns: [...(turn.recent ?? [])],
      modality: "TEXT" as const,
      actions: ACTIONS,
      shown: turn.shown ?? "",
      attribution: {
        tenantId,
        userId,
        correlationId: `cor_${randomUUID()}`,
      },
    };
    const [a, b, c] = await Promise.all(
      [before, again, after].map(
        async (one) => (await one.read(input).catch(() => null)) ?? null,
      ),
    );
    const [ra, rb, rc] = [routeOf(a), routeOf(b), routeOf(c)];
    const stable = ra === rb;
    const verdict = !stable ? "NOISE" : ra === rc ? "SAME" : "CHANGED";
    if (verdict === "CHANGED") changed += 1;
    if (verdict === "NOISE") noisy += 1;
    say(`${verdict.padEnd(7)} ${turn.area.padEnd(12)} ${turn.id}`);
    if (verdict !== "SAME") say(`   v67 ${ra}\n   v67 ${rb}\n   v68 ${rc}`);
  }
  say(
    `changed ${String(changed)}, v67 disagreed with itself ${String(noisy)}, of ${String(CASES.length)}. Usage since ${started}: ai_ops.model_usage where tenant_id='${tenantId}' and occurred_at >= '${started}'.`,
  );
  await database.close?.();
}

await main();
