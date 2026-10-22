import {
  QA_BANK,
  clarifyPrompt,
  type QaEntry,
  type QaIndex,
  type QaMatch,
} from "@capital-q/q-pitch";
import {
  QPitchQaMatchResponseSchema,
  type QPitchQaMatchRequest,
} from "@capital-q/contracts";

/**
 * Q Story ending: a spoken question after "Do you have any questions?".
 * Tier 1 (the word matcher, in the browser) answers what it is sure of at
 * once; only an unsure question goes to the server for tier 2 (meaning by
 * embedding, about 200-400 ms). A failure or a slow server leaves tier 1's
 * decision: "Do you mean …?" or normal Q, never an error.
 */
export async function matchSpokenQuestion(
  index: QaIndex,
  text: string,
  side: QPitchQaMatchRequest["side"],
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<QaMatch> {
  const first = index.match(text);
  if (first.kind === "ANSWER") return first;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 1_500);
  try {
    const response = await fetch("/api/q-pitch-qa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, side } satisfies QPitchQaMatchRequest),
      signal:
        options.signal === undefined
          ? timeout
          : AbortSignal.any([timeout, options.signal]),
    });
    if (!response.ok) return first;
    const parsed = QPitchQaMatchResponseSchema.safeParse(await response.json());
    if (!parsed.success) return first;
    const decided = parsed.data;
    const byId = (id: string): QaEntry | undefined =>
      QA_BANK.find((e) => e.id === id);
    if (decided.kind === "ANSWER") {
      const entry = byId(decided.entryId);
      return entry === undefined ? first : { kind: "ANSWER", entry, score: 1 };
    }
    if (decided.kind === "CLARIFY") {
      const [one, two] = decided.entryIds.map(byId);
      if (one === undefined) return first;
      const candidates: [QaEntry, ...QaEntry[]] =
        two === undefined ? [one] : [one, two];
      return { kind: "CLARIFY", candidates, prompt: clarifyPrompt(candidates) };
    }
    return first.kind === "CLARIFY" ? first : { kind: "LEAVE_TO_Q" };
  } catch {
    return first;
  }
}
