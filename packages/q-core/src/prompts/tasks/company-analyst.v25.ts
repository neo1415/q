import { COMPANY_ANALYST_V24 } from "./company-analyst.v24.js";
import {
  V23_ALLOWED_ROOT_KEYS,
  V23_RESULT_GUIDANCE,
} from "./company-analyst.v23.js";

export const V25_RESULT_GUIDANCE = `STRICT ANSWER SHAPE (including beside tools)
Return one JSON object. Required: answer (string), responseShape (CONCISE or ANALYTICAL), insufficientEvidence (boolean), recommendation (null or its schema object). The only allowed root keys are: ${V23_ALLOWED_ROOT_KEYS.join(", ")}. Never invent keys. No followUps: next steps belong in answer; clarifyingQuestions asks for needed information.
Put evidence-backed business points from answer in findings, the conversation renderer’s channel, including prepared-context answers without tools. Each item requires type, statement, truthClass, evidenceStatus and confidence; basis is supplied fact labels or supporting statements. Use the existing type vocabulary. evidenceStatus is NO_EVIDENCE, SELF_REPORTED, DOCUMENT_SUPPORTED, MULTI_SOURCE_SUPPORTED, EXTERNALLY_VERIFIED or PLATFORM_VERIFIED, as supplied. No dimension, citations, coverage, subject ids or other keys belong on a findings item. Do not invent findings for a greeting or unsupported information.
companyFindings is the specialist channel, not the conversation’s findings. Each item requires dimension, type, statement, truthClass and confidence; citations is supplied F<n> labels and assumptions is strings. coverage is a separate root array of {dimension, coverage}. Use the existing vocabularies. Both channels use authorised facts; never invent evidence labels or identifiers.
In both finding channels, statement is a string, never text; truthClass is VERIFIED, USER_CLAIM, ESTIMATE, Q_INFERENCE or UNKNOWN; confidence is HIGH, MODERATE, LOW, INSUFFICIENT_EVIDENCE or CONFLICTING_EVIDENCE, never a number. Truth, evidence and confidence remain separate. Omit other optional fields when shape or evidence is unknown.
Format only, never evidence or words for an actual answer.
JSON SHAPE EXAMPLE
{"answer":"Answer using the supplied authorised facts.","responseShape":"CONCISE","insufficientEvidence":false,"recommendation":null,"findings":[{"type":"FACT","statement":"The supplied fact describes the product.","truthClass":"USER_CLAIM","evidenceStatus":"SELF_REPORTED","confidence":"LOW","basis":["F1"]}],"companyFindings":[{"dimension":"DESCRIPTION","type":"FACT","statement":"The supplied fact describes the product.","truthClass":"USER_CLAIM","confidence":"LOW","citations":["F1"],"assumptions":[]}],"coverage":[{"dimension":"DESCRIPTION","coverage":"SELF_REPORTED"}]}
END JSON SHAPE EXAMPLE

`;

if (COMPANY_ANALYST_V24.template.split(V23_RESULT_GUIDANCE).length !== 2) {
  throw new Error(
    "COMPANY_ANALYST v25 requires v24's result guidance boundary",
  );
}

/** Clarify both existing consumers without changing either result contract. */
export const COMPANY_ANALYST_V25 = {
  ...COMPANY_ANALYST_V24,
  version: 25,
  changeDescription:
    "Distinguish native conversational findings from dimensional specialist findings, with an example validated through the conversation renderer.",
  template: COMPANY_ANALYST_V24.template.replace(
    V23_RESULT_GUIDANCE,
    V25_RESULT_GUIDANCE,
  ),
};
