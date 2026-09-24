import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V5_UNTRUSTED,
  COMPANY_ANALYST_V8_SCHEMA_VERSION,
  CompanyAnalystV5VariablesSchema,
  CompanyAnalystV8ResultSchema,
  type CompanyAnalystV5Variables,
  type CompanyAnalystV8Result,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V7 } from "./company-analyst.v7.js";

/**
 * COMPANY_ANALYST v8 — v7, truthful about acting and about corrections
 * (CQ-QX-007).
 *
 * Three changes, each from a failure seen in a real browser run:
 *
 *   - v4's paragraph about a person's own name told the model to "say it
 *     is ready for their approval". It never was the model's to say:
 *     Capital Q states the claim from the proposal it actually created.
 *     The sentence is gone, and talk about acting now goes in its own
 *     field, `actionTalk`, which the runtime removes from what is read.
 *   - A founder corrected August GMV (412k in the one-pager was a typo;
 *     380k) and the next answer quoted 412k as current. Their correction
 *     is now what is stated as current, as theirs, with the document's
 *     figure named as the document's and both kept as a contradiction.
 *   - An investor asking whether a company suits what they invest in is
 *     answered from their own declared mandate, criterion by criterion,
 *     with no score or verdict.
 *
 * A new version, because a published prompt is immutable.
 */
const V4_NAME_LINE = `If in THIS message they ask to be called something else ("call me John", "change my name from Daniel to Dan"), put the new name in displayName with their exact words as quote and say it is ready for their approval: their own name, never a company field, never applied by you.`;

const V8_NAME_LINE = `If in THIS message they ask to be called something else ("call me John", "change my name from Daniel to Dan"), put the new name in displayName with their exact words as quote: their own name, never a company field, never applied by you.`;

const ANCHOR = "AUTHORISED FACTS\n{{authorisedFacts}}";

export const COMPANY_ANALYST_V8_SECTION = `ACTING, CORRECTIONS, MANDATES
Never say you did, will or are about to do what they asked (prepared, noted, updated, revised, awaiting approval): Capital Q says what happened. Put any such sentence in actionTalk, verbatim, not in answer.
A figure the person corrected, now or earlier in this conversation, is current as theirs ("you told me X"); a record that differs is only what it says ("your deck says Y"); list both in contradictions.
Asked whether a company suits what they invest in, with their declared mandate among the facts: compare each declared criterion (matches, misses, not on record). No score or verdict.
Never write a ref label (F1) in the answer.

`;

if (!COMPANY_ANALYST_V7.template.includes(V4_NAME_LINE)) {
  throw new Error(
    "COMPANY_ANALYST v8 rewrites v4's name paragraph, and v7 no longer carries it",
  );
}
if (!COMPANY_ANALYST_V7.template.includes(ANCHOR)) {
  throw new Error(
    "COMPANY_ANALYST v8 derives from v7's template, and v7 no longer carries the section it extends",
  );
}

export const COMPANY_ANALYST_V8: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV8Result
> = {
  ...COMPANY_ANALYST_V7,
  version: 8,
  status: "ACTIVE",
  changeDescription:
    "CQ-QX-007: the model never says a change is ready for approval (v4's name paragraph no longer tells it to); talk about acting goes in actionTalk, which the runtime removes; a correction the person made in the conversation is stated as current and as theirs, with the differing record named as its own and both kept as a contradiction; fit questions compare the person's own declared mandate criterion by criterion, with no score.",
  effectiveFrom: "2026-09-24",
  variables: {
    schema: CompanyAnalystV5VariablesSchema,
    untrusted: [...COMPANY_ANALYST_V5_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V8_SCHEMA_VERSION,
    schema: CompanyAnalystV8ResultSchema,
  },
  template: COMPANY_ANALYST_V7.template
    .replace(V4_NAME_LINE, V8_NAME_LINE)
    .replace(ANCHOR, `${COMPANY_ANALYST_V8_SECTION}${ANCHOR}`),
};
