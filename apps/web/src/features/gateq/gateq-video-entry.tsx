"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type {
  ApplicationCoverageDto,
  GateqVideoSessionDto,
  VideoAllowanceDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  endVideoAction,
  startVideoAction,
  videoStateAction,
} from "./apply-actions";
import {
  videoAllowanceLine,
  videoAllowanceUsedUp,
} from "@/features/video-room/video-allowance";

import { GateqVideoRoom } from "./gateq-video-room";

/**
 * The way into the GateQ video interview (C3). It appears only when the
 * server says video is offered for this application (switched on,
 * configured, allowance left) or a session is already live, in which case
 * it reopens that same session: a refresh never starts a second room or
 * restarts the clock. Typing is always the fallback and carries on the
 * same canonical interview.
 *
 * `aside` (default) is the offer beside a typed interview. `primary`
 * (owner, 2026-10-15) makes video the default way to do the interview:
 * the offer is the step's main action, and the caller is told when to show
 * typing instead (not offered, refused, cap reached, or the person's
 * choice) through `onUnavailable` / `onTypeInstead`.
 */
export function GateqVideoEntry({
  token,
  fund,
  coverage,
  participantName,
  onEnded,
  variant = "aside",
  onUnavailable,
  onTypeInstead,
  onRoomChange,
}: {
  readonly token: string;
  readonly fund: string;
  readonly coverage: ApplicationCoverageDto | null;
  readonly participantName: string;
  /** After the room closes: refresh the transcript; `typed` false → review. */
  readonly onEnded: (typed: boolean) => Promise<void>;
  readonly variant?: "aside" | "primary";
  /** Video is not offered; `why` is what to tell the person, if known. */
  readonly onUnavailable?: ((why: string | null) => void) | undefined;
  /** The person chose to type (primary only). */
  readonly onTypeInstead?: (() => void) | undefined;
  /** The room opened (true) or closed (false). */
  readonly onRoomChange?: ((open: boolean) => void) | undefined;
}) {
  const primary = variant === "primary";
  const [checked, setChecked] = useState(false);
  const [available, setAvailable] = useState(false);
  const [allowance, setAllowance] = useState<VideoAllowanceDto | null>(null);
  const [session, setSession] = useState<GateqVideoSessionDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [pending, startTransition] = useTransition();
  // Latest callbacks, so the state read runs once per token.
  const unavailable = useRef(onUnavailable);
  const roomChange = useRef(onRoomChange);
  useEffect(() => {
    unavailable.current = onUnavailable;
    roomChange.current = onRoomChange;
  });

  useEffect(() => {
    let live = true;
    void videoStateAction(token)
      .then((result) => {
        if (!live) return;
        setChecked(true);
        if (!result.ok) {
          unavailable.current?.(null);
          return;
        }
        setAvailable(result.state.available);
        setAllowance(result.state.allowance ?? null);
        // Recovery: a live session reopens in its room with its own clock.
        if (result.state.session?.status === "LIVE")
          setSession(result.state.session);
        else if (!result.state.available) {
          const spent = result.state.allowance;
          unavailable.current?.(
            spent !== undefined && spent !== null && spent.remaining === 0
              ? `${videoAllowanceUsedUp(spent)} You can carry on by typing.`
              : null,
          );
        }
      })
      .catch(() => {
        if (!live) return;
        setChecked(true);
        unavailable.current?.(null);
      });
    return () => {
      live = false;
    };
  }, [token]);

  // Q is still joining: the server starts the clock when Q is in the room,
  // so re-read the session until it says when (bounded by its hard stop).
  const joining = session?.status === "LIVE" && session.liveAt === null;
  useEffect(() => {
    if (!joining) return;
    let live = true;
    const timer = window.setInterval(() => {
      void videoStateAction(token).then((result) => {
        if (!live || !result.ok) return;
        const next = result.state.session;
        if (next?.status === "LIVE" && next.liveAt !== null) setSession(next);
      });
    }, 3_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [joining, token]);

  const roomOpen = session !== null && session.status === "LIVE";
  useEffect(() => {
    roomChange.current?.(roomOpen);
  }, [roomOpen]);

  if (session !== null && session.status === "LIVE") {
    return (
      <GateqVideoRoom
        fund={fund}
        session={session}
        coverage={coverage}
        participantName={participantName}
        onEnd={async (typed) => {
          const result = await endVideoAction(token, typed);
          if (!result.ok) return { message: result.message };
          setSession(null);
          setAvailable(false);
          await onEnded(typed);
          return {};
        }}
      />
    );
  }
  if (primary && !checked) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <div className="gq-sk" style={{ width: "60%", height: 20 }} />
        <div className="gq-sk" style={{ width: "40%", height: 44 }} />
      </div>
    );
  }
  // Primary: the caller already shows typing, with the reason.
  if (primary && !available) return null;
  if (!available) {
    // Typing is never limited; say why video is not offered when we know.
    const why =
      message ??
      (allowance?.remaining === 0
        ? `${videoAllowanceUsedUp(allowance)} You can carry on by typing.`
        : null);
    return why === null ? null : (
      <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
        {why}
      </p>
    );
  }

  return (
    <div
      className={
        primary
          ? "gq-card flex flex-col gap-3 p-4"
          : "flex flex-col gap-2 border-t border-(--cq-border-subtle) pt-4"
      }
      data-gateq-video-entry={variant}
    >
      <p className="cq-label text-(--cq-text-primary)">
        {primary ? "Talk it through with Q" : "Prefer to talk it through?"}
      </p>
      {primary ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          A short video conversation, the way you would pitch {fund} in person.
          Q asks, you answer out loud; every answer is written into this
          application for you to review.
        </p>
      ) : null}
      {videoAllowanceLine(allowance) === null ? null : (
        <p className="cq-caption text-(--cq-text-tertiary)">
          {videoAllowanceLine(allowance)}
        </p>
      )}
      <label className="cq-body-sm flex min-h-11 cursor-pointer items-start gap-3 text-(--cq-text-secondary)">
        <input
          type="checkbox"
          checked={consented}
          onChange={(event) => setConsented(event.target.checked)}
          className="mt-1 size-4 accent-(--cq-accent)"
        />
        <span>
          I understand Q is an AI interviewer, my camera and microphone are used
          only while the video room is open, and what I say is transcribed into
          this application. Nothing reaches {fund} until I review and submit.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={primary ? "primary" : "secondary"}
          disabled={!consented || pending}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const result = await startVideoAction(token);
              if (!result.ok) {
                setMessage(result.message);
                setAvailable(false);
                onUnavailable?.(result.message);
                return;
              }
              if (result.state.session?.status === "LIVE")
                setSession(result.state.session);
              else {
                const why =
                  "Video isn't available right now. You can continue by typing.";
                setMessage(why);
                if (primary) {
                  setAvailable(false);
                  onUnavailable?.(why);
                }
              }
            })
          }
        >
          {pending
            ? "Opening the video room…"
            : primary
              ? "Start the video interview"
              : "Continue by video"}
        </Button>
        {primary && onTypeInstead !== undefined ? (
          <Button variant="quiet" disabled={pending} onClick={onTypeInstead}>
            Type my answers instead
          </Button>
        ) : (
          <span className="cq-caption text-(--cq-text-tertiary)">
            Short sessions; typing stays available.
          </span>
        )}
      </div>
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}
