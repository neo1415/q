import { z } from "zod";

import { MandatePreferenceClassSchema, UuidSchema } from "@capital-q/contracts";
import { TenantIdSchema } from "@capital-q/security";

import {
  TaxonomyAssignmentSourceSchema,
  TaxonomyNodeIdSchema,
  type MandateTaxonomyPreferenceInput,
  type TaxonomyVocabularyCode,
} from "../contracts/index.js";
import { requireSelectableNodes } from "./company-assignments.js";
import type {
  MandateTaxonomyPreferencePort,
  TaxonomyReferenceRepository,
} from "./ports.js";

/**
 * Declared investor taxonomy preferences, as a persistence primitive.
 *
 * Owned here so the same node namespace and node validation apply on both
 * sides of capital, but written only from the Investor domain's mandate
 * create/update transaction: that command authorises `investor.mandate.edit`,
 * checks the version the caller read, increments it, audits and emits
 * `core.investor_mandate.updated` with change kind TAXONOMY. Nothing here
 * authorises, versions or publishes, and no route reaches this directly.
 *
 * AVOID and HARD_EXCLUSION are never collapsed: HARD_EXCLUSION ⇔ isExclusion.
 * Nothing observed (save, pass, watch time) or inferred by Q writes here.
 */

const PreferenceInputSchema = z
  .object({
    nodeId: TaxonomyNodeIdSchema,
    preferenceStrength: MandatePreferenceClassSchema,
    isExclusion: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      (value.preferenceStrength === "HARD_EXCLUSION") === value.isExclusion,
    { message: "preferenceStrength HARD_EXCLUSION and isExclusion must agree" },
  );

const ReplaceInputSchema = z
  .object({
    tenantId: TenantIdSchema,
    mandateId: UuidSchema,
    preferences: z.array(PreferenceInputSchema).max(100),
    source: TaxonomyAssignmentSourceSchema,
  })
  .strict();

export type MandateTaxonomyPreferenceRow = {
  readonly nodeId: string;
  readonly preferenceStrength: MandateTaxonomyPreferenceInput["preferenceStrength"];
  readonly isExclusion: boolean;
};

/** Identity of a declared preference for set comparison. */
export function preferenceKey(
  preference: MandateTaxonomyPreferenceRow,
): string {
  return `${preference.nodeId}|${preference.preferenceStrength}|${String(preference.isExclusion)}`;
}

export type MandateTaxonomyPreferenceStore = {
  readonly list: MandateTaxonomyPreferencePort["list"];
  readonly deleteByNodeIds: (
    tx: Parameters<MandateTaxonomyPreferencePort["replace"]>[0],
    tenantId: string,
    mandateId: string,
    nodeIds: readonly string[],
  ) => Promise<number>;
  readonly insert: (
    tx: Parameters<MandateTaxonomyPreferencePort["replace"]>[0],
    input: {
      readonly tenantId: string;
      readonly mandateId: string;
      readonly nodeId: string;
      readonly preferenceStrength: MandateTaxonomyPreferenceInput["preferenceStrength"];
      readonly isExclusion: boolean;
      readonly source: string;
    },
  ) => Promise<void>;
};

export function createMandateTaxonomyPreferencePort(dependencies: {
  readonly reference: TaxonomyReferenceRepository;
  readonly store: MandateTaxonomyPreferenceStore;
}): MandateTaxonomyPreferencePort {
  const { reference, store } = dependencies;
  return {
    list: (executor, tenantId, mandateId) =>
      store.list(executor, tenantId, mandateId),
    replace: async (tx, raw) => {
      const input = ReplaceInputSchema.parse(raw);
      const nodes = await requireSelectableNodes(
        reference,
        tx.sql,
        input.preferences.map((preference) => preference.nodeId),
      );
      const current = await store.list(tx.sql, input.tenantId, input.mandateId);
      const desired = new Map(
        input.preferences.map((preference) => [
          preferenceKey(preference),
          preference,
        ]),
      );
      const existing = new Map(
        current.map((preference) => [preferenceKey(preference), preference]),
      );
      const removed = current.filter((row) => !desired.has(preferenceKey(row)));
      const added = input.preferences.filter(
        (row) => !existing.has(preferenceKey(row)),
      );
      const changed = new Set<TaxonomyVocabularyCode>();
      for (const row of removed) {
        changed.add(row.vocabularyCode);
      }
      for (const row of added) {
        const node = nodes.get(row.nodeId);
        if (node !== undefined) {
          changed.add(node.vocabularyCode);
        }
      }
      if (removed.length > 0) {
        await store.deleteByNodeIds(
          tx,
          input.tenantId,
          input.mandateId,
          removed.map((row) => row.nodeId),
        );
      }
      for (const row of added) {
        await store.insert(tx, {
          tenantId: input.tenantId,
          mandateId: input.mandateId,
          nodeId: row.nodeId,
          preferenceStrength: row.preferenceStrength,
          isExclusion: row.isExclusion,
          source: input.source,
        });
      }
      return {
        added: added.length,
        removed: removed.length,
        changedVocabularyCodes: [...changed].sort(),
      };
    },
  };
}
