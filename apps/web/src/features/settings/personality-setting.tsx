"use client";

import { useState, useTransition } from "react";

import { Q_PERSONALITIES, type QPersonality } from "@capital-q/contracts";
import { Tooltip, TooltipProvider } from "@capital-q/ui/tooltip";

import { setPersonalityAction } from "./personality-actions";

/**
 * Who Q is with this person (founder direction 2026-09-30): one of Q's
 * personalities to stick to, or Auto, where Q reads the person and
 * matches them. Each option explains itself on hover; the chosen one's
 * explanation is always written underneath, so touch screens read it too.
 */

const LABELS: Readonly<Record<QPersonality, string>> = {
  AUTO: "Auto",
  WARM: "Warm",
  WITTY: "Witty",
  SHARP: "Sharp",
  CALM: "Calm",
};

const EXPLAINED: Readonly<Record<QPersonality, string>> = {
  AUTO: "Q reads you and adapts as you talk: playful when you are, brisk when you're busy, gentle when you're unsure.",
  WARM: "Encouraging and patient. Q makes you feel in good hands, and still gets to the point.",
  WITTY:
    "Playful and quick, with jokes and gentle teasing, never at the expense of the work.",
  SHARP:
    "Direct and efficient, like a seasoned analyst. Short sentences, no fluff.",
  CALM: "Steady and unhurried, in plain words. Good company when things are busy.",
};

export function PersonalitySetting({
  initial,
}: {
  readonly initial: QPersonality;
}) {
  const [chosen, setChosen] = useState<QPersonality>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (next: QPersonality) => {
    const before = chosen;
    setChosen(next);
    setMessage(null);
    startTransition(async () => {
      const result = await setPersonalityAction(next);
      if (!result.ok) {
        setChosen(before);
        setMessage(result.message);
      }
    });
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2">
        <div
          role="group"
          aria-label="Q's personality"
          className="flex flex-wrap gap-1"
          data-personality-setting
        >
          {Q_PERSONALITIES.map((choice) => (
            <Tooltip key={choice} content={EXPLAINED[choice]}>
              <button
                type="button"
                aria-pressed={chosen === choice}
                disabled={pending}
                onClick={() => {
                  choose(choice);
                }}
                className={
                  chosen === choice
                    ? "cq-appearance-option is-active"
                    : "cq-appearance-option"
                }
              >
                {LABELS[choice]}
              </button>
            </Tooltip>
          ))}
        </div>
        <p className="cq-caption text-(--cq-text-secondary)">
          {EXPLAINED[chosen]}
        </p>
        {message === null ? null : (
          <p role="alert" className="cq-caption text-(--cq-text-secondary)">
            {message}
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}
