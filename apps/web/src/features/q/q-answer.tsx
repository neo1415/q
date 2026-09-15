import { Q_CONFIDENCE_LABELS, type QFindingType } from "@capital-q/contracts";
import { QMark } from "@capital-q/ui/q-mark";

import type { QTurn } from "./conversation";

/**
 * Q's answer on Home, laid out to be read rather than scrolled
 * (doc 17 §60-§63; doc 18 on quiet surfaces).
 *
 * The prose first, in a reading measure. Then, only when the server sent
 * them, the findings as one plain list with the type in words and the
 * confidence the contract labelled; then what Q could not settle and what
 * would settle it; then how many recorded sources the answer rests on.
 * Truth is never conveyed by colour alone, and nothing here invents a
 * percentage or a verdict the server did not send.
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

export function QAnswer({
  turn,
}: {
  readonly turn: Extract<QTurn, { kind: "Q" }>;
}) {
  const hasDetail = turn.findings.length > 0 || turn.uncertainties.length > 0;
  return (
    <div
      className={
        hasDetail
          ? "cq-q-answer cq-q-answer-read flex max-w-(--cq-layout-narrow) flex-col gap-4"
          : "cq-q-answer flex max-w-(--cq-layout-narrow) flex-col gap-2"
      }
      data-q-answer={turn.streaming ? "streaming" : "settled"}
    >
      <div className="flex items-center gap-2">
        <QMark size="sm" state={turn.streaming ? "WORKING" : "IDLE"} />
        <span className="cq-label text-(--cq-text-tertiary)">Q</span>
      </div>
      <p className="cq-body whitespace-pre-wrap text-(--cq-text-primary)">
        {turn.text}
      </p>
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
          <span className="cq-label text-(--cq-text-tertiary)">Still open</span>
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
      {turn.sourceCount > 0 ? (
        <span className="cq-caption text-(--cq-text-secondary)">
          Based on {sources(turn.sourceCount)} on record.
        </span>
      ) : null}
    </div>
  );
}
