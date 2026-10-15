"use client";

import { useRouter } from "next/navigation";

import type {
  QRehearsalDto,
  RehearsalVideoSessionDto,
} from "@capital-q/contracts";

import { ProviderVideoRoom } from "@/features/video-room/provider-video-room";

import { endRehearsalVideoAction } from "./rehearsal-actions";

/**
 * The video rehearsal (ADR 0066) in Capital Q's shared video room. The
 * interviewer's every line comes from Q's rehearsal service on the server;
 * this page only shows the room, the disclosure, the time left, and the
 * way out. The three-minute cap is the server's.
 */
export function RehearsalVideoStage({
  rehearsal,
  session,
  onContinueByVoice,
}: {
  readonly rehearsal: Pick<QRehearsalDto, "id" | "counterpart" | "userRole">;
  readonly session: RehearsalVideoSessionDto;
  readonly onContinueByVoice: (rehearsal: QRehearsalDto) => void;
}) {
  const router = useRouter();
  const name = rehearsal.counterpart.name;
  return (
    <ProviderVideoRoom
      title={`Rehearsing with ${name}`}
      disclosure={session.disclosure}
      joinUrl={session.joinUrl}
      // The room asks for a name otherwise; the interviewer needs no more.
      participantName={
        rehearsal.userRole === "INVESTOR" ? "Investor" : "Founder"
      }
      tileLabel={`Video rehearsal with ${name} (AI interviewer)`}
      endsAt={session.endsAt}
      // Held at the full three minutes until the interviewer joins.
      clockStarted={session.liveAt !== null}
      maxSeconds={session.maxSeconds}
      endLabel="End and see my review"
      fallbackLabel="Carry on by voice instead"
      joiningNote={`${session.interviewer.name} is joining the room. Their video can take up to 20 seconds to appear.`}
      closingNote="Time is up. Q is saving your transcript and review."
      closingSoonNote="We’re closing shortly. Finish your last point; Q will save your transcript and review."
      unavailableNote={
        <>
          <p className="cq-body text-(--cq-stage-text)">
            This call can’t be rejoined from here.
          </p>
          <p className="cq-body-sm text-(--cq-stage-text-muted)">
            End it to see your review, or carry on by voice.
          </p>
        </>
      }
      footnote={`Video calls last up to ${String(Math.round(session.maxSeconds / 60))} minutes. Your camera and microphone go to the video room only while this call is open. This video room cannot speak over continuous speech to announce its closing; Q will attempt a spoken close on the next reply near the deadline. The room still ends at three minutes.`}
      onEnd={async (continueByVoice) => {
        const result = await endRehearsalVideoAction(
          rehearsal.id,
          continueByVoice,
        );
        if (!result.ok) return { message: result.message };
        if (continueByVoice && result.value.rehearsal.status === "ACTIVE") {
          onContinueByVoice(result.value.rehearsal);
          return {};
        }
        // The existing review page reads the finished rehearsal.
        router.push(`/rehearsals/r/${rehearsal.id}`);
        return {};
      }}
    />
  );
}
