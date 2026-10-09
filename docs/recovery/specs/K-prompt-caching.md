# K Part 7: prompt caching

Owner: B. Status: researched and partly measured; no live provider calls were made for this note.

## 1. What the configured providers do

These points come from the providers' documentation as I know it, not from a fetch made for this note. Check them against the current pages before relying on any number.

| Provider (gateway code)                                      | Caching                                                                                                                                                                            | What breaks a hit                                                        | Reported as                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| Google Gemini (`google`), FAST_CLASSIFICATION and most turns | Implicit caching is automatic on 2.5+ models, from a minimum prompt size (about 1–4k tokens by model). Explicit cached contents (`cachedContents`) can also be created with a TTL. | Any change before the cached part. Hits are best-effort, not guaranteed. | `usageMetadata.cachedContentTokenCount`     |
| OpenAI (`openai`)                                            | Automatic prefix caching for prompts of 1,024 tokens and more, in 128-token steps.                                                                                                 | Any change in the prefix, which includes the tool list and its order.    | `usage.prompt_tokens_details.cached_tokens` |
| Groq (`groq`)                                                | Prompt caching on some models only. Treat it as absent unless a model's page says otherwise.                                                                                       | Not relied on.                                                           | Reported only where supported.              |

All three charge cached input tokens at a discount. The hosted price row for gemini-3.5-flash-lite is $0.30 per million input tokens, $0.03 per million cached and $2.50 per million output.

## 2. What hosted shows (ai_ops.model_usage, last 3 days, aggregates only)

- **Turn reader** (FAST_CLASSIFICATION, gemini-3.5-flash-lite, 334 calls): about 6.6k input tokens per call, of which about 3.8k were cached on average (58%). About 178 output tokens. p50 1.21 s, p95 1.77 s.
- **Output is probably the larger cost in time.** On a small model, writing about 180 tokens likely takes most of the 1.2 s; serving the cached input mostly cuts cost. This is an inference, not measured.

## 3. Ordering rule, and where we stand

The rule: stable instructions and tools first, then cacheable authorised context, then the volatile turn data.

- **Prompt registry rendering:** done. `renderPrompt` sends the charter, then the task template, with every variable at the end of the template.
  - The turn reader's variables all sit in the last 200 characters of a 24k template.
  - TURN_SKIM v1 (K fast lane) follows the same layout: about 7k characters of static charter, the task text, then the turn.
- **Conversational analyst:** not yet done. The tool offer changes from turn to turn (tool focus, `use_capability` loading). With OpenAI, tools are part of the cached prefix, so a changed offer misses the cache. Gemini places tools separately.
  - Proposed: offer tools in a stable order by name, and keep the core set constant, so the prefix is identical across turns. Measure before and after with cached-token counts from hosted.
- **Authorised context** (the person's own facts, the Tier A working snapshot) should sit after instructions and tools and before the turn, and be byte-identical between turns while the snapshot is unchanged. The snapshot from Part 4 makes that possible; wiring it into the prompt is the next step.

## 4. Logging

Cached-token counts are already recorded per call in `ai_ops.model_usage.cached_input_tokens`, through the gateway's usage repository, for every provider whose adapter reports them. The turn log (`q answer produced`) carries `modelCalls`, `prepareMs` and `sharedReads`.

To separate the fast lane's TURN_SKIM rows from the turn reader's, look for the `:turn-skim` suffix on the correlation id.

## 5. Next measurements

1. Turn reader against TURN_SKIM, from hosted after the deploy: calls, input, cached and output tokens, p50/p95.
2. Analyst cache hit rate before and after a stable tool order.
3. If implicit hits stay near 58% for the reader, try an explicit Gemini cached content for the static reader prefix. Ask before doing it, because it is a paid resource with a TTL.
