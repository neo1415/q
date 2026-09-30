"use client";

import { useEffect, useState, type ReactNode } from "react";

import { qArtifactExportFormats } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  CircleAlert,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  Presentation,
} from "@capital-q/ui/icons";

import { QSwarm } from "@/features/q-swarm/q-swarm";

import { artifactTypeLabel } from "./artifact-type";
import { ArtifactDownloads } from "./artifact-download";
import type { QTurnObjectBlock } from "./conversation";

/**
 * Something Q composed, as a card (QX-003E; R36).
 *
 * One card for the answer and the Board, so a brief looks like a brief
 * wherever it lands: what kind of document it is, its title, where it is
 * in its life, and one clear way in (Open), with the files beside it in a
 * single control. Nothing else competes: Edit with Q is quiet, and the
 * reassurance that nothing was sent is a few words in the meta line rather
 * than a paragraph.
 *
 * The status is always on the card, in words and an icon, never colour
 * alone: "prepared" and "still being prepared" are different things to
 * somebody about to send a document to an investor. While Q is still
 * preparing, a skeleton holds the card's shape so nothing jumps when it
 * arrives; when it failed, the card says what to do next.
 */

export type ArtifactReference = Extract<
  QTurnObjectBlock,
  { kind: "ARTIFACT_REFERENCE" }
>;

export const EDIT_WITH_Q_PROMPT =
  "Edit this document with me — what would you change first?";
export const RETRY_PROMPT = "Try preparing that document again.";

/**
 * A card that arrived while its document was still being prepared asks
 * where it is until it has settled (founder live 2026-09-30: a new
 * document needed a refresh to appear). Bounded: every few seconds, for a
 * few minutes at most.
 */
const PREPARING_CHECK_MS = 4_000;
const PREPARING_CHECKS_MAX = 60;

function useSettledStatus(
  artifactId: string,
  initial: ArtifactReference["status"],
): ArtifactReference["status"] {
  // What the checks learned, for the status the card was given; a new
  // status from the answer replaces it.
  const [settled, setSettled] = useState<{
    readonly from: ArtifactReference["status"];
    readonly status: ArtifactReference["status"];
  }>({ from: initial, status: initial });
  const status = settled.from === initial ? settled.status : initial;
  useEffect(() => {
    if (status !== "PREPARING") return;
    let checks = 0;
    let alive = true;
    const timer = window.setInterval(() => {
      checks += 1;
      if (checks > PREPARING_CHECKS_MAX) {
        window.clearInterval(timer);
        return;
      }
      void fetch(`/api/q-artifact/${encodeURIComponent(artifactId)}/detail`)
        .then(async (response) => {
          if (!response.ok) return;
          const body: unknown = await response.json();
          const next: unknown = Reflect.get(Object(body), "status");
          if (
            alive &&
            (next === "READY" || next === "FAILED" || next === "PREPARING")
          ) {
            setSettled({ from: initial, status: next });
          }
        })
        .catch(() => undefined);
    }, PREPARING_CHECK_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [artifactId, status, initial]);
  return status;
}

export function ArtifactCard({
  block: given,
  onOpen,
  onAsk,
  preview,
  framed = true,
}: {
  readonly block: ArtifactReference;
  /** Absent on a surface with no viewer. */
  readonly onOpen?: ((artifactId: string) => void) | undefined;
  readonly onAsk?: ((question: string) => void) | undefined;
  /** A first-slide picture, where the surface has room for one. */
  readonly preview?: ReactNode;
  /** The Board draws its own frame around every object. */
  readonly framed?: boolean | undefined;
}) {
  const status = useSettledStatus(given.artifactId, given.status);
  const block = status === given.status ? given : { ...given, status };
  const ready = block.status === "READY";
  const deck = block.type === "PITCH_DECK";
  const TypeIcon = deck ? Presentation : FileText;

  return (
    <section
      className={
        framed
          ? "flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
          : "flex flex-col gap-3"
      }
      aria-label={`${artifactTypeLabel(block.type)}: ${block.title}`}
      data-q-result-card
      data-q-artifact-card={block.status}
    >
      {ready && preview !== undefined ? preview : null}

      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
        >
          <TypeIcon size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="cq-caption text-(--cq-text-tertiary)">
            {/* The Board names the type in its own header. */}
            {framed ? <span>{artifactTypeLabel(block.type)}</span> : null}
            {framed && ready ? " · " : null}
            {ready ? <span>Private draft, not shared</span> : null}
          </p>
          <p className="cq-body line-clamp-2 font-medium text-(--cq-text-primary)">
            {block.title}
          </p>
        </div>
      </div>

      {ready ? (
        <div className="flex flex-wrap items-center gap-2">
          {onOpen === undefined ? null : (
            <button
              type="button"
              className={buttonClassName("primary", "regular")}
              onClick={() => {
                onOpen(block.artifactId);
              }}
              data-q-artifact-open={block.artifactId}
            >
              Open
            </button>
          )}
          {/*
            "Just give me the PDF" (CQ-QACT-002): the file is one tap from
            the answer that made it, through the same narrow route the
            viewer uses, so the session cookie is the only authority it
            carries. A deck offers both of its files in one menu (BIZ-001).
          */}
          <ArtifactDownloads
            artifactId={block.artifactId}
            formats={qArtifactExportFormats(block.type)}
            version={null}
          />
          {onAsk === undefined ? null : (
            <button
              type="button"
              className={buttonClassName("quiet", "regular")}
              onClick={() => {
                // A normal question in the same thread: the revision is
                // composed and written by the same authorised path any
                // other answer takes.
                onAsk(EDIT_WITH_Q_PROMPT);
              }}
              data-q-artifact-edit
            >
              Edit with Q
            </button>
          )}
        </div>
      ) : block.status === "PREPARING" ? (
        <div className="flex items-center gap-3" data-q-artifact-preparing>
          <QSwarm state="WORKING" pixels={48} />
          <p className="cq-caption text-(--cq-text-secondary)">
            Q is writing this. Please wait; it opens here when it&apos;s ready.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-q-artifact-failed>
          <p className="cq-body-sm flex items-start gap-2 text-(--cq-text-secondary)">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            <span>
              Q couldn&apos;t finish preparing this one. Nothing was sent.
            </span>
          </p>
          {onAsk === undefined ? null : (
            <div>
              <button
                type="button"
                className={buttonClassName("secondary", "regular")}
                onClick={() => {
                  onAsk(RETRY_PROMPT);
                }}
                data-q-artifact-retry
              >
                Ask Q to try again
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
