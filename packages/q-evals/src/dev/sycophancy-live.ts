import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  DEFAULT_COMMUNICATION_PROFILE,
  Q_SYSTEM_V3,
  renderCommunicationGuidance,
  renderTemplate,
} from "@capital-q/q-core";
import type { ModelMessage } from "@capital-q/contracts";
import {
  ANTHROPIC_ANSWER_MODEL,
  createAnthropicModelProvider,
} from "@capital-q/model-gateway/providers/anthropic";

import {
  gradeSycophancy,
  SYCOPHANCY_CASES,
} from "../datasets/sycophancy/cases.js";

/**
 * HQ-6 sycophancy and directness, LIVE (owner approval 26 Nov 2026, about $1).
 *
 *   ANTHROPIC_API_KEY_FILE=… node packages/q-evals/dist/dev/sycophancy-live.js \
 *     [--budget 1] [--out results.json]
 *
 * Each case's system prompt is Q's own ACTIVE conversation charter
 * (Q_SYSTEM v3, default communication profile) followed by the case's
 * authorised facts; the turn is the person's message. The answer is graded
 * by code (gradeSycophancy), never by a model. DECISIONS 68: live evals
 * spend Anthropic credit only, so production's first model (OpenAI) is not
 * measured here; this measures the charter's pull against agreement on the
 * backup model. Keys are read from a file and never printed. Fictional
 * people and companies only.
 */

// ai_ops.model_prices for the answer model, input at the 1.25x
// cache-write rate: an upper bound, for a hard budget.
const PRICE = { inputPerMillion: 2.5, outputPerMillion: 10 };

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function main(): Promise<void> {
  const keyFile = process.env["ANTHROPIC_API_KEY_FILE"];
  if (keyFile === undefined)
    throw new Error("ANTHROPIC_API_KEY_FILE is required");
  const apiKey = readFileSync(keyFile, "utf8").trim();
  const budget = Number(flag("budget") ?? "1");
  if (!(budget > 0 && budget <= 2))
    throw new Error("--budget must be in (0, 2]");
  const provider = createAnthropicModelProvider({ apiKey });
  const charter = renderTemplate(Q_SYSTEM_V3, {
    operatingMode: "CONTINUOUS_INTELLIGENCE",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    communicationGuidance: renderCommunicationGuidance(
      DEFAULT_COMMUNICATION_PROFILE,
    ),
    environmentNotes: "",
  });
  let spent = 0;
  const rows: {
    id: string;
    kind: string;
    side: string;
    pass: boolean;
    failures: readonly string[];
    answer: string;
    costUsd: number;
  }[] = [];
  for (const one of SYCOPHANCY_CASES) {
    if (spent >= budget * 0.9) {
      console.log(`budget reached at $${spent.toFixed(4)}; stopping`);
      break;
    }
    const system = [
      charter,
      "",
      `You are working with this ${one.side === "FOUNDER" ? "founder" : "investor"}. Authorised context (what Capital Q holds):`,
      ...one.holds.map((fact) => `- ${fact}`),
    ].join("\n");
    const messages: ModelMessage[] = [
      { role: "SYSTEM", content: system },
      { role: "USER", content: one.said },
    ];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const result = await provider.generate(
        {
          modelCode: ANTHROPIC_ANSWER_MODEL,
          messages,
          output: { kind: "TEXT" },
          tools: [],
          maxOutputTokens: 400,
          temperature: undefined,
          reasoning: "NONE",
        },
        {
          signal: controller.signal,
          attemptTimeoutMs: 60_000,
          attempt: 1,
          correlationId: `sycophancy-${randomUUID()}`,
        },
      );
      const input = result.usage?.inputTokens ?? 0;
      const output = result.usage?.outputTokens ?? 0;
      const costUsd =
        (input * PRICE.inputPerMillion + output * PRICE.outputPerMillion) /
        1_000_000;
      spent += costUsd;
      const failures = gradeSycophancy(one, result.text);
      rows.push({
        id: one.id,
        kind: one.kind,
        side: one.side,
        pass: failures.length === 0,
        failures,
        answer: result.text,
        costUsd,
      });
      console.log(
        `${failures.length === 0 ? "PASS" : "FAIL"} ${one.id} ${failures.join("; ")} ($${costUsd.toFixed(4)})`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  const passed = rows.filter((row) => row.pass).length;
  console.log(
    `sycophancy live: ${String(passed)}/${String(rows.length)} pass, model ${ANTHROPIC_ANSWER_MODEL}, charter Q_SYSTEM v${String(Q_SYSTEM_V3.version)}, spent ~$${spent.toFixed(4)}`,
  );
  const out = flag("out");
  if (out !== undefined) {
    writeFileSync(
      out,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          model: ANTHROPIC_ANSWER_MODEL,
          charter: `Q_SYSTEM.v${String(Q_SYSTEM_V3.version)}`,
          spentUsd: spent,
          passed,
          total: rows.length,
          rows,
        },
        null,
        2,
      ),
    );
  }
}

await main();
