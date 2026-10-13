"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type {
  QRehearsalDto,
  RehearsalVideoSessionDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { endRehearsalVideoAction } from "./rehearsal-actions";

/**
 * The video rehearsal (ADR 0066): the provider's private room, embedded as
 * an iframe (no SDK, no new dependency). The interviewer's every line comes
 * from Q's rehearsal service on the server; this page only shows the room,
 * the disclosure, the time left, and the way out. The three-minute cap is
 * the server's: the countdown here is a courtesy, and when it reaches zero
 * the page asks the server to end (which it does anyway).
 */
export function RehearsalVideoStage({
  rehearsal,
  session,
  onContinueByVoice,
}: {
  readonly rehearsal: Pick<QRehearsalDto, "id" | "counterpart">;
  readonly session: RehearsalVideoSessionDto;
  readonly onContinueByVoice: (rehearsal: QRehearsalDto) => void;
}) {
  const router = useRouter();
  const endsAt = Date.parse(session.endsAt);
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000)),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [ending, startEnding] = useTransition();
  const ended = useRef(false);

  function end(continueByVoice: boolean) {
    if (ended.current) return;
    ended.current = true;
    setMessage(null);
    startEnding(async () => {
      const result = await endRehearsalVideoAction(
        rehearsal.id,
        continueByVoice,
      );
      if (!result.ok) {
        ended.current = false;
        setMessage(result.message);
        return;
      }
      if (continueByVoice && result.value.rehearsal.status === "ACTIVE") {
        onContinueByVoice(result.value.rehearsal);
        return;
      }
      // The existing review page reads the finished rehearsal.
      router.push(`/rehearsals/r/${rehearsal.id}`);
    });
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000));
      setLeft(seconds);
      if (seconds === 0) {
        window.clearInterval(timer);
        end(false);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
    // `end` is stable in effect: it guards itself with a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);

  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  const name = rehearsal.counterpart.name;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="cq-title-md text-(--cq-text-primary)">
            Rehearsing with {name}
          </h1>
          <p className="cq-caption text-(--cq-text-secondary)">
            {session.disclosure}
          </p>
        </div>
        <p
          className="cq-label tabular-nums text-(--cq-text-primary)"
          aria-live="off"
        >
          <span className="sr-only">Time left: </span>
          {minutes}:{seconds}
        </p>
      </div>

      {session.joinUrl === null ? (
        <div className="cq-stage flex min-h-80 flex-col items-center justify-center gap-3 rounded-(--cq-radius-xl) p-8 text-center">
          <p className="cq-body text-(--cq-stage-text)">
            This call can’t be rejoined from here.
          </p>
          <p className="cq-body-sm text-(--cq-stage-text-muted)">
            End it to see your review, or carry on by voice.
          </p>
        </div>
      ) : (
        <div className="cq-stage relative aspect-video w-full overflow-hidden rounded-(--cq-radius-xl)">
          <iframe
            src={session.joinUrl}
            title={`Video rehearsal with ${name} (AI interviewer)`}
            allow="camera; microphone; autoplay; display-capture; fullscreen"
            referrerPolicy="no-referrer"
            className="absolute inset-0 size-full border-0"
          />
        </div>
      )}

      {left > 0 && left <= 30 ? (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          We’re closing shortly. Finish your last point; Q will save your
          transcript and review.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="large"
          onClick={() => end(false)}
          disabled={ending}
        >
          {ending ? "Ending…" : "End and see my review"}
        </Button>
        <Button variant="secondary" onClick={() => end(true)} disabled={ending}>
          Carry on by voice instead
        </Button>
      </div>
      <p className="cq-caption text-(--cq-text-tertiary)">
        Video calls last up to {Math.round(session.maxSeconds / 60)} minutes.
        Your camera and microphone go to the video room only while this call is
        open.
      </p>
      {message === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </section>
  );
}
