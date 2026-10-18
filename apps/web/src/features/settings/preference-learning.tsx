"use client";

import { useEffect, useState, useTransition } from "react";

import type { QPreferenceLearningDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  choosePreferenceLearningAction,
  preferenceLearningAction,
} from "./memory-actions";
import { useT } from "@/features/i18n/language";

/**
 * Consent to learn how the person likes to work (lane ob1; owner decision
 * 2026-10-16). Two surfaces, one decision:
 *
 *   PreferenceLearningAsk     the one short line Q puts once, at the end of
 *                             onboarding or on the next Home arrival after
 *                             the greeting; Allow / Not now (30 days).
 *   PreferenceLearningSwitch  the control in What Q remembers.
 *
 * Nothing new is inferred until they allow it; what they tell Q directly
 * is kept either way. The decision is theirs in this workspace only.
 */

export const PREFERENCE_LEARNING_QUESTION =
  "May I learn how you like to work from our conversations, like how brief to be? You can change this anytime in What Q remembers.";

export function PreferenceLearningAsk({
  initial,
}: {
  /** The state read on the server, when the page already has it. */
  readonly initial?: QPreferenceLearningDto | null | undefined;
}) {
  const t = useT();
  const [state, setState] = useState<QPreferenceLearningDto | null>(
    initial ?? null,
  );
  const [answered, setAnswered] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    void preferenceLearningAction().then((read) => {
      if (live) setState(read);
    });
    return () => {
      live = false;
    };
  }, [initial]);

  if (answered !== null) {
    return (
      <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
        {answered}
      </p>
    );
  }
  if (state === null || !state.mayAsk) return null;
  const choose = (choice: "ALLOW" | "NOT_NOW") =>
    startTransition(async () => {
      const saved = await choosePreferenceLearningAction({
        choice,
        via: "PROMPT",
      });
      setAnswered(
        saved === null
          ? "That didn't save. I'll ask another time."
          : choice === "ALLOW"
            ? "Thanks. I'll learn how you like to work."
            : "Okay. I won't ask again for a month.",
      );
    });
  return (
    <div
      role="group"
      aria-label={t("May Q learn how you like to work?")}
      className="flex flex-col gap-2"
      data-q-learning-ask
    >
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t(PREFERENCE_LEARNING_QUESTION)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="compact"
          variant="secondary"
          disabled={pending}
          onClick={() => choose("ALLOW")}
        >
          {t("Allow")}
        </Button>
        <Button
          size="compact"
          variant="quiet"
          disabled={pending}
          onClick={() => choose("NOT_NOW")}
        >
          {t("Not now")}
        </Button>
      </div>
    </div>
  );
}

export function PreferenceLearningSwitch({
  initial,
}: {
  readonly initial: QPreferenceLearningDto | null;
}) {
  const t = useT();
  const [state, setState] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  if (state === null) return null;
  const on = state.status === "GRANTED";
  return (
    <div className="flex flex-col gap-2" data-q-learning-switch>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={pending}
          aria-checked={on}
          className="size-5"
          onChange={() =>
            startTransition(async () => {
              const saved = await choosePreferenceLearningAction({
                choice: on ? "TURN_OFF" : "ALLOW",
                via: "SETTINGS",
              });
              setFailed(saved === null);
              if (saved !== null) setState(saved);
            })
          }
        />
        <span className="cq-body text-(--cq-text-primary)">
          {t("Let Q learn how I like to work")}
        </span>
      </label>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {on
          ? "Q learns from your conversations in this workspace. What it has learned is listed below; forget anything."
          : "Off: Q learns nothing new about how you like to work. What you tell it directly is still kept."}
      </p>
      {failed ? (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {t("That didn't save. Try again.")}
        </p>
      ) : null}
    </div>
  );
}
