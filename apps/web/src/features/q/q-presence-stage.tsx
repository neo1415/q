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

import type { QAnswerCardsBlock, QArtifactPreview } from "@capital-q/contracts";
import { splitSentences } from "@capital-q/q-core/speech";

import { History, ICON_SIZE, ICON_STROKE, X } from "@capital-q/ui/icons";

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
import { RenderedMark } from "./artifact-rendered";
import { documentsOnStage } from "@/features/documents/document-ready";
import { useT } from "@/features/i18n/language";

/** W7: how long after the stage mounts its likely next code is fetched. */
const PREFETCH_AFTER_MS = 800;
/** The longest a set takes to fly to the Board (560 ms plus its stagger). */
const LEAVING_MAX_MS = 1_500;
import {
  answerCardRef,
  hideKey,
  isHiddenIn,
  reopenStaged,
  useCardsState,
  useVisibleCards,
  type CardRef,
} from "./cards/card-visibility";
import { LivePreview } from "./live-preview";
import { rememberResults, useResultShelf } from "./result-shelf";
import {
  latestAnswerRun,
  livePreviewOf,
  shownItems,
  shownRecently,
  stageNoteOf,
  stageOf,
  subjectOf,
  type ShownItem,
} from "./shown";

/**
 * Lane A: a stage object as a card of the one presentation controller, so
 * its X, "clear all cards", "show them again" and "Shown recently" are one
 * state that holds across pages and a reload (card-visibility-store).
 */
export function stageCardRef(item: ShownItem): CardRef {
  return {
    category: "ANSWER",
    key: `stage:${item.run}`,
    names: [item.title, ...subjectOf(item).names],
  };
}

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
  onStageObjectChange,
  onCardsShowingChange,
  live = false,
  spokenPreview = null,
  onBoardLanded,
  onPin,
  loadRoomCard,
  deckLoaders,
  exportAnswer,
}: {
  /** A live voice line is open: Q's own lines drive which card is open. */
  readonly live?: boolean | undefined;
  /** L-16: what Q is naming aloud, from the room feed (useQSession). */
  readonly spokenPreview?: QArtifactPreview | null | undefined;
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
  /** The answer whose object is drawn on the stage now; null for none. */
  readonly onStageObjectChange?:
    ((answerId: string | null) => void) | undefined;
  /** Told when an answer's cards come on or leave the stage (the wide layout). */
  readonly onCardsShowingChange?: ((cards: boolean) => void) | undefined;
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
  const t = useT();
  const listId = useId();
  const own = useMemo(() => shownItems(turns), [turns]);
  // INC-1: every set shown in this tab stays reachable, whatever happens
  // to the conversation (a reconnect that opens another one, a replayed
  // arrival). Sets from elsewhere sit before this conversation's own, so
  // its newest answer still leads; with none of its own yet, the last set
  // shown stays on the stage rather than vanishing.
  useEffect(() => {
    rememberResults(own);
  }, [own]);
  const shelf = useResultShelf();
  const items = useMemo(() => {
    const runs = new Set(own.map((item) => item.run));
    const elsewhere = shelf
      .filter((item) => !runs.has(item.run))
      .map((item) => ({ ...item, answer: 0 }));
    return [...elsewhere, ...own];
  }, [own, shelf]);
  const cards = useCardsState();
  const [listOpen, setListOpen] = useState(false);
  // Lane A: one rule (shown.ts stageOf) for every kind of object -- shown
  // by the answer that made it, kept while the conversation is on it,
  // replaced or put away out loud (the note below), never by a count.
  const pick = stageOf(items, turns, cards.reopened);
  const visible = useVisibleCards(
    pick.item === null ? [] : [pick.item],
    stageCardRef,
  );
  const shown = visible[0] ?? null;
  // Artifacts live: the cards for what Q is naming, up while it talks.
  const livePreview = livePreviewOf(turns, shown, spokenPreview);
  const previewing = livePreview !== null;
  const note = stageNoteOf(items, turns, pick, (item) =>
    isHiddenIn(cards, stageCardRef(item)),
  );
  // F-35: what is on the stage now is not listed again beside it.
  const recent = shownRecently(items).filter((item) => item.id !== shown?.id);
  const reopen = (item: ShownItem) =>
    reopenStaged(item.run, latestAnswerRun(turns));
  // Q room R4: the card Q brought into the room, open while the
  // conversation stays on its subject (room-stage), or until closed here.
  // W7: the room's cards are checked against the wire's contracts, and
  // read again once they are in.
  const wire = useWire();
  const room = useMemo(
    () => (wire === null ? roomStage([]) : roomStage(turns)),
    [turns, wire],
  );
  // Closed by hand: the same controller, so it stays closed on the way
  // back from another page; the subject coming back reopens it (a new
  // openedAt is a new key).
  const roomOpen =
    room.open !== null && !cards.keys.includes(roomCardKey(room.open))
      ? room.open
      : null;
  // F-35: a document the room has open is drawn there, not again here.
  const inRoom =
    roomOpen?.intent.object === "Q_DOCUMENT" &&
    shown !== null &&
    shown.blocks.some(
      (block) =>
        block.kind === "ARTIFACT_REFERENCE" &&
        block.artifactId === roomOpen.intent.id,
    );
  const latestQ = turns.findLast(
    (turn): turn is Extract<QTurn, { kind: "Q" }> => turn.kind === "Q",
  );

  // What the line over the cards says: the answer that showed them, or,
  // for a set kept or brought back, the latest settled exchange.
  const captionTurn =
    pick.why === "SHOWN"
      ? undefined
      : turns.findLast(
          (turn): turn is Extract<QTurn, { kind: "Q" }> =>
            turn.kind === "Q" && !turn.streaming,
        );

  const dismiss = (item: ShownItem) => hideKey(stageCardRef(item).key);

  // The answer on the stage as cards, and one leaving for the Board.
  const shownCards =
    shown?.blocks.find(
      (one): one is QAnswerCardsBlock => one.kind === "ANSWER_CARDS",
    ) ?? null;
  // Owner 2026-10-17: cards every one of which is put away draw nothing,
  // so they are not on the stage: Q's presence stays, never a blank stage.
  const drawable = useVisibleCards(shownCards?.cards ?? [], (card) =>
    answerCardRef(shown?.id ?? "", card),
  );
  const putAway =
    shownCards !== null && shownCards.cards.length > 0 && drawable.length === 0;
  const canvas =
    shown === null || putAway
      ? null
      : (() => {
          // The set as it was shown (INC-1): from its own blocks, so a later
          // copy of the run, or a turn no longer in this thread, never
          // changes or clears it.
          const turn = turns.find((one) => one.id === shown.id);
          const block =
            shown.blocks.find(
              (one): one is QAnswerCardsBlock => one.kind === "ANSWER_CARDS",
            ) ?? null;
          return block === null
            ? null
            : {
                item: shown,
                block,
                turn,
                rest: shown.blocks.filter((one) => one !== block),
              };
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

  // QA U2: what the stage shows of documents, so the ready toast stays down
  // for a document already in front of them, and a lone document card is
  // drawn without a second frame around it.
  const stageVisible = shown !== null && canvas === null && !putAway && !inRoom;
  const stageDocuments = stageVisible
    ? shown.blocks.flatMap((block) =>
        block.kind === "ARTIFACT_REFERENCE" ? [block.artifactId] : [],
      )
    : [];
  const stageDocumentsKey = stageDocuments.join(",");
  useEffect(() => {
    documentsOnStage(
      stageDocumentsKey === "" ? [] : stageDocumentsKey.split(","),
    );
  }, [stageDocumentsKey]);
  useEffect(() => () => documentsOnStage([]), []);
  const soleDocument =
    stageVisible &&
    shown.blocks.length === 1 &&
    shown.blocks[0]?.kind === "ARTIFACT_REFERENCE";
  // The answer whose preview replaced the set on screen: its own cards
  // take the preview's place, and the set it replaced has already gone,
  // so nothing flies to the Board on top of the new cards.
  const [previewedId, setPreviewedId] = useState<string | null>(null);
  if (livePreview !== null && previewedId !== livePreview.messageId) {
    setPreviewedId(livePreview.messageId);
  }
  if ((onStageCanvas?.id ?? null) !== canvasId) {
    // Only the answer that a preview stood in for skips the flight; a set
    // leaving for nothing (a new topic) still flies to the Board.
    if (
      onStageCanvas !== null &&
      (canvasId === null || canvasId !== previewedId)
    ) {
      setLeaving(onStageCanvas);
    }
    setOnStageCanvas(
      canvas === null ? null : { id: canvas.item.id, block: canvas.block },
    );
  }
  useEffect(() => {
    if (leaving === null) return;
    let done = false;
    // Owner 2026-10-17: while a set is leaving, neither the new set nor
    // Q's presence is drawn, so the leaving always ends: on landing, on a
    // failed flight, and at the latest after the flight's own time.
    const land = () => {
      if (done) return;
      done = true;
      setLeaving(null);
      onBoardLanded?.();
    };
    const fallback = window.setTimeout(land, LEAVING_MAX_MS);
    void import("./answer-canvas")
      .then((module) => module.flyToBoard(leavingRef.current))
      .then(land, land);
    return () => {
      done = true;
      window.clearTimeout(fallback);
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
        const item = items.find((one) => one.id === detail.id);
        if (item !== undefined) reopenStaged(item.run, latestAnswerRun(turns));
      }
    };
    window.addEventListener(SHOW_ON_STAGE, onShow);
    return () => window.removeEventListener(SHOW_ON_STAGE, onShow);
  }, [items, turns]);

  // Q room W3: a data-room document open in the room's centre panel.
  const documentOpen = useRoomDocumentOpen();
  const showing =
    (shown !== null && !putAway) ||
    previewing ||
    roomOpen !== null ||
    documentOpen;
  useEffect(() => {
    onShowingChange?.(showing);
  }, [showing, onShowingChange]);
  const stageObject = shown !== null && !putAway ? shown.id : null;
  useEffect(() => {
    onStageObjectChange?.(stageObject);
  }, [stageObject, onStageObjectChange]);
  // Owner 2026-10-17: a set kept or brought back gets the same wide
  // layout as a fresh one (the page widened only for the latest answer's
  // own cards, so a restored set was squeezed and its names cut).
  const cardsUp = canvas !== null;
  useEffect(() => {
    onCardsShowingChange?.(cardsUp);
  }, [cardsUp, onCardsShowingChange]);
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
        // Mounted once in, so the first card enters as it always has.
        void import("./room/q-room-card").then(
          () => setRoomShown(true),
          () => undefined,
        );
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
      {(canvas !== null && !previewing) || leaving !== null ? null : (
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
              answerKey={leaving.id}
              block={leaving.block}
              focus={-1}
              said=""
              presence={presence(true, true)}
              showFollowUps={false}
            />
          </Suspense>
        </div>
      )}

      {livePreview === null || leaving !== null ? null : (
        <LivePreview
          preview={livePreview}
          // Its answer has landed: the frames are the cards, not waiting.
          settled={turns.some(
            (turn) =>
              turn.id === livePreview.messageId &&
              turn.kind === "Q" &&
              !turn.streaming,
          )}
        />
      )}

      {canvas === null || leaving !== null || previewing ? null : (
        <Suspense fallback={presence(true)}>
          <StageCanvas
            key={canvas.item.id}
            answerId={canvas.item.id}
            block={canvas.block}
            turns={turns}
            // Owner 2026-10-17: a set kept or brought back carries the
            // latest exchange over it, never the turn that first showed it.
            asked={askedBefore(turns, captionTurn?.id ?? canvas.item.id)}
            closing={closingLine(captionTurn ?? canvas.turn)}
            exchangeId={captionTurn?.id ?? canvas.item.id}
            live={live}
            presence={presence(true, true)}
            onCloseAll={() => dismiss(canvas.item)}
            onAsk={onAsk}
            onPin={
              onPin === undefined ? undefined : () => onPin(canvas.item.id)
            }
          />
          {/* The rest of the same answer's set (a table, a map beside
              the cards) is part of what was shown, never dropped. */}
          <RenderedMark
            run={canvas.item.run}
            kinds={canvas.item.blocks.map((one) => one.kind)}
          />
          {canvas.rest.length === 0 ? null : (
            <div className="w-full" data-q-canvas-rest={canvas.item.id}>
              <QResultBlocks
                blocks={canvas.rest}
                onAsk={onAsk}
                onOpenArtifact={onOpenArtifact}
              />
            </div>
          )}
        </Suspense>
      )}

      {/* Lane A: a stage object never leaves silently. */}
      {note === null ? null : (
        <p
          className="cq-caption flex w-full flex-wrap items-center justify-center gap-2 text-(--cq-text-secondary)"
          role="status"
          data-q-stage-note={note.id}
        >
          <span>{note.text}</span>
          <button
            type="button"
            className="cq-stage-quiet min-h-11"
            onClick={() => reopen(note.item)}
            data-q-stage-note-reopen={note.item.id}
          >
            {t("Show again")}
          </button>
        </p>
      )}

      {shown === null || canvas !== null || putAway || inRoom ? null : (
        <section
          aria-labelledby={`${listId}-shown-title`}
          className={
            soleDocument
              ? "flex max-h-[60dvh] w-full flex-col overflow-hidden"
              : "flex max-h-[60dvh] w-full flex-col overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)"
          }
          data-q-shown={shown.id}
        >
          {/* Its title and Dismiss stay in view while the object scrolls. A
              lone document card carries its own title, so the frame's goes
              to screen readers only (QA U2: a frame inside a frame). */}
          <div
            className={
              soleDocument
                ? "flex min-h-11 flex-none items-center justify-end"
                : "flex min-h-11 flex-none items-center justify-between gap-2 border-b border-(--cq-border-subtle) py-1 pe-1 ps-4"
            }
            data-q-shown-header
          >
            <h2
              id={`${listId}-shown-title`}
              className={
                soleDocument
                  ? "sr-only"
                  : "cq-body min-w-0 truncate font-medium text-(--cq-text-primary)"
              }
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
          <div
            className={
              soleDocument
                ? "min-h-0 overflow-y-auto"
                : "min-h-0 overflow-y-auto p-4"
            }
            data-q-shown-body
          >
            <Suspense fallback={null}>
              <QResultBlocks
                blocks={shown.blocks}
                onAsk={onAsk}
                onOpenArtifact={onOpenArtifact}
              />
              <RenderedMark
                run={shown.run}
                kinds={shown.blocks.map((one) => one.kind)}
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
            onClose={(card) => hideKey(roomCardKey(card))}
            load={loadRoomCard}
            turns={turns}
            deckLoaders={deckLoaders}
            onAsk={onAsk}
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
            {t("Shown recently")}
          </button>
          {listOpen ? (
            <ul
              id={listId}
              className="flex w-full flex-col gap-1"
              aria-label={t("Shown recently")}
            >
              {recent.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="cq-stage-quiet w-full justify-start"
                    onClick={() => {
                      reopen(item);
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

/** A room card's key in the presentation controller: one per opening. */
function roomCardKey(card: {
  readonly key: string;
  readonly openedAt: number;
}): string {
  return `room:${card.key}@${String(card.openedAt)}`;
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
  // Real sentence ends only, so "8.8/10." is not cut to "8/10." (D9).
  const sentences = splitSentences(plain);
  return (sentences.at(-1) ?? firstWords(plain) ?? "").trim();
}
