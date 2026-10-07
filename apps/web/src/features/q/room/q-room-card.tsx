"use client";

import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { QManifestRef, QShowInQRoomIntent } from "@capital-q/contracts";
import { ICON_SIZE, ICON_STROKE, X } from "@capital-q/ui/icons";

import type { QTurn, QTurnPublicSource } from "../conversation";
import { useQSection } from "../q-section";

import { QRoomDeck, type DeckLoaders } from "./q-room-deck";
import { loadRoomCardAction, type RoomCardResult } from "./room-actions";
import type { RoomCardView } from "./room-card-view";
import { RoomLoadFailed } from "./room-load-failed";
import { roomRead, useRetryWhenOnline } from "./room-read";
import type { RoomCard, RoomNote } from "./room-stage";

/**
 * Q room R4: the card Q brought into the room, and the quiet note when it
 * closes as the conversation moves on. Its content is read on the server
 * as the person (room-actions); while it loads the card holds its shape.
 * Motion follows the answer canvas: 240 ms, standard ease, no scale under
 * reduced motion.
 */

const EASE = [0.2, 0, 0, 1] as const;
/** Loaded views, per card, for this tab: a reopened card is instant. */
const loaded = new Map<string, RoomCardResult>();

export type RoomCardLoader = (
  intent: QShowInQRoomIntent,
) => Promise<RoomCardResult>;

type CardRead =
  | { readonly kind: "loading" }
  | { readonly kind: "read"; readonly result: RoomCardResult }
  | { readonly kind: "failed" };

/**
 * The card's content, read once per card. R9: one retry, then "Couldn't
 * load — try again"; coming back online retries by itself. A refusal is
 * an answer, shown as such and never retried.
 */
function useCardView(
  card: RoomCard,
  load: RoomCardLoader,
): { readonly read: CardRead; readonly retry: () => void } {
  const [read, setRead] = useState<{
    readonly key: string;
    readonly read: CardRead;
  } | null>(null);
  const [tries, setTries] = useState(0);
  const cached = loaded.get(card.key);
  useEffect(() => {
    if (
      card.intent.object === "SOURCES" ||
      card.intent.object === "Q_DOCUMENT" ||
      loaded.has(card.key)
    ) {
      return;
    }
    let live = true;
    roomRead(() => load(card.intent)).then(
      (next) => {
        if (next.ok) loaded.set(card.key, next);
        if (live) {
          setRead({ key: card.key, read: { kind: "read", result: next } });
        }
      },
      () => {
        if (live) setRead({ key: card.key, read: { kind: "failed" } });
      },
    );
    return () => {
      live = false;
    };
  }, [card.key, card.intent, load, tries]);
  const now: CardRead =
    cached !== undefined
      ? { kind: "read", result: cached }
      : read?.key === card.key
        ? read.read
        : { kind: "loading" };
  const retry = useCallback(() => {
    setRead(null);
    setTries((n) => n + 1);
  }, []);
  useRetryWhenOnline(now.kind === "failed", retry);
  return { read: now, retry };
}

export function QRoomStage({
  open,
  note,
  onClose,
  load = loadRoomCardAction,
  turns = [],
  deckLoaders,
}: {
  readonly open: RoomCard | null;
  readonly note: RoomNote | null;
  readonly onClose: (card: RoomCard) => void;
  readonly load?: RoomCardLoader | undefined;
  /** Q room W5: the conversation, for the deck surface's paging. */
  readonly turns?: readonly QTurn[] | undefined;
  readonly deckLoaders?: DeckLoaders | undefined;
}) {
  const reduced = useReducedMotion() === true;
  // The note shows once per moving on, for a few seconds.
  const [noteDone, setNoteDone] = useState<string | null>(null);
  const noteShown = note !== null && noteDone !== note.id ? note : null;
  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNoteDone(note.id), 4_000);
    return () => window.clearTimeout(timer);
  }, [note]);

  return (
    <LazyMotion features={domAnimation} strict>
      <AnimatePresence mode="popLayout" initial={false}>
        {open === null ? null : (
          <m.section
            key={open.key}
            layout={!reduced}
            initial={
              reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: reduced ? 0 : 0.24, ease: EASE }}
            className="w-full"
          >
            <RoomCardBody
              card={open}
              load={load}
              turns={turns}
              deckLoaders={deckLoaders}
              onClose={() => onClose(open)}
            />
          </m.section>
        )}
      </AnimatePresence>
      <div
        className="pointer-events-none fixed right-4 bottom-28 z-(--cq-z-toast) flex justify-end sm:right-8"
        aria-live="polite"
      >
        <AnimatePresence>
          {noteShown === null ? null : (
            <m.p
              key={noteShown.id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.24, ease: EASE }}
              className="cq-body-sm flex items-center gap-2 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3.5 py-2.5 text-(--cq-text-secondary)"
              data-q-room-note
            >
              <X
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
              {noteShown.text}
            </m.p>
          )}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}

function RoomCardBody({
  card,
  load,
  turns,
  deckLoaders,
  onClose,
}: {
  readonly card: RoomCard;
  readonly load: RoomCardLoader;
  readonly turns: readonly QTurn[];
  readonly deckLoaders?: DeckLoaders | undefined;
  readonly onClose: () => void;
}) {
  const deck = card.intent.object === "Q_DOCUMENT";
  const { read, retry } = useCardView(card, load);
  const result = read.kind === "read" ? read.result : null;
  const title =
    card.intent.object === "SOURCES"
      ? "Sources"
      : result?.ok === true
        ? result.view.heading
        : card.intent.title;
  // R1: the open card is part of what Q sees on this page.
  const ref = cardRef(card.intent);
  useQSection(
    "q-room-card",
    "Q_ROOM_CARD",
    ref === null ? [] : [ref],
    1,
    `${title} open`,
  );
  return (
    <div
      className={`flex w-full flex-col overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) ${
        deck ? "max-h-[85dvh]" : "max-h-[60dvh]"
      }`}
      data-q-room-card={card.intent.object}
      data-q-section="q-room-card"
      aria-label={title}
      role="region"
    >
      <div className="flex min-h-11 flex-none items-center justify-between gap-2 border-b border-(--cq-border-subtle) py-1 pr-1 pl-4">
        <h2 className="cq-body min-w-0 truncate font-medium text-(--cq-text-primary)">
          {title}
        </h2>
        <button
          type="button"
          className="cq-stage-quiet min-h-11 min-w-11 justify-center"
          aria-label={`Close ${title}`}
          onClick={onClose}
          data-q-room-close
        >
          <X
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto p-4" data-q-room-body>
        {card.intent.object === "SOURCES" ? (
          <SourceCards sources={card.sources} />
        ) : deck && card.intent.id !== undefined ? (
          <QRoomDeck
            artifactId={card.intent.id}
            title={card.intent.title}
            turns={turns}
            openedAt={card.openedAt}
            {...(deckLoaders === undefined ? {} : { loaders: deckLoaders })}
          />
        ) : read.kind === "failed" ? (
          <RoomLoadFailed onRetry={retry} className="min-h-40" />
        ) : result === null ? (
          // R9: the skeleton holds about the card's own height, so the
          // content landing does not push the page below it.
          <div
            className="flex min-h-40 flex-col gap-2"
            aria-busy="true"
            data-q-room-loading
          >
            <div className="h-4 w-2/3 rounded bg-(--cq-surface-subtle)" />
            <div className="h-4 w-1/2 rounded bg-(--cq-surface-subtle)" />
            <div className="h-4 w-3/5 rounded bg-(--cq-surface-subtle)" />
          </div>
        ) : result.ok ? (
          <CardView view={result.view} />
        ) : (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {result.message}
          </p>
        )}
      </div>
    </div>
  );
}

/** The record a card shows, as Q's screen reads it back. */
function cardRef(intent: QShowInQRoomIntent): QManifestRef | null {
  if (intent.id === undefined) return null;
  switch (intent.object) {
    case "COMPANY_PROFILE":
    case "DATA_ROOM":
    case "PITCH_DECK":
    case "CHAT_WITH_COMPANY":
      return { kind: "COMPANY", id: intent.id };
    case "CHAT_WITH_INVESTOR":
      return { kind: "INVESTOR_ORGANISATION", id: intent.id };
    case "WORK_PLAN":
      return { kind: "Q_WORK", id: intent.id };
    case "CAPITAL_ROUND":
      return { kind: "CAPITAL_ROUND", id: intent.id };
    case "GATEQ_APPLICATION":
      return { kind: "GATEQ_APPLICATION", id: intent.id };
    case "SOURCES":
      return null;
    case "Q_DOCUMENT":
      return { kind: "ARTIFACT", id: intent.id };
  }
}

function CardView({ view }: { readonly view: RoomCardView }) {
  return (
    <div className="flex flex-col gap-3">
      {view.lead === null ? null : (
        <p className="cq-body text-(--cq-text-primary)">{view.lead}</p>
      )}
      {view.facts.length === 0 ? null : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {view.facts.map((fact) => (
            <div key={fact.label} className="flex flex-col">
              <dt className="cq-caption text-(--cq-text-tertiary)">
                {fact.label}
              </dt>
              <dd className="cq-body-sm text-(--cq-text-primary)">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {view.items.length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
          {view.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5 py-2">
              <span className="cq-body-sm text-(--cq-text-primary)">
                {item.title}
              </span>
              {item.meta === null || item.meta === "" ? null : (
                <span className="cq-caption text-(--cq-text-secondary)">
                  {item.meta}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.more > 0 ? (
        <p className="cq-caption text-(--cq-text-secondary)">
          and {String(view.more)} more
        </p>
      ) : null}
      <Link
        href={view.href}
        className="cq-label inline-flex min-h-11 items-center self-start text-(--cq-accent) underline-offset-2 hover:underline"
        data-q-room-open
      >
        {view.open}
      </Link>
    </div>
  );
}

function SourceCards({
  sources,
}: {
  readonly sources: readonly QTurnPublicSource[];
}) {
  if (sources.length === 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        This answer read no public sources.
      </p>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {sources.slice(0, 6).map((source) => (
        <li key={source.url}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 flex-col gap-0.5 rounded-(--cq-radius-md) border border-(--cq-border-subtle) px-3 py-2 hover:bg-(--cq-surface-subtle)"
          >
            <span className="cq-body-sm text-(--cq-text-primary)">
              {source.title}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {source.domain}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
