"use client";

import "./answer-canvas.css";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import {
  ICON_SIZE,
  ICON_STROKE,
  PanelRight,
  X,
} from "@capital-q/ui/icons";

import { QAperture } from "@/features/q-aperture";

import { answerChipFor } from "./answer-canvas-logic";
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
  const turns = session?.turns;
  // Answers already there when this page opened are not news.
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [seenPath, setSeenPath] = useState(pathname);
  if (turns !== undefined && (before === null || seenPath !== pathname)) {
    setBefore(new Set(turns.map((turn) => turn.id)));
    setSeenPath(pathname);
  }
  const chip = useMemo(
    () =>
      turns === undefined || before === null
        ? null
        : answerChipFor(turns, before, dismissed),
    [turns, before, dismissed],
  );
  if (pathname === Q_PAGE || chip === null || session === null) return null;
  const conversation = session.q.conversationId;
  const home =
    conversation === null ? Q_PAGE : `${Q_PAGE}?c=${encodeURIComponent(conversation)}`;
  const board = `${home}${home.includes("?") ? "&" : "?"}board=1`;
  return (
    <aside className="cq-answer-chip" aria-label="Q answer ready" data-answer-chip>
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
          <PanelRight aria-hidden="true" size={ICON_SIZE.compact} strokeWidth={ICON_STROKE} />
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
        onClick={() => setDismissed((current) => new Set([...current, chip.answerId]))}
      >
        <X aria-hidden="true" size={ICON_SIZE.compact} strokeWidth={ICON_STROKE} />
      </button>
    </aside>
  );
}
