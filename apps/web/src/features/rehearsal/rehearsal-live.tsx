"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  QRehearsalDto,
  RehearsalVideoSessionDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";

import { readRehearsalRoomAction } from "./rehearsal-actions";
import { RehearsalRoom } from "./rehearsal-room";
import { RehearsalVideoStage } from "./rehearsal-video-stage";

/** The durable room URL recovers the same owned rehearsal after refresh. */
export function RehearsalLive({
  initialRehearsal,
  initialVideo,
  expectsVideo = false,
}: {
  readonly initialRehearsal: QRehearsalDto;
  readonly initialVideo: RehearsalVideoSessionDto | null;
  readonly expectsVideo?: boolean | undefined;
}) {
  const router = useRouter();
  const [rehearsal, setRehearsal] = useState(initialRehearsal);
  const [video, setVideo] = useState(initialVideo);
  const [expectingVideo, setExpectingVideo] = useState(expectsVideo);
  const [gaveUp, setGaveUp] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const pendingEndsAt = video?.endsAt ?? null;
  const pending =
    (video === null && expectingVideo) ||
    (video?.status === "LIVE" && video.joinUrl === null);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Never poll past the existing cap, or beyond one minute if the
    // refresh happened before the allocation row was claimed.
    const deadline = Math.min(
      Date.now() + 60_000,
      pendingEndsAt === null ? Infinity : Date.parse(pendingEndsAt),
    );
    // Bound the UI even if an existing GET never settles. A late result
    // cannot reopen a room after recovery has exhausted its deadline.
    const stop = setTimeout(
      () => {
        live = false;
        setGaveUp(true);
      },
      Math.max(0, deadline - Date.now()),
    );
    const recover = async () => {
      if (Date.now() >= deadline) {
        if (live) setGaveUp(true);
        return;
      }
      const result = await readRehearsalRoomAction(rehearsal.id).catch(
        () => null,
      );
      if (!live) return;
      if (result?.ok) {
        setRehearsal(result.value.rehearsal);
        // An absent row while allocation is in flight is not evidence
        // for a new allocation or a silent switch into another room.
        if (result.value.video !== null) {
          setVideo(result.value.video);
          if (
            result.value.video.joinUrl !== null ||
            result.value.video.status === "ENDED"
          )
            return;
        }
      }
      timer = setTimeout(() => {
        void recover();
      }, 1_000);
    };
    timer = setTimeout(() => {
      void recover();
    }, 1_000);
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      clearTimeout(stop);
    };
  }, [pending, rehearsal.id, pendingEndsAt, recoveryAttempt]);

  if (pending)
    return (
      <section className="flex flex-col gap-4" aria-busy={!gaveUp}>
        <h1 className="cq-title-md">
          {gaveUp
            ? "We couldn't recover your video room."
            : "Recovering your video room…"}
        </h1>
        <p role="status" className="cq-body-sm">
          {gaveUp
            ? "Refresh to try again, or return to Rehearsals. Your existing call keeps its original time limit."
            : "We're checking the same rehearsal. Your original time limit stays the same."}
        </p>
        {gaveUp ? (
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setGaveUp(false);
                setRecoveryAttempt((attempt) => attempt + 1);
                router.refresh();
              }}
            >
              Refresh
            </Button>
            <Link href="/rehearsals" className={buttonClassName("secondary")}>
              Rehearsals
            </Link>
          </div>
        ) : null}
      </section>
    );

  if (video !== null && video.endedReason !== "CONTINUED_BY_VOICE") {
    return (
      <RehearsalVideoStage
        rehearsal={rehearsal}
        session={video}
        onContinueByVoice={(open) => {
          setExpectingVideo(false);
          setVideo(null);
          setRehearsal(open);
        }}
      />
    );
  }
  // Consent is not reconstructed from a URL or earlier browser state.
  return <RehearsalRoom initial={rehearsal} seeYou={false} />;
}
