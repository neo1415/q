"use client";

import { Q_CONFIDENCE_LABELS, type QFindingType } from "@capital-q/contracts";

import type { QTurn, QTurnObjectBlock } from "./conversation";
import { QResultBlocks } from "./q-result-blocks";

/**
 * What an answer rests on, behind one "Sources" disclosure (founder
 * direction, 2026-09-25; R23, ADR 0018): the answer is heard and read first, clean; the findings,
 * what is still open, what Q needs to know and the sources are one press
 * away, never in the way. Everything the server sent is still here --
 * collapsed is not removed -- and nothing is invented: no percentage, no
 * verdict, confidence only in the contract's own words.
 */

const FINDING_LABELS: Readonly<Record<QFindingType, string>> = {
  FACT: "Fact",
  OBSERVATION: "Observation",
  INFERENCE: "Inference",
  RISK: "Risk",
  STRENGTH: "Strength",
  GAP: "Gap",
  RECOMMENDATION: "Recommendation",
  UNCERTAINTY: "Open question",
};

function sources(count: number): string {
  return count === 1 ? "1 source" : `${String(count)} sources`;
}

/**
 * An answer's blocks, split: what stays in view (a document Q made, a
 * place to go) and what is evidence (a company or investor it referred
 * to, a comparison, a question back). An approval is never here: it has
 * its own place, with the exact payload.
 */
export function splitBlocks(blocks: readonly QTurnObjectBlock[]): {
  readonly visible: readonly QTurnObjectBlock[];
  readonly evidence: readonly QTurnObjectBlock[];
} {
  const visible: QTurnObjectBlock[] = [];
  const evidence: QTurnObjectBlock[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "ARTIFACT_REFERENCE":
      case "UI_INTENT":
        visible.push(block);
        break;
      case "ACTION_PROPOSAL":
        // Shown once, where it is decided.
        break;
      case "COMPANY_REFERENCE":
      case "INVESTOR_REFERENCE":
      case "COMPARISON":
      case "CLARIFICATION_REQUEST":
        evidence.push(block);
        break;
      default:
        // A block kind this build does not know yet (another packet may
        // add one): kept, behind the disclosure.
        evidence.push(block);
    }
  }
  return { visible, evidence };
}

export function QEvidence({
  turn,
  onAsk,
  onOpenArtifact,
}: {
  readonly turn: Extract<QTurn, { kind: "Q" }>;
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
}) {
  const { evidence } = splitBlocks(turn.blocks);
  const count =
    turn.findings.length + turn.uncertainties.length + evidence.length;
  if (count === 0 && turn.sourceCount === 0) return null;
  return (
    <details className="cq-q-evidence" data-q-evidence>
      <summary className="cq-q-evidence-summary">
        Sources
        <span className="cq-caption text-(--cq-text-tertiary)">
          {turn.sourceCount > 0
            ? ` · ${sources(turn.sourceCount)}`
            : count > 0
              ? ` · ${String(count)}`
              : ""}
        </span>
      </summary>
      <div className="flex flex-col gap-4 pt-3 text-left">
        {turn.findings.length > 0 ? (
          <dl className="cq-q-answer-findings flex flex-col">
            {turn.findings.map((finding) => (
              <div
                key={finding.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4"
              >
                <dt className="cq-label shrink-0 text-(--cq-text-tertiary) sm:w-28">
                  {FINDING_LABELS[finding.type]}
                </dt>
                <dd className="flex flex-col gap-1">
                  <span className="cq-body text-(--cq-text-primary)">
                    {finding.statement}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {Q_CONFIDENCE_LABELS[finding.confidence]}
                    {finding.sourceCount > 0
                      ? ` · ${sources(finding.sourceCount)}`
                      : ""}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {turn.uncertainties.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="cq-label text-(--cq-text-tertiary)">
              Still open
            </span>
            <ul className="flex flex-col gap-2">
              {turn.uncertainties.map((item) => (
                <li key={item.statement} className="flex flex-col gap-0.5">
                  <span className="cq-body text-(--cq-text-primary)">
                    {item.statement}
                  </span>
                  {item.missing.length > 0 ? (
                    <span className="cq-caption text-(--cq-text-secondary)">
                      Would settle it: {item.missing.join(", ")}.
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {evidence.length > 0 ? (
          <QResultBlocks
            blocks={evidence}
            onAsk={onAsk}
            onOpenArtifact={onOpenArtifact}
          />
        ) : null}
        {turn.sourceCount > 0 ? (
          <span className="cq-caption text-(--cq-text-secondary)">
            Based on {sources(turn.sourceCount)} on record.
          </span>
        ) : null}
      </div>
    </details>
  );
}
