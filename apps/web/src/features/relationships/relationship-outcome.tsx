"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import type {
  PassReasonListDto,
  RelationshipPassResponseDto,
  RelationshipStateV2,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";

import {
  meetingOutcomeAction,
  passAction,
  passReasonsAction,
  pauseAction,
  readPassAction,
  resumeAction,
} from "./outcome-actions";
import type { RelationshipSide } from "./relationship-words";
import type { CallToRecord } from "./call-to-record";

/**
 * Where a match goes after a meeting (2026-10-02). The investor's side
 * decides: not proceeding for now (a button with a confirm), pausing, or
 * resuming. The reason for not proceeding is optional and stays the
 * investor's private note unless they tick "share this reason with the
 * founder" (founder decision (a)). The founder's side reads only a reason
 * that was shared. Every change is server-confirmed and the page re-read,
 * so the state shown is always the server's. Pass is neutral, not red.
 */

const DECIDING: ReadonlySet<RelationshipStateV2> = new Set([
  "CONNECTED",
  "MEETING_HELD",
  "IN_DILIGENCE",
  "PAUSED",
]);

function newKey(): string {
  return `web-pass-${crypto.randomUUID()}`;
}

export function RelationshipOutcome({
  call = null,
  ...props
}: {
  readonly relationshipId: string;
  readonly state: RelationshipStateV2;
  readonly side: RelationshipSide;
  readonly counterpart: string;
  /** A booked call that has ended on a still-CONNECTED match (no bot). */
  readonly call?: CallToRecord | null | undefined;
}) {
  // The notes notice links here (#outcome): "How did it go?" first.
  return (
    <div id="outcome" className="flex flex-col items-stretch gap-3">
      {props.state === "MEETING_HELD" ||
      (props.state === "CONNECTED" && call !== null) ? (
        <HowDidItGo
          relationshipId={props.relationshipId}
          meetingId={call?.meetingId}
        />
      ) : null}
      <SideOutcome {...props} />
    </div>
  );
}

const MEETING_OUTCOMES: readonly {
  readonly outcome:
    "DILIGENCE" | "FOLLOW_UP_MEETING" | "MATERIALS_REQUESTED" | "INTRODUCTIONS";
  readonly label: string;
}[] = [
  { outcome: "DILIGENCE", label: "Diligence starts" },
  { outcome: "FOLLOW_UP_MEETING", label: "We'll meet again" },
  { outcome: "MATERIALS_REQUESTED", label: "Materials asked for" },
  { outcome: "INTRODUCTIONS", label: "Introductions next" },
];

/**
 * Either side confirms what the call led to (PADL #130: Q proposes, the
 * person confirms). One press is their confirmation; it is recorded on
 * the relationship both sides read. Q asks the same in conversation.
 */
function HowDidItGo({
  relationshipId,
  meetingId,
}: {
  readonly relationshipId: string;
  /** Names the call: answering also marks it held (no bot needed). */
  readonly meetingId?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="cq-body-sm text-(--cq-text-secondary)">
        How did the call go? Record what was agreed.
      </p>
      {MEETING_OUTCOMES.map((option) => (
        <OutcomeButton
          key={option.outcome}
          label={option.label}
          busyLabel="Recording…"
          run={() =>
            meetingOutcomeAction(relationshipId, {
              outcome: option.outcome,
              ...(meetingId === undefined ? {} : { meetingId }),
            })
          }
        />
      ))}
    </div>
  );
}

function SideOutcome({
  relationshipId,
  state,
  side,
  counterpart,
}: {
  readonly relationshipId: string;
  readonly state: RelationshipStateV2;
  readonly side: RelationshipSide;
  readonly counterpart: string;
}) {
  if (side === "COMPANY") {
    return state === "PASSED" ? (
      <SharedPassReason relationshipId={relationshipId} />
    ) : null;
  }
  if (state === "PASSED") {
    return (
      <div className="flex flex-col gap-2">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          You decided not to proceed for now. {counterpart} only comes back to
          your Discover with something new: a new pitch, a new raise, or a
          change to your mandate.
        </p>
        <OutcomeButton
          label="Reconsider"
          busyLabel="Reopening…"
          primary
          run={() => resumeAction(relationshipId)}
        />
      </div>
    );
  }
  if (!DECIDING.has(state)) return null;
  return (
    <div className="flex flex-col items-stretch gap-2">
      {state === "PAUSED" ? (
        <OutcomeButton
          label="Resume"
          busyLabel="Resuming…"
          primary
          run={() => resumeAction(relationshipId)}
        />
      ) : (
        <OutcomeButton
          label="Pause for now"
          busyLabel="Pausing…"
          run={() => pauseAction(relationshipId)}
        />
      )}
      <PassDialog relationshipId={relationshipId} counterpart={counterpart} />
    </div>
  );
}

function OutcomeButton({
  label,
  busyLabel,
  run,
  primary = false,
}: {
  readonly label: string;
  readonly busyLabel: string;
  /** The way back from a pause or a pass is the next step, so it leads. */
  readonly primary?: boolean;
  readonly run: () => Promise<
    { readonly ok: true } | { readonly ok: false; readonly message: string }
  >;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant={primary ? "primary" : "secondary"}
        className="min-h-11"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void run().then((result) => {
            setBusy(false);
            if (result.ok) router.refresh();
            else setError(result.message);
          });
        }}
      >
        {busy ? busyLabel : label}
      </Button>
      {error === null ? null : (
        <p role="alert" className="cq-body-sm">
          {error}
        </p>
      )}
    </>
  );
}

function PassDialog({
  relationshipId,
  counterpart,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
}) {
  const router = useRouter();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<PassReasonListDto["items"]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per opening of the dialog: a retried press cannot pass twice.
  const [key, setKey] = useState(newKey);

  useEffect(() => {
    if (!open || reasons.length > 0) return;
    void passReasonsAction().then((result) => {
      if (result.ok) setReasons(result.value.items);
    });
  }, [open, reasons.length]);

  const trimmed = note.trim();
  const canShare = reason !== null || trimmed.length > 0;

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setKey(newKey());
      }}
    >
      <Button
        variant="secondary"
        className="min-h-11"
        onClick={() => setOpen(true)}
      >
        Not proceeding for now
      </Button>
      {open ? (
        <DialogContent
          title={`Not proceed with ${counterpart} for now?`}
          description={`${counterpart} is told you've decided not to proceed for now. A reason is optional and stays private to your organisation unless you share it.`}
          actions={
            <>
              <Button
                variant="secondary"
                className="min-h-11"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void passAction(
                    relationshipId,
                    {
                      reasonCode: reason,
                      note: trimmed.length === 0 ? null : trimmed,
                      shareWithFounder: share && canShare,
                    },
                    key,
                  ).then((result) => {
                    setBusy(false);
                    if (result.ok) {
                      setOpen(false);
                      router.refresh();
                    } else {
                      setError(result.message);
                    }
                  });
                }}
              >
                {busy ? "Saving…" : "Confirm"}
              </Button>
            </>
          }
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="cq-body-sm mb-1 text-(--cq-text-secondary)">
              Reason (optional)
            </legend>
            <div className="flex flex-wrap gap-2">
              {reasons.map((option) => (
                <label
                  key={option.code}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 hover:bg-(--cq-surface-subtle)"
                >
                  <input
                    type="radio"
                    name="pass-reason"
                    value={option.code}
                    checked={reason === option.code}
                    onChange={() => setReason(option.code)}
                    className="size-4 accent-(--cq-accent)"
                  />
                  <span className="cq-body">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label
            htmlFor={noteId}
            className="cq-body-sm mt-3 block text-(--cq-text-secondary)"
          >
            A note for your organisation (optional)
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={1000}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            className="cq-body mt-1 min-h-11 w-full resize-y rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 py-2 text-(--cq-text-primary)"
          />
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={share}
              disabled={!canShare}
              onChange={(event) => setShare(event.target.checked)}
              className="size-4 accent-(--cq-accent)"
            />
            <span className="cq-body">Share this reason with the founder</span>
          </label>
          {error === null ? null : (
            <p role="alert" className="mt-2">
              {error}
            </p>
          )}
        </DialogContent>
      ) : null}
    </DialogRoot>
  );
}

/** The founder's side: a reason appears only when the investor shared it. */
function SharedPassReason({
  relationshipId,
}: {
  readonly relationshipId: string;
}) {
  const [pass, setPass] = useState<RelationshipPassResponseDto["pass"]>(null);
  useEffect(() => {
    void readPassAction(relationshipId).then((result) => {
      if (result.ok) setPass(result.value.pass);
    });
  }, [relationshipId]);
  if (pass === null) return null;
  return (
    <p className="cq-body-sm text-(--cq-text-secondary)">
      {pass.reasonLabel === null
        ? "Their note"
        : `Their reason: ${pass.reasonLabel}`}
      {pass.note === null ? "." : ` — "${pass.note}"`}
    </p>
  );
}
