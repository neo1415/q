import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import {
  createCursorPageSchema,
  CursorSchema,
  PageSizeSchema,
} from "../common/pagination.js";

/**
 * `/v1/taxonomy` -- the canonical Capital Q taxonomy, read-only.
 *
 * Taxonomy is a platform capability, not a UI enum: one versioned,
 * multi-vocabulary, multi-label classification language shared by
 * companies, investor mandates, search, discovery, recommendations and Q.
 * These contracts expose reference reads only. There is no classification
 * or search endpoint here (CQ-TAX-002), no assignment route (owning product
 * workflows) and no editor (reference data changes by reviewed migration).
 *
 * Identity is `TaxonomyNodeId` + `canonicalCode`; a display name may change
 * without either moving.
 */

export const TAXONOMY_PATH = "/v1/taxonomy";
export const TAXONOMY_VOCABULARIES_SEGMENT = "/vocabularies";
export const TAXONOMY_NODES_SEGMENT = "/nodes";

/** A vocabulary code: `industry`, `product_category`, `geography`. */
export const TaxonomyVocabularyCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "expected a lower_snake_case vocabulary code")
  .max(64);
export type TaxonomyVocabularyCode = z.infer<
  typeof TaxonomyVocabularyCodeSchema
>;

/**
 * A stable canonical node code, unique within its vocabulary. Conservative
 * on purpose: no display punctuation, no locale, no case.
 */
export const TaxonomyCanonicalCodeSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]{0,127}$/,
    "expected a canonical code such as payment_infrastructure",
  );
export type TaxonomyCanonicalCode = z.infer<typeof TaxonomyCanonicalCodeSchema>;

export const TAXONOMY_VOCABULARY_STATUSES = ["ACTIVE", "RETIRED"] as const;
export const TaxonomyVocabularyStatusSchema = z.enum(
  TAXONOMY_VOCABULARY_STATUSES,
);
export type TaxonomyVocabularyStatus = z.infer<
  typeof TaxonomyVocabularyStatusSchema
>;

/** A deprecated node stays loadable and historically interpretable; it is not offered as a new selection. */
export const TAXONOMY_NODE_STATUSES = ["ACTIVE", "DEPRECATED"] as const;
export const TaxonomyNodeStatusSchema = z.enum(TAXONOMY_NODE_STATUSES);
export type TaxonomyNodeStatus = z.infer<typeof TaxonomyNodeStatusSchema>;

export const TAXONOMY_ALIAS_TYPES = [
  "SYNONYM",
  "ABBREVIATION",
  "COLLOQUIAL",
  "LEGACY",
] as const;
export const TaxonomyAliasTypeSchema = z.enum(TAXONOMY_ALIAS_TYPES);
export type TaxonomyAliasType = z.infer<typeof TaxonomyAliasTypeSchema>;

/** BCP-47-shaped, lowercase, bounded. Full internationalisation is not built here. */
export const TaxonomyLocaleSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/, "expected a lowercase BCP-47 tag")
  .max(35);

export const TaxonomyVocabularyDtoSchema = z.object({
  id: UuidSchema,
  code: TaxonomyVocabularyCodeSchema,
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int().min(1),
  status: TaxonomyVocabularyStatusSchema,
});
export type TaxonomyVocabularyDto = z.infer<typeof TaxonomyVocabularyDtoSchema>;

export const ListTaxonomyVocabulariesResponseSchema = z.object({
  items: z.array(TaxonomyVocabularyDtoSchema),
});
export type ListTaxonomyVocabulariesResponse = z.infer<
  typeof ListTaxonomyVocabulariesResponseSchema
>;

export const TaxonomyNodeDtoSchema = z.object({
  id: UuidSchema,
  vocabularyCode: TaxonomyVocabularyCodeSchema,
  canonicalCode: TaxonomyCanonicalCodeSchema,
  displayName: z.string(),
  description: z.string().nullable(),
  parentNodeId: UuidSchema.nullable(),
  depth: z.number().int().min(0),
  status: TaxonomyNodeStatusSchema,
});
export type TaxonomyNodeDto = z.infer<typeof TaxonomyNodeDtoSchema>;

/** Breadcrumb entry: identity and label only. */
export const TaxonomyNodeRefDtoSchema = z.object({
  id: UuidSchema,
  canonicalCode: TaxonomyCanonicalCodeSchema,
  displayName: z.string(),
  depth: z.number().int().min(0),
});
export type TaxonomyNodeRefDto = z.infer<typeof TaxonomyNodeRefDtoSchema>;

export const TaxonomyAliasDtoSchema = z.object({
  id: UuidSchema,
  alias: z.string(),
  locale: TaxonomyLocaleSchema,
  aliasType: TaxonomyAliasTypeSchema,
});
export type TaxonomyAliasDto = z.infer<typeof TaxonomyAliasDtoSchema>;

/** One node with its primary ancestry (root first) and its aliases. */
export const TaxonomyNodeDetailDtoSchema = TaxonomyNodeDtoSchema.extend({
  ancestors: z.array(TaxonomyNodeRefDtoSchema),
  aliases: z.array(TaxonomyAliasDtoSchema),
});
export type TaxonomyNodeDetailDto = z.infer<typeof TaxonomyNodeDetailDtoSchema>;

/**
 * Node listing within one vocabulary. `roots=true` lists depth-0 nodes;
 * `parentNodeId` lists direct children; neither lists the whole vocabulary
 * page by page. `status` defaults to ACTIVE so deprecated nodes are never
 * offered as new selections by default.
 */
export const ListTaxonomyNodesQuerySchema = z
  .object({
    parentNodeId: UuidSchema.optional(),
    roots: z.enum(["true", "false"]).optional(),
    status: TaxonomyNodeStatusSchema.optional(),
    cursor: CursorSchema.optional(),
    limit: z.coerce.number().pipe(PageSizeSchema).optional(),
  })
  .strict()
  .refine(
    (value) => !(value.parentNodeId !== undefined && value.roots === "true"),
    { message: "parentNodeId and roots=true are mutually exclusive" },
  );
export type ListTaxonomyNodesQuery = z.infer<
  typeof ListTaxonomyNodesQuerySchema
>;

export const ListTaxonomyNodesResponseSchema = createCursorPageSchema(
  TaxonomyNodeDtoSchema,
);
export type ListTaxonomyNodesResponse = z.infer<
  typeof ListTaxonomyNodesResponseSchema
>;
