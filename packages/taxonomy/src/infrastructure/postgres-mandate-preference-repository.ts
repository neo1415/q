import { z } from "zod";

import { MandatePreferenceClassSchema } from "@capital-q/contracts";

import {
  TaxonomyAssignmentSourceSchema,
  TaxonomyCanonicalCodeSchema,
  TaxonomyNodeIdSchema,
  TaxonomyVocabularyCodeSchema,
  type MandateTaxonomyPreference,
} from "../contracts/index.js";
import {
  createMandateTaxonomyPreferencePort,
  type MandateTaxonomyPreferenceStore,
} from "../application/mandate-preferences.js";
import type { MandateTaxonomyPreferencePort } from "../application/ports.js";
import { createPostgresTaxonomyReferenceRepository } from "./postgres-taxonomy-repository.js";

/**
 * PostgreSQL store for declared mandate taxonomy preferences. Investor-
 * private rows keyed by (mandate, node); tenant and mandate are bound on
 * every statement. Written only from the Investor domain's versioned
 * mandate transaction through the port; there is no other write path.
 */

const Row = z.object({
  node_id: TaxonomyNodeIdSchema,
  vocabulary_code: TaxonomyVocabularyCodeSchema,
  canonical_code: TaxonomyCanonicalCodeSchema,
  preference_strength: MandatePreferenceClassSchema,
  is_exclusion: z.boolean(),
  source: TaxonomyAssignmentSourceSchema,
  confidence: z.string().nullable(),
});

function toPreference(row: unknown): MandateTaxonomyPreference {
  const r = Row.parse(row);
  return {
    nodeId: r.node_id,
    vocabularyCode: r.vocabulary_code,
    canonicalCode: r.canonical_code,
    preferenceStrength: r.preference_strength,
    isExclusion: r.is_exclusion,
    source: r.source,
    confidence: r.confidence,
  };
}

export function createPostgresMandateTaxonomyPreferenceStore(): MandateTaxonomyPreferenceStore {
  return {
    list: async (executor, tenantId, mandateId) => {
      const rows = await executor`
        select p.node_id, v.code as vocabulary_code, n.canonical_code, p.preference_strength,
               p.is_exclusion, p.source, p.confidence::text as confidence
          from taxonomy.mandate_preferences p
          join taxonomy.nodes n on n.id = p.node_id
          join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where p.mandate_id = ${mandateId} and p.tenant_id = ${tenantId}
         order by v.code, n.canonical_code`;
      return rows.map(toPreference);
    },
    deleteByNodeIds: async (tx, tenantId, mandateId, nodeIds) => {
      const rows = await tx.sql`
        delete from taxonomy.mandate_preferences p
         where p.mandate_id = ${mandateId}
           and p.tenant_id = ${tenantId}
           and p.node_id = any(${[...nodeIds]}::uuid[])
        returning p.node_id`;
      return rows.length;
    },
    insert: async (tx, input) => {
      await tx.sql`
        insert into taxonomy.mandate_preferences
          (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source)
        values (${input.tenantId}, ${input.mandateId}, ${input.nodeId},
                ${input.preferenceStrength}, ${input.isExclusion}, ${input.source})`;
    },
  };
}

/** The production port over the Postgres store and reference reads. */
export function createPostgresMandateTaxonomyPreferencePort(): MandateTaxonomyPreferencePort {
  return createMandateTaxonomyPreferencePort({
    reference: createPostgresTaxonomyReferenceRepository(),
    store: createPostgresMandateTaxonomyPreferenceStore(),
  });
}
