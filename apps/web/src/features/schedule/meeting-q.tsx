"use client";

import { useEffect, useState, useTransition } from "react";

import type { QMeetingAssistantDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { QSwarm } from "@/features/q-swarm/q-swarm";

import {
  bringMeetingQAction,
  dismissMeetingQAction,
  readMeetingQAction,
} from "./meeting-q-actions";

/**
 * Q in a meeting, on the meeting itself (founder direction 2026-09-29):
 * the organiser brings Q with one press; Q joins the call under its own
 * name, and afterwards its notes appear here -- what was covered, what to
 * know, what to do next. One state at a time, never a paragraph of help.
 */

const FLAG_WORDS: Readonly<Record<string, string>> = {
  COMMITMENT: "Commitment",
  NUMBER: "Number",
  RISK: "Risk",
  QUESTION: "Open question",
  SIGNAL: "Signal",
};

function newKey(): string {
  return `web-q-meet-${crypto.randomUUID()}`;
}

export function MeetingQ({
  meetingId,
  ended,
}: {
  readonly meetingId: string;
  /** The call is over: Q can no longer be brought, only read. */
  readonly ended: boolean;
}) {
  const [state, setState] = useState<QMeetingAssistantDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void readMeetingQAction(meetingId).then((result) => {
      if (!live) return;
      if (result.ok) setState(result.value);
    });
    return () => {
      live = false;
    };
  }, [meetingId]);

  const act = (work: () => ReturnType<typeof readMeetingQAction>) =>
    startTransition(async () => {
      setMessage(null);
      const result = await work();
      if (result.ok) setState(result.value);
      else setMessage(result.message);
    });

  if (state === null) return null;
  const status = state.status;

  if (status === "DONE") {
    return (
      <details className="flex flex-col gap-2" data-meeting-q="DONE">
        <summary className="cq-label cursor-pointer text-(--cq-text-primary)">
          Q&apos;s notes
        </summary>
        <div className="flex flex-col gap-3 pt-2">
          {state.summary === null ? null : (
            <p className="cq-body-sm whitespace-pre-line text-(--cq-text-secondary)">
              {state.summary}
            </p>
          )}
          {state.flags.length === 0 ? null : (
            <ul className="flex flex-col gap-1.5" aria-label="Worth knowing">
              {state.flags.map((flag) => (
                <li
                  key={`${flag.kind}:${flag.text}`}
                  className="cq-body-sm text-(--cq-text-primary)"
                >
                  <span className="cq-caption text-(--cq-text-tertiary)">
                    {FLAG_WORDS[flag.kind] ?? flag.kind}
                    {flag.speaker === null ? "" : ` · ${flag.speaker}`}
                  </span>
                  <br />
                  {flag.text}
                </li>
              ))}
            </ul>
          )}
          {state.followUps.length === 0 ? null : (
            <ul className="flex flex-col gap-1" aria-label="Follow-ups">
              {state.followUps.map((item) => (
                <li
                  key={item.text}
                  className="cq-body-sm text-(--cq-text-primary)"
                >
                  → {item.text}
                  {item.owner === null ? "" : ` (${item.owner})`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    );
  }

  if (status === "IN_CALL" || status === "COMPOSING") {
    return (
      <div className="flex items-center gap-2" data-meeting-q={status}>
        <QSwarm state="WORKING" pixels={32} />
        <span className="cq-caption text-(--cq-text-secondary)">
          {status === "IN_CALL"
            ? "Q is in the call, taking notes."
            : "Q is writing its notes. One moment."}
        </span>
      </div>
    );
  }

  if (status === "REQUESTED" || status === "SCHEDULED") {
    return (
      <div
        className="flex flex-wrap items-center gap-2"
        data-meeting-q={status}
      >
        <span className="cq-caption text-(--cq-text-secondary)">
          Q will join and take notes.
        </span>
        {ended ? null : (
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={() => act(() => dismissMeetingQAction(meetingId))}
          >
            Remove Q
          </Button>
        )}
      </div>
    );
  }

  // NONE, CANCELLED or FAILED.
  if (ended) {
    return status === "FAILED" && state.failure !== null ? (
      <p
        className="cq-caption text-(--cq-text-secondary)"
        data-meeting-q="FAILED"
      >
        {state.failure}
      </p>
    ) : null;
  }
  return (
    <div className="flex flex-col items-start gap-1" data-meeting-q={status}>
      <Button
        variant="secondary"
        size="compact"
        disabled={pending}
        onClick={() => act(() => bringMeetingQAction(meetingId, newKey()))}
      >
        {pending ? "Booking Q…" : "Bring Q to take notes"}
      </Button>
      {status === "FAILED" && state.failure !== null ? (
        <span className="cq-caption text-(--cq-text-secondary)">
          {state.failure}
        </span>
      ) : null}
      {message === null ? null : (
        <span className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
