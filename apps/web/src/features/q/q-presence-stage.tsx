"use client";

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { History, ICON_SIZE, ICON_STROKE, X } from "@capital-q/ui/icons";

import { AnswerCanvas, flyToBoard } from "./answer-canvas";
import { answerCardsOf, topicMovedOn } from "./answer-canvas-logic";
import type { QTurn } from "./conversation";
import { firstWords } from "./board-timeline";
import { useAnswerPlayback } from "./use-answer-playback";
import { plainFromMarkdown } from "./markdown";
import { QResultBlocks } from "./q-result-blocks";
import { QRoomStage } from "./room/q-room-card";
import { roomStage } from "./room/room-stage";
import {
  answersIn,
  onStage,
  shownItems,
  shownRecently,
  type ShownItem,
} from "./shown";

const SHOW_ON_STAGE = "cq:q-show-answer";

/** Put an answer Q showed earlier back on the stage (from the Board). */
export function showOnStage(answerId: string): void {
  // A frame later: the stage may only now be mounting (from Chat view).
  window.requestAnimationFrame(() => {
    window.dispatchEvent(
      new CustomEvent<{ readonly id: string }>(SHOW_ON_STAGE, {
        detail: { id: answerId },
      }),
    );
  });
}

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
  live = false,
  onBoardLanded,
  onPin,
}: {
  /** A live voice line is open: Q's own lines drive which card is open. */
  readonly live?: boolean | undefined;
  /** An answer flew into the Board (C4): the Board button counts it. */
  readonly onBoardLanded?: (() => void) | undefined;
  /** Pin an answer to the Board. */
  readonly onPin?: ((answerId: string) => void) | undefined;
  /**
   * Q's presence: full size, or small and pinned at the top while an
   * object is shown (lead 2026-10-03: the presence never leaves the screen).
   */
  readonly presence: (compact: boolean, mini?: boolean) => ReactNode;
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
  const staged = onStage(items, answers, dismissed, reopened);
  // C4: cards whose topic the conversation has left are not on the stage.
  const movedOn =
    staged !== null &&
    reopened?.id !== staged.id &&
    topicMovedOn(turns, staged.id);
  const shown = movedOn ? null : staged;
  const recent = shownRecently(items);
  // Q room R4: the card Q brought into the room, open while the
  // conversation stays on its subject (room-stage), or until closed here.
  const room = useMemo(() => roomStage(turns), [turns]);
  const [closedByHand, setClosedByHand] = useState<{
    readonly key: string;
    readonly at: number;
  } | null>(null);
  const roomOpen =
    room.open !== null &&
    !(
      closedByHand !== null &&
      closedByHand.key === room.open.key &&
      closedByHand.at >= room.open.openedAt
    )
      ? room.open
      : null;
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

  // The answer on the stage as cards, and one leaving for the Board.
  const canvas =
    shown === null
      ? null
      : (() => {
          const turn = turns.find((one) => one.id === shown.id);
          const block = answerCardsOf(turn);
          return block === null ? null : { item: shown, block, turn };
        })();
  const [leaving, setLeaving] = useState<{
    readonly id: string;
    readonly block: QAnswerCardsBlock;
  } | null>(null);
  const leavingRef = useRef<HTMLDivElement>(null);
  // Which answer's cards are on the stage; when that changes, the one
  // that was there flies to the Board (state adjusted during render).
  const [onStageCanvas, setOnStageCanvas] = useState<{
    readonly id: string;
    readonly block: QAnswerCardsBlock;
  } | null>(null);
  const canvasId = canvas?.item.id ?? null;
  if ((onStageCanvas?.id ?? null) !== canvasId) {
    if (onStageCanvas !== null) setLeaving(onStageCanvas);
    setOnStageCanvas(
      canvas === null ? null : { id: canvas.item.id, block: canvas.block },
    );
  }
  useEffect(() => {
    if (leaving === null) return;
    let done = false;
    void flyToBoard(leavingRef.current).then(() => {
      if (done) return;
      setLeaving(null);
      onBoardLanded?.();
    });
    return () => {
      done = true;
    };
  }, [leaving, onBoardLanded]);

  useEffect(() => {
    const onShow = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (
        typeof detail === "object" &&
        detail !== null &&
        "id" in detail &&
        typeof detail.id === "string"
      ) {
        setReopened({ id: detail.id, atAnswer: answers });
      }
    };
    window.addEventListener(SHOW_ON_STAGE, onShow);
    return () => window.removeEventListener(SHOW_ON_STAGE, onShow);
  }, [answers]);

  const showing = shown !== null || roomOpen !== null;
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
        {canvas !== null || leaving !== null ? null : (
          <m.div
            key={showing ? "compact" : "full"}
            className="flex w-full flex-col items-center"
            data-q-presence-size={showing ? "compact" : "full"}
            initial={
              reduced ? false : { opacity: 0.4, scale: showing ? 1.2 : 0.8 }
            }
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduced
                ? { duration: 0 }
                : { duration: 0.24, ease: [0.2, 0, 0, 1] }
            }
          >
            {presence(showing)}
          </m.div>
        )}
      </LazyMotion>

      {/* Q's words for a screen reader, never as text on the page. */}
      <p className="sr-only" aria-live="polite" data-q-said>
        {latestQ === undefined || latestQ.streaming
          ? ""
          : plainFromMarkdown(latestQ.text)}
      </p>

      {captions ? <div data-q-captions>{caption}</div> : null}

      {leaving === null ? null : (
        <div ref={leavingRef} className="w-full" data-q-canvas-leaving>
          <AnswerCanvas
            block={leaving.block}
            focus={-1}
            said=""
            presence={presence(true, true)}
            showFollowUps={false}
          />
        </div>
      )}

      {canvas === null || leaving !== null ? null : (
        <StageCanvas
          key={canvas.item.id}
          answerId={canvas.item.id}
          block={canvas.block}
          asked={askedBefore(turns, canvas.item.id)}
          closing={closingLine(canvas.turn)}
          live={live}
          presence={presence(true, true)}
          onCloseAll={() => dismiss(canvas.item)}
          onAsk={onAsk}
          onPin={onPin === undefined ? undefined : () => onPin(canvas.item.id)}
        />
      )}

      {shown === null || canvas !== null ? null : (
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

      <QRoomStage
        open={roomOpen}
        note={room.note}
        onClose={(card) => setClosedByHand({ key: card.key, at: card.openedAt })}
      />

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

/** What the person asked just before an answer, for the line above Q's. */
function askedBefore(
  turns: readonly QTurn[],
  answerId: string,
): string | undefined {
  const at = turns.findIndex((turn) => turn.id === answerId);
  const asked = turns
    .slice(0, Math.max(0, at))
    .findLast((turn) => turn.kind === "PERSON");
  return asked?.text;
}

/** Q's last sentence of the answer: said over the overview. */
function closingLine(turn: QTurn | undefined): string {
  if (turn === undefined || turn.kind !== "Q") return "";
  const plain = plainFromMarkdown(turn.text).replace(/\s+/gu, " ").trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/gu) ?? [plain];
  return (sentences.at(-1) ?? firstWords(plain) ?? "").trim();
}

/** The answer on the stage, walked through card by card (C1-C3). */
function StageCanvas({
  answerId,
  block,
  asked,
  closing,
  live,
  presence,
  onCloseAll,
  onAsk,
  onPin,
}: {
  readonly answerId: string;
  readonly block: QAnswerCardsBlock;
  readonly asked: string | undefined;
  readonly closing: string;
  readonly live: boolean;
  readonly presence: ReactNode;
  readonly onCloseAll: () => void;
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onPin?: (() => void) | undefined;
}) {
  const playback = useAnswerPlayback(block, answerId, closing, live);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const closeCard = (key: string) => {
    const next = new Set([...closed, key]);
    // The last card closed closes the answer.
    if (block.cards.every((card) => next.has(card.key))) onCloseAll();
    else setClosed(next);
  };
  return (
    <div className="w-full" data-q-canvas={answerId}>
      <AnswerCanvas
        block={block}
        asked={asked}
        said={playback.said}
        focus={playback.focus}
        presence={presence}
        dismissed={closed}
        onFocus={playback.choose}
        onCloseCard={closeCard}
        onCloseAll={onCloseAll}
        onFollowUp={onAsk}
        onAsk={onAsk}
        onPin={onPin === undefined ? undefined : () => onPin()}
      />
    </div>
  );
}
