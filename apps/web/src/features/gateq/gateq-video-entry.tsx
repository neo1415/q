"use client";

import { useEffect, useState, useTransition } from "react";

import type {
  ApplicationCoverageDto,
  GateqVideoSessionDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  endVideoAction,
  startVideoAction,
  videoStateAction,
} from "./apply-actions";
import { GateqVideoRoom } from "./gateq-video-room";

/**
 * The way into the GateQ video interview (C3), beside the typed one. It
 * appears only when the server says video is offered for this application
 * (switched on, configured, allowance left) or a session is already live,
 * in which case it reopens that same session: a refresh never starts a
 * second room or restarts the clock. Typing is always the fallback and
 * carries on the same canonical interview.
 */
export function GateqVideoEntry({
  token,
  fund,
  coverage,
  onEnded,
}: {
  readonly token: string;
  readonly fund: string;
  readonly coverage: ApplicationCoverageDto | null;
  /** After the room closes: refresh the transcript; `typed` false → review. */
  readonly onEnded: (typed: boolean) => Promise<void>;
}) {
  const [available, setAvailable] = useState(false);
  const [session, setSession] = useState<GateqVideoSessionDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void videoStateAction(token).then((result) => {
      if (!live || !result.ok) return;
      setAvailable(result.state.available);
      // Recovery: a live session reopens in its room with its own clock.
      if (result.state.session?.status === "LIVE")
        setSession(result.state.session);
    });
    return () => {
      live = false;
    };
  }, [token]);

  if (session !== null && session.status === "LIVE") {
    return (
      <GateqVideoRoom
        fund={fund}
        session={session}
        coverage={coverage}
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
  if (!available)
    return message === null ? null : (
      <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
        {message}
      </p>
    );

  return (
    <div
      className="flex flex-col gap-2 border-t border-(--cq-border-subtle) pt-4"
      data-gateq-video-entry
    >
      <p className="cq-label text-(--cq-text-primary)">
        Prefer to talk it through?
      </p>
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
          variant="secondary"
          disabled={!consented || pending}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const result = await startVideoAction(token);
              if (!result.ok) {
                setMessage(result.message);
                setAvailable(false);
                return;
              }
              if (result.state.session?.status === "LIVE")
                setSession(result.state.session);
              else
                setMessage(
                  "Video isn't available right now. You can continue by typing.",
                );
            })
          }
        >
          {pending ? "Opening the video room…" : "Continue by video"}
        </Button>
        <span className="cq-caption text-(--cq-text-tertiary)">
          Short sessions; typing stays available.
        </span>
      </div>
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}
