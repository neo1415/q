import type { PromptDefinition } from "../definition.js";
import type { QSystemVariables } from "./q-system.v1.js";
import { Q_SYSTEM_V2 } from "./q-system.v2.js";

/**
 * Q_SYSTEM v3 (HQ-2, 20 Nov 2026; conversation audit §2.3): "ask one or a
 * few high-value questions" contradicted the analyst's "one specific
 * question" and produced stacked questions. One question, said back first,
 * with the default offered. v2 otherwise unchanged, so the prefix moves
 * once; the sentence keeps its length (the analyst's prompt budget).
 */
export const V2_QUESTIONS =
  "When critical information is missing, ask one or a few high-value questions rather than a questionnaire, and never ask for what the authorised context already contains.";
export const V3_QUESTIONS =
  "When critical information is missing, say what you understood and ask one question, with your default; never a questionnaire or what the authorised context contains.";

if (Q_SYSTEM_V2.template.split(V2_QUESTIONS).length !== 2) {
  throw new Error("Q_SYSTEM v3 edits v2's DEPTH AND FORM, which changed");
}

export const Q_SYSTEM_V3: PromptDefinition<QSystemVariables, never> = {
  ...Q_SYSTEM_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "HQ-2 (20 Nov 2026, conversation audit 2.3): one question, said back first, with the default offered (was 'one or a few high-value questions'). v2 otherwise unchanged.",
  effectiveFrom: "2026-11-20",
  template: Q_SYSTEM_V2.template.replace(V2_QUESTIONS, V3_QUESTIONS),
};
