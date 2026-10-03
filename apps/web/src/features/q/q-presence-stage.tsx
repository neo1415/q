"use client";

import { useId, useMemo, useState, type ReactNode } from "react";

import { History, ICON_SIZE, ICON_STROKE, X } from "@capital-q/ui/icons";

import type { QTurn } from "./conversation";
import { plainFromMarkdown } from "./markdown";
import { QResultBlocks } from "./q-result-blocks";
import {
  answersIn,
  onStage,
  shownItems,
  shownRecently,
  type ShownItem,
} from "./shown";

/**
 * The Q page in its presence view (founder request 2026-10-03): Q's
 * presence and nothing written, unless Q has something to show.
 *
 * - No transcript. Q's words are said, and are in Chat; here they are
 *   announced to a screen reader only, unless the person turned captions
 *   on (an accessibility setting, off by default), which shows the latest
 *   exchange the presence view used to show.
 * - An object Q shows (a document, a comparison, cards, a question back)
 *   appears over the presence and steps back after a few answers, or when
 *   dismissed. "Shown recently" brings any of this session's back.
 * - A change waiting for approval is passed in as `waiting` and is never
 *   stepped back: it stays until it is decided.
 */
export function QPresenceStage({
  presence,
  turns,
  captions,
  caption,
  waiting,
  onAsk,
  onOpenArtifact,
}: {
  /** Q's presence: the aperture and anything that belongs with it. */
  readonly presence: ReactNode;
  readonly turns: readonly QTurn[];
  /** The person's captions setting. */
  readonly captions: boolean;
  /** The latest exchange as captions, rendered only when captions are on. */
  readonly caption: ReactNode;
  /** A pending approval (QNow): always reachable while it waits. */
  readonly waiting?: ReactNode;
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
}) {
  const listId = useId();
  const items = useMemo(() => shownItems(turns), [turns]);
  const answers = answersIn(turns);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [reopened, setReopened] = useState<{
    readonly id: string;
    readonly atAnswer: number;
  } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const shown = onStage(items, answers, dismissed, reopened);
  const recent = shownRecently(items);
  const latestQ = turns.findLast(
    (turn): turn is Extract<QTurn, { kind: "Q" }> => turn.kind === "Q",
  );

  const dismiss = (item: ShownItem) => {
    const key =
      reopened !== null && reopened.id === item.id
        ? `${item.id}@${String(reopened.atAnswer)}`
        : item.id;
    setDismissed((current) => new Set([...current, key]));
    if (reopened?.id === item.id) setReopened(null);
  };

  return (
    <div
      className="flex w-full flex-col items-center gap-4"
      data-q-presence-stage
    >
      {presence}

      {/* Q's words for a screen reader, never as text on the page. */}
      <p className="sr-only" aria-live="polite" data-q-said>
        {latestQ === undefined || latestQ.streaming
          ? ""
          : plainFromMarkdown(latestQ.text)}
      </p>

      {captions ? <div data-q-captions>{caption}</div> : null}

      {shown === null ? null : (
        <section
          aria-label={shown.title}
          className="relative w-full rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-4"
          data-q-shown={shown.id}
        >
          <button
            type="button"
            className="cq-stage-quiet absolute top-2 right-2"
            aria-label={`Dismiss ${shown.title}`}
            onClick={() => dismiss(shown)}
            data-q-shown-dismiss
          >
            <X
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </button>
          <QResultBlocks
            blocks={shown.blocks}
            onAsk={onAsk}
            onOpenArtifact={onOpenArtifact}
          />
        </section>
      )}

      {waiting}

      {recent.length === 0 ? null : (
        <div
          className="flex w-full flex-col items-center gap-2"
          data-q-shown-recently
        >
          <button
            type="button"
            className="cq-stage-quiet"
            aria-expanded={listOpen}
            aria-controls={listId}
            onClick={() => setListOpen((open) => !open)}
          >
            <History
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            Shown recently
          </button>
          {listOpen ? (
            <ul
              id={listId}
              className="flex w-full flex-col gap-1"
              aria-label="Shown recently"
            >
              {recent.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="cq-stage-quiet w-full justify-start"
                    onClick={() => {
                      setReopened({ id: item.id, atAnswer: answers });
                      setListOpen(false);
                    }}
                    data-q-shown-reopen={item.id}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
