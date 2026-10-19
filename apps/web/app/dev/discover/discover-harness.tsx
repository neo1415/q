"use client";

import { useState } from "react";

import type {
  DiscoveredCompanyDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";

import { FeedCard } from "@/features/discover/feed-card";
import type { FeedPreloadPolicy } from "@/features/discover/feed/feed-state";
import { PitchStage } from "@/features/discover/stage/pitch-stage";

function fictional(
  n: number,
  name: string,
  country: string,
  line: string,
): DiscoveredCompanyDto {
  return {
    companyId: `0000000${String(n)}-0000-4000-8000-0000000000d${String(n)}`,
    canonicalName: name,
    websiteUrl: null,
    headquartersCountry: country,
    currentStageCode: "SEED",
    shortDescription: line,
    reasons: [],
    reasonCodes: [
      "STAGE_ALIGNED",
      "GEOGRAPHY_COUNTRY_ALIGNED",
      "TAXONOMY_EXACT",
    ],
    summary: {
      sectorNodeIds: [],
      raise: {
        money: { amount: "1000000.00", currency: "USD" },
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      },
    },
    pitch: {
      mediaAssetId: `aaaaaaa${String(n)}-aaaa-4aaa-8aaa-aaaaaaaaaaa${String(n)}`,
      aspectRatio: "9:16",
      durationSeconds: 60,
      captionState: "AVAILABLE",
    },
  };
}

const COMPANIES: readonly DiscoveredCompanyDto[] = [
  fictional(
    1,
    "Watchly (fictional)",
    "GH",
    "Transaction fraud detection for banks and payment processors in Ghana.",
  ),
  fictional(
    2,
    "Halyard Security (fictional)",
    "GB",
    "Phishing-resistant passkeys for shared workstations in public services.",
  ),
  fictional(
    3,
    "Tensorgate (fictional)",
    "NG",
    "Inference scheduling that cuts GPU spend for African AI teams.",
  ),
];

/** A sample grant for a path the browser run answers; never a real pitch. */
function sampleGrant(mediaAssetId: string): Promise<PlaybackAuthorizationDto> {
  return Promise.resolve({
    mediaAssetId,
    playbackUrl: `/dev/discover/media/${mediaAssetId}.mp4`,
    posterUrl: `/dev/discover/media/${mediaAssetId}.jpg`,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
}

export function DiscoverHarness() {
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [decided, setDecided] = useState<string | null>(null);
  const card = COMPANIES[index];
  if (card === undefined) return null;
  const next = () => setIndex((at) => Math.min(COMPANIES.length - 1, at + 1));
  const previous = () => setIndex((at) => Math.max(0, at - 1));
  const policyFor = (companyId: string): FeedPreloadPolicy => {
    const at = COMPANIES.findIndex((item) => item.companyId === companyId);
    return at === index
      ? "ACTIVE"
      : Math.abs(at - index) === 1
        ? "METADATA"
        : "POSTER";
  };
  const save = (companyId: string) =>
    setSaved((current) => new Set([...current, companyId]));
  return (
    <div className="flex min-h-dvh flex-col bg-(--cq-canvas)">
      <span className="sr-only" data-harness-decided>
        {decided ?? ""}
      </span>
      <PitchStage
        items={COMPANIES}
        index={index}
        next={next}
        previous={previous}
        canAdvance={index < COMPANIES.length - 1}
        canRetreat={index > 0}
        policyFor={policyFor}
        sourceFor={() => sampleGrant}
        reducedMotion={false}
        hold={false}
        muted={muted}
        onMutedChange={setMuted}
        label="Companies to review"
        onDecide={(verdict) => {
          setDecided(`${verdict}:${card.companyId}`);
          if (verdict === "SAVE") save(card.companyId);
          next();
        }}
        overlay={({ openOptions }) => (
          <FeedCard
            key={card.companyId}
            company={card}
            policy="ACTIVE"
            reducedMotion={false}
            saved={saved.has(card.companyId)}
            deciding={false}
            onSave={() => save(card.companyId)}
            onPass={next}
            onAskQ={() => undefined}
            onMore={openOptions}
            showMedia={false}
          />
        )}
      />
    </div>
  );
}
