"use client";

import { useRef, useState } from "react";

import {
  CompanyScoresDtoSchema,
  notAssessedInvestability,
  type CompanyScoresDto,
  type DiscoveredCompanyDto,
  type PlaybackAuthorizationDto,
} from "@capital-q/contracts";

import { GlobalQProvider } from "@/components/app-shell/global-q";
import { DossierQ } from "@/features/discover/dossier-q";
import { FeedCard } from "@/features/discover/feed-card";
import { QAperture } from "@/features/q-aperture";
import {
  EndOfSlate,
  FeedMomentToast,
  NO_TALLY,
  type FeedMoment,
  type FeedTally,
} from "@/features/discover/feed-moments";
import type { FeedPreloadPolicy } from "@/features/discover/feed/feed-state";
import { PitchStage } from "@/features/discover/stage/pitch-stage";
import type { ExpressInterestPort } from "@/features/network/express-interest";
import { NO_SUBJECT } from "@/features/q/q-subject";

const FINTECH = "a0000000-0000-4000-8000-000000000051";
const SECTORS: ReadonlyMap<string, string> = new Map([
  [FINTECH, "Financial services, Fintech"],
]);

function fictional(
  n: number,
  name: string,
  country: string,
  line: string,
  raise: string,
): DiscoveredCompanyDto {
  return {
    companyId: `0000000${String(n)}-0000-4000-8000-0000000000d${String(n)}`,
    canonicalName: name,
    websiteUrl: null,
    headquartersCountry: country,
    currentStageCode: "seed",
    shortDescription: line,
    reasons: [],
    reasonCodes: [
      "STAGE_ALIGNED",
      "GEOGRAPHY_COUNTRY_ALIGNED",
      "TAXONOMY_EXACT",
    ],
    summary: {
      sectorNodeIds: [FINTECH],
      raise: {
        money: { amount: raise, currency: "USD" },
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      },
    },
    unverifiedExclusions: n === 1 ? ["red_flag"] : [],
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
    "Transaction fraud detection for banks and payment processors in Ghana. Watchly scores transactions in real time with models trained on regional fraud patterns.",
    "1000000.00",
  ),
  fictional(
    2,
    "Halyard Security (fictional)",
    "GB",
    "Phishing-resistant passkeys for shared workstations in public services.",
    "3000000.00",
  ),
  fictional(
    3,
    "Tensorgate (fictional)",
    "NG",
    "Inference scheduling that cuts GPU spend for African AI teams.",
    "2500000.00",
  ),
  {
    ...fictional(
      4,
      "Kora Ledger (fictional)",
      "NG",
      "Bookkeeping for small businesses, built from their mobile-money statements.",
      "0",
    ),
    currentStageCode: "pre_seed",
    summary: { sectorNodeIds: [], raise: null },
    pitch: null,
  },
];

/** Sample reads, shaped as the server sends them; never a real company's. */
function sampleScores(
  company: DiscoveredCompanyDto,
  investability: number,
  suitability: number,
): CompanyScoresDto {
  return CompanyScoresDtoSchema.parse({
    companyId: company.companyId,
    investability: {
      ...notAssessedInvestability("investiq/v1+investability-inputs.v1"),
      status: "SCORED",
      score: investability,
      band: "DEVELOPING",
      confidence: "LOW",
      cappedByConfidence: true,
      coverage: {
        areasScored: 5,
        areasTotal: 8,
        criteriaScored: 12,
        criteriaApplicable: 48,
      },
      stage: "Seed",
      up: [{ label: "Traction", detail: "Dated traction · founder-stated" }],
      down: [],
      missing: ["Governance: board and reporting arrangements"],
      assessedAt: "2026-10-16T12:00:00.000Z",
    },
    suitability: {
      status: "SCORED",
      score: suitability,
      band: "GOOD_FIT",
      confidence: "MEDIUM",
      coverage: { known: 4, applicable: 7 },
      up: [{ label: "Stage", detail: "Their stage is one you invest at." }],
      down: [],
      missing: ["Traction: not known yet"],
      configVersion: "ranking-config.v4",
    },
    // Not assessed: an assessed one carries all twelve pillars, which a
    // sample has no honest values for.
    unicornPotential: {
      status: "NOT_ASSESSED",
      overallScore: null,
      band: null,
      confidence: "LOW",
      coverage: 0,
      stage: null,
      methodVersion: "unicorn-potential.v1.0.0",
      inputRulesVersion: "unicorn-inputs.v1",
      assessedAt: null,
      pillars: [],
      up: [],
      down: [],
      missing: [],
      momentum: null,
      benchmark: "Comparable benchmark unavailable",
    },
  });
}

const [WATCHLY, HALYARD, TENSORGATE, KORA] = COMPANIES;
const SCORES: ReadonlyMap<string, CompanyScoresDto> = new Map(
  [
    WATCHLY === undefined ? null : sampleScores(WATCHLY, 54, 85),
    HALYARD === undefined ? null : sampleScores(HALYARD, 62, 71),
    TENSORGATE === undefined ? null : sampleScores(TENSORGATE, 47, 66),
    KORA === undefined ? null : sampleScores(KORA, 41, 71),
  ]
    .filter((scores): scores is CompanyScoresDto => scores !== null)
    .map((scores) => [scores.companyId, scores]),
);

/** A sample grant for a path the browser run answers; never a real pitch. */
function sampleGrant(mediaAssetId: string): Promise<PlaybackAuthorizationDto> {
  return Promise.resolve({
    mediaAssetId,
    playbackUrl: `/dev/discover/media/${mediaAssetId}.mp4`,
    posterUrl: `/dev/discover/media/${mediaAssetId}.jpg`,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
}

/** Interest confirmed after a moment, as the server would; nothing is sent. */
const sampleInterest: ExpressInterestPort = ({ companyId }) =>
  new Promise((settle) => {
    window.setTimeout(
      () =>
        settle({
          ok: true,
          value: {
            interest: {
              interestId: "22222222-2222-4222-8222-222222222222",
              relationshipId: "33333333-3333-4333-8333-333333333333",
              companyId,
              status: "EXPRESSED",
              expressedAt: new Date().toISOString(),
              response: "PENDING",
              respondedAt: null,
              connection: null,
            },
            deduplicated: false,
          },
        }),
      700,
    );
  });

/** Every hard rule checked: no "can't be checked yet" line (the Q Story). */
const ALL_CHECKED: readonly DiscoveredCompanyDto[] = COMPANIES.map(
  (company) => ({ ...company, unverifiedExclusions: [] }),
);

export function DiscoverHarness({
  allRulesChecked = false,
}: {
  readonly allRulesChecked?: boolean;
}) {
  return (
    <GlobalQProvider subject={NO_SUBJECT} connected={false}>
      <Feed companies={allRulesChecked ? ALL_CHECKED : COMPANIES} />
    </GlobalQProvider>
  );
}

function Feed({
  companies,
}: {
  readonly companies: readonly DiscoveredCompanyDto[];
}) {
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [decided, setDecided] = useState<string | null>(null);
  const [moment, setMoment] = useState<FeedMoment | null>(null);
  const momentCount = useRef(0);
  const [tally, setTally] = useState<FeedTally>(NO_TALLY);
  const [ended, setEnded] = useState(false);
  const [interestAsked, setInterestAsked] = useState(0);
  const card = companies[index];
  if (card === undefined) return null;
  const last = index === companies.length - 1;
  const moveOn = () => {
    if (last) setEnded(true);
    else setIndex(index + 1);
  };
  const previous = () => setIndex((at) => Math.max(0, at - 1));
  const policyFor = (companyId: string): FeedPreloadPolicy => {
    const at = companies.findIndex((item) => item.companyId === companyId);
    return at === index
      ? "ACTIVE"
      : Math.abs(at - index) === 1
        ? "METADATA"
        : "POSTER";
  };
  const note = (kind: FeedMoment["kind"]) => {
    momentCount.current += 1;
    setMoment({
      kind,
      id: momentCount.current,
      companyId: card.companyId,
      companyName: card.canonicalName,
    });
  };
  const save = () => {
    if (saved.has(card.companyId)) return;
    setSaved((current) => new Set([...current, card.companyId]));
    setTally((was) => ({ ...was, saved: was.saved + 1 }));
    note("SAVED");
  };
  const pass = () => {
    setDecided(`PASS:${card.companyId}`);
    setTally((was) => ({ ...was, passed: was.passed + 1 }));
    note("PASSED");
    moveOn();
  };
  const toast = (
    <FeedMomentToast
      moment={moment}
      onUndoPass={(companyId) => {
        setTally((was) => ({ ...was, passed: Math.max(0, was.passed - 1) }));
        setEnded(false);
        setIndex(companies.findIndex((item) => item.companyId === companyId));
      }}
      onUndoSave={(companyId) => {
        setSaved((current) => {
          const next = new Set(current);
          next.delete(companyId);
          return next;
        });
        setTally((was) => ({ ...was, saved: Math.max(0, was.saved - 1) }));
      }}
      onPassReason={(companyId, reason) =>
        setDecided(`PASS:${companyId}:${reason}`)
      }
      onDone={() => setMoment(null)}
    />
  );
  return (
    <div className="flex min-h-dvh flex-col bg-(--cq-canvas)">
      <span className="sr-only" data-harness-decided>
        {decided ?? ""}
      </span>
      <PitchStage
        items={companies}
        index={index}
        next={() => setIndex((at) => Math.min(companies.length - 1, at + 1))}
        previous={previous}
        canAdvance={!last}
        canRetreat={index > 0}
        policyFor={policyFor}
        sourceFor={() => sampleGrant}
        reducedMotion={false}
        hold={false}
        muted={muted}
        onMutedChange={setMuted}
        label="Companies to review"
        positionLabel={`${String(index + 1)} of ${String(companies.length)}`}
        onDecide={(verdict) => {
          if (verdict === "INTEREST") {
            setDecided(`INTEREST:${card.companyId}`);
            setInterestAsked((n) => n + 1);
          } else {
            pass();
          }
        }}
        ending={
          ended ? (
            <>
              <EndOfSlate tally={tally} onBack={() => setEnded(false)} />
              {toast}
            </>
          ) : null
        }
        overlay={({ openOptions }) => (
          <>
            <FeedCard
              key={card.companyId}
              company={card}
              policy="ACTIVE"
              reducedMotion={false}
              saved={saved.has(card.companyId)}
              deciding={false}
              onSave={save}
              onPass={pass}
              onAskQ={() => undefined}
              askQMark={<QAperture state="IDLE" size={24} />}
              askPanel={<DossierQ companyName={card.canonicalName} />}
              onMore={openOptions}
              showMedia={false}
              initialScores={SCORES}
              sectorLabels={SECTORS}
              interestRequest={interestAsked}
              expressInterest={sampleInterest}
              onInterestConfirmed={() => {
                setTally((was) => ({ ...was, interest: was.interest + 1 }));
                note("INTEREST");
              }}
            />
            {toast}
          </>
        )}
      />
    </div>
  );
}
