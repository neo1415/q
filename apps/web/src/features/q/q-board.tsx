"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, ICON_STROKE, Pin, PinOff, X } from "@capital-q/ui/icons";

import { ViewTransition } from "@/components/view-transition";

import { artifactTypeLabel } from "./artifact-type";
import { ArtifactCard } from "./artifact-card";
import { slideSource } from "./artifact-viewer";
import { arrangeBoard, boardObjects, type BoardObject } from "./board";
import type { QTurn } from "./conversation";
import { plainFromMarkdown } from "./markdown";
import { QEvidence } from "./q-evidence";
import { QResultBlocks } from "./q-result-blocks";

/**
 * The Board (ADR 0017 F3; spec §7.1): what Q produced, as objects to open,
 * pin, dismiss or ask about -- not a transcript. Each object says what it
 * is, keeps the exchange that produced it one press away ("Show
 * exchange"), and its evidence behind the same single disclosure the
 * stage uses. Cards are legitimate here: each one is a discrete object.
 *
 * Pinned and dismissed are this tab's arrangement of the board, kept per
 * conversation in sessionStorage; they change what is shown, never what
 * was said.
 */

type Marks = { readonly pinned: string[]; readonly dismissed: string[] };
const EMPTY: Marks = { pinned: [], dismissed: [] };
const MARKS_KEY = "cq.q.board.v1";
const MARKS_CHANGED = "cq:q-board-marks";

function readAllMarks(): Record<string, Marks> {
  try {
    const raw = window.sessionStorage.getItem(MARKS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, Marks> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const pinned: unknown = Reflect.get(Object(value), "pinned");
      const dismissed: unknown = Reflect.get(Object(value), "dismissed");
      const strings = (list: unknown) =>
        Array.isArray(list)
          ? list.filter((item): item is string => typeof item === "string")
          : [];
      out[id] = { pinned: strings(pinned), dismissed: strings(dismissed) };
    }
    return out;
  } catch {
    return {};
  }
}

const cached = new Map<string, Marks>();
function readMarks(conversation: string): Marks {
  const marks = readAllMarks()[conversation] ?? EMPTY;
  const key = `${conversation}:${JSON.stringify(marks)}`;
  const known = cached.get(key);
  if (known !== undefined) return known;
  cached.set(key, marks);
  return marks;
}

function writeMarks(conversation: string, marks: Marks): void {
  try {
    const all = readAllMarks();
    all[conversation] = marks;
    window.sessionStorage.setItem(MARKS_KEY, JSON.stringify(all));
  } catch {
    // Arranged for this page only.
  }
  window.dispatchEvent(new CustomEvent(MARKS_CHANGED));
}

function subscribeMarks(onChange: () => void): () => void {
  window.addEventListener(MARKS_CHANGED, onChange);
  return () => window.removeEventListener(MARKS_CHANGED, onChange);
}

const LABELS: Readonly<Record<BoardObject["kind"], string>> = {
  NOTE: "Answer",
  COMPANIES: "Companies",
  INVESTORS: "Investors",
  COMPARISON: "Comparison",
  ARTIFACT: "Document",
  INTENT: "Where this lives",
};

/** The first slide of a deck, drawn by the Q API, once per deck. */
// Kept briefly: a deck Q revises is the same id with a new first slide,
// and a cache kept forever showed the old one until a reload (founder live
// 2026-09-30).
const SLIDE_CACHE_MS = 20_000;
const slideCache = new Map<string, Promise<string | null>>();
const slideCachedAt = new Map<string, number>();
function firstSlide(artifactId: string): Promise<string | null> {
  const at = slideCachedAt.get(artifactId);
  if (at !== undefined && Date.now() - at > SLIDE_CACHE_MS) {
    slideCache.delete(artifactId);
  }
  let pending = slideCache.get(artifactId);
  if (pending === undefined) {
    slideCachedAt.set(artifactId, Date.now());
    pending = fetch(`/api/q-artifact/${encodeURIComponent(artifactId)}/slides`)
      .then(async (response) => {
        if (!response.ok) return null;
        const body: unknown = await response.json();
        const slides: unknown = Reflect.get(Object(body), "slides");
        return Array.isArray(slides) && typeof slides[0] === "string"
          ? slides[0]
          : null;
      })
      .catch(() => null);
    slideCache.set(artifactId, pending);
  }
  return pending;
}

function SlidePreview({
  artifactId,
  title,
}: {
  readonly artifactId: string;
  readonly title: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void firstSlide(artifactId).then((slide) => {
      if (alive) setSvg(slide);
    });
    return () => {
      alive = false;
    };
  }, [artifactId]);
  if (svg === null) {
    return <div className="cq-q-board-slide is-empty" aria-hidden="true" />;
  }
  return (
    // A data-URI SVG the Q API drew: an img cannot run it, and there is
    // nothing for an image optimiser to fetch.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="cq-q-board-slide"
      src={slideSource(svg)}
      alt={`First slide of ${title}`}
      data-q-board-slide
    />
  );
}

function ObjectBody({
  object,
  onAsk,
  onOpenArtifact,
}: {
  readonly object: BoardObject;
  readonly onAsk: (question: string) => void;
  readonly onOpenArtifact: (artifactId: string) => void;
}) {
  switch (object.kind) {
    case "NOTE":
      return (
        <p className="cq-body-sm cq-q-board-note text-(--cq-text-primary)">
          {/* A slim note: the answer's words, not its Markdown syntax. */}
          {plainFromMarkdown(object.turn.text)}
        </p>
      );
    case "COMPANIES":
    case "INVESTORS":
      return (
        <ul className="flex flex-col" data-q-board-rows>
          {object.blocks.map((block, index) => (
            <li
              key={
                block.kind === "COMPANY_REFERENCE"
                  ? block.companyId
                  : String(index)
              }
              className="flex min-h-11 items-center justify-between gap-2 border-t border-(--cq-border-subtle) first:border-t-0"
            >
              <span className="cq-body-sm text-(--cq-text-secondary)">
                {object.kind === "COMPANIES" ? "Company" : "Investor"}{" "}
                {index + 1}
              </span>
              <span className="flex items-center gap-1">
                {block.kind === "COMPANY_REFERENCE" ? (
                  <Link
                    href={`/company/${encodeURIComponent(block.companyId)}`}
                    className={buttonClassName("quiet", "compact")}
                  >
                    Open
                  </Link>
                ) : null}
                <button
                  type="button"
                  className={buttonClassName("quiet", "compact")}
                  onClick={() => {
                    onAsk(
                      `Why is ${object.kind === "COMPANIES" ? "company" : "investor"} ${String(index + 1)} here?`,
                    );
                  }}
                >
                  Why?
                </button>
              </span>
            </li>
          ))}
        </ul>
      );
    case "ARTIFACT": {
      const block = object.blocks[0];
      if (block?.kind !== "ARTIFACT_REFERENCE") return null;
      // The same card as the answer's (R36), with the first slide above it
      // for a deck: the picture is itself a way in.
      return (
        <ArtifactCard
          block={block}
          framed={false}
          onOpen={onOpenArtifact}
          onAsk={onAsk}
          preview={
            block.type === "PITCH_DECK" ? (
              <button
                type="button"
                className="cq-q-board-slide-button"
                onClick={() => onOpenArtifact(block.artifactId)}
                aria-label={`Open ${block.title}`}
              >
                <SlidePreview
                  artifactId={block.artifactId}
                  title={block.title}
                />
              </button>
            ) : undefined
          }
        />
      );
    }
    case "COMPARISON":
    case "INTENT":
      return (
        <QResultBlocks
          blocks={object.blocks}
          onAsk={onAsk}
          onOpenArtifact={onOpenArtifact}
        />
      );
  }
}

/** How many objects the dock's compact Board shows before "Open Q". */
const COMPACT_LIMIT = 4;

export function QBoard({
  conversationId,
  turns,
  onAsk,
  onOpenArtifact,
  compact = false,
  skipNoteOf,
}: {
  readonly conversationId: string | null;
  readonly turns: readonly QTurn[];
  readonly onAsk: (question: string) => void;
  readonly onOpenArtifact: (artifactId: string) => void;
  /**
   * The dock panel's Board (spec §6.1): the newest few objects, the rest
   * one press away on the Q page.
   */
  readonly compact?: boolean | undefined;
  /** An answer already shown in full beside the Board: not noted twice. */
  readonly skipNoteOf?: string | undefined;
}) {
  const key = conversationId ?? "new";
  const marks = useSyncExternalStore(
    subscribeMarks,
    () => readMarks(key),
    () => EMPTY,
  );
  const [exchange, setExchange] = useState<string | null>(null);
  const arranged = arrangeBoard(
    boardObjects(turns).filter(
      (object) => !(object.kind === "NOTE" && object.turn.id === skipNoteOf),
    ),
    marks.pinned,
    marks.dismissed,
  );
  const objects = compact ? arranged.slice(0, COMPACT_LIMIT) : arranged;
  const more = arranged.length - objects.length;

  const togglePin = (objectKey: string) => {
    const pinned = marks.pinned.includes(objectKey)
      ? marks.pinned.filter((item) => item !== objectKey)
      : [...marks.pinned, objectKey];
    writeMarks(key, { ...marks, pinned });
  };
  const dismiss = (objectKey: string) => {
    writeMarks(key, {
      pinned: marks.pinned.filter((item) => item !== objectKey),
      dismissed: [...marks.dismissed, objectKey],
    });
  };

  return (
    <ViewTransition name="q-board" share="cq-q-morph" default="none">
      <section
        aria-label="Board"
        className="flex flex-col gap-3"
        data-q-board={compact ? "compact" : "full"}
      >
        {compact && objects.length === 0 ? null : objects.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            What Q finds and makes lands here: answers, companies, comparisons
            and documents, to open, pin or ask about.
          </p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {objects.map((object) => {
            const pinned = marks.pinned.includes(object.key);
            return (
              <li
                key={object.key}
                className={cx("cq-q-board-object", pinned ? "is-pinned" : "")}
                data-q-board-object={object.kind}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="cq-label text-(--cq-text-secondary)">
                    {pinned ? "Pinned · " : ""}
                    {object.kind === "ARTIFACT" &&
                    object.blocks[0]?.kind === "ARTIFACT_REFERENCE"
                      ? artifactTypeLabel(object.blocks[0].type)
                      : LABELS[object.kind]}
                  </span>
                  <span className="flex items-center">
                    <button
                      type="button"
                      className="cq-q-board-icon"
                      aria-label={pinned ? "Unpin" : "Pin"}
                      aria-pressed={pinned}
                      onClick={() => togglePin(object.key)}
                    >
                      {pinned ? (
                        <PinOff
                          aria-hidden="true"
                          size={ICON_SIZE.compact}
                          strokeWidth={ICON_STROKE}
                        />
                      ) : (
                        <Pin
                          aria-hidden="true"
                          size={ICON_SIZE.compact}
                          strokeWidth={ICON_STROKE}
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      className="cq-q-board-icon"
                      aria-label="Dismiss"
                      onClick={() => dismiss(object.key)}
                    >
                      <X
                        aria-hidden="true"
                        size={ICON_SIZE.compact}
                        strokeWidth={ICON_STROKE}
                      />
                    </button>
                  </span>
                </div>
                <ObjectBody
                  object={object}
                  onAsk={onAsk}
                  onOpenArtifact={onOpenArtifact}
                />
                {object.kind === "NOTE" ? (
                  <QEvidence
                    turn={object.turn}
                    onAsk={onAsk}
                    onOpenArtifact={onOpenArtifact}
                  />
                ) : null}
                {object.question === undefined ? null : (
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      className="cq-q-board-exchange"
                      aria-expanded={exchange === object.key}
                      onClick={() =>
                        setExchange((current) =>
                          current === object.key ? null : object.key,
                        )
                      }
                    >
                      Show exchange
                    </button>
                    {exchange === object.key ? (
                      <p className="cq-caption text-(--cq-text-secondary)">
                        You asked: “{object.question}”
                      </p>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {more > 0 ? (
          <p className="cq-caption text-(--cq-text-secondary)">
            {more === 1 ? "1 more" : `${String(more)} more`} on the Q page.
          </p>
        ) : null}
      </section>
    </ViewTransition>
  );
}

/**
 * This conversation's Board arrangement (pinned, removed) for the Board
 * timeline and the answer canvas's pin, from the same per-tab store.
 */
export function useBoardMarks(conversationId: string | null): {
  readonly pinned: readonly string[];
  readonly dismissed: readonly string[];
  readonly togglePin: (key: string) => void;
  readonly pin: (key: string) => void;
  readonly remove: (key: string) => void;
} {
  const key = conversationId ?? "new";
  const marks = useSyncExternalStore(
    subscribeMarks,
    () => readMarks(key),
    () => EMPTY,
  );
  return {
    pinned: marks.pinned,
    dismissed: marks.dismissed,
    togglePin: (item) =>
      writeMarks(key, {
        ...marks,
        pinned: marks.pinned.includes(item)
          ? marks.pinned.filter((one) => one !== item)
          : [...marks.pinned, item],
      }),
    pin: (item) => {
      if (!marks.pinned.includes(item)) {
        writeMarks(key, { ...marks, pinned: [...marks.pinned, item] });
      }
    },
    remove: (item) =>
      writeMarks(key, {
        pinned: marks.pinned.filter((one) => one !== item),
        dismissed: [...marks.dismissed, item],
      }),
  };
}
