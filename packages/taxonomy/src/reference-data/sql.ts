import { REFERENCE_TAXONOMY, type ReferenceTaxonomy } from "./index.js";

/**
 * Render the reference taxonomy as idempotent SQL for a forward migration.
 * Every row names its stable id; re-applying does nothing. Parents are
 * emitted before children so the hierarchy trigger sees a complete chain.
 * Values are SQL-literal escaped here because this output is committed and
 * reviewed as a migration, never executed from user input.
 */

function literal(value: string | null): string {
  return value === null ? "null" : `'${value.replace(/'/g, "''")}'`;
}

export function renderReferenceTaxonomySql(
  taxonomy: ReferenceTaxonomy = REFERENCE_TAXONOMY,
): string {
  const lines: string[] = [];
  lines.push(
    "-- Reference taxonomy (rendered from @capital-q/taxonomy reference-data; do not hand-edit).",
  );
  lines.push("");
  lines.push(
    "insert into taxonomy.vocabularies (id, code, name, description, version, status) values",
  );
  lines.push(
    taxonomy.vocabularies
      .map(
        (v) =>
          `  (${literal(v.id)}, ${literal(v.code)}, ${literal(v.name)}, ${literal(v.description)}, ${String(v.version)}, 'ACTIVE')`,
      )
      .join(",\n"),
  );
  lines.push("on conflict (id) do nothing;");
  lines.push("");

  const byDepth = [...taxonomy.nodes].sort((a, b) => a.depth - b.depth);
  lines.push(
    "insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, description, parent_node_id, depth, status, metadata) values",
  );
  lines.push(
    byDepth
      .map(
        (n) =>
          `  (${literal(n.id)}, ${literal(n.vocabularyId)}, ${literal(n.canonicalCode)}, ${literal(n.displayName)}, ${literal(n.description)}, ${literal(n.parentNodeId)}, ${String(n.depth)}, ${literal(n.status)}, ${literal(JSON.stringify(n.metadata))}::jsonb)`,
      )
      .join(",\n"),
  );
  lines.push("on conflict (id) do nothing;");
  lines.push("");

  if (taxonomy.aliases.length > 0) {
    lines.push(
      "insert into taxonomy.aliases (id, node_id, alias, locale, alias_type, normalized_alias) values",
    );
    lines.push(
      taxonomy.aliases
        .map(
          (a) =>
            `  (${literal(a.id)}, ${literal(a.nodeId)}, ${literal(a.alias)}, ${literal(a.locale)}, ${literal(a.aliasType)}, ${literal(a.normalizedAlias)})`,
        )
        .join(",\n"),
    );
    lines.push("on conflict (id) do nothing;");
    lines.push("");
  }

  if (taxonomy.edges.length > 0) {
    lines.push(
      "insert into taxonomy.node_edges (from_node_id, to_node_id, edge_type) values",
    );
    lines.push(
      taxonomy.edges
        .map(
          (e) =>
            `  (${literal(e.fromNodeId)}, ${literal(e.toNodeId)}, ${literal(e.edgeType)})`,
        )
        .join(",\n"),
    );
    lines.push("on conflict (from_node_id, to_node_id, edge_type) do nothing;");
    lines.push("");
  }

  return lines.join("\n");
}
