"use client";

import { useEffect, useState } from "react";

import { cx } from "@capital-q/ui";

import { useQMotion } from "../q-aperture/q-motion";

/**
 * The voice room's rolling captions (Q home, owner 2026-10-19): the words
 * being said right now, large, under the presence -- only the latest few,
 * so the line never becomes a transcript (the transcript is Chat).
 *
 * A line that arrives whole (Q's reply) is revealed at about speaking pace
 * so the words keep up with the voice instead of landing as a block; a line
 * that grows as it is heard (the person's) simply follows. Reduced motion
 * shows the whole line at once.
 *
 * Decorative for assistive technology: the same words are announced by
 * the stage's own latest-exchange list, so this is aria-hidden.
 */

/** About 3.4 words a second: a measured speaking voice. */
const WORD_MS = 290;

export function QRollingCaption({
  text,
  speaker,
  keep = 24,
}: {
  readonly text: string;
  readonly speaker: "person" | "q";
  /** How many of the latest words stay on screen. */
  readonly keep?: number;
}) {
  const { motion } = useQMotion();
  const all = text.split(/\s+/).filter((word) => word.length > 0);
  const total = all.length;
  const [shown, setShown] = useState(total);
  const [line, setLine] = useState({ text, speaker });
  // A new speaker or a line that is not a continuation starts the reveal
  // over; a growing line keeps what is already shown.
  if (line.text !== text || line.speaker !== speaker) {
    const continues = line.speaker === speaker && text.startsWith(line.text);
    setLine({ text, speaker });
    if (!continues) setShown(speaker === "q" && motion === "full" ? 0 : total);
  }
  const revealing = speaker === "q" && motion === "full" && shown < total;
  useEffect(() => {
    if (!revealing) return;
    const timer = window.setTimeout(() => setShown((n) => n + 1), WORD_MS);
    return () => window.clearTimeout(timer);
  }, [revealing, shown]);
  const end =
    speaker === "q" && motion === "full" ? Math.min(shown, total) : total;
  const visible = all.slice(Math.max(0, end - keep), end).join(" ");
  if (visible.length === 0) return null;
  return (
    <p
      aria-hidden="true"
      className={cx("cq-rolling-caption", speaker === "q" && "is-q")}
      data-q-rolling-caption={speaker}
    >
      {visible}
    </p>
  );
}
