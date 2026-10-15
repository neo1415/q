"use client";

import type {
  QRehearsalDto,
  RehearsalVideoSessionDto,
} from "@capital-q/contracts";

import { RehearsalRoom } from "@/features/rehearsal/rehearsal-room";
import { RehearsalVideoStage } from "@/features/rehearsal/rehearsal-video-stage";

const ID = "e0000000-0000-4000-8000-000000000001";

const REHEARSAL: QRehearsalDto = {
  id: ID,
  counterpart: {
    kind: "INVESTOR_ORGANISATION",
    id: "f0000000-0000-4000-8000-000000000001",
    name: "Voltron Capital (fictional)",
  },
  userRole: "FOUNDER",
  status: "ACTIVE",
  outcome: null,
  meetingId: null,
  voice: "MALE",
  difficulty: "REALISTIC",
  metrics: {
    yourShareOfWords: 0,
    longestAnswerWords: 0,
    exchanges: 0,
    minutes: 0,
  },
  previousScore: null,
  persona: { summary: "", style: "", priorities: [], grounding: "SOME" },
  turns: [],
  review: null,
  createdAt: "2026-10-13T00:00:00.000Z",
  endedAt: null,
};

function session(): RehearsalVideoSessionDto {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    rehearsalId: ID,
    interviewer: {
      id: "partner-steve",
      name: "Steve",
      style: "Calm",
      available: true,
    },
    status: "LIVE",
    // No provider room exists: the tile frames an empty document.
    joinUrl: "about:blank",
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 180_000).toISOString(),
    maxSeconds: 180,
    endedReason: null,
    disclosure:
      "AI rehearsal of Voltron Capital, played by Q with a stock AI face and voice. Not the real person.",
  };
}

export function RehearsalVideoHarness({
  view,
}: {
  readonly view: "stage" | "room";
}) {
  if (view === "room") return <RehearsalRoom initial={REHEARSAL} />;
  return (
    <RehearsalVideoStage
      rehearsal={REHEARSAL}
      session={session()}
      onContinueByVoice={() => undefined}
    />
  );
}
