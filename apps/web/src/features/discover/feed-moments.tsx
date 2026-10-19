"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button, buttonClassName } from "@capital-q/ui/button";
import { Check, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import type { FeedPassReason } from "./feed/feed-state";
import { useT } from "@/features/i18n/language";

/**
 * The feed's moments after a decision (Discover A, owner 2026-10-19): a
 * quiet toast once a pass is recorded (Undo, and an optional reason in one
 * tap -- never a modal, doc 17 §67), one once interest is confirmed by the
 * server (with the way to the relationship), and the end of the slate.
 * Pass is neutral throughout: no red, no verdict.
 */

/** How long a toast stays when nobody is reading it. */
const TOAST_MS = 6_000;

/** The reasons offered after a pass, in the contract's own codes. */
export const PASS_REASON_CHOICES: readonly {
  readonly reason: FeedPassReason;
  readonly label: string;
}[] = [
  { reason: "SECTOR", label: "Not my sector" },
  { reason: "STAGE", label: "Wrong stage" },
  { reason: "TRACTION", label: "Too early" },
  { reason: "OTHER", label: "Other" },
];

export type FeedMoment =
  | {
      readonly kind: "PASSED";
      readonly id: number;
      readonly companyId: string;
      readonly companyName: string;
    }
  | {
      readonly kind: "INTEREST";
      readonly id: number;
      readonly companyId: string;
      readonly companyName: string;
    };

/** Dismisses itself after a while, but never while it is being used. */
function useAutoDismiss(id: number, onDone: () => void) {
  const [held, setHeld] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => done.current(), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [id, held]);
  return {
    onPointerEnter: () => setHeld(true),
    onPointerLeave: () => setHeld(false),
    onFocus: () => setHeld(true),
    onBlur: () => setHeld(false),
  };
}

export function FeedMomentToast({
  moment,
  onUndoPass,
  onPassReason,
  onDone,
}: {
  readonly moment: FeedMoment | null;
  readonly onUndoPass: (companyId: string) => void;
  readonly onPassReason: (companyId: string, reason: FeedPassReason) => void;
  readonly onDone: () => void;
}) {
  if (moment === null) return null;
  return (
    <div className="cq-feed-toast-layer" data-feed-toast-layer>
      {moment.kind === "PASSED" ? (
        <PassToast
          key={moment.id}
          moment={moment}
          onUndo={onUndoPass}
          onReason={onPassReason}
          onDone={onDone}
        />
      ) : (
        <InterestToast key={moment.id} moment={moment} onDone={onDone} />
      )}
    </div>
  );
}

function PassToast({
  moment,
  onUndo,
  onReason,
  onDone,
}: {
  readonly moment: Extract<FeedMoment, { kind: "PASSED" }>;
  readonly onUndo: (companyId: string) => void;
  readonly onReason: (companyId: string, reason: FeedPassReason) => void;
  readonly onDone: () => void;
}) {
  const t = useT();
  const [noted, setNoted] = useState<FeedPassReason | null>(null);
  const hold = useAutoDismiss(moment.id, onDone);
  return (
    <div
      className="cq-feed-toast"
      role="status"
      aria-live="polite"
      data-feed-toast="passed"
      {...hold}
    >
      <span className="cq-feed-toast-text">
        {t("Passed")} {moment.companyName}
      </span>
      {noted === null ? (
        <span
          className="cq-feed-toast-reasons"
          role="group"
          aria-label={t("Why, if you like")}
        >
          {PASS_REASON_CHOICES.map((choice) => (
            <button
              key={choice.reason}
              type="button"
              className="cq-feed-toast-chip"
              onClick={() => {
                onReason(moment.companyId, choice.reason);
                setNoted(choice.reason);
              }}
              data-pass-reason={choice.reason}
            >
              {t(choice.label)}
            </button>
          ))}
        </span>
      ) : (
        <span className="cq-feed-toast-note" data-pass-reason-noted={noted}>
          <Check
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
          {t("Noted for your feed")}
        </span>
      )}
      <button
        type="button"
        className="cq-feed-toast-action"
        onClick={() => {
          onUndo(moment.companyId);
          onDone();
        }}
        data-feed-undo-pass
      >
        {t("Undo")}
      </button>
    </div>
  );
}

function InterestToast({
  moment,
  onDone,
}: {
  readonly moment: Extract<FeedMoment, { kind: "INTEREST" }>;
  readonly onDone: () => void;
}) {
  const t = useT();
  const hold = useAutoDismiss(moment.id, onDone);
  return (
    <div
      className="cq-feed-toast"
      role="status"
      aria-live="polite"
      data-feed-toast="interest"
      {...hold}
    >
      <Check
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
      />
      <span className="cq-feed-toast-text">
        {t("Interest recorded")} · {moment.companyName} ·{" "}
        {t("Its founders are told.")}
      </span>
      <Link
        href={`/relationships/company/${encodeURIComponent(moment.companyId)}`}
        className="cq-feed-toast-action"
        data-feed-view-in-crm
      >
        {t("View in CRM")}
      </Link>
    </div>
  );
}

/** This visit's decisions, counted where they were made. */
export type FeedTally = {
  readonly saved: number;
  readonly interest: number;
  readonly passed: number;
};

export const NO_TALLY: FeedTally = { saved: 0, interest: 0, passed: 0 };

/**
 * After the last company of the slate: what this visit decided, and where
 * the saved ones are. Counts are this visit's own actions -- never a
 * popularity figure (doc 19).
 */
export function EndOfSlate({
  tally,
  onBack,
}: {
  readonly tally: FeedTally;
  readonly onBack: () => void;
}) {
  const t = useT();
  return (
    <section
      className="cq-feed-end"
      aria-label={t("Today's slate")}
      data-feed-end
    >
      <p className="cq-caption text-(--cq-text-secondary)">
        {t("Today's slate")}
      </p>
      <h2 className="cq-title-md text-(--cq-text-primary)">
        {t("You're through today's slate.")}
      </h2>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t(
          "New companies arrive as they match your mandate. Nothing here is ranked by popularity.",
        )}
      </p>
      <dl className="cq-feed-end-tally">
        <div>
          <dt>{t("Saved")}</dt>
          <dd>{tally.saved}</dd>
        </div>
        <div>
          <dt>{t("Interest sent")}</dt>
          <dd>{tally.interest}</dd>
        </div>
        <div>
          <dt>{t("Passed")}</dt>
          <dd>{tally.passed}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/discover/saved"
          className={buttonClassName("secondary")}
          data-feed-end-saved
        >
          {t("Review saved companies")}
        </Link>
        <Button variant="quiet" onClick={onBack}>
          {t("Back to the last company")}
        </Button>
      </div>
    </section>
  );
}
