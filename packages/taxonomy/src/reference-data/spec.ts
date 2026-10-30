import type {
  TaxonomyAliasType,
  TaxonomyNodeMetadata,
  TaxonomyNodeStatus,
} from "../contracts/index.js";

/**
 * The shapes the reference taxonomy is written in. Type-only, so a
 * browser-safe module (the canonical country list) can read the geography
 * spec without the builder, which hashes ids with node:crypto.
 */

export type AliasSpec =
  string | { readonly alias: string; readonly type: TaxonomyAliasType };

export type NodeSpec = {
  readonly code: string;
  readonly name: string;
  readonly parent?: string | undefined;
  readonly description?: string | undefined;
  readonly metadata?: TaxonomyNodeMetadata | undefined;
  readonly status?: TaxonomyNodeStatus | undefined;
  readonly aliases?: readonly AliasSpec[] | undefined;
};

export type VocabularySpec = {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly nodes: readonly NodeSpec[];
};
