#!/usr/bin/env node
/* global process, console */
/**
 * Recovery G: what a LIVE run costs, before and after. No invented numbers.
 *
 *   node scripts/recovery/live-cost.mjs estimate [--text-turns 10] [--voice-minutes 3]
 *        [--audio-in-per-m <USD>] [--audio-out-per-m <USD>]
 *   node scripts/recovery/live-cost.mjs actual --since 2026-10-08T15:00:00Z
 *
 * estimate:
 *   - Text prices come from the local catalogue (ai_ops.model_prices), the
 *     same rows the gateway prices calls with.
 *   - Prompt size per text turn is MEASURED from the last MOCK run's
 *     fake-vendor log (what the product actually sent per turn), converted
 *     at ~4 characters per token (stated approximation).
 *   - Output is bounded above by the task class's max output tokens
 *     (4,096 for NORMAL_DIALOGUE, audit B-04), so the text figure is a ceiling.
 *   - Realtime AUDIO token prices are not in the catalogue (it holds one
 *     text-rate row for gpt-realtime-mini). Pass them from
 *     https://openai.com/api/pricing; without them the voice part is
 *     reported as unknown, and the hard bound is the run's own cap
 *     (CQ_LIVE_BUDGET_USD → CQ_VOICE_REALTIME_DAILY_CAP_USD).
 * actual: sums ai_ops.model_usage.cost_usd in the local database since a
 *   time: what the gateway itself recorded for the run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUN =
  process.env.CQ_RECOVERY_RUN_DIR ??
  resolve(import.meta.dirname, "../../.playwright/recovery-stack");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

function sql(query) {
  return execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_capital-q",
      "psql",
      "-U",
      "postgres",
      "-tA",
      "-F",
      "|",
      "-c",
      query,
    ],
    {
      encoding: "utf8",
    },
  ).trim();
}

function prices() {
  const rows = sql(
    "select m.model_code, p.input_per_million, p.cached_input_per_million, p.output_per_million from ai_ops.model_prices p join ai_ops.models m on m.id = p.model_id join ai_ops.providers pr on pr.id = m.provider_id where pr.code = 'openai' and (p.effective_to is null or p.effective_to > now())",
  );
  return Object.fromEntries(
    rows
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [model, input, cached, output] = line.split("|");
        return [
          model,
          {
            input: Number(input),
            cached: Number(cached),
            output: Number(output),
          },
        ];
      }),
  );
}

function measuredPromptChars() {
  const log = resolve(RUN, "fake-vendors.ndjson");
  if (!existsSync(log)) return null;
  const perRequest = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (entry) =>
        entry.path === "/v1/responses" && typeof entry.input === "string",
    );
  if (perRequest.length === 0) return null;
  const sizes = perRequest
    .map((entry) => entry.input.length)
    .sort((a, b) => a - b);
  // Requests per Q turn: turn reader + analyst rounds + memory extraction.
  return {
    requests: sizes.length,
    median: sizes[Math.floor(sizes.length / 2)],
    max: sizes.at(-1),
  };
}

if (args[0] === "actual") {
  const since = flag("since", null);
  if (since === null || Number.isNaN(Date.parse(since))) {
    console.error("actual needs --since <ISO time>");
    process.exit(2);
  }
  const out = sql(
    `select coalesce(purpose, task_class), count(*), coalesce(sum(cost_usd), 0) from ai_ops.model_usage where occurred_at >= '${new Date(since).toISOString()}' group by 1 order by 3 desc`,
  );
  let total = 0;
  console.log(
    "purpose | calls | recorded cost USD (ai_ops.model_usage, local)",
  );
  for (const line of out.split("\n").filter(Boolean)) {
    const [purpose, calls, cost] = line.split("|");
    total += Number(cost);
    console.log(`${purpose} | ${calls} | ${Number(cost).toFixed(6)}`);
  }
  console.log(`TOTAL | | ${total.toFixed(6)}`);
  console.log(
    "Note: realtime usage is recorded per response with the catalogue's single rate; check the OpenAI usage page for the billed audio figure.",
  );
  process.exit(0);
}

const textTurns = Number(flag("text-turns", 10));
const voiceMinutes = Number(flag("voice-minutes", 3));
const p = prices();
const luna = p["gpt-5.6-luna"];
const measured = measuredPromptChars();
console.log(
  "LIVE run cost estimate (ceiling for text; voice needs audio rates)",
);
if (luna === undefined || measured === null) {
  console.log(
    luna === undefined
      ? "text: unknown (no gpt-5.6-luna price in the local catalogue)"
      : "text: unknown (no MOCK run measured yet: run the suite in MOCK mode first)",
  );
} else {
  // Model calls per Q turn measured in MOCK runs: about 4 (reader, 1-2 analyst rounds, memory).
  const callsPerTurn = 4;
  const inputTokens = (measured.max / 4) * callsPerTurn * textTurns;
  const outputTokens = 4_096 * callsPerTurn * textTurns;
  const text = (inputTokens * luna.input + outputTokens * luna.output) / 1e6;
  console.log(
    `text: ${String(textTurns)} turns x ${String(callsPerTurn)} calls, prompt <= ${String(measured.max)} chars (measured over ${String(measured.requests)} requests, median ${String(measured.median)})`,
  );
  console.log(
    `      prices in/out per M: $${String(luna.input)} / $${String(luna.output)} (ai_ops.model_prices)`,
  );
  console.log(
    `      ceiling: $${text.toFixed(4)} (output at the 4,096-token cap; real output is far smaller)`,
  );
}
const audioIn = flag("audio-in-per-m", null);
const audioOut = flag("audio-out-per-m", null);
if (audioIn === null || audioOut === null) {
  console.log(
    `voice: unknown for ${String(voiceMinutes)} min: pass --audio-in-per-m and --audio-out-per-m from https://openai.com/api/pricing`,
  );
} else {
  // Realtime audio is ~10 tokens per second of input and ~20 per second of
  // output (OpenAI realtime docs' rule of thumb; verify on the pricing page).
  const seconds = voiceMinutes * 60;
  const voice =
    (seconds * 10 * Number(audioIn) + seconds * 0.5 * 20 * Number(audioOut)) /
    1e6;
  console.log(
    `voice: ~$${voice.toFixed(4)} for ${String(voiceMinutes)} min (Q speaking half the time; rates you passed)`,
  );
}
console.log(
  `hard cap: CQ_LIVE_BUDGET_USD sets the realtime daily cap; text has no aggregate cap today (audit F-08), so keep --text-turns small.`,
);
