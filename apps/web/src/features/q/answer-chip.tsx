"use client";

import "./answer-canvas.css";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { ICON_SIZE, ICON_STROKE, PanelRight, X } from "@capital-q/ui/icons";

import { QAperture } from "@/features/q-aperture";

import { answerChipFor, type AnswerChipContent } from "./answer-canvas-logic";
import type { QTurn } from "./conversation";
import { useQSessionOptional } from "./q-session";

const Q_PAGE = "/home";

/**
 * On any page but Q's, a new answer with cards shows as one compact chip
 * (C6; mockup answer-canvas.html?page=discover): what is ready, the names,
 * their colours, and two ways in: the Q page, or the Board. A file Q made
 * keeps its own floating card; this chip is only for answers as cards.
 */
export function AnswerChip() {
  const pathname = usePathname();
  const session = useQSessionOptional();
  if (session === null) return null;
  return (
    <AnswerChipFor
      pathname={pathname}
      turns={session.turns}
      loading={session.q.loading}
      conversationId={session.q.conversationId}
    />
  );
}

/**
 * The chip for a session's turns on a page. Split from the session so the
 * appear / open / dismiss behaviour is exercised in a browser with a
 * recorded conversation (e2e/answer-cards.spec.ts).
 */
export function AnswerChipFor({
  pathname,
  turns,
  loading,
  conversationId,
}: {
  readonly pathname: string;
  readonly turns: readonly QTurn[];
  /** The conversation is still being read: its turns are not news yet. */
  readonly loading: boolean;
  readonly conversationId: string | null;
}) {
  // Answers already there when this page opened are not news. Taken once
  // the conversation has been read: taken while it loads, an empty list
  // made the newest old answer with cards look new (P10).
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [seenPath, setSeenPath] = useState(pathname);
  if (!loading && (before === null || seenPath !== pathname)) {
    setBefore(new Set(turns.map((turn) => turn.id)));
    setSeenPath(pathname);
  }
  const chip = useMemo(
    () => (before === null ? null : answerChipFor(turns, before, dismissed)),
    [turns, before, dismissed],
  );
  if (pathname === Q_PAGE || chip === null) return null;
  const conversation = conversationId;
  const home =
    conversation === null
      ? Q_PAGE
      : `${Q_PAGE}?c=${encodeURIComponent(conversation)}`;
  return (
    <AnswerChipView
      chip={chip}
      home={home}
      onDismiss={() =>
        setDismissed((current) => new Set([...current, chip.answerId]))
      }
    />
  );
}

export function AnswerChipView({
  chip,
  home,
  onDismiss,
}: {
  readonly chip: AnswerChipContent;
  /** The Q page, in this conversation. */
  readonly home: string;
  readonly onDismiss: () => void;
}) {
  const board = `${home}${home.includes("?") ? "&" : "?"}board=1`;
  return (
    <aside
      className="cq-answer-chip"
      aria-label="Q answer ready"
      data-answer-chip
    >
      <span className="mark">
        <QAperture state="IDLE" size={40} />
      </span>
      <div className="min-w-0">
        <strong>{chip.heading}</strong>
        <span className="sub">{chip.names}</span>
        <div className="dots" aria-hidden="true">
          {chip.hues.map((hue, index) => (
            <i key={`${String(hue)}-${String(index)}`} data-hue={String(hue)} />
          ))}
        </div>
      </div>
      <span className="acts">
        <Link href={board} className="cq-ac-btn" aria-label="Open in the Board">
          <PanelRight
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
          Board
        </Link>
        <Link href={home} className="open inline-flex items-center">
          Open in Q
        </Link>
      </span>
      <button
        type="button"
        className="cq-ac-x chip-x"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
      </button>
    </aside>
  );
}
