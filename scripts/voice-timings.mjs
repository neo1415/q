#!/usr/bin/env node
/* global process, console */
/**
 * Where spoken turns spend their time, read from q-api's own log
 * (CQ-VOICE-010).
 *
 *   railway logs --service @capital-q/q-api --json | node scripts/voice-timings.mjs
 *   node scripts/voice-timings.mjs < q-api.log
 *
 * Reads JSON log lines on stdin and keeps the "voice turn timed" ones.
 * Both q-api's own pino lines and Railway's JSON wrapper are accepted,
 * with the fields either at the top level or under `attributes`. Prints
 * percentiles for each stage of a turn, measured from the moment the turn
 * reached Q (the think request, sent once the speech provider decided the
 * person had finished):
 *
 *   reasoningStartMs  first model call began
 *   reasoningEndMs    last model call ended
 *   firstTextMs       Q's first words went to the provider
 *   ttsRequestMs      the provider asked the speak relay for audio
 *   firstAudioMs      the first audio byte came back from the voice vendor
 *   ttsFirstByteMs    firstAudioMs - ttsRequestMs (the voice alone)
 *
 * It also prints which engine voiced each utterance, the fallback rate,
 * the cues rendered, and the median time of each step (model, API or
 * memory) by label. Nothing in these lines is anything a person said.
 */
import { createInterface } from "node:readline";

const wanted = "voice turn timed";
const turns = [];

function fieldsOf(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const flat = { ...parsed, ...(parsed.attributes ?? {}) };
  const message = flat.msg ?? flat.message;
  if (message !== wanted) {
    // Railway may carry the original line as a string.
    if (typeof flat.message === "string" && flat.message.includes(wanted)) {
      return fieldsOf(flat.message);
    }
    return null;
  }
  return flat;
}

function percentile(values, p) {
  const sorted = values
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo));
}

function row(name, values) {
  const present = values.filter((v) => typeof v === "number");
  return {
    stage: name,
    n: present.length,
    p50: percentile(present, 0.5),
    p90: percentile(present, 0.9),
    p95: percentile(present, 0.95),
    max: present.length === 0 ? null : Math.max(...present),
  };
}

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const fields = fieldsOf(line);
  if (fields !== null) turns.push(fields);
}

if (turns.length === 0) {
  console.log(`No "${wanted}" lines on stdin.`);
  process.exit(1);
}

const spoken = turns.filter((t) => t.outcome === "SPOKEN");
const stage = (key, list = spoken) => list.map((t) => t[key]);
console.log(
  `${turns.length} turns (${spoken.length} spoken; stages below are spoken turns only)`,
);
console.table([
  row("reasoningStartMs", stage("reasoningStartMs")),
  row("reasoningEndMs", stage("reasoningEndMs")),
  row("firstTextMs", stage("firstTextMs")),
  row("ttsRequestMs", stage("ttsRequestMs")),
  row("firstAudioMs", stage("firstAudioMs")),
  row(
    "ttsFirstByteMs",
    spoken.map((t) =>
      typeof t.firstAudioMs === "number" && typeof t.ttsRequestMs === "number"
        ? t.firstAudioMs - t.ttsRequestMs
        : undefined,
    ),
  ),
  row("modelMs", stage("modelMs")),
]);

const count = (values) =>
  values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map());
console.log("outcomes", Object.fromEntries(count(turns.map((t) => t.outcome))));
const engines = turns.flatMap((t) => t.ttsEngines ?? []);
console.log("utterances by engine", Object.fromEntries(count(engines)));
const fallbacks = turns.reduce((n, t) => n + (t.ttsFallbacks ?? 0), 0);
console.log(
  `tts fallbacks: ${fallbacks} of ${engines.length} utterances${engines.length === 0 ? "" : ` (${((100 * fallbacks) / engines.length).toFixed(1)}%)`}`,
);
console.log(
  "cues rendered",
  Object.fromEntries(count(turns.flatMap((t) => t.cues ?? []))),
);

const steps = new Map();
for (const t of spoken) {
  for (const s of t.steps ?? []) {
    const key = `${s.k} ${s.l}`;
    steps.set(key, [...(steps.get(key) ?? []), s.ms]);
  }
}
console.table(
  [...steps.entries()]
    .map(([key, values]) => row(key, values))
    .sort((a, b) => (b.p50 ?? 0) - (a.p50 ?? 0)),
);
const models = count(
  spoken.flatMap((t) =>
    (t.steps ?? []).filter((s) => s.k === "model").map((s) => s.d ?? "?"),
  ),
);
console.log("model calls by outcome", Object.fromEntries(models));
