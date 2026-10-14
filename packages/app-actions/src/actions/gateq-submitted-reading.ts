import {
  GateqInboxDetailDtoSchema,
  type GateqInboxDetailDto,
  type GateqDossierV1,
} from "@capital-q/contracts";
import {
  AppSourceReadingSchema,
  type AppSourceReading,
} from "../source-reading.js";

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
      const line = `${fact.label}: ${fact.summary.replace(/\s+/gu, " ")} [truth=${fact.truthClass}; evidence=${fact.evidenceStatus}; provenance=${fact.provenance}; sourceFactId=${fact.sourceFactId}; sourceTurnSeq=${fact.sourceTurnSeq ?? "not recorded"}]`;
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

/** Fail closed unless this is the exact authorized frozen submission. */
export function submittedSourceReading(
  out: unknown,
  gatewayId: string,
  applicationId: string,
): AppSourceReading | null {
  const parsed = GateqInboxDetailDtoSchema.safeParse(out);
  if (!parsed.success) return null;
  const detail: GateqInboxDetailDto = parsed.data;
  const dossier = detail.dossier;
  if (
    !dossier ||
    detail.item.applicationId !== applicationId ||
    dossier.application.reference !== detail.item.reference ||
    dossier.application.submittedAt !== detail.item.submittedAt ||
    !detail.item.submittedAt
  )
    return null;
  const all = [
    `${detail.item.companyName}: ${detail.item.oneLiner ?? ""}`,
    `Frozen submission ${detail.item.reference}; submitted ${detail.item.submittedAt}.`,
    `Qualification rules: ${detail.rules.map((rule) => `${rule.label}: ${rule.standing}`).join("; ") || "none recorded"}.`,
    ...submittedReading(dossier).split("\n"),
    ...detail.answers.map(
      (answer) =>
        `Submitted answer (applicant claim): ${answer.label}: ${answer.value.replace(/\s+/gu, " ")}`,
    ),
    `Shared document titles: ${detail.shared.map((document) => document.title).join("; ") || "none"}. No document contents were read.`,
  ];
  const lines: string[] = [];
  let used = 0;
  let omittedLines = 0;
  for (const line of all) {
    if (used + line.length + 1 > 6500) {
      omittedLines++;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (omittedLines)
    lines.push(
      `${omittedLines} source lines exceed this bounded reading; consult the frozen dossier before answering about omitted material.`,
    );
  return AppSourceReadingSchema.parse({
    kind: "GATEQ_SUBMITTED_APPLICATION",
    gatewayId,
    applicationId,
    reference: detail.item.reference,
    submittedAt: detail.item.submittedAt,
    dossierSchemaVersion: dossier.schemaVersion,
    generatedAt: dossier.generatedAt,
    statement: lines.join("\n"),
    omittedLines,
  });
}
