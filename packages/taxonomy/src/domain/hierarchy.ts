import { TaxonomyHierarchyError } from "./errors.js";

/**
 * Pure integrity checks for a primary hierarchy: parent in the same
 * vocabulary, depth = parent depth + 1 (roots 0), no cycles, canonical codes
 * unique per vocabulary, bounded depth. Used on the reference data before
 * it is rendered to SQL and by tests; the database enforces the same rules
 * with a composite foreign key and a trigger.
 */

export const TAXONOMY_MAX_DEPTH = 16;

export type HierarchyNodeLike = {
  readonly id: string;
  readonly vocabularyCode: string;
  readonly canonicalCode: string;
  readonly parentNodeId: string | null;
  readonly depth: number;
};

export function validateHierarchy(nodes: readonly HierarchyNodeLike[]): void {
  const byId = new Map<string, HierarchyNodeLike>();
  const codes = new Set<string>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      throw new TaxonomyHierarchyError(`duplicate node id ${node.id}`);
    }
    byId.set(node.id, node);
    const codeKey = `${node.vocabularyCode}/${node.canonicalCode}`;
    if (codes.has(codeKey)) {
      throw new TaxonomyHierarchyError(`duplicate canonical code ${codeKey}`);
    }
    codes.add(codeKey);
  }
  for (const node of nodes) {
    if (node.parentNodeId === null) {
      if (node.depth !== 0) {
        throw new TaxonomyHierarchyError(
          `root ${node.canonicalCode} must have depth 0`,
        );
      }
      continue;
    }
    const parent = byId.get(node.parentNodeId);
    if (parent === undefined) {
      throw new TaxonomyHierarchyError(
        `${node.canonicalCode} names an unknown parent`,
      );
    }
    if (parent.vocabularyCode !== node.vocabularyCode) {
      throw new TaxonomyHierarchyError(
        `${node.vocabularyCode}/${node.canonicalCode} cannot have a parent in ${parent.vocabularyCode}`,
      );
    }
    if (node.depth !== parent.depth + 1) {
      throw new TaxonomyHierarchyError(
        `${node.canonicalCode} depth must be ${String(parent.depth + 1)}`,
      );
    }
    // Ancestor walk: bounded, so a corrupt chain fails instead of spinning.
    let cursor: HierarchyNodeLike | undefined = parent;
    let steps = 0;
    while (cursor !== undefined) {
      if (cursor.id === node.id) {
        throw new TaxonomyHierarchyError(
          `${node.canonicalCode} is its own ancestor`,
        );
      }
      steps += 1;
      if (steps > TAXONOMY_MAX_DEPTH) {
        throw new TaxonomyHierarchyError(
          `${node.canonicalCode} exceeds the maximum depth`,
        );
      }
      cursor =
        cursor.parentNodeId === null
          ? undefined
          : byId.get(cursor.parentNodeId);
    }
  }
}
