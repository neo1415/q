import type { PromptDefinition } from "../definition.js";
import {
  TURN_SKIM_SCHEMA_NAME,
  TURN_SKIM_V8_SCHEMA_VERSION,
  TurnSkimV8ResultSchema,
  type TurnSkimV3Variables,
  type TurnSkimV8Result,
} from "../schemas/turn-skim.js";
import { TURN_SKIM_V7 } from "./turn-skim.v7.js";

/**
 * v8 (owner's own conversation, 2026-10-24): "show me three Arab / Qatari
 * investors that would be interested in Capital Q" was searched as a
 * lookup of Capital Q, and "five Kenyan angel networks" or "three Saudi
 * family offices that back fintech" had no word for the kind of investor.
 * A discovery ask may name a kind; the skim says it, as said. v7 is kept
 * whole.
 */
export const V7_ABOUT_MY_COMPANY =
  'aboutMyCompany: true when "this", "us" or "our" means their own company or raise.';
export const V8_KINDS = `${V7_ABOUT_MY_COMPANY} kinds: the kinds of investor they ask for, as they said them ("family offices", "angel networks", "VCs", "sovereign funds", "corporate venture arms"), empty when they named no kind ("investors", "funds" name no kind). A company they name as the one the investors are for (their own, or "Capital Q") is the beneficiary, never a region, kind or sector, and makes aboutMyCompany true when it is theirs.`;

if (TURN_SKIM_V7.template.split(V7_ABOUT_MY_COMPANY).length !== 2) {
  throw new Error("TURN_SKIM v8 extends v4's investors rule, which changed");
}

export const TURN_SKIM_V8: PromptDefinition<
  TurnSkimV3Variables,
  TurnSkimV8Result
> = {
  ...TURN_SKIM_V7,
  version: 8,
  status: "ACTIVE",
  changeDescription:
    "Owner's own conversation 2026-10-24 (discovery asks searched as a lookup of the asker's company): v7 plus investors.kinds -- the kinds of investor asked for as said (family offices, angel networks, VCs) -- and a company named as whom the investors are for is the beneficiary, never a search term. Read by meaning in any language.",
  effectiveFrom: "2026-10-24",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_SKIM_SCHEMA_NAME,
    schemaVersion: TURN_SKIM_V8_SCHEMA_VERSION,
    schema: TurnSkimV8ResultSchema,
  },
  template: TURN_SKIM_V7.template.replace(V7_ABOUT_MY_COMPANY, V8_KINDS),
};
