"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

import { ChevronDown, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { QMark } from "@capital-q/ui/q-mark";

import type { QTurn, QTurnObjectBlock } from "./conversation";
import { RenderedMark } from "./artifact-rendered";
import { LivePreview } from "./live-preview";
import { QMarkdown } from "./markdown";
import { useMoveLine } from "./move-line";
import { evidenceSummary, QEvidenceBody } from "./q-evidence";
import { QResultBlocks } from "./q-result-blocks";
import {
  AnswerPdf,
  ANSWER_PDF_MIN_CHARS,
} from "@/features/documents/answer-pdf";
import { useT } from "@/features/i18n/language";
import { StoryOffer } from "@/features/q-pitch/story/story-offer";

/**
 * One Q reply as a chat row (founder direction A, 2026-09-28; ADR 0018).
 *
 * The answer reads first, as structure when it is structured (lists,
 * tables, callouts; `QMarkdown`). What the answer produced stays inline
 * and compact: a document Q made, a comparison, a question back, a place
 * to go. What it rests on is behind small chips under it -- Sources, the
 * companies or investors it referred to -- which open in place. Collapsed
 * is not removed: every panel is rendered, hidden, so what the server sent
 * is all on the page. Nothing here invents a percentage or a verdict.
 */

type Panel = "sources" | "companies" | "investors";

/** What stays in view, and what sits behind a chip. */
export function replyParts(
  blocks: readonly QTurnObjectBlock[],
  cardsInline = false,
  picturesInline = true,
): {
  readonly inline: readonly QTurnObjectBlock[];
  readonly companies: readonly QTurnObjectBlock[];
  readonly investors: readonly QTurnObjectBlock[];
} {
  const inline: QTurnObjectBlock[] = [];
  const companies: QTurnObjectBlock[] = [];
  const investors: QTurnObjectBlock[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "COMPANY_REFERENCE":
        companies.push(block);
        break;
      case "INVESTOR_REFERENCE":
        investors.push(block);
        break;
      case "ACTION_PROPOSAL":
        // Shown once, where it is decided (the approval, exact payload).
        break;
      case "ARTIFACT_REFERENCE":
        // F-35 (QA 2026-10-23): a document Q made is drawn once. Where the
        // stage draws the answer's objects, it is the stage's (and "Shown
        // recently" brings it back); the thread names it in words.
        if (picturesInline) inline.push(block);
        break;
      case "UI_INTENT":
      case "COMPARISON":
      case "COMPARISON_CARDS":
      case "CLARIFICATION_REQUEST":
      case "WORK_IN_PROGRESS":
      case "TABLE":
      case "CHART":
      case "MAP":
      case "TIMELINE":
      case "ATTENTION":
      case "SUMMARY":
        // What the answer produced or needs from the person, and (E4) its
        // laid-out data: in view.
        inline.push(block);
        break;
      case "PICTURE":
        // Drawn once (owner 2026-10-23: the same picture in the thread and
        // on the stage around it read as broken): where the stage draws it,
        // the answer leaves it to the stage.
        if (picturesInline) inline.push(block);
        break;
      case "ANSWER_CARDS":
        // The dock has no stage to draw these. Reuse the card renderer
        // there; the full Q stage retains its existing ownership.
        if (cardsInline) inline.push(block);
        break;
    }
  }
  return { inline, companies, investors };
}

/**
 * Round 5 (coordinator decision, Stage + Board: objects first, words as
 * caption): the kinds a live preview frame stands in for. They sit above
 * Q's words, so words streaming in below push nothing down; every other
 * block stays under the words, where it lands without moving anything.
 */
const LEADING_KINDS: ReadonlySet<QTurnObjectBlock["kind"]> = new Set([
  "TABLE",
  "SUMMARY",
  "COMPARISON_CARDS",
  "ANSWER_CARDS",
]);

/**
 * The objects region of an answer that streamed here: it never gets
 * shorter while it stays mounted, so the preview frame giving way to the
 * real block (or to cards drawn on the stage instead) never pulls the
 * words up. An answer that arrived settled is not held.
 */
function useNeverShrink(hold: boolean) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [floor, setFloor] = useState(0);
  useEffect(() => {
    if (!hold || element === null || typeof ResizeObserver === "undefined") {
      return;
    }
    // The layout height (border box), not the painted rect: an entering
    // frame's transform would read a few pixels short (round 5, measured).
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const height = entry?.borderBoxSize[0]?.blockSize ?? element.offsetHeight;
      setFloor((current) => (height > current ? height : current));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hold, element]);
  return [setElement, hold && floor > 0 ? floor : undefined] as const;
}

function counted(one: string, many: string, n: number): string {
  return `${n === 1 ? one : many} · ${String(n)}`;
}

export function QAnswer({
  turn,
  onAsk,
  onOpenArtifact,
  mark = true,
  cardsInline = false,
  picturesInline = true,
  working,
}: {
  readonly turn: Extract<QTurn, { kind: "Q" }>;
  /** Continue in this thread from something Q referred to (QX-001 §9). */
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
  /** False in a thread, where the row itself says who is speaking. */
  readonly mark?: boolean | undefined;
  /** The dock has no separate answer stage. */
  readonly cardsInline?: boolean | undefined;
  /** False where the stage around the thread draws the answer's pictures. */
  readonly picturesInline?: boolean | undefined;
  /**
   * Where Q is while it works (round 4/5): one line at the top of the
   * answer, held at its height once the answer lands, so nothing moves.
   */
  readonly working?: ReactNode | undefined;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState<Panel | null>(null);
  const { inline, companies, investors } = replyParts(
    turn.blocks,
    cardsInline,
    picturesInline,
  );
  const leading = inline.filter((block) => LEADING_KINDS.has(block.kind));
  const trailing = inline.filter((block) => !LEADING_KINDS.has(block.kind));
  // Streamed here in this mount: its working line keeps its height once it
  // has nothing to say, and its objects region does not shrink (round 5).
  const [streamedHere, setStreamedHere] = useState(turn.streaming);
  if (turn.streaming && !streamedHere) setStreamedHere(true);
  const [objectsRef, objectsFloor] = useNeverShrink(streamedHere);
  // QA 2026-10-23 (U2): where the stage draws the pictures it also draws
  // the live preview; the thread drawing it too showed every frame twice.
  const preview = turn.streaming && picturesInline ? turn.preview : undefined;
  const sources = evidenceSummary(turn, false);
  // R3: "Opening X…" until this tab's browser VERIFIED the move.
  const text = useMoveLine(turn.text, turn.blocks);

  const chips: { key: Panel; label: string }[] = [];
  if (sources !== null) {
    chips.push({
      key: "sources",
      label: sources.label === "" ? "Sources" : `Sources · ${sources.label}`,
    });
  }
  if (companies.length > 0) {
    chips.push({
      key: "companies",
      label: counted("Company", "Companies", companies.length),
    });
  }
  if (investors.length > 0) {
    chips.push({
      key: "investors",
      label: counted("Investor", "Investors", investors.length),
    });
  }

  return (
    <div
      className="cq-q-answer flex w-full max-w-(--cq-layout-reading) flex-col gap-3"
      data-q-answer={turn.streaming ? "streaming" : "settled"}
    >
      {mark ? (
        <QMark size="sm" state={turn.streaming ? "WORKING" : "IDLE"} />
      ) : null}
      {/* Round 5: where Q is, on top while it works (the live mark turns
          beside it); its line keeps its height once the answer lands. */}
      {working !== undefined && (turn.streaming || streamedHere)
        ? working
        : null}
      {/* Objects first (round 5, Stage + Board): the cards for what Q is
          naming go up while it talks (artifacts live, in the thread too),
          and the answer's own table, summary or cards take their place. */}
      {preview !== undefined || leading.length > 0 || streamedHere ? (
        <div
          ref={objectsRef}
          className="flex flex-col gap-3"
          style={
            objectsFloor === undefined ? undefined : { minHeight: objectsFloor }
          }
          data-q-answer-objects
        >
          {preview !== undefined ? (
            <LivePreview preview={preview} />
          ) : leading.length > 0 ? (
            <QResultBlocks
              blocks={leading}
              onAsk={onAsk}
              onOpenArtifact={onOpenArtifact}
            />
          ) : null}
        </div>
      ) : null}
      {text.length > 0 ? (
        <QMarkdown
          text={text}
          streaming={turn.streaming}
          className="cq-body text-(--cq-text-primary)"
        />
      ) : null}
      {trailing.length > 0 ? (
        <QResultBlocks
          blocks={trailing}
          onAsk={onAsk}
          onOpenArtifact={onOpenArtifact}
        />
      ) : null}
      {/* Q Story: "what is Capital Q?" asked alone, the story one tap away. */}
      {turn.streaming ? null : <StoryOffer turnId={turn.id} />}
      {/* Artifacts live (audit 2026-10-15 §4): drawn inline in the thread
          (Chat view, the Q sheet) counts as drawn, as on the Q stage, so
          "as the table shows" stands here too. The newest answer mounts
          last, so its set is the one reported. */}
      {!turn.streaming && inline.length > 0 && turn.runId !== undefined ? (
        <RenderedMark
          run={turn.runId}
          kinds={inline.map((block) => block.kind)}
        />
      ) : null}
      {/* DOCS: any substantive answer, as a PDF. */}
      {!turn.streaming &&
      turn.runId !== undefined &&
      turn.text.length >= ANSWER_PDF_MIN_CHARS ? (
        <AnswerPdf runId={turn.runId} messageId={turn.id} />
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t("About this answer")}
            data-q-chips
          >
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="cq-q-chip"
                aria-expanded={open === chip.key}
                aria-controls={`${id}-${chip.key}`}
                onClick={() => {
                  setOpen((current) =>
                    current === chip.key ? null : chip.key,
                  );
                }}
                data-q-chip={chip.key}
              >
                {chip.label}
                <ChevronDown
                  aria-hidden="true"
                  className="cq-q-chip-caret"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              </button>
            ))}
          </div>
          {sources !== null ? (
            <div
              id={`${id}-sources`}
              hidden={open !== "sources"}
              data-q-evidence
              data-q-panel="sources"
            >
              <QEvidenceBody
                turn={turn}
                onAsk={onAsk}
                onOpenArtifact={onOpenArtifact}
                includeBlocks={false}
              />
            </div>
          ) : null}
          {companies.length > 0 ? (
            <div
              id={`${id}-companies`}
              hidden={open !== "companies"}
              data-q-panel="companies"
            >
              <QResultBlocks blocks={companies} onAsk={onAsk} />
            </div>
          ) : null}
          {investors.length > 0 ? (
            <div
              id={`${id}-investors`}
              hidden={open !== "investors"}
              data-q-panel="investors"
            >
              <QResultBlocks blocks={investors} onAsk={onAsk} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
