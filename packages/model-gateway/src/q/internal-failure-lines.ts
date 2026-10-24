/**
 * QA F-107 (24 Oct 2026, run bad4b716): "How is my pitch video doing?"
 * ended with "I couldn't revise the pitch deck because the first document
 * reference was invalid". How a tool call failed is Capital Q's, never the
 * person's: a sentence that reports one in system words is dropped.
 */
const INTERNAL_FAILURE =
  /\b(?:document|artifact|file|tool|record)\s+(?:reference|id|identifier|ref)\b[^.!?]*\b(?:invalid|not valid|malformed)\b|\binvalid\s+(?:document|artifact|tool|input|argument|reference|id|identifier)\b|\b(?:INVALID_INPUT|NOT_AVAILABLE|NOT_ASKED|tool call|function call)\b/iu;

const SENTENCES = /(?<=[.!?])\s+(?=[\p{Lu}"'“‘([])/u;

/** The text without sentences that report an internal failure; all of it if every one does. */
export function withoutInternalFailureLines(text: string): string {
  const kept = text
    .split(/(\n+)/u)
    .map((part) =>
      /^\n+$/u.test(part)
        ? part
        : part
            .split(SENTENCES)
            .filter((sentence) => !INTERNAL_FAILURE.test(sentence))
            .join(" "),
    )
    .join("")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return kept.length === 0 ? text : kept;
}
