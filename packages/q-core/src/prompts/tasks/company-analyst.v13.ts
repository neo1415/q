import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV12Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V10_SECTION } from "./company-analyst.v10.js";
import { COMPANY_ANALYST_V11_FORMAT_SECTION } from "./company-analyst.v11.js";
import {
  COMPANY_ANALYST_V12,
  COMPANY_ANALYST_V12_CARDS_SECTION,
} from "./company-analyst.v12.js";

/**
 * COMPANY_ANALYST v13 — the gaps a live founder conversation exposed
 * (2026-09-29), fixed where the model decides rather than after it:
 *
 * - userStatements was never described in the prompt, so the model filed
 *   requests and misheard speech as "your statement" and Capital Q read
 *   them back verbatim. It is now defined: a fact they state about their
 *   own company, never a request, question, instruction or unclear words.
 * - Asked to change a deck, Q said it could not edit documents, then did;
 *   and a vague instruction produced identical versions. Q now knows it
 *   makes and revises decks and documents, and a revision carries the
 *   whole, specific change.
 * - Speech-to-text heard "Yamfield Agro" as "Jump Shooter Group" and Q
 *   repeated it. A name heard close to one on record is that one.
 *
 * The answer-format and involved-versus-suited sections are restated more
 * compactly, with the same
 * rules, to keep the bundle inside its size budget.
 */
const V12_REVISE =
  "To change one: kind REVISE, the change in instruction. Otherwise null; a question is not a request.";
const V13_REVISE =
  "To change one: kind REVISE, the whole change in instruction, specific (page, colours, text). Otherwise null; a question is not a request. Capital Q makes and revises decks and PDFs: never say it cannot.";

const V12_REF_RULE = "Never write a ref label (F1) in the answer.";
const V13_REF_RULE = `${V12_REF_RULE}
userStatements: only a fact they state in THIS message about their own company, in their words; never a request, question or unclear words.
Speech mishears names: one heard close to a name on record is that name.`;

export const COMPANY_ANALYST_V13_FORMAT_SECTION = `ANSWER FORMAT
Short answers are plain sentences. To list, compare or summarise use Markdown: "- " bullets, "1. " steps, a table (header row, |---|; an empty cell is not known), "**Label:** value" key facts, or one "> [!RISK]", "[!GAP]", "[!STRENGTH]" or "[!NOTE]" callout. No HTML, images or code. Structure never upgrades a claim.
Comparing 2-4 named things: also fill comparisonCards (no order or verdict, 1-4 points each, unknown is "Not known"); else null.

`;

export const COMPANY_ANALYST_V13_INVOLVED_SECTION = `INVOLVED VERSUS SUITED
Asked who relates to a company (investors, customers, partners, acquirers), read whether they want who is already involved (evidence: only from a source) or who would suit it (inference: specific candidates from tool results, sources or published focus, say which, each with its reason, labelled a likely fit to check). Answer the one asked; keep both apart if both matter. Nobody involved is never a reason to name nobody who would suit.

`;

const V12_FORMAT = `${COMPANY_ANALYST_V11_FORMAT_SECTION}${COMPANY_ANALYST_V12_CARDS_SECTION}`;

for (const piece of [
  V12_REVISE,
  V12_REF_RULE,
  V12_FORMAT,
  COMPANY_ANALYST_V10_SECTION,
]) {
  if (!COMPANY_ANALYST_V12.template.includes(piece)) {
    throw new Error(
      "COMPANY_ANALYST v13 rewrites a v12 passage that v12 no longer carries",
    );
  }
}

export const COMPANY_ANALYST_V13: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV12Result
> = {
  ...COMPANY_ANALYST_V12,
  version: 13,
  status: "ACTIVE",
  changeDescription:
    "Founder live 2026-09-29: userStatements defined (stated facts only, never requests or unclear words); Q knows it makes and revises decks and documents and a revision carries the whole specific change; misheard names resolve to the name on record; answer format restated compactly.",
  effectiveFrom: "2026-09-29",
  template: COMPANY_ANALYST_V12.template
    .replace(V12_REVISE, V13_REVISE)
    .replace(V12_REF_RULE, V13_REF_RULE)
    .replace(V12_FORMAT, COMPANY_ANALYST_V13_FORMAT_SECTION)
    .replace(COMPANY_ANALYST_V10_SECTION, COMPANY_ANALYST_V13_INVOLVED_SECTION),
};
