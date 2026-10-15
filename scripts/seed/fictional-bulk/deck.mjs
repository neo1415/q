// A fictional company's pitch deck through the product's own deck pipeline,
// with no model: the Company Intelligence composer (`composePitchDeck`, the
// same one Q uses) reads deterministic findings written from the company's
// seeded facts, and the export renderer (`renderArtifactFile`, the same one
// the artifact export route uses) writes the PDF. Unknowns stay unknown:
// a figure the company has not given is never a finding.
import { createHash } from "node:crypto";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../../..");
const specialists = await import(
  join(ROOT, "packages/q-specialists/dist/index.js")
);
const contracts = await import(join(ROOT, "packages/contracts/dist/index.js"));
const render = await import(join(ROOT, "packages/deck-render/dist/index.js"));

const uuid = (seed) => {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/**
 * @param {{ key: string, companyId: string, name: string, shortDescription: string,
 *   lines: { dimension: string, statement: string, truthClass?: string }[] }} input
 * @returns {Promise<{ title: string, pdf: Uint8Array } | null>}
 */
export async function renderDeck(input) {
  const runId = uuid(`fictional-deck:run:${input.key}`);
  const findings = input.lines.map((line, index) => ({
    ...contracts.QInternalFindingSchema.parse({
      findingId: uuid(`fictional-deck:finding:${input.key}:${index}`),
      type: "FACT",
      statement: line.statement,
      truthClass: line.truthClass ?? "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      confidence: "MODERATE",
      subjects: [{ kind: "COMPANY", companyId: input.companyId }],
      evidenceRefs: [],
      runId,
      sensitivity: "CONFIDENTIAL",
      visibilityScope: "organisation_private",
    }),
    dimension: line.dimension,
    derivation: "DETERMINISTIC",
    sources: [`${input.name} founder statements (fictional demo)`],
  }));
  const result = {
    companyId: input.companyId,
    companyName: input.name,
    canonicalDescription: `${input.shortDescription.replace(/\.$/, "")} (fictional demo company).`,
    specialistVersion: "fictional-bulk-deck/v1",
    asOf: "2026-10-15T00:00:00.000Z",
    blocked: null,
    findings,
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "MODERATE",
    synthesis: null,
    research: null,
    recordedStatements: [],
    artifactRequest: null,
    telemetry: {
      specialistId: "fictional-bulk-deck",
      specialistVersion: "fictional-bulk-deck/v1",
      promptBundleVersion: null,
      providerCode: null,
      modelCode: null,
      routingPolicyCode: null,
      modelCalls: 0,
      retrievalCalls: 0,
      knowledgeReads: 0,
      toolCalls: 0,
      factCount: findings.length,
      promptCharacters: 0,
      latencyMs: 0,
      costUsd: 0,
      findingCountsByType: { FACT: findings.length },
      evidenceRefCount: 0,
      contradictionCount: 0,
      gapCount: 0,
      uncertaintyCount: 0,
      staleFactCount: 0,
      rejectedFindingCount: 0,
      rejectedCitationCount: 0,
      researchCalls: 0,
      publicSourceCount: 0,
      statementsRecorded: 0,
    },
  };
  const draft = specialists.composePitchDeck({
    companyName: input.name,
    result,
    direction: "MINIMAL_INSTITUTIONAL",
  });
  if (draft === null) return null;
  const file = await render.renderArtifactFile({
    type: "PITCH_DECK",
    version: { title: draft.title, content: draft.content },
    format: "pdf",
    company: input.name,
  });
  return file === null ? null : { title: draft.title, pdf: file.bytes };
}
