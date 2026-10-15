import {
  GateqDossierV1Schema,
  type ApplicationTranscriptTurnDto,
  type GateqDossierV1,
  type GateqSynthesisV1,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  GateqDossierSynthesisResultSchema,
  renderPrompt,
  type GateqDossierSynthesisResult,
  type PromptRegistry,
} from "@capital-q/q-core";

import { withDerivedAmountsMarked } from "./dossier.js";

/**
 * Q's reading of a submitted GateQ application (lead decision 2026-10-15).
 *
 * Runs AFTER submission, outside its transaction, as a job of the API: a
 * sweep claims one submission at a time, asks the Model Gateway on the
 * EVIDENCE_SYNTHESIS task class, validates the answer and records it once.
 *
 * Context boundary (the Context Firewall's rule, applied before the model
 * is called): the only input is what the receiving organisation was sent,
 * the frozen dossier and the frozen transcript of THIS submission. No live
 * application facts, no company profile, no other application, and no
 * contact details (the founder's email and phone are not needed to read
 * the evidence, so they never reach a model). The q-firewall package has
 * no scope for a background job over a submission yet; this projection is
 * that boundary until it does (flagged for an ADR, not redesigned here).
 *
 * Output discipline: every point must cite a fact id or transcript turn
 * that exists in that submission; anything uncited is dropped. The whole
 * reading is Q_INFERENCE and carries no score, rank or decision.
 */

export const GATEQ_SYNTHESIS_PROMPT_VERSION = "GATEQ_DOSSIER_SYNTHESIS@v1";

export type PendingSynthesis = {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly investorName: string;
  readonly dossier: unknown;
  readonly transcript: readonly ApplicationTranscriptTurnDto[];
};

export type SynthesisStore = {
  /** Submissions without a reading (or with a retryable failure), oldest first. */
  readonly pending: (limit: number) => Promise<readonly PendingSynthesis[]>;
  /**
   * Record an attempt BEFORE the model is called (as FAILED, attempts+1),
   * so a crash mid-call counts as a failure and two replicas never both
   * pay for the same reading. False: another attempt holds it or the
   * attempts are spent.
   */
  readonly claim: (input: {
    readonly applicationId: string;
    readonly tenantId: string;
  }) => Promise<boolean>;
  readonly ready: (input: {
    readonly applicationId: string;
    readonly synthesis: GateqSynthesisV1;
    readonly promptVersion: string;
  }) => Promise<void>;
};

const FINDINGS_MAX = 14_000;
const TRANSCRIPT_MAX = 14_000;

/** What the model may read: the frozen findings, with ids, no contact. */
export function synthesisContext(input: {
  readonly dossier: GateqDossierV1;
  readonly transcript: readonly ApplicationTranscriptTurnDto[];
}): {
  readonly findings: string;
  readonly transcript: string;
  readonly factIds: ReadonlySet<string>;
  readonly turnSeqs: ReadonlySet<number>;
} {
  const dossier = withDerivedAmountsMarked(input.dossier, input.transcript);
  const lines: string[] = [];
  const factIds = new Set<string>();
  for (const group of dossier.dimensions) {
    for (const fact of group.facts) {
      factIds.add(fact.sourceFactId);
      lines.push(
        `sourceFactId=${fact.sourceFactId} | ${group.label} / ${fact.label}: ${fact.summary} [truth=${fact.truthClass}; evidence=${fact.evidenceStatus}; turn=${fact.sourceTurnSeq ?? "form"}]${fact.derivation === undefined ? "" : ` (${fact.derivation})`}`,
      );
    }
  }
  lines.push(
    `Published mandate check (not an investment decision): ${dossier.qualification.criteria.map((c) => `${c.label} ${c.status}`).join("; ") || "no rules"}.`,
    `Unknown: ${dossier.unknowns.map((g) => g.label).join("; ") || "none"}.`,
    `Declined: ${dossier.declined.map((g) => g.label).join("; ") || "none"}.`,
    `Missing: ${dossier.missing.map((g) => g.label).join("; ") || "none"}.`,
    `Contradictions: ${dossier.contradictions.join("; ") || "none recorded"}.`,
  );
  let findings = "";
  for (const line of lines) {
    if (findings.length + line.length + 1 > FINDINGS_MAX) break;
    findings += `${line}\n`;
  }
  let transcript = "";
  const turnSeqs = new Set<number>();
  for (const turn of input.transcript) {
    const line = `turn ${String(turn.seq)} ${turn.role}: ${turn.text}`;
    if (transcript.length + line.length + 1 > TRANSCRIPT_MAX) break;
    transcript += `${line}\n`;
    turnSeqs.add(turn.seq);
  }
  return {
    findings: findings.trim(),
    transcript: transcript.trim() || "(no interview)",
    factIds,
    turnSeqs,
  };
}

/** Keep only points that cite something real; the rest are not evidence. */
export function citedSynthesis(
  result: GateqDossierSynthesisResult,
  known: {
    readonly factIds: ReadonlySet<string>;
    readonly turnSeqs: ReadonlySet<number>;
  },
  generatedAt: string,
): GateqSynthesisV1 {
  const points = result.points.flatMap((point) => {
    const factIds = [...new Set(point.factIds)].filter((id) =>
      known.factIds.has(id),
    );
    const turnSeqs = [...new Set(point.turnSeqs)].filter((seq) =>
      known.turnSeqs.has(seq),
    );
    if (factIds.length === 0 && turnSeqs.length === 0) return [];
    return [
      {
        kind: point.kind,
        text: point.text.slice(0, 400),
        factIds: factIds.slice(0, 4),
        turnSeqs: turnSeqs.slice(0, 4),
      },
    ];
  });
  return {
    schemaVersion: 1,
    generatedAt,
    truthClass: "Q_INFERENCE",
    takeaway: result.takeaway.slice(0, 600),
    points: points.slice(0, 9),
  };
}

export function createDossierSynthesis(deps: {
  readonly gateway: Pick<ModelGateway, "execute">;
  readonly store: SynthesisStore;
  readonly registry?: PromptRegistry | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
}) {
  const registry = deps.registry ?? createDefaultPromptRegistry();
  const now = deps.now ?? (() => new Date());

  const one = async (item: PendingSynthesis): Promise<"READY" | "FAILED"> => {
    const dossier = GateqDossierV1Schema.safeParse(item.dossier);
    if (!dossier.success) return "FAILED";
    if (
      !(await deps.store.claim({
        applicationId: item.applicationId,
        tenantId: item.tenantId,
      }))
    )
      return "FAILED";
    const context = synthesisContext({
      dossier: dossier.data,
      transcript: item.transcript,
    });
    try {
      const rendered = renderPrompt(registry, {
        task: "GATEQ_DOSSIER_SYNTHESIS",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You cannot record, decide or send anything; this reading is shown to the investor's team as Q's nonbinding view beside the dossier.",
        variables: {
          investorName: item.investorName.slice(0, 200) || "the investor",
          findings: context.findings || "(no findings)",
          transcript: context.transcript,
        },
      });
      const response = await deps.gateway.execute<GateqDossierSynthesisResult>(
        {
          taskClass: "EVIDENCE_SYNTHESIS",
          // The founder's commercial material, read for its recipient.
          sensitivity: "CONFIDENTIAL",
          budget: {
            maxAttempts: 1,
            maxEstimatedCostUsd: 0.1,
            maxOutputTokens: 1_600,
            attemptTimeoutMs: 90_000,
          },
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            tenantId: item.tenantId,
            correlationId: `gateq-synthesis-${item.applicationId}`,
            purpose: "DOCUMENT",
          },
        },
        {
          schema: GateqDossierSynthesisResultSchema,
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (response.output.kind !== "STRUCTURED") return "FAILED";
      const parsed = GateqDossierSynthesisResultSchema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      if (!parsed.success) return "FAILED";
      await deps.store.ready({
        applicationId: item.applicationId,
        synthesis: citedSynthesis(parsed.data, context, now().toISOString()),
        promptVersion: GATEQ_SYNTHESIS_PROMPT_VERSION,
      });
      return "READY";
    } catch (error: unknown) {
      deps.logger?.warn(
        { err: error, applicationId: item.applicationId },
        "gateq synthesis failed",
      );
      return "FAILED";
    }
  };

  return {
    /** One sweep: at most `limit` submissions, one at a time. */
    sweep: async (limit = 1) => {
      let ready = 0;
      let failed = 0;
      for (const item of await deps.store.pending(limit)) {
        if ((await one(item)) === "READY") ready++;
        else failed++;
      }
      return { ready, failed };
    },
  };
}

export type DossierSynthesis = ReturnType<typeof createDossierSynthesis>;
