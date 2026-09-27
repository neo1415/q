"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type {
  CompanyNetworkFact,
  CompanyNetworkFactKey,
  CompanyNetworkFactStatement,
  EvidenceStatus,
  ExplanationFactorDto,
  LifecycleStatus,
  RecommendationExplanationDto,
  TruthClass,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { ChevronRight, CircleAlert, ICON_SIZE } from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { SourcesDisclosure } from "@/components/sources-disclosure";

import {
  browserFeedPositionStore,
  readStoredFeedSlateId,
} from "../discover/feed/feed-position";
import { countryLabel, stageLabel } from "./declared-labels";
import { explainRecommendationAction } from "./explanation-action";

/**
 * The Evidence / Q deeper view of a company (CQ-WEB-024; doc 17 §74-§78,
 * doc 18 §89).
 *
 * Two disclosures under the overview, closed until asked for: doc 17 §76
 * keeps provenance out of the normal view, and §74 wants intelligence
 * disclosed progressively rather than as a wall.
 *
 * Everything shown comes from the investor projection the server built
 * under the reader's own session, or from the Q API's explanation of the
 * reader's own slate. Nothing here filters: a fact this page could hide is
 * a fact it was never sent.
 *
 * The three ADR-001 axes are shown as three separate lines, never merged
 * into one badge, and each is said in words — meaning is never carried by
 * colour. Unknown is shown as unknown. Statements that disagree are shown
 * side by side, and neither is picked.
 */

const FACT_LABELS: Readonly<
  Record<
    CompanyNetworkFactKey,
    { readonly label: string; readonly noun: string }
  >
> = {
  currentStageCode: { label: "Stage", noun: "stage" },
  headquartersCountry: { label: "Country", noun: "headquarters country" },
  headquartersCity: { label: "City", noun: "headquarters city" },
  foundedDate: { label: "Founded", noun: "founding date" },
  legalName: { label: "Legal name", noun: "legal name" },
  websiteUrl: { label: "Website", noun: "website" },
};

const TRUTH_LABELS: Readonly<Record<TruthClass, string>> = {
  VERIFIED: "Verified",
  USER_CLAIM: "The company's own claim",
  ESTIMATE: "An estimate",
  Q_INFERENCE: "Q's inference",
  UNKNOWN: "Unknown",
};

const EVIDENCE_LABELS: Readonly<Record<EvidenceStatus, string>> = {
  NO_EVIDENCE: "No evidence",
  SELF_REPORTED: "Self-reported",
  DOCUMENT_SUPPORTED: "Supported by a document",
  MULTI_SOURCE_SUPPORTED: "Supported by more than one source",
  EXTERNALLY_VERIFIED: "Verified externally",
  PLATFORM_VERIFIED: "Verified by Capital Q",
};

const LIFECYCLE_LABELS: Readonly<Record<LifecycleStatus, string>> = {
  CURRENT: "Current",
  HISTORICAL: "Historical",
  SUPERSEDED: "Superseded",
  DISPUTED: "Disputed",
  CONTRADICTORY: "Contradicted",
  STALE: "May be out of date",
};

const SOURCE_LABELS: Readonly<
  Record<CompanyNetworkFactStatement["source"], string>
> = {
  COMPANY_PROFILE: "The company's profile",
};

/** Codes never reach a reader as codes ("pre_seed", "NG"). */
function displayValue(
  key: CompanyNetworkFactKey,
  statement: CompanyNetworkFactStatement,
): string {
  if (key === "currentStageCode") {
    return stageLabel(statement.value) ?? statement.value;
  }
  if (key === "headquartersCountry") {
    return countryLabel(statement.value) ?? statement.value;
  }
  return statement.value;
}

/**
 * The draft question a fact opens Q with. The person's to edit or send;
 * it restates only what this page already shows them.
 */
export function factQuestion(
  companyName: string,
  fact: CompanyNetworkFact,
): string {
  const { noun } = FACT_LABELS[fact.key];
  const [first, ...rest] = fact.statements;
  if (first === undefined) {
    return `${companyName} hasn't declared its ${noun}. What is known about it, and what would tell us?`;
  }
  if (rest.length > 0) {
    const stated = fact.statements
      .map((statement) => `"${displayValue(fact.key, statement)}"`)
      .join(" and ");
    return `${companyName}'s ${noun} is stated as ${stated}. Which is better supported, and what would settle it?`;
  }
  return `${companyName}'s ${noun} is given as "${displayValue(fact.key, first)}" — ${TRUTH_LABELS[first.truthClass].toLowerCase()}, ${EVIDENCE_LABELS[first.evidenceStatus].toLowerCase()}. How well supported is that, and what would confirm it?`;
}

export function CompanyDeeperView({
  companyId,
  companyName,
  facts,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly facts: readonly CompanyNetworkFact[];
}) {
  return (
    <div className="mt-4 flex flex-col">
      <WhyInYourFeed companyId={companyId} />
      {facts.length === 0 ? null : (
        <WhatIsKnown companyName={companyName} facts={facts} />
      )}
    </div>
  );
}

function Disclosure({
  title,
  onFirstOpen,
  children,
  ...data
}: {
  readonly title: string;
  readonly onFirstOpen?: (() => void) | undefined;
  readonly children: ReactNode;
  readonly "data-deeper-view": string;
}) {
  const opened = useRef(false);
  return (
    <details
      className="group border-t border-(--cq-border-subtle)"
      onToggle={(event) => {
        if (event.currentTarget.open && !opened.current) {
          opened.current = true;
          onFirstOpen?.();
        }
      }}
      {...data}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-(--cq-text-primary) [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={ICON_SIZE.regular}
          aria-hidden="true"
          className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        <h2 className="cq-title-sm">{title}</h2>
      </summary>
      <div className="flex flex-col gap-4 pb-6 pl-7">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Why this company is in the reader's feed
// ---------------------------------------------------------------------------

const noSubscription = () => () => undefined;

type Explanation =
  | { readonly status: "IDLE" }
  | { readonly status: "LOADING" }
  | { readonly status: "UNAVAILABLE" }
  | {
      readonly status: "EXPLAINED";
      readonly value: RecommendationExplanationDto;
    };

/**
 * Only reachable from the reader's own feed: the slate is the one the feed
 * remembered for this tab, read and never written, so Back still lands on
 * the same card. With no slate there is no recommendation to explain, and
 * the section is absent rather than empty.
 */
function WhyInYourFeed({ companyId }: { readonly companyId: string }) {
  const slateId = useSyncExternalStore(
    noSubscription,
    () => readStoredFeedSlateId(browserFeedPositionStore()),
    () => null,
  );
  const [explanation, setExplanation] = useState<Explanation>({
    status: "IDLE",
  });

  if (slateId === null) return null;

  const load = () => {
    setExplanation({ status: "LOADING" });
    void explainRecommendationAction(slateId, companyId).then(
      (result) => {
        setExplanation(
          result.kind === "EXPLAINED"
            ? { status: "EXPLAINED", value: result.value }
            : { status: "UNAVAILABLE" },
        );
      },
      () => setExplanation({ status: "UNAVAILABLE" }),
    );
  };

  return (
    <Disclosure
      title="Why it's in your feed"
      onFirstOpen={load}
      data-deeper-view="why"
    >
      {explanation.status === "IDLE" || explanation.status === "LOADING" ? (
        <p className="cq-status-line" role="status">
          Reading your recommendation…
        </p>
      ) : explanation.status === "UNAVAILABLE" ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          There is no recommendation to explain for this company right now. It
          may not be in your current feed.
        </p>
      ) : (
        <ExplanationBody explanation={explanation.value} />
      )}
    </Disclosure>
  );
}

function ExplanationBody({
  explanation,
}: {
  readonly explanation: RecommendationExplanationDto;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-primary)">
          {explanation.summary}
        </p>
        {explanation.source === "Q_SYNTHESIZED" ? (
          // Who chose the words, so no reader thinks a model decided the order.
          <p className="cq-caption text-(--cq-text-tertiary)">
            Worded by Q from the factors below. Q did not decide the order.
          </p>
        ) : null}
      </div>
      <Factors
        title="Matches your mandate"
        factors={explanation.matchedFactors}
      />
      <Factors title="Doesn't match" factors={explanation.mismatchedFactors} />
      <Factors
        title="Not known yet — not counted against it"
        factors={explanation.uncertainties}
      />
    </>
  );
}

function Factors({
  title,
  factors,
}: {
  readonly title: string;
  readonly factors: readonly ExplanationFactorDto[];
}) {
  if (factors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="cq-label text-(--cq-text-secondary)">{title}</h3>
      <ul className="flex flex-col gap-1">
        {factors.map((factor) => (
          <li
            key={`${factor.dimension}-${factor.reasonCode}`}
            className="cq-body-sm text-(--cq-text-primary)"
          >
            {factor.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// What is known, and how well supported
// ---------------------------------------------------------------------------

function WhatIsKnown({
  companyName,
  facts,
}: {
  readonly companyName: string;
  readonly facts: readonly CompanyNetworkFact[];
}) {
  const { askAbout } = useGlobalQ();
  return (
    <Disclosure
      title="What is known, and how well supported"
      data-deeper-view="evidence"
    >
      <p className="cq-body-sm max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
        Only what {companyName} has made visible to investors. Declared is not
        verified, and unknown is not a zero: a fact nobody has stated says
        nothing against the company.
      </p>
      <ul className="flex flex-col">
        {facts.map((fact) => (
          <FactRow
            key={fact.key}
            fact={fact}
            onAsk={() => askAbout(factQuestion(companyName, fact))}
          />
        ))}
      </ul>
    </Disclosure>
  );
}

function FactRow({
  fact,
  onAsk,
}: {
  readonly fact: CompanyNetworkFact;
  readonly onAsk: () => void;
}) {
  const { label } = FACT_LABELS[fact.key];
  const state =
    fact.statements.length === 0
      ? "unknown"
      : fact.statements.length === 1
        ? "stated"
        : "contradictory";
  return (
    <li
      className="flex flex-col gap-2 border-t border-(--cq-border-subtle) py-3 first:border-t-0"
      data-fact={fact.key}
      data-fact-state={state}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="cq-label text-(--cq-text-secondary)">{label}</h3>
        <Button
          variant="quiet"
          onClick={onAsk}
          aria-label={`Ask Q about ${label.toLowerCase()}`}
        >
          Ask Q about this
        </Button>
      </div>
      {state === "unknown" ? (
        <div className="flex flex-col gap-0.5">
          <p className="cq-body text-(--cq-text-primary)">Unknown</p>
          <p className="cq-caption text-(--cq-text-tertiary)">Not declared.</p>
        </div>
      ) : state === "stated" && fact.statements[0] !== undefined ? (
        <Statement factKey={fact.key} statement={fact.statements[0]} />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 cq-body-sm text-(--cq-text-primary)">
            <CircleAlert size={ICON_SIZE.compact} aria-hidden="true" />
            These disagree. Neither has been chosen over the other.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {fact.statements.map((statement, index) => (
              <div
                key={`${statement.value}-${String(index)}`}
                className="rounded-(--cq-radius-md) border border-(--cq-border-subtle) p-3"
              >
                <Statement factKey={fact.key} statement={statement} />
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

function Statement({
  factKey,
  statement,
}: {
  readonly factKey: CompanyNetworkFactKey;
  readonly statement: CompanyNetworkFactStatement;
}) {
  const axes: readonly (readonly [string, string, string])[] = [
    ["Claim", TRUTH_LABELS[statement.truthClass], statement.truthClass],
    [
      "Support",
      EVIDENCE_LABELS[statement.evidenceStatus],
      statement.evidenceStatus,
    ],
    [
      "Status",
      LIFECYCLE_LABELS[statement.lifecycleStatus],
      statement.lifecycleStatus,
    ],
    ["Source", SOURCE_LABELS[statement.source], statement.source],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="cq-body break-words text-(--cq-text-primary)">
        {displayValue(factKey, statement)}
      </p>
      <SourcesDisclosure>
        <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
          {axes.map(([term, value, code]) => (
            <div
              key={term}
              className="flex gap-1"
              data-axis={term.toLowerCase()}
              data-value={code}
            >
              <dt className="cq-caption text-(--cq-text-tertiary)">{term}</dt>
              <dd className="cq-caption text-(--cq-text-secondary)">{value}</dd>
            </div>
          ))}
        </dl>
      </SourcesDisclosure>
    </div>
  );
}
