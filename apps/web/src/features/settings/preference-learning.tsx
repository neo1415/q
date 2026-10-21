"use client";

import { useEffect, useState, useTransition } from "react";

import type { QPreferenceLearningDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { useAccountToast, WordSwitch } from "./account-kit";
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

/**
 * The switch in What Q remembers (a card at the top) and in Settings ->
 * Privacy (a row). It says On or Off in words; the change is the person's
 * own decision, saved for their current workspace, and a toast says what
 * it now means.
 */
export function PreferenceLearningSwitch({
  initial,
  layout = "card",
}: {
  readonly initial: QPreferenceLearningDto | null;
  readonly layout?: "card" | "row" | undefined;
}) {
  const t = useT();
  const toast = useAccountToast();
  const [state, setState] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  if (state === null) return null;
  const on = state.status === "GRANTED";
  const control = (
    <WordSwitch
      on={on}
      disabled={pending}
      label={t("Let Q learn how I like to work")}
      onWord={t("On")}
      offWord={t("Off")}
      data-q-learning-toggle
      onChange={(next) =>
        startTransition(async () => {
          const saved = await choosePreferenceLearningAction({
            choice: next ? "ALLOW" : "TURN_OFF",
            via: "SETTINGS",
          });
          setFailed(saved === null);
          if (saved === null) return;
          setState(saved);
          toast(
            next
              ? t("Thanks. I’ll learn how you like to work.")
              : t("Off. Q learns nothing new about how you like to work."),
          );
        })
      }
    />
  );
  const words = (
    <>
      <b className="block text-[15px] font-medium text-(--cq-text-primary)">
        {t("Let Q learn how I like to work")}
      </b>
      <span className="text-[13px] leading-[1.45] text-(--cq-text-secondary)">
        {layout === "card"
          ? t(
              "From our conversations, like how brief to be. Off: Q learns nothing new about how you like to work. What you tell it directly is still kept.",
            )
          : t(
              "Like how brief to be. Off: Q learns nothing new. What you tell it directly is still kept.",
            )}
      </span>
      {failed ? (
        <span
          role="alert"
          className="mt-1 block text-[13px] text-(--cq-text-primary)"
        >
          {t("That didn't save. Try again.")}
        </span>
      ) : null}
    </>
  );
  return layout === "card" ? (
    <div
      className="flex flex-wrap items-center gap-4 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4 sm:flex-nowrap"
      data-q-learning-switch
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{words}</div>
      {control}
    </div>
  ) : (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-(--cq-border-subtle) py-3.5 first:border-t-0 sm:flex-nowrap"
      data-q-learning-switch
      data-srow
    >
      <div className="flex min-w-[58%] flex-1 flex-col gap-0.5 sm:min-w-0">
        {words}
      </div>
      {control}
    </div>
  );
}
