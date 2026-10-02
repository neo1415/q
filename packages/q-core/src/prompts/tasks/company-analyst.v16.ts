import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV15Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V15 } from "./company-analyst.v15.js";

/**
 * COMPANY_ANALYST v16 -- v15 in prompt-cache order (lead 2026-10-02: the
 * provider reuses an identical prefix). Every value of this turn moves to
 * the end, under THIS TURN: the capability and subject (v15's first two
 * lines), this turn's notes from Capital Q (moved out of the charter),
 * the institutional notes and the memory. Where they were, the text says
 * where to find them. The wording and the schema are v15's.
 */
const V15_HEAD =
  "Capability requested: {{capability}}.\nSubject: {{subjectDescription}}.\n";
const V16_HEAD =
  "(This turn's capability, subject and notes: THIS TURN, at the end.)\n";
const V15_INSTITUTIONAL = "{{institutionalNotes}}";
const V16_INSTITUTIONAL = "(See THIS TURN.)";
const V15_MEMORY = "{{memory}}";
const V16_MEMORY = "(See THIS TURN.)";
const V15_FACTS = "AUTHORISED FACTS\n{{authorisedFacts}}";
export const COMPANY_ANALYST_V16_TURN = `THIS TURN
Capability requested: {{capability}}. Subject: {{subjectDescription}}.
NOTES (Capital Q, trusted): {{turnNotes}}
INSTITUTIONAL NOTES: {{institutionalNotes}}
MEMORY: {{memory}}

${V15_FACTS}`;

for (const anchor of [V15_HEAD, V15_INSTITUTIONAL, V15_MEMORY, V15_FACTS]) {
  if (COMPANY_ANALYST_V15.template.split(anchor).length !== 2) {
    throw new Error(
      `COMPANY_ANALYST v16 reorders v15, which changed: ${anchor}`,
    );
  }
}

export const COMPANY_ANALYST_V16: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV15Result
> = {
  ...COMPANY_ANALYST_V15,
  version: 16,
  status: "ACTIVE",
  changeDescription:
    "Lead 2026-10-02 (speed): v15 in prompt-cache order -- capability, subject, this turn's notes, institutional notes and memory moved to a THIS TURN tail; wording and schema unchanged.",
  effectiveFrom: "2026-10-02",
  template: COMPANY_ANALYST_V15.template
    .replace(V15_HEAD, V16_HEAD)
    .replace(V15_INSTITUTIONAL, V16_INSTITUTIONAL)
    .replace(V15_MEMORY, V16_MEMORY)
    .replace(V15_FACTS, COMPANY_ANALYST_V16_TURN),
};
