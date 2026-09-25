import { QMark } from "@capital-q/ui/q-mark";

import type { QTurn } from "./conversation";
import { QEvidence, splitBlocks } from "./q-evidence";
import { QResultBlocks } from "./q-result-blocks";

/**
 * Q's answer where it is read rather than heard (the panel beside a page):
 * the prose first, what can be acted on (a document Q made, a place to
 * go), then everything the answer rests on behind one "Evidence"
 * disclosure (founder direction, 2026-09-25). Nothing here invents a
 * percentage or a verdict the server did not send.
 */
export function QAnswer({
  turn,
  onAsk,
  onOpenArtifact,
}: {
  readonly turn: Extract<QTurn, { kind: "Q" }>;
  /** Continue in this thread from something Q referred to (QX-001 §9). */
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
}) {
  const { visible } = splitBlocks(turn.blocks);
  return (
    <div
      className="cq-q-answer flex max-w-(--cq-layout-reading) flex-col gap-3"
      data-q-answer={turn.streaming ? "streaming" : "settled"}
    >
      {/* One Q, once: the mark is the label. */}
      <QMark size="sm" state={turn.streaming ? "WORKING" : "IDLE"} />
      <p className="cq-body cq-prose whitespace-pre-wrap text-(--cq-text-primary)">
        {turn.text}
      </p>
      <QResultBlocks
        blocks={visible}
        onAsk={onAsk}
        onOpenArtifact={onOpenArtifact}
      />
      <QEvidence turn={turn} onAsk={onAsk} onOpenArtifact={onOpenArtifact} />
    </div>
  );
}
