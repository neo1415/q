// Live calibration for the turn timing harness (turn latency round 6):
// time to the first token and tokens per second of the answer models the
// routing policies name, on the real COMPANY_ANALYST v26 prompt rendered
// with SYNTHETIC facts. Through the repo's own provider adapter; no
// customer data. Reports numbers only.
//
//   NODE_USE_ENV_PROXY=1 node scripts/handoff/live/answer-model-latency.mjs [runs]
//
// Cost: a few thousand input tokens and up to 1,200 output tokens per call;
// well under $0.05 for the default 2 runs x 2 models.
import { createGoogleModelProvider } from "../../../packages/model-gateway/dist/providers/google.js";
import {
  createDefaultPromptRegistry,
  renderPrompt,
  SYNTHETIC_COMPANY_FACTS,
  DEFAULT_COMMUNICATION_PROFILE,
} from "../../../packages/q-core/dist/index.js";
import { operatingModeForCapability } from "../../../packages/model-gateway/dist/q/index.js";

const runs = Number(process.argv[2] ?? "2");
const key = process.env.GEMINI_API_KEY;
if (!key || key.startsWith("disabled")) {
  console.error("GEMINI_API_KEY is not set");
  process.exit(2);
}
const registry = createDefaultPromptRegistry();
const facts = [...SYNTHETIC_COMPANY_FACTS];
while (facts.length < 40) facts.push(...SYNTHETIC_COMPANY_FACTS);
const rendered = renderPrompt(registry, {
  task: "COMPANY_ANALYST",
  operatingMode: operatingModeForCapability("ANSWER"),
  communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
  environmentNotes: "",
  variables: {
    capability: "ANSWER",
    userMessage:
      "What are the main risks with Northwind Ledger for a seed investor?",
    conversation: [],
    authorisedFacts: facts.slice(0, 40),
    subjectDescription: "Northwind Ledger (synthetic)",
    turnNotes: "",
  },
});
const chars = rendered.messages.reduce((n, m) => n + m.content.length, 0);
console.log(
  `prompt: ${rendered.bundle.bundleVersion}, ${String(chars)} characters`,
);
const google = createGoogleModelProvider({
  apiKey: key,
  additionalApiKeys: process.env.GEMINI_API_KEY2
    ? [process.env.GEMINI_API_KEY2]
    : [],
});
const openaiKey = process.env.OPENAI_API_KEY;
const openai =
  openaiKey && !openaiKey.startsWith("disabled")
    ? (
        await import("../../../packages/model-gateway/dist/providers/openai.js")
      ).createOpenAIModelProvider({ apiKey: openaiKey })
    : null;
const targets = [
  [google, "gemini-3.5-flash-lite"],
  [google, "gemini-3.5-flash"],
  ...(openai === null ? [] : [[openai, "gpt-5.6-luna"]]),
];
for (const [provider, modelCode] of targets) {
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    let first = null;
    try {
      const result = await provider.generate(
        {
          modelCode,
          messages: rendered.messages,
          output: rendered.output,
          tools: [],
          maxOutputTokens: 1_200,
          temperature: undefined,
          reasoning: "NONE",
        },
        {
          signal: AbortSignal.timeout(60_000),
          attemptTimeoutMs: 60_000,
          attempt: 1,
          correlationId: `cor_latency_${String(run)}`,
          onTextDelta: () => {
            first ??= performance.now() - started;
          },
        },
      );
      const total = performance.now() - started;
      const out =
        result.usage?.outputTokens ?? Math.round(result.text.length / 4);
      const genMs = total - (first ?? total);
      console.log(
        `${modelCode} run ${String(run + 1)}: first token ${String(Math.round(first ?? -1))} ms, total ${String(Math.round(total))} ms, output ${String(out)} tokens, ${genMs > 0 ? String(Math.round((out / genMs) * 1000)) : "-"} tokens/s, input ${String(result.usage?.inputTokens ?? "?")}`,
      );
    } catch (error) {
      console.log(
        `${modelCode} run ${String(run + 1)}: failed ${error?.failureClass ?? ""} ${String(error?.message ?? error).slice(0, 160)}`,
      );
    }
  }
}
