import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V26_SCHEMA_VERSION,
  CompanyAnalystV26ResultSchema,
  type CompanyAnalystV26Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { V22_VISUAL_LINE } from "./company-analyst.v22.js";
import { V23_ALLOWED_ROOT_KEYS } from "./company-analyst.v23.js";
import { COMPANY_ANALYST_V25 } from "./company-analyst.v25.js";

/**
 * COMPANY_ANALYST v26 -- a picture when seeing the thing helps (L-13,
 * owner ask 2026-10-20). The visual line gains PICTURE with a few plain
 * search words; Capital Q composes what may leave from the person's own
 * words and shows the picture credited. Output schema v26 adds PICTURE to
 * `visual` and the optional `pictureQuery`.
 */
export const V26_VISUAL_LINE =
  "- visual: MAP, TABLE, CHART or TIMELINE (from Capital Q's reads), or PICTURE with pictureQuery (2-4 plain words, no names), when clearer.";

export const V26_ALLOWED_ROOT_KEYS = [
  ...V23_ALLOWED_ROOT_KEYS,
  "pictureQuery",
] as const;

const V25_KEYS_LINE = V23_ALLOWED_ROOT_KEYS.join(", ");

/**
 * The v25 wording v26 states more briefly, so the rendered prompt keeps
 * headroom under its token cap (prompts.test.ts). Every rule stays; what
 * goes is repetition the result schema already enforces (enum lists) or
 * that another line already says. Each pair is [v25 text, v26 text].
 */
export const V26_TRIMS: ReadonlyArray<readonly [string, string]> = [
  [
    "Answer from the authorised facts below, the conversation, and whatever a tool returned in this conversation — nothing else.",
    "Answer only from the authorised facts below, the conversation and tool results in it.",
  ],
  [
    "Capital Q has no calibrated benchmark and no such methodology is available to you.",
    "Capital Q has no calibrated benchmark or such methodology.",
  ],
  [
    "The platform prepares it and says so: never say a request was recorded or awaits approval, and never name a JSON field.",
    "The platform prepares it and says so: never say a request was recorded or awaits approval.",
  ],
  [
    '- No boilerplate disclaimers: never "not an investment recommendation/conclusion/verdict", "this is mandate alignment" or "rather than a decision to invest". They know a fit score is not a decision.',
    '- No disclaimers like "not an investment recommendation" or "rather than a decision to invest": they know a fit score is not a decision.',
  ],
  [
    "Put evidence-backed business points from answer in findings, the conversation renderer’s channel, including prepared-context answers without tools. Each item requires type, statement, truthClass, evidenceStatus and confidence; basis is supplied fact labels or supporting statements. Use the existing type vocabulary. evidenceStatus is NO_EVIDENCE, SELF_REPORTED, DOCUMENT_SUPPORTED, MULTI_SOURCE_SUPPORTED, EXTERNALLY_VERIFIED or PLATFORM_VERIFIED, as supplied. No dimension, citations, coverage, subject ids or other keys belong on a findings item. Do not invent findings for a greeting or unsupported information.",
    "findings (the conversation’s channel, with or without tools): the evidence-backed business points in answer. Each requires type, statement, truthClass, evidenceStatus (as supplied) and confidence; basis is supplied fact labels or supporting statements; no dimension, citations, coverage, subject ids or other keys. None for a greeting or unsupported information.",
  ],
  [
    "companyFindings is the specialist channel, not the conversation’s findings. Each item requires dimension, type, statement, truthClass and confidence; citations is supplied F<n> labels and assumptions is strings. coverage is a separate root array of {dimension, coverage}. Use the existing vocabularies. Both channels use authorised facts; never invent evidence labels or identifiers.",
    "companyFindings (the specialist channel): each requires dimension, type, statement, truthClass and confidence; citations are supplied F<n> labels, assumptions strings; coverage is a separate root array of {dimension, coverage}. Never invent evidence labels or identifiers in either.",
  ],
  [
    "In both finding channels, statement is a string, never text; truthClass is VERIFIED, USER_CLAIM, ESTIMATE, Q_INFERENCE or UNKNOWN; confidence is HIGH, MODERATE, LOW, INSUFFICIENT_EVIDENCE or CONFLICTING_EVIDENCE, never a number. Truth, evidence and confidence remain separate. Omit other optional fields when shape or evidence is unknown.",
    "In both, statement is a string, never text; confidence is a level, never a number; truth, evidence and confidence stay separate; omit optional fields you cannot fill.",
  ],
  [
    "When asked which decisions await them, including alongside memo or agent recall, read list_pending_approvals. Its fresh owner-scoped results cover all conversations; filedForApproval only records past filing.",
    "Asked which decisions await them (also beside memo or agent recall), read list_pending_approvals: it covers all conversations; filedForApproval only records past filing.",
  ],
  [
    "Determined by Capital Q from its records before you were asked. Trusted; you may not overturn it: do not resolve a disagreement it records, do not present a figure it marks as past its useful life as current, and do not contradict a change it states.",
    "Determined by Capital Q from its records before you were asked; trusted: never resolve a disagreement it records, present a figure it marks past its useful life as current, or contradict a change it states.",
  ],
  [
    " Set coverage per dimension you spoke about: INSUFFICIENT, SELF_REPORTED, DOCUMENT_SUPPORTED, MULTI_SOURCE_SUPPORTED, EXTERNALLY_VERIFIED or PLATFORM_VERIFIED.",
    " Set coverage per dimension you spoke about.",
  ],
  [
    '("call me John", "change my name from Daniel to Dan")',
    '("call me John")',
  ],
  [
    '- First person for your own work and knowledge: "I\'ve reached out to…", "I\'d start with Portside", "I don\'t know their round size yet". Never "Capital Q records…", "the record confirms…", "the records show…" or "according to Capital Q".',
    '- First person for your own work and knowledge ("I\'d start with Portside", "I don\'t know their round size yet"), never "Capital Q records…", "the records show…" or "according to Capital Q".',
  ],
  [
    "- Lists, scores and comparisons go in answerCards (a score is Capital Q's, from the fit tools: repeat one only exactly as given, never make one up); your words",
    "- Lists, scores and comparisons go in answerCards (scores exactly as the fit tools gave them); your words",
  ],
  [
    "- Ask back only when you genuinely cannot answer without it, and then ask one specific question in your answer;",
    "- Ask back only when you cannot answer without it: one specific question, in your answer;",
  ],
  [
    "Describe existing pending items in answer and leave them untouched unless clearly asked to act. proposalStatus concerns this conversation's receipts; empty local receipts do not mean there are no global decisions.",
    "Describe pending items in answer; leave them untouched unless clearly asked to act. proposalStatus is this conversation's receipts only: none here does not mean none anywhere.",
  ],
  [
    "Respond with a single JSON object matching the CompanyAnalystResult schema. The answer field is what the person reads; write it as you would speak to them.",
    "Respond with one JSON object (CompanyAnalystResult); answer is what the person reads, written as you would speak to them.",
  ],
];

const anchors: ReadonlyArray<readonly [string, string]> = [
  [V22_VISUAL_LINE, "visual line"],
  [V25_KEYS_LINE, "allowed root keys"],
  ...V26_TRIMS.map(([from]) => [from, `trim "${from.slice(0, 40)}"`] as const),
];
for (const [anchor, name] of anchors) {
  if (COMPANY_ANALYST_V25.template.split(anchor).length !== 2) {
    throw new Error(`COMPANY_ANALYST v26 extends v25, which changed: ${name}`);
  }
}

export const COMPANY_ANALYST_V26: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV26Result
> = {
  ...COMPANY_ANALYST_V25,
  version: 26,
  status: "ACTIVE",
  changeDescription:
    "L-13 (owner ask 2026-10-20): the model may ask for a PICTURE with a short pictureQuery; Capital Q composes the outbound words from the person's own (egress allowlist) and shows a credited stock picture. Output schema v26. Repeated wording stated more briefly to keep headroom under the token cap.",
  effectiveFrom: "2026-10-21",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V26_SCHEMA_VERSION,
    schema: CompanyAnalystV26ResultSchema,
  },
  template: V26_TRIMS.reduce(
    (template, [from, to]) => template.replace(from, to),
    COMPANY_ANALYST_V25.template
      .replace(V22_VISUAL_LINE, V26_VISUAL_LINE)
      .replace(V25_KEYS_LINE, V26_ALLOWED_ROOT_KEYS.join(", ")),
  ),
};
