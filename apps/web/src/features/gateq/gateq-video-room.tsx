"use client";

import type { ApplicationCoverageDto } from "@capital-q/contracts";

import { ProviderVideoRoom } from "@/features/video-room/provider-video-room";

import { CoveragePanel } from "./coverage-panel";

/**
 * The GateQ video interview in Capital Q's shared video room (directive
 * C3): the provider's tile, our disclosure and time limit, and beside it
 * the same durable "What we have / What's still needed" the typed interview
 * shows. Typing is always the fallback; it continues the SAME canonical
 * interview, so nothing said by video is lost or asked twice.
 *
 * Not reachable in production yet: there is no server GateQ video session
 * (allocation, bridge into the canonical interviewer, transcript to facts)
 * and paid video is off. Shown only on the dev harness until that exists
 * behind its own config flag.
 */
export type GateqVideoSession = {
  readonly joinUrl: string | null;
  readonly endsAt: string;
  /** Null while Q is still joining; absent from an older server. */
  readonly liveAt?: string | null | undefined;
  readonly maxSeconds: number;
  readonly disclosure: string;
};

export function GateqVideoRoom({
  fund,
  session,
  coverage,
  participantName = "",
  onEnd,
}: {
  readonly fund: string;
  readonly session: GateqVideoSession;
  /** The applicant's contact name, shown to the interviewer in the room. */
  readonly participantName?: string;
  readonly coverage: ApplicationCoverageDto | null;
  /** `typed` true: continue the same interview by typing. */
  readonly onEnd: (typed: boolean) => Promise<{ readonly message?: string }>;
}) {
  return (
    <ProviderVideoRoom
      title={`Your interview for ${fund}`}
      disclosure={session.disclosure}
      joinUrl={session.joinUrl}
      participantName={participantName}
      tileLabel={`Video interview for ${fund} (Q, an AI interviewer)`}
      endsAt={session.endsAt}
      clockStarted={session.liveAt !== null}
      maxSeconds={session.maxSeconds}
      endLabel="End and review my application"
      fallbackLabel="Continue by typing instead"
      joiningNote={
        "Q is joining the room. Its video can take up to 20 seconds to appear."
      }
      closingNote="Time is up. Your answers so far are saved; you can continue by typing."
      closingSoonNote="We’re closing shortly. Finish your point; everything recorded so far is saved."
      unavailableNote={
        <>
          <p className="cq-body text-(--cq-stage-text)">
            The video room isn’t available right now.
          </p>
          <p className="cq-body-sm text-(--cq-stage-text-muted)">
            Continue by typing; your interview carries on where it is.
          </p>
        </>
      }
      footnote="Q is an AI interviewer. Your camera and microphone go to the video room only while it is open. What you say is transcribed into this application; nothing is sent to the investor until you review and submit."
      aside={
        coverage === null ? undefined : (
          <CoveragePanel coverage={coverage} fund={fund} />
        )
      }
      onEnd={onEnd}
    />
  );
}
