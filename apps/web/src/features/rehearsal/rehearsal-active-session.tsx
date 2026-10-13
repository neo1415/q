"use client";

import { useState } from "react";
import type {
  QRehearsalDto,
  RehearsalVideoSessionDto,
} from "@capital-q/contracts";
import { RehearsalVideoStage } from "./rehearsal-video-stage";
import { RehearsalRoom } from "./rehearsal-room";

/** The existing canonical rehearsal URL can rejoin the same owned room. */
export function RehearsalActiveSession({
  rehearsal: initial,
  session: initialSession,
}: {
  readonly rehearsal: QRehearsalDto;
  readonly session: RehearsalVideoSessionDto | null;
}) {
  const [rehearsal, setRehearsal] = useState(initial);
  const [session, setSession] = useState(initialSession);
  return session === null ? (
    <RehearsalRoom initial={rehearsal} seeYou={false} />
  ) : (
    <RehearsalVideoStage
      rehearsal={rehearsal}
      session={session}
      onContinueByVoice={(open) => {
        setRehearsal(open);
        setSession(null);
      }}
    />
  );
}
