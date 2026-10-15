"use client";

import { useState } from "react";

import type {
  ApplicationCoverageDto,
  QRehearsalDto,
  RehearsalVideoSessionDto,
} from "@capital-q/contracts";

import { GateqVideoRoom } from "@/features/gateq/gateq-video-room";
import { RehearsalRoom } from "@/features/rehearsal/rehearsal-room";
import { RehearsalVideoStage } from "@/features/rehearsal/rehearsal-video-stage";

const ID = "e0000000-0000-4000-8000-000000000001";

/** A fictional application's durable coverage, for the GateQ room. */
const COVERAGE: ApplicationCoverageDto = {
  coverage: {
    version: 1,
    access: "NEEDS_INFORMATION",
    unmet: [],
    stillNeeded: ["Stage"],
    answered: [
      {
        dimension: "company.description",
        label: "What the company does",
        group: "COMPANY",
        summary: "Metered water kiosks for informal settlements",
        provenance: "APPLICANT_PROVIDED",
      },
      {
        dimension: "claims.traction",
        label: "Traction",
        group: "TRACTION",
        summary: "12 kiosks live",
        provenance: "APPLICANT_PROVIDED",
      },
    ],
    unknown: [],
    declined: [],
    missing: [
      {
        dimension: "company.stage",
        label: "Stage",
        group: "COMPANY",
        reason: "REQUIRED_BY_GATEWAY",
      },
      {
        dimension: "raise.amount",
        label: "Raise size",
        group: "FUNDRAISING",
        reason: "UNDERSTANDING",
      },
    ],
    contradictions: [],
  },
  contact: { required: true, confirmed: true },
  documentCount: 0,
  transcriptTurns: 4,
};

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
  readonly view: "stage" | "room" | "gateq";
}) {
  // Read once, outside render: the room's own deadline.
  const [gateqEndsAt] = useState(() =>
    new Date(Date.now() + 600_000).toISOString(),
  );
  if (view === "room") return <RehearsalRoom initial={REHEARSAL} />;
  if (view === "gateq")
    return (
      <GateqVideoRoom
        fund="Voltron Capital (fictional)"
        session={{
          joinUrl: "about:blank",
          endsAt: gateqEndsAt,
          maxSeconds: 600,
          disclosure:
            "Q is an AI interviewer. This video interview is transcribed into your application.",
        }}
        coverage={COVERAGE}
        onEnd={() => Promise.resolve({})}
      />
    );
  return (
    <RehearsalVideoStage
      rehearsal={REHEARSAL}
      session={session()}
      onContinueByVoice={() => undefined}
    />
  );
}
