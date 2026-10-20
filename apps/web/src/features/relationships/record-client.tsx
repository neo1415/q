"use client";

import { useState } from "react";

import { Button } from "@capital-q/ui/button";

import { meetingBriefAction } from "@/features/schedule/schedule-actions";
import { QSwarm } from "@/features/q-swarm/q-swarm";
import { useT } from "@/features/i18n/language";

import { QLine, RecordSheet } from "./record-parts";

/**
 * The record's few client parts: a call's time in the reader's own zone,
 * and the call brief in a sheet. Reads only; nothing here acts.
 */

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

/** "today at 14:00", "tomorrow at 14:00", "on Wed 22 Oct at 14:00". */
export function callPhrase(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  const time = TIME.format(at);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" as const }),
  }).format(at);
  return `on ${date} at ${time}`;
}

/** A call's time, in the reader's zone (the server's first guess is replaced). */
export function CallWhen({ iso }: { readonly iso: string }) {
  const t = useT();
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {t(callPhrase(iso))}
    </time>
  );
}

/**
 * "Open call brief": Q's preparation for the next call, read for this
 * person when they open it (the API answers only a party to the call).
 */
export function CallBriefButton({
  meetingId,
  counterpart,
  charcoal = false,
  variant = "primary",
  label = "Open call brief",
}: {
  readonly meetingId: string;
  readonly counterpart: string;
  readonly charcoal?: boolean | undefined;
  readonly variant?: "primary" | "secondary" | undefined;
  readonly label?: string | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<
    | { readonly kind: "LOADING" }
    | { readonly kind: "READ"; readonly body: string }
    | { readonly kind: "FAILED"; readonly message: string }
  >({ kind: "LOADING" });

  const load = () => {
    setBrief({ kind: "LOADING" });
    void meetingBriefAction(meetingId)
      .then((result) =>
        setBrief(
          result.ok
            ? { kind: "READ", body: result.value.body }
            : { kind: "FAILED", message: result.message },
        ),
      )
      .catch(() =>
        setBrief({
          kind: "FAILED",
          message: "The brief didn't load. Try again.",
        }),
      );
  };

  return (
    <>
      <Button
        variant={variant}
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        {t(label)}
      </Button>
      <RecordSheet
        open={open}
        onOpenChange={setOpen}
        title={t("Call brief")}
        description={t(`For your call with ${counterpart}`)}
        charcoal={charcoal}
      >
        {brief.kind === "LOADING" ? (
          <div className="flex items-center gap-3" role="status">
            <QSwarm state="WORKING" pixels={40} />
            <span className="cq-body-sm text-(--cq-text-secondary)">
              {t("Reading the brief…")}
            </span>
          </div>
        ) : brief.kind === "FAILED" ? (
          <div className="flex items-center justify-between gap-3" role="alert">
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t(brief.message)}
            </p>
            <Button variant="secondary" onClick={load}>
              {t("Retry")}
            </Button>
          </div>
        ) : (
          <QLine
            note={t(
              "Q's preparation from what both sides shared. Check it before the call.",
            )}
          >
            <p className="cq-body-sm whitespace-pre-wrap">{brief.body}</p>
          </QLine>
        )}
      </RecordSheet>
    </>
  );
}
