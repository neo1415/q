import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * TAXONOMY_CHOICE (production re-test 2026-10-28, investor "fintech and
 * health"): the deterministic taxonomy lookup found several categories a
 * person's word could mean ("health": Healthcare, Digital Health, Health
 * Access) and abstained, so the word never became a category. This reads,
 * by meaning, which of the lookup's own candidates the word names. It only
 * chooses among the candidates it is given (reference data); it never
 * invents a category, and an empty choice leaves the word in their words.
 */
export const TAXONOMY_CHOICE_SCHEMA_NAME = "TaxonomyChoiceResult";
export const TAXONOMY_CHOICE_SCHEMA_VERSION = 1;

export const TaxonomyChoiceVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** What the categories are for ("Sectors they invest in"). Trusted. */
    field: z.string().trim().min(1).max(200),
    /** The lookup's candidates, one per line: "id | name | vocabulary". Trusted. */
    candidates: z.string().trim().min(1).max(4_000),
    /** The person's word or phrase. UNTRUSTED. */
    phrase: z.string().trim().min(1).max(200),
    /** The sentence it came from. UNTRUSTED. */
    sentence: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type TaxonomyChoiceVariables = z.infer<
  typeof TaxonomyChoiceVariablesSchema
>;
export const TAXONOMY_CHOICE_UNTRUSTED = ["phrase", "sentence"] as const;

export const TaxonomyChoiceResultSchema = z
  .object({ chosen: z.array(z.string().max(64)).max(4) })
  .strict();
export type TaxonomyChoiceResult = z.infer<typeof TaxonomyChoiceResultSchema>;

/**
 * v2 (live onboarding sweep 2026-10-29): "Benelux and the Nordics" found no
 * category by lookup and was kept as plain words. When the lookup finds
 * none, the field's whole (small) vocabulary is offered, and a group they
 * name that is not listed (a region) is read as its listed members, so a
 * choice can hold more of them.
 */
export const TAXONOMY_CHOICE_V2_SCHEMA_VERSION = 2;

export const TaxonomyChoiceV2VariablesSchema = z
  .object({
    ...TaskFrameSchema,
    field: z.string().trim().min(1).max(200),
    /** One per line: "id | name | vocabulary". Trusted. */
    candidates: z.string().trim().min(1).max(8_000),
    phrase: z.string().trim().min(1).max(200),
    sentence: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type TaxonomyChoiceV2Variables = z.infer<
  typeof TaxonomyChoiceV2VariablesSchema
>;

export const TaxonomyChoiceV2ResultSchema = z
  .object({ chosen: z.array(z.string().max(64)).max(16) })
  .strict();
export type TaxonomyChoiceV2Result = z.infer<
  typeof TaxonomyChoiceV2ResultSchema
>;
