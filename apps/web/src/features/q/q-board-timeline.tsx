"use client";

import "./answer-canvas.css";

import { useState } from "react";

import {
  ChevronRight,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  Pin,
  X,
} from "@capital-q/ui/icons";

import {
  boardTimeline,
  groupByDay,
  timeLabel,
  type BoardDecision,
  type BoardEntry,
  type BoardSource,
} from "./board-timeline";
import type { QTurn } from "./conversation";
import { useBoardMarks } from "./q-board";
import { boardFiles, useSavedFiles } from "./saved-files";
import { useT } from "@/features/i18n/language";

/**
 * The Board (C7; mockup board.html): a timeline of what Q showed, with
 * Pinned and Files beside it on a desktop and as tabs on a phone. Each
 * entry says what it is in plain words; where it came from is folded
 * under one line ("Where this came from: 5 sources") and read as words
 * with a shape, never as reference codes.
 */

type Tab = "timeline" | "pinned" | "files";

function SourceShape({ kind }: { readonly kind: BoardSource["kind"] }) {
  return (
    <svg className="cq-board-ev" viewBox="0 0 12 12" aria-hidden="true">
      {kind === "record" ? (
        <>
          <circle
            cx="6"
            cy="6"
            r="4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path d="M6 1.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />
        </>
      ) : (
        <circle
          cx="6"
          cy="6"
          r="4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeDasharray="2 2"
        />
      )}
    </svg>
  );
}

function Entry({
  entry,
  pinned,
  onPin,
  onRemove,
  onShow,
  onOpenArtifact,
}: {
  readonly entry: BoardEntry;
  readonly pinned: boolean;
  readonly onPin: () => void;
  readonly onRemove: () => void;
  readonly onShow?: (() => void) | undefined;
  readonly onOpenArtifact: (artifactId: string) => void;
}) {
  const time = timeLabel(entry.at);
  // A decided change says when it was decided, where that is known.
  const kindTime =
    entry.outcome !== null && entry.outcome.at !== undefined
      ? timeLabel(entry.outcome.at)
      : time;
  return (
    <li data-board-entry={entry.id} data-board-outcome={entry.outcome?.status}>
      <span className="cq-board-time">{time}</span>
      <span className="cq-board-node" aria-hidden="true" />
      <article className="cq-board-item">
        <div className="cq-board-item-top">
          <div className="min-w-0">
            <h2>{entry.title}</h2>
            <p className="kind">
              {entry.kind}
              {kindTime.length > 0 ? (
                <span className="t-inline">, {kindTime}</span>
              ) : null}
            </p>
          </div>
          <div className="flex">
            <button
              type="button"
              className="cq-ac-x"
              aria-pressed={pinned}
              aria-label={`${pinned ? "Unpin" : "Pin"} ${entry.title}`}
              onClick={onPin}
            >
              <Pin
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            </button>
            {onShow === undefined ? null : (
              <button
                type="button"
                className="cq-ac-x cq-board-open-q"
                aria-label={`Show ${entry.title} on the Q page`}
                onClick={onShow}
              >
                <ChevronRight
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              </button>
            )}
            <button
              type="button"
              className="cq-ac-x"
              aria-label={`Remove ${entry.title} from the Board`}
              onClick={onRemove}
            >
              <X
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            </button>
          </div>
        </div>
        {entry.minis.length === 0 ? null : (
          <div className="cq-board-minis">
            {entry.minis.map((mini) => (
              <span
                key={mini.name}
                className="cq-board-mini"
                data-hue={String(mini.hue)}
              >
                <i aria-hidden="true" />
                {mini.name}
                {mini.score === null ? null : (
                  <b aria-label={`fit ${mini.score} out of 10`}>{mini.score}</b>
                )}
              </span>
            ))}
          </div>
        )}
        {entry.files.map((file) => (
          <button
            key={file.artifactId}
            type="button"
            className="cq-ac-btn mt-2"
            onClick={() => onOpenArtifact(file.artifactId)}
          >
            <FileText
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            Open {file.title}
          </button>
        ))}
        {entry.said === null ? null : (
          <p className="cq-board-said">“{entry.said}”</p>
        )}
        {entry.sources.length === 0 ? null : (
          <details className="cq-board-src">
            <summary>
              <ChevronRight
                aria-hidden="true"
                className="icon"
                size={16}
                strokeWidth={ICON_STROKE}
              />
              {`Where this came from: ${String(entry.sourceTotal)} ${entry.sourceTotal === 1 ? "source" : "sources"}`}
            </summary>
            <ul>
              {entry.sources.map((source) => (
                <li key={`${source.kind}:${source.title}`}>
                  <SourceShape kind={source.kind} />
                  <span>
                    {source.title}
                    <small>{source.detail}</small>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </article>
    </li>
  );
}

export function QBoardTimeline({
  conversationId,
  turns,
  decisions = [],
  heading = true,
  onClose,
  onShow,
  onOpenArtifact,
  onAsk,
  suggestions = [],
  now,
}: {
  readonly conversationId: string | null;
  readonly turns: readonly QTurn[];
  /** What this tab decided on changes Q prepared (the thread's own state). */
  readonly decisions?: readonly BoardDecision[] | undefined;
  /** False inside a sheet that already carries the Board's title. */
  readonly heading?: boolean | undefined;
  readonly onClose?: (() => void) | undefined;
  /** Put an answer back on the Q page. */
  readonly onShow?: ((answerId: string) => void) | undefined;
  readonly onOpenArtifact: (artifactId: string) => void;
  /** A suggestion on the empty Board runs at once (C8). */
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly suggestions?: readonly string[] | undefined;
  readonly now?: Date | undefined;
}) {
  const t = useT();
  const marks = useBoardMarks(conversationId);
  const [chosen, setTab] = useState<Tab | null>(null);
  const entries = boardTimeline(turns, decisions).filter(
    (entry) => !marks.dismissed.includes(entry.id),
  );
  const pinned = entries.filter((entry) => marks.pinned.includes(entry.id));
  const made = entries.flatMap((entry) => entry.files);
  // XLSX-002: Files lists their saved documents from the server, so a
  // reload never empties it; what this tab made comes first.
  const saved = useSavedFiles(made.length);
  const files = boardFiles(made, saved);
  const empty = entries.length === 0;
  // Nothing at all: the welcome. Saved files but no timeline yet: the
  // Board still opens on its Files.
  const nothing = empty && files.length === 0;
  const tab: Tab = chosen ?? (empty && files.length > 0 ? "files" : "timeline");
  const groups = groupByDay(entries, now);

  return (
    <div className="cq-board" data-q-board-timeline>
      {heading ? (
        <div className="cq-board-head">
          <h1>{t("Board")}</h1>
          {onClose === undefined ? null : (
            <button
              type="button"
              className="cq-ac-x"
              aria-label={t("Close the Board")}
              onClick={onClose}
            >
              <X
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            </button>
          )}
        </div>
      ) : null}
      {nothing ? null : (
        <div className="cq-board-tabs" role="tablist" aria-label={t("Board")}>
          {(
            [
              ["timeline", "Timeline"],
              ["pinned", `Pinned ${String(pinned.length)}`],
              ["files", `Files ${String(files.length)}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="cq-board-grid" data-tab={tab}>
        <div className="cq-board-timeline">
          {empty ? (
            <div className="cq-board-empty">
              <h2>
                {nothing
                  ? t("Nothing on the Board yet")
                  : t("Nothing from this conversation yet")}
              </h2>
              <p>
                {nothing
                  ? t(
                      "What Q shows you lands here, so you can find it again. Pin what matters; files Q makes for you sit alongside.",
                    )
                  : t(
                      "What Q shows you here lands on this timeline. Your saved files are under Files.",
                    )}
              </p>
              {onAsk === undefined || suggestions.length === 0 ? null : (
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="cq-ac-chip"
                      onClick={() => onAsk(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.day} aria-label={group.day}>
                <p className="cq-board-day">{group.day}</p>
                <ol className="cq-board-tl">
                  {group.entries.map((entry) => (
                    <Entry
                      key={entry.id}
                      entry={entry}
                      pinned={marks.pinned.includes(entry.id)}
                      onPin={() => marks.togglePin(entry.id)}
                      onRemove={() => marks.remove(entry.id)}
                      onShow={
                        onShow === undefined
                          ? undefined
                          : () => onShow(entry.id)
                      }
                      onOpenArtifact={onOpenArtifact}
                    />
                  ))}
                </ol>
              </section>
            ))
          )}
        </div>
        {nothing ? null : (
          <aside className="cq-board-rail">
            <section className="pins" aria-label={t("Pinned")}>
              <h2>
                {t("Pinned")} <span>{pinned.length}</span>
              </h2>
              {pinned.length === 0 ? (
                <p className="cq-board-note">
                  {t("Pin an answer to keep it here.")}
                </p>
              ) : (
                pinned.map((entry) => (
                  <div
                    key={entry.id}
                    className="cq-board-pin"
                    data-hue={String(entry.minis[0]?.hue ?? 1)}
                  >
                    <div className="min-w-0">
                      <strong>{entry.title}</strong>
                      <span>
                        {entry.minis.map((mini) => mini.name).join(", ") ||
                          entry.kind}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="cq-ac-x"
                      aria-label={`Unpin ${entry.title}`}
                      onClick={() => marks.togglePin(entry.id)}
                    >
                      <X
                        aria-hidden="true"
                        size={ICON_SIZE.compact}
                        strokeWidth={ICON_STROKE}
                      />
                    </button>
                  </div>
                ))
              )}
            </section>
            <section className="files" aria-label={t("Files")}>
              <h2>
                {t("Files")} <span>{files.length}</span>
              </h2>
              {files.length === 0 ? (
                <p className="cq-board-note">
                  {t("Files Q makes when you ask for one sit here.")}
                </p>
              ) : (
                files.map((file) => (
                  <button
                    key={file.artifactId}
                    type="button"
                    className="cq-board-file"
                    onClick={() => onOpenArtifact(file.artifactId)}
                  >
                    <span className="ficon">
                      <FileText
                        aria-hidden="true"
                        size={ICON_SIZE.compact}
                        strokeWidth={ICON_STROKE}
                      />
                    </span>
                    <span className="min-w-0">
                      <strong>{file.title}</strong>
                      <span>{file.detail}</span>
                    </span>
                  </button>
                ))
              )}
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
