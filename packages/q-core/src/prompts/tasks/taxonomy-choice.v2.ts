import type { PromptDefinition } from "../definition.js";
import {
  TAXONOMY_CHOICE_SCHEMA_NAME,
  TAXONOMY_CHOICE_UNTRUSTED,
  TAXONOMY_CHOICE_V2_SCHEMA_VERSION,
  TaxonomyChoiceV2ResultSchema,
  TaxonomyChoiceV2VariablesSchema,
  type TaxonomyChoiceV2Result,
  type TaxonomyChoiceV2Variables,
} from "../schemas/taxonomy-choice.js";
import { TAXONOMY_CHOICE_V1 } from "./taxonomy-choice.v1.js";

/**
 * TAXONOMY_CHOICE v2 — live onboarding sweep 2026-10-29: an investor's
 * "Benelux and the Nordics" matched no category by lookup and was saved
 * as plain words. When the lookup finds nothing, the field's own list is
 * offered; a group they name that the list does not have (a region) is
 * read, by meaning, as the listed members of it, and only those.
 */
const V1_INTRO =
  "Capital Q's lookup found the categories below that the words could mean. Say which of them the words name.";
const V2_INTRO =
  "The categories below are the ones Capital Q can record for these words: the lookup's candidates, or, when the lookup found none, the field's whole list. Say which of them the words name.";
const V1_SEVERAL =
  '- Words that name several categories ("fintech and health") give each one.';
const V2_SEVERAL = `${V1_SEVERAL}
- Words that name a group the list does not have (a region made of several countries) name the listed members of that group: choose each member that is listed, and only those. Never a neighbour of the group, and never a broader category above it.
- Words that name something inside one listed category (a city in a listed country; a month or a quarter inside a listed span of time, read against today's date in the notes) name that category.`;

if (
  !TAXONOMY_CHOICE_V1.template.includes(V1_INTRO) ||
  !TAXONOMY_CHOICE_V1.template.includes(V1_SEVERAL)
) {
  throw new Error("TAXONOMY_CHOICE v2 extends v1, which lost an anchor");
}

export const TAXONOMY_CHOICE_V2: PromptDefinition<
  TaxonomyChoiceV2Variables,
  TaxonomyChoiceV2Result
> = {
  ...TAXONOMY_CHOICE_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "Live onboarding sweep 2026-10-29: with no lookup candidate the field's whole list is offered, and a group they name that the list lacks (a region) is read as its listed members only.",
  effectiveFrom: "2026-10-29",
  variables: {
    schema: TaxonomyChoiceV2VariablesSchema,
    untrusted: [...TAXONOMY_CHOICE_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TAXONOMY_CHOICE_SCHEMA_NAME,
    schemaVersion: TAXONOMY_CHOICE_V2_SCHEMA_VERSION,
    schema: TaxonomyChoiceV2ResultSchema,
  },
  template: TAXONOMY_CHOICE_V1.template
    .replace(V1_INTRO, V2_INTRO)
    .replace(V1_SEVERAL, V2_SEVERAL),
};
