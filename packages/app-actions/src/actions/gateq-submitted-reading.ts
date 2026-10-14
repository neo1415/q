import type { GateqDossierV1 } from "@capital-q/contracts";

/** Reads the authorized frozen dossier, without fetching or upgrading evidence. */
export function submittedReading(
  dossier:
    | Pick<
        GateqDossierV1,
        "dimensions" | "unknowns" | "declined" | "missing" | "contradictions"
      >
    | null
    | undefined,
): string {
  if (!dossier)
    return "No frozen interview dossier is available for this legacy submission.";
  const lines = [
    "Frozen submitted interview findings (nonbinding; mandate fit is not an investment decision):",
  ];
  let remaining = 12_000;
  let omitted = 0;
  for (const group of dossier.dimensions) {
    for (const fact of group.facts) {
      const line = `${fact.label}: ${fact.summary} [truth=${fact.truthClass}; evidence=${fact.evidenceStatus}; provenance=${fact.provenance}; sourceFactId=${fact.sourceFactId}; sourceTurnSeq=${fact.sourceTurnSeq ?? "not recorded"}]`;
      if (line.length > remaining) {
        omitted++;
        continue;
      }
      lines.push(line);
      remaining -= line.length;
    }
  }
  for (const [label, gaps] of [
    ["Unknown", dossier.unknowns],
    ["Declined", dossier.declined],
    ["Missing", dossier.missing],
  ] as const) {
    lines.push(
      `${label}: ${gaps.map((gap) => gap.label).join("; ") || "none recorded"}.`,
    );
  }
  lines.push(
    `Conflicts: ${dossier.contradictions.join("; ") || "none recorded"}.`,
  );
  if (omitted)
    lines.push(
      `${omitted} additional findings exceed this reading's context budget; consult the submitted dossier before answering about them.`,
    );
  lines.push(
    "Document-supported means supported by submitted evidence, not independently verified. No document contents were read by this action.",
  );
  return lines.join("\n");
}
