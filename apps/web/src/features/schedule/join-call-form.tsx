"use client";

import { useState, useTransition } from "react";

import type { MeetingDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";

import { joinCallAction } from "./schedule-actions";

/**
 * meet-47: "Have Q join a call" -- a Google Meet already running. One form
 * wherever the job is offered (the schedule controls, the relationship's
 * More menu), so the link rule (meet.google.com only) and the disclosure
 * are said the same way everywhere. Sending Q in is the approval: the
 * person pastes the exact call and presses the button.
 */
export function JoinCallForm({
  relationshipId,
  counterpart,
  onJoined,
  onCancel,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  /** Called with the meeting Q joined; without it the form says so itself. */
  readonly onJoined?: ((meeting: MeetingDto) => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
}) {
  const [link, setLink] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const join = () =>
    startTransition(async () => {
      setMessage(null);
      const joined = await joinCallAction({ relationshipId, meetLink: link });
      if (!joined.ok) {
        setMessage(joined.message);
        return;
      }
      setLink("");
      if (onJoined !== undefined) {
        onJoined(joined.value);
        return;
      }
      setMessage(JOINED_MESSAGE);
    });

  return (
    <form
      className="flex flex-col gap-2"
      data-join-call
      onSubmit={(event) => {
        event.preventDefault();
        join();
      }}
    >
      <Input
        id={`join-call-link-${relationshipId}`}
        label="Google Meet link"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://meet.google.com/abc-defg-hij"
        value={link}
        onChange={(event) => setLink(event.target.value)}
      />
      <p className="cq-caption text-(--cq-text-secondary)">
        Q joins as &quot;Q (Capital Q notes)&quot; to keep the record of this
        call for both sides, and says so when it joins. {counterpart} is told.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="secondary"
          disabled={pending || link.trim() === ""}
        >
          Send Q in
        </Button>
        {onCancel === undefined ? null : (
          <Button
            type="button"
            variant="quiet"
            disabled={pending}
            onClick={onCancel}
          >
            Not now
          </Button>
        )}
      </div>
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </form>
  );
}

export const JOINED_MESSAGE =
  'Q is on its way into the call. Admit "Q (Capital Q notes)" from the lobby.';
