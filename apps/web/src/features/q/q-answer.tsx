"use client";

import { useId, useState } from "react";

import { ChevronDown, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { QMark } from "@capital-q/ui/q-mark";

import type { QTurn, QTurnObjectBlock } from "./conversation";
import { QMarkdown } from "./markdown";
import { evidenceSummary, QEvidenceBody } from "./q-evidence";
import { QResultBlocks } from "./q-result-blocks";

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
export function replyParts(blocks: readonly QTurnObjectBlock[]): {
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
      case "UI_INTENT":
      case "COMPARISON":
      case "CLARIFICATION_REQUEST":
        // What the answer produced or needs from the person: in view.
        inline.push(block);
        break;
    }
  }
  return { inline, companies, investors };
}

function counted(one: string, many: string, n: number): string {
  return `${n === 1 ? one : many} · ${String(n)}`;
}

export function QAnswer({
  turn,
  onAsk,
  onOpenArtifact,
  mark = true,
}: {
  readonly turn: Extract<QTurn, { kind: "Q" }>;
  /** Continue in this thread from something Q referred to (QX-001 §9). */
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
  /** False in a thread, where the row itself says who is speaking. */
  readonly mark?: boolean | undefined;
}) {
  const id = useId();
  const [open, setOpen] = useState<Panel | null>(null);
  const { inline, companies, investors } = replyParts(turn.blocks);
  const sources = evidenceSummary(turn, false);

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
      {turn.text.length > 0 ? (
        <QMarkdown
          text={turn.text}
          streaming={turn.streaming}
          className="cq-body text-(--cq-text-primary)"
        />
      ) : null}
      {inline.length > 0 ? (
        <QResultBlocks
          blocks={inline}
          onAsk={onAsk}
          onOpenArtifact={onOpenArtifact}
        />
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="About this answer"
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
