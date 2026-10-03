"use client";

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

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
  onShowingChange,
}: {
  /**
   * Q's presence: full size, or small and pinned at the top while an
   * object is shown (lead 2026-10-03: the presence never leaves the screen).
   */
  readonly presence: (compact: boolean) => ReactNode;
  /** Told when an object starts or stops being shown (the stage stops following newest). */
  readonly onShowingChange?: ((showing: boolean) => void) | undefined;
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

  const showing = shown !== null;
  useEffect(() => {
    onShowingChange?.(showing);
  }, [showing, onShowingChange]);
  const reduced = useReducedMotion() === true;

  return (
    <div
      className="flex w-full flex-col items-center gap-4"
      data-q-presence-stage={showing ? "object" : "presence"}
    >
      <LazyMotion features={domAnimation} strict>
        {/* The presence stays on screen: small while an object is shown,
            full again once it is dismissed (reduced motion: no scale). */}
        <m.div
          key={showing ? "compact" : "full"}
          className="flex w-full flex-col items-center"
          data-q-presence-size={showing ? "compact" : "full"}
          initial={
            reduced ? false : { opacity: 0.4, scale: showing ? 1.2 : 0.8 }
          }
          animate={{ opacity: 1, scale: 1 }}
          transition={
            reduced ? { duration: 0 } : { duration: 0.24, ease: [0.2, 0, 0, 1] }
          }
        >
          {presence(showing)}
        </m.div>
      </LazyMotion>

      {/* Q's words for a screen reader, never as text on the page. */}
      <p className="sr-only" aria-live="polite" data-q-said>
        {latestQ === undefined || latestQ.streaming
          ? ""
          : plainFromMarkdown(latestQ.text)}
      </p>

      {captions ? <div data-q-captions>{caption}</div> : null}

      {shown === null ? null : (
        <section
          aria-labelledby={`${listId}-shown-title`}
          className="flex max-h-[60dvh] w-full flex-col overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)"
          data-q-shown={shown.id}
        >
          {/* Its title and Dismiss stay in view while the object scrolls. */}
          <div
            className="flex min-h-11 flex-none items-center justify-between gap-2 border-b border-(--cq-border-subtle) py-1 pr-1 pl-4"
            data-q-shown-header
          >
            <h2
              id={`${listId}-shown-title`}
              className="cq-body min-w-0 truncate font-medium text-(--cq-text-primary)"
            >
              {shown.title}
            </h2>
            <button
              type="button"
              className="cq-stage-quiet min-h-11 min-w-11 justify-center"
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
          </div>
          <div className="min-h-0 overflow-y-auto p-4" data-q-shown-body>
            <QResultBlocks
              blocks={shown.blocks}
              onAsk={onAsk}
              onOpenArtifact={onOpenArtifact}
            />
          </div>
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
