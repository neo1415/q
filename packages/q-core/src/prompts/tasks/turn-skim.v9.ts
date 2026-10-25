import type { PromptDefinition } from "../definition.js";
import type {
  TurnSkimV3Variables,
  TurnSkimV8Result,
} from "../schemas/turn-skim.js";
import { TURN_SKIM_V8 } from "./turn-skim.v8.js";

/**
 * v9 (production 2026-10-25, run 3d8c2636): "Who is the founder of
 * Paystack?" was read as a lookup of Paystack itself; the person lane
 * searched the company's name as a person's and answered "I only have a
 * name match so far". A question of an organisation -- who holds a role
 * there, or a fact about it -- asks something OF it, by meaning in any
 * language; it is not a request to identify it. v8 is kept whole.
 */
export const V8_PERSON_EXAMPLES = '"do you know QInvest").';
export const V9_ASKS_OF_IT = `${V8_PERSON_EXAMPLES} A question OF an organisation -- who holds a role there (its founder, CEO, partners, owners, investors) or a fact about it (when it was founded, what it raised) -- asks something of it, by what it means in any words and any language ("who is the founder of Paystack?", "who runs Flutterwave", "Paystack's CEO"): that is OTHER, never PERSON_SEARCH with the organisation's name, because the person they want is not named. PERSON_SEARCH is only for identifying the one named person, organisation or agency itself.`;

if (TURN_SKIM_V8.template.split(V8_PERSON_EXAMPLES).length !== 2) {
  throw new Error(
    "TURN_SKIM v9 extends v8's PERSON_SEARCH rule, which changed",
  );
}

export const TURN_SKIM_V9: PromptDefinition<
  TurnSkimV3Variables,
  TurnSkimV8Result
> = {
  ...TURN_SKIM_V8,
  version: 9,
  status: "ACTIVE",
  changeDescription:
    "Production 2026-10-25 (run 3d8c2636): v8 plus a question OF an organisation -- who holds a role there (founder, CEO, owners, investors) or a fact about it -- is OTHER, never PERSON_SEARCH with the organisation's name; PERSON_SEARCH only identifies the one named person, organisation or agency itself. Read by meaning in any language.",
  effectiveFrom: "2026-10-25",
  template: TURN_SKIM_V8.template.replace(V8_PERSON_EXAMPLES, V9_ASKS_OF_IT),
};
