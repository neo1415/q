import type { PromptDefinition } from "../definition.js";
import {
  TURN_SKIM_SCHEMA_NAME,
  TURN_SKIM_V10_SCHEMA_VERSION,
  TurnSkimV10ResultSchema,
  type TurnSkimV10Result,
  type TurnSkimV3Variables,
} from "../schemas/turn-skim.js";
import { V7_WRITES } from "./turn-skim.v7.js";
import { TURN_SKIM_V9 } from "./turn-skim.v9.js";

/**
 * v10 (acceptance 2026-11-04, J3, production 8967c4fd4): "Write me a
 * one-page memo on Ledgerline" was skimmed as writing a note TO Ledgerline,
 * so Q's first words were "Drafting that note to Ledgerline now." -- as if
 * something were going to the company. A document about someone is not a
 * message to them: `document` says so, read by meaning in any language,
 * and `writes` is kept for a note, message, email or reply to someone.
 * v9 is kept whole; one field is added for every kind.
 */
export const V10_DOCUMENT = `document (every kind): true when they ask you to write or prepare a document ABOUT a company, person or topic for themselves -- a memo, brief, one-pager, report, write-up, analysis or deck -- by what it means, in any language ("write me a one-page memo on Ledgerline", "make a brief on the second company", "prépare une note sur Kestrel"); subject is then whom it is about, and writes is false, because nothing is sent to anyone. false otherwise.
`;

if (TURN_SKIM_V9.template.split(V7_WRITES).length !== 2) {
  throw new Error("TURN_SKIM v10 extends v7's writes rule, which changed");
}

export const TURN_SKIM_V10: PromptDefinition<
  TurnSkimV3Variables,
  TurnSkimV10Result
> = {
  ...TURN_SKIM_V9,
  version: 10,
  status: "ACTIVE",
  changeDescription:
    "Acceptance 2026-11-04 (J3: a one-page memo on Ledgerline was held with 'Drafting that note to Ledgerline now.'): v9 plus document (every kind) -- true when the turn asks Q to write a document ABOUT someone (memo, brief, one-pager, report, deck) for the person, read by meaning in any language; writes stays a note to someone. Decides only Q's holding line.",
  effectiveFrom: "2026-11-04",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_SKIM_SCHEMA_NAME,
    schemaVersion: TURN_SKIM_V10_SCHEMA_VERSION,
    schema: TurnSkimV10ResultSchema,
  },
  template: TURN_SKIM_V9.template.replace(
    V7_WRITES,
    `${V7_WRITES}${V10_DOCUMENT}`,
  ),
};
