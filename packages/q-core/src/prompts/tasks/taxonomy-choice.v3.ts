import type { PromptDefinition } from "../definition.js";
import {
  TAXONOMY_CHOICE_SCHEMA_NAME,
  TAXONOMY_CHOICE_V3_SCHEMA_VERSION,
  TAXONOMY_CHOICE_V3_UNTRUSTED,
  TaxonomyChoiceV3ResultSchema,
  TaxonomyChoiceV3VariablesSchema,
  type TaxonomyChoiceV3Result,
  type TaxonomyChoiceV3Variables,
} from "../schemas/taxonomy-choice.js";
import { TAXONOMY_CHOICE_V2 } from "./taxonomy-choice.v2.js";

/**
 * TAXONOMY_CHOICE v3 — live check 2026-10-31 on production 656719a90
 * (fictional "Skerry Lantern Ventures" and "Vesiveski Parcel Docks"):
 * - "industrial automation" named nothing, though it is a kind of the
 *   listed Manufacturing & Industrial (v2 covered places and times only);
 * - "recurring revenue" from an investor backing B2B companies was read as
 *   Consumer Subscription: nothing told the reading who their customers
 *   are. What else they said for the profile is now given, and a category
 *   it contradicts is never chosen;
 * - "40 lockers live in 12 towns" was lost when the words were read as
 *   "Paying customers": what the chosen ones do not hold is given back in
 *   their exact words, and code keeps it beside the answer.
 */
const V2_SHARES =
  "- Never choose a category only because it shares a word with theirs.";
const V3_RULES = `${V2_SHARES}
- Words that name a narrower kind of activity, product or business inside one listed broader category, where nothing listed is closer to them, name that broader category ("dental clinics" is Healthcare when nothing listed is closer).
- WHAT ELSE THEY SAID is context about them, never a category to choose. Never choose a category it contradicts: for someone whose customers are businesses, never a category for consumers, and the other way round. When every listed category their words could mean is contradicted by it, choose none: their words are kept as they said them.`;
const V2_SENTENCE = `THE SENTENCE THEY CAME FROM
{{sentence}}`;
const V3_SENTENCE = `${V2_SENTENCE}

WHAT ELSE THEY SAID FOR THIS PROFILE (one "field: their words" a line)
{{context}}`;
const V2_RESPOND =
  'Respond with a single JSON object {"chosen": ["<id>", ...]}.';
const V3_RESPOND = `Respond with a single JSON object {"chosen": ["<id>", ...], "beyond": <string or null>}. "beyond" is the part of THE SENTENCE about this field that the chosen ones do not hold (a count, a place, a name), copied exactly as they said it; null when the chosen ones hold all of it, or when nothing is chosen.`;

for (const anchor of [V2_SHARES, V2_SENTENCE, V2_RESPOND]) {
  if (!TAXONOMY_CHOICE_V2.template.includes(anchor)) {
    throw new Error("TAXONOMY_CHOICE v3 extends v2, which lost an anchor");
  }
}

export const TAXONOMY_CHOICE_V3: PromptDefinition<
  TaxonomyChoiceV3Variables,
  TaxonomyChoiceV3Result
> = {
  ...TAXONOMY_CHOICE_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Live check 2026-10-31 (656719a90): a narrower kind of a listed category names it; what else they said is given and a category it contradicts is never chosen; what the chosen ones do not hold is given back in their words.",
  effectiveFrom: "2026-10-31",
  variables: {
    schema: TaxonomyChoiceV3VariablesSchema,
    untrusted: [...TAXONOMY_CHOICE_V3_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TAXONOMY_CHOICE_SCHEMA_NAME,
    schemaVersion: TAXONOMY_CHOICE_V3_SCHEMA_VERSION,
    schema: TaxonomyChoiceV3ResultSchema,
  },
  template: TAXONOMY_CHOICE_V2.template
    .replace(V2_SHARES, V3_RULES)
    .replace(V2_SENTENCE, V3_SENTENCE)
    .replace(V2_RESPOND, V3_RESPOND),
};
