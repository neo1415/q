import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV22Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V16_TURN } from "./company-analyst.v16.js";
import { COMPANY_ANALYST_V22 } from "./company-analyst.v22.js";

/** Pinned to schema v22; a changed result shape needs a new prompt version. */
export const V23_ALLOWED_ROOT_KEYS = [
  "answer",
  "responseShape",
  "findings",
  "missingEvidence",
  "contradictions",
  "insufficientEvidence",
  "recommendation",
  "clarifyingQuestions",
  "declined",
  "companyFindings",
  "coverage",
  "materialChanges",
  "userStatements",
  "profileUpdates",
  "displayName",
  "artifactRequest",
  "actionTalk",
  "comparisonCards",
  "gestures",
  "proposalStatus",
  "answerCards",
  "visual",
] as const;

export const V23_RESULT_GUIDANCE = `STRICT ANSWER SHAPE (including when answering beside tools)
Return one JSON object, never prose outside it. Required root fields: answer (string), responseShape (CONCISE or ANALYTICAL), insufficientEvidence (boolean), recommendation (null when no defensible recommendation, otherwise its schema object). The only allowed root keys are: ${V23_ALLOWED_ROOT_KEYS.join(", ")}. Omit optional fields unless their exact shape and evidence are known; never invent or rename a key. In particular, followUps is not a root field: put a useful next step in answer, not a new followUps property. clarifyingQuestions is for information needed to answer, not a substitute field for follow-up suggestions.
Each companyFindings item has required dimension, type, statement, truthClass and confidence. statement is the finding's string, never text. Use the existing dimension and type vocabularies above. truthClass is VERIFIED, USER_CLAIM, ESTIMATE, Q_INFERENCE or UNKNOWN, as the supplied facts warrant; confidence is HIGH, MODERATE, LOW, INSUFFICIENT_EVIDENCE or CONFLICTING_EVIDENCE, never a number. citations is an array of supplied F<n> labels; assumptions is an array of strings. No other finding keys are allowed. Do not put coverage on a finding: coverage is a separate root array of {dimension, coverage} objects, using the existing evidence-coverage vocabulary. Truth class, confidence and coverage are different axes; a self-reported fact is not verified merely because you can state it confidently. Unknown remains unknown and neither weak evidence nor missing evidence is a low business score.
This example demonstrates the format only; it is not evidence and must never supply a fact, citation or wording to an actual answer. Populate findings and coverage only from the authorised facts for this turn.
JSON SHAPE EXAMPLE
{"answer":"Answer using the supplied authorised facts.","responseShape":"CONCISE","insufficientEvidence":false,"recommendation":null,"companyFindings":[{"dimension":"DESCRIPTION","type":"FACT","statement":"The supplied fact describes the product.","truthClass":"USER_CLAIM","confidence":"LOW","citations":["F1"],"assumptions":[]}],"coverage":[{"dimension":"DESCRIPTION","coverage":"SELF_REPORTED"}]}
END JSON SHAPE EXAMPLE

`;

const FACTS_ANCHOR = COMPANY_ANALYST_V16_TURN;
if (COMPANY_ANALYST_V22.template.split(FACTS_ANCHOR).length !== 2) {
  throw new Error("COMPANY_ANALYST v23 requires v22's stable-prefix boundary");
}

/** New guidance only: every v22 authority, truth and score rule is retained. */
export const COMPANY_ANALYST_V23: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV22Result
> = {
  ...COMPANY_ANALYST_V22,
  version: 23,
  status: "ACTIVE",
  changeDescription:
    "Make schema v22's strict root keys, finding fields and separate coverage shape explicit beside tools; no acceptance or authority change.",
  effectiveFrom: "2026-10-13",
  template: COMPANY_ANALYST_V22.template.replace(
    FACTS_ANCHOR,
    `${V23_RESULT_GUIDANCE}${FACTS_ANCHOR}`,
  ),
};
