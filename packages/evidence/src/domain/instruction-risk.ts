import type {
  ExtractedBlock,
  InstructionRiskCategory,
  InstructionRiskSignal,
} from "../contracts/extraction.js";
import { blockCharacters } from "../contracts/extraction.js";

/**
 * Instruction-risk signalling (doc 15 §30, doc 16 TM-FILE-05).
 *
 *   document text ≠ instruction
 *
 * A deterministic reader that notices when a document's words are shaped
 * like commands. It exists so that a later Q ingestion knows to be careful,
 * and for no other purpose.
 *
 * What it deliberately does not do: execute anything, call a model, remove
 * or rewrite text, grant or deny any permission, block processing, or decide
 * that a document is fraudulent. A pitch deck saying "ignore previous
 * instructions" is still an ordinary pitch deck whose words carry no
 * authority — deleting the sentence would destroy source content and change
 * nothing about the risk.
 */

type Rule = {
  readonly category: InstructionRiskCategory;
  readonly pattern: RegExp;
};

/**
 * Bounded, literal patterns. Not a classifier and not a security control:
 * it will miss paraphrases, and missing one changes nothing, because no
 * document text is ever obeyed in the first place.
 */
const RULES: readonly Rule[] = [
  {
    category: "override_instructions",
    pattern:
      /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|earlier|above|all)\b[^.\n]{0,20}\b(instruction|prompt|rule|direction)/i,
  },
  {
    category: "override_instructions",
    pattern: /\byou are now\b[^.\n]{0,40}\b(assistant|model|ai|system)\b/i,
  },
  {
    category: "reveal_system_prompt",
    pattern:
      /\b(reveal|print|show|repeat|output)\b[^.\n]{0,30}\b(system prompt|instructions|your prompt|initial prompt)\b/i,
  },
  {
    category: "exfiltrate_data",
    pattern:
      /\b(send|email|forward|upload|post|transmit|leak)\b[^.\n]{0,50}\b(investor|customer|user|private|confidential|internal)\b[^.\n]{0,30}\b(list|data|email|record|detail)/i,
  },
  {
    category: "exfiltrate_data",
    pattern: /\bexfiltrat/i,
  },
  {
    category: "invoke_tool",
    pattern:
      /\b(call|invoke|use|execute|run)\b[^.\n]{0,30}\b(tool|function|api|command|shell|script)\b/i,
  },
  {
    category: "change_policy",
    pattern:
      /\b(disable|bypass|turn off|skip|remove)\b[^.\n]{0,40}\b(safety|guardrail|policy|restriction|filter|permission|authorization)\b/i,
  },
  {
    category: "impersonate_authority",
    pattern:
      /\b(as|this is|i am)\b[^.\n]{0,20}\b(the (system|administrator|developer|owner)|an admin)\b[^.\n]{0,40}\b(instruct|require|authorise|authorize|permit)/i,
  },
];

/** Bounded work: a hostile document must not make this scan expensive. */
const MAX_SCANNED_CHARACTERS = 2_000_000;
const MAX_SIGNALS = 200;

function textOf(block: ExtractedBlock): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "footnote":
      return block.text;
    case "list":
      return block.items.join("\n");
    case "table":
      return block.rows.map((row) => row.join(" ")).join("\n");
    case "slide":
      return `${block.title ?? ""}\n${block.text}`;
    case "page_break":
      return "";
  }
}

export type InstructionRiskReport = {
  readonly signals: readonly InstructionRiskSignal[];
  /** Distinct categories seen. Safe to log and to put in run metadata. */
  readonly categories: readonly InstructionRiskCategory[];
  readonly truncated: boolean;
};

/**
 * Reports where instruction-shaped passages appear. Returns locators and
 * categories only: the matched sentence is document content and stays in the
 * private artifact, never in a signal, a log, an event or a metric.
 */
export function scanInstructionRisk(
  blocks: readonly ExtractedBlock[],
): InstructionRiskReport {
  const signals: InstructionRiskSignal[] = [];
  const categories = new Set<InstructionRiskCategory>();
  let scanned = 0;
  let truncated = false;

  for (const block of blocks) {
    scanned += blockCharacters(block);
    if (scanned > MAX_SCANNED_CHARACTERS) {
      truncated = true;
      break;
    }
    const text = textOf(block);
    if (text.length === 0) continue;
    for (const rule of RULES) {
      if (!rule.pattern.test(text)) continue;
      categories.add(rule.category);
      if (signals.length < MAX_SIGNALS) {
        signals.push({ category: rule.category, locator: block.locator });
      } else {
        truncated = true;
      }
    }
  }

  return { signals, categories: [...categories].sort(), truncated };
}
