import { createHash } from "node:crypto";

import { RESEARCH_BOUNDS } from "../contracts.js";

/**
 * Bounded excerpts of public pages (CQ-Q-RESEARCH-001 §12, §15).
 *
 * What a provider returns is UNTRUSTED DATA. It is trimmed to a size an
 * evidence item can hold, stripped of markup that carries no meaning to a
 * reader, hashed for de-duplication, and scanned for instruction-shaped
 * text so the fact that a page tried to instruct Q is visible — the scan
 * changes nothing about how the text is treated, because no page text is
 * ever obeyed in the first place. A signal is a count and a category; the
 * matched sentence is never surfaced.
 */

export const INSTRUCTION_RISK_CATEGORIES = [
  "override_instructions",
  "reveal_system_prompt",
  "exfiltrate_data",
  "invoke_tool",
  "change_policy",
] as const;
export type InstructionRiskCategory =
  (typeof INSTRUCTION_RISK_CATEGORIES)[number];

const RISK_RULES: readonly {
  readonly category: InstructionRiskCategory;
  readonly pattern: RegExp;
}[] = [
  {
    category: "override_instructions",
    pattern:
      /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|all)\b[^.\n]{0,20}\binstructions?\b/i,
  },
  {
    category: "reveal_system_prompt",
    pattern:
      /\b(reveal|print|show|repeat|output)\b[^.\n]{0,40}\b(system prompt|instructions|hidden prompt)\b/i,
  },
  {
    category: "exfiltrate_data",
    pattern:
      /\b(send|post|forward|upload|email)\b[^.\n]{0,60}\b(all|user|customer|private|confidential)\b[^.\n]{0,40}\b(data|information|details)\b/i,
  },
  {
    category: "invoke_tool",
    pattern:
      /\b(call|invoke|run|execute|use)\b[^.\n]{0,30}\b(tool|function|get_company|search_companies|research_public_web|extract_public_web)\b/i,
  },
  {
    category: "change_policy",
    pattern:
      /\b(you are now|act as|new (?:system )?policy|grant(?:ed)? (?:yourself |me )?(?:access|permission)|change (?:the )?tenant)\b/i,
  },
];

export function scanExcerptForInstructions(
  text: string,
): readonly InstructionRiskCategory[] {
  const sample = text.slice(0, 200_000);
  return RISK_RULES.filter((rule) => rule.pattern.test(sample)).map(
    (rule) => rule.category,
  );
}

/** Markdown images, links (keeping the visible text), scripts and long runs of whitespace. */
export function cleanPublicText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]{1,200}>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]{1,200})\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type BoundedExcerpt = {
  readonly text: string;
  readonly truncated: boolean;
  /** SHA-256 of the bounded text, for de-duplicating retrievals of a page. */
  readonly sha256: string;
  readonly instructionRisk: readonly InstructionRiskCategory[];
};

export function boundExcerpt(
  raw: string,
  maxChars: number = RESEARCH_BOUNDS.maxExcerptChars,
): BoundedExcerpt {
  const cleaned = cleanPublicText(raw);
  const truncated = cleaned.length > maxChars;
  const text = truncated
    ? `${cleaned.slice(0, maxChars - 1).trimEnd()}…`
    : cleaned;
  return {
    text,
    truncated,
    sha256: createHash("sha256").update(text).digest("hex"),
    instructionRisk: scanExcerptForInstructions(cleaned),
  };
}
