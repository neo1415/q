import type { PromptDefinition } from "../definition.js";
import {
  TURN_SKIM_SCHEMA_NAME,
  TURN_SKIM_V7_SCHEMA_VERSION,
  TurnSkimV7ResultSchema,
  type TurnSkimV3Variables,
  type TurnSkimV7Result,
} from "../schemas/turn-skim.js";
import { TURN_SKIM_V6, V6_SUBJECT } from "./turn-skim.v6.js";

/**
 * v7 (QA F-23, live 2026-10-23): "Draft a note to the founders of the
 * second company" waited 16 s for its first words. The skim now says
 * whether the turn asks Q to write, draft or send something to someone, so
 * Q says "Drafting that note to <them> now." at skim time (~1 s). It
 * decides nothing else: the full reading and the answer still do. v6 is
 * kept whole; one field is added for every kind.
 */
export const V7_WRITES = `writes (every kind): true when they ask you to write, draft, compose or send a note, message, email or reply to someone (a company's founders, an investor, a person), by what it means, in any language ("draft a note to the founders of the second company", "send Kestrel a message", "reply to Amina", "écris aux fondateurs"); subject is then whom it is to. false otherwise, including when they only ask about a message someone sent them.
`;

if (TURN_SKIM_V6.template.split(V6_SUBJECT).length !== 2) {
  throw new Error("TURN_SKIM v7 extends v6's subject rule, which changed");
}

export const TURN_SKIM_V7: PromptDefinition<
  TurnSkimV3Variables,
  TurnSkimV7Result
> = {
  ...TURN_SKIM_V6,
  version: 7,
  status: "DEPRECATED",
  changeDescription:
    "QA F-23 2026-10-23 (16 s to first words on 'draft a note to the founders'): v6 plus writes (every kind) -- true when the turn asks Q to write, draft or send a note, message, email or reply to someone, read by meaning in any language; Q's holding line says it is drafting, to the subject when one is understood. Decides nothing else.",
  effectiveFrom: "2026-10-23",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_SKIM_SCHEMA_NAME,
    schemaVersion: TURN_SKIM_V7_SCHEMA_VERSION,
    schema: TurnSkimV7ResultSchema,
  },
  template: TURN_SKIM_V6.template.replace(
    V6_SUBJECT,
    `${V6_SUBJECT}${V7_WRITES}`,
  ),
};
