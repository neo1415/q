"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { History, ICON_SIZE, ICON_STROKE, X } from "@capital-q/ui/icons";

import { answerCardsOf, topicMovedOn } from "./answer-canvas-logic";
import type { QTurn } from "./conversation";
import { firstWords } from "./board-timeline";
import { plainFromMarkdown } from "./markdown";
import {
  registerRoomDocumentHost,
  useRoomDocumentOpen,
} from "./room/document-host";
import type { PdfExport } from "./room/pdf-offer";
import type { RoomCardLoader } from "./room/q-room-card";
import type { DeckLoaders } from "./room/q-room-deck";
import { whenIdle } from "./room/room-read";
import { roomStage } from "./room/room-stage";
import { useWire } from "./use-wire";

/** W7: how long after the stage mounts its likely next code is fetched. */
const PREFETCH_AFTER_MS = 2_500;
import {
  answersIn,
  onStage,
  shownItems,
  shownRecently,
  type ShownItem,
} from "./shown";

const SHOW_ON_STAGE = "cq:q-show-answer";

/*
 * Q room W7: what the stage shows only once Q has shown something -- the
 * answer cards, an object, a room card, the PDF offer -- is loaded when it
 * is first needed, never with the page's first paint. Each shows nothing
 * until its code is in (a fraction of a second), and the room around it
 * stays usable meanwhile.
 */
const AnswerCanvas = lazy(() =>
  import("./answer-canvas").then((module) => ({
    default: module.AnswerCanvas,
  })),
);
const StageCanvas = lazy(() =>
  import("./stage-canvas").then((module) => ({
    default: module.StageCanvas,
  })),
);
const QResultBlocks = lazy(() =>
  import("./q-result-blocks").then((module) => ({
    default: module.QResultBlocks,
  })),
);
const QRoomStage = lazy(() =>
  import("./room/q-room-card").then((module) => ({
    default: module.QRoomStage,
  })),
);
const QRoomPdfOffer = lazy(() =>
  import("./room/pdf-offer").then((module) => ({
    default: module.QRoomPdfOffer,
  })),
);

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
  loadRoomCard,
  deckLoaders,
  exportAnswer,
}: {
  /** A live voice line is open: Q's own lines drive which card is open. */
  readonly live?: boolean | undefined;
  /** An answer flew into the Board (C4): the Board button counts it. */
  readonly onBoardLanded?: (() => void) | undefined;
  /** Pin an answer to the Board. */
  readonly onPin?: ((answerId: string) => void) | undefined;
  /** Q room R4: how a card reads its content (the dev harness serves it). */
  readonly loadRoomCard?: RoomCardLoader | undefined;
  /** Q room W5: the deck surface's reads (a harness serves fixtures). */
  readonly deckLoaders?: DeckLoaders | undefined;
  /** Q room W3: how an answer is filed as a PDF (the dev harness serves it). */
  readonly exportAnswer?: PdfExport | undefined;
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
  // W7: the room's cards are checked against the wire's contracts, and
  // read again once they are in.
  const wire = useWire();
  const room = useMemo(
    () => (wire === null ? roomStage([]) : roomStage(turns)),
    [turns, wire],
  );
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
    void import("./answer-canvas")
      .then((module) => module.flyToBoard(leavingRef.current))
      .then(() => {
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

  // Q room W3: a data-room document open in the room's centre panel.
  const documentOpen = useRoomDocumentOpen();
  const showing = shown !== null || roomOpen !== null || documentOpen;
  useEffect(() => {
    onShowingChange?.(showing);
  }, [showing, onShowingChange]);
  // W7: the room card stays mounted once shown, so its exit still plays.
  const [roomShown, setRoomShown] = useState(false);
  if (!roomShown && (roomOpen !== null || room.note !== null)) {
    setRoomShown(true);
  }
  const answered = latestQ !== undefined;
  // What was in the conversation when the room opened (the PDF offer
  // offers only answers that arrive after; its code loads later).
  const [openedWith] = useState<ReadonlySet<string>>(
    () => new Set(turns.map((turn) => turn.id)),
  );

  // W7: once the page has settled, what Q is likely to show first (a room
  // card, an answer's cards) is fetched quietly, so the first one shown
  // does not wait for its code. Never during the first paint.
  useEffect(() => {
    let cancel: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      cancel = whenIdle(() => {
        void import("./room/q-room-card");
        void import("./stage-canvas");
      }, 5_000);
    }, PREFETCH_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      cancel?.();
    };
  }, []);

  return (
    <div
      className="flex w-full flex-col items-center gap-4"
      data-q-presence-stage={showing ? "object" : "presence"}
    >
      {/* The presence stays on screen: small while an object is shown,
          full again once it is dismissed (reduced motion: no scale). */}
      {canvas !== null || leaving !== null ? null : (
        <div
          key={showing ? "compact" : "full"}
          className="cq-presence-in flex w-full flex-col items-center"
          data-q-presence-size={showing ? "compact" : "full"}
        >
          {presence(showing)}
        </div>
      )}

      {/* Q's words for a screen reader, never as text on the page. */}
      <p className="sr-only" aria-live="polite" data-q-said>
        {latestQ === undefined || latestQ.streaming
          ? ""
          : plainFromMarkdown(latestQ.text)}
      </p>

      {captions ? <div data-q-captions>{caption}</div> : null}

      {leaving === null ? null : (
        <div ref={leavingRef} className="w-full" data-q-canvas-leaving>
          <Suspense fallback={null}>
            <AnswerCanvas
              block={leaving.block}
              focus={-1}
              said=""
              presence={presence(true, true)}
              showFollowUps={false}
            />
          </Suspense>
        </div>
      )}

      {canvas === null || leaving !== null ? null : (
        <Suspense fallback={presence(true)}>
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
            onPin={
              onPin === undefined ? undefined : () => onPin(canvas.item.id)
            }
          />
        </Suspense>
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
            <Suspense fallback={null}>
              <QResultBlocks
                blocks={shown.blocks}
                onAsk={onAsk}
                onOpenArtifact={onOpenArtifact}
              />
            </Suspense>
          </div>
        </section>
      )}

      {roomShown ? (
        <Suspense fallback={null}>
          <QRoomStage
            open={roomOpen}
            note={room.note}
            onClose={(card) =>
              setClosedByHand({ key: card.key, at: card.openedAt })
            }
            load={loadRoomCard}
            turns={turns}
            deckLoaders={deckLoaders}
          />
        </Suspense>
      ) : null}

      {/* Q room W3: the document Q opened shows here (material-viewer). */}
      <div
        ref={registerRoomDocumentHost}
        className="w-full empty:hidden"
        data-q-room-document-host
      />

      {answered ? (
        <Suspense fallback={null}>
          <QRoomPdfOffer
            turns={turns}
            file={exportAnswer}
            opened={openedWith}
          />
        </Suspense>
      ) : null}

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
