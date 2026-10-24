import type { ReactNode } from "react";
import Link from "next/link";

import type {
  ConnectionStatusDto,
  DiscoveredInvestorProfileDto,
  DiscoveryReasonDto,
  PublishedFitDto,
  InvestorGateFitDto,
  PublicCardDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  ArrowLeft,
  CircleHelp,
  DoorOpen,
  ExternalLink,
  Globe,
  ShieldCheck,
  X,
} from "@capital-q/ui/icons";

import { formatDay } from "@/components/date-format";
import { countryLabel, stageLabel } from "@/features/company/declared-labels";
import { serverT } from "@/features/i18n/server";
import { connectCta } from "@/features/network/connect-cta";
import { DraftFill } from "@/features/q-pitch/founder/draft-fill";
import { QControl } from "@/features/q/control/q-control";
import { STATE_WORDS } from "@/features/relationships/relationship-words";

import { InvestorActions } from "./investor-actions";
import { deploymentLabel, investorTypeLabel } from "./investor-labels";
import { InvestorTabs } from "./investor-tabs";
import { criterionWords, draftHref } from "./looks-for";
import {
  LogoTile,
  MatchMark,
  MATCH_WORDS,
  Tick,
  type MatchState,
} from "./match-marks";
import {
  DIMENSION_WORDS,
  MATCH_DIMENSIONS,
  REACH_WORDS,
  dimensionMatches,
  publishedMandate,
  reachOf,
  type MatchDimension,
  type PublishedMandate,
} from "./published-focus";

/**
 * One investor as a founder may see them (app prototype "investor",
 * option 2, "Tabbed: overview, looks for, gate"), from reads the route
 * already made under the founder's own session (see
 * app/(app)/investors/[investorOrganisationId]/page.tsx). Rendering is
 * kept apart from reading so the design review (/dev/discovery-review)
 * shows this exact tree with fictional reads.
 */

/** The company's own form prefill for the gate tab; null when not read. */
export type InvestorGatePrefill = {
  readonly companyName: string;
  readonly oneLiner: string | null;
  readonly stageCode: string | null;
  readonly country: string | null;
};

export type InvestorProfileReads = {
  readonly investor: DiscoveredInvestorProfileDto;
  /** Where the founder's company stands with them; null when not read. */
  readonly status: ConnectionStatusDto | null;
  /** Their Q Card as a participant reads it; null when none or not read. */
  readonly card: PublicCardDto | null;
  readonly gate: InvestorGateFitDto | null;
  /** Discover's public-profile reasons for this investor. */
  readonly reasons: readonly DiscoveryReasonDto[];
  /** QO-42: their card against the founder's own company; absent: not read. */
  readonly publishedFit?: PublishedFitDto | undefined;
  /** The founder's own canonical relationship with them, if any. */
  readonly record:
    Pick<RelationshipSummaryDto, "state" | "nextStep"> | undefined;
  readonly prefill: InvestorGatePrefill | null;
};

export async function InvestorProfile({
  reads,
  tab: tabParam,
}: {
  readonly reads: InvestorProfileReads;
  /** `?tab=`: the tab to open first. */
  readonly tab?: string | string[] | undefined;
}) {
  const t = await serverT();
  const { investor, status, card, gate, reasons, record, prefill } = reads;
  const id = investor.investorOrganisationId;
  const mandate = publishedMandate(card);
  const matches = dimensionMatches(gate, reasons, reads.publishedFit);
  const cta = connectCta(record);
  const recordHref = `/relationships/investor/${encodeURIComponent(id)}`;
  const where = countryLabel(investor.hqCountry);
  const deployment = deploymentLabel(investor.deploymentState);
  const type = investorTypeLabel(investor.investorType);
  const reach = reachOf(investor.inboundPreference, gate);

  const overview = (
    <>
      <Glance
        t={t}
        cells={[
          [t("Based in"), where],
          [
            t("Stage focus"),
            mandate.stages.length === 0 ? null : mandate.stages.join(", "),
          ],
          [t("Typical cheque"), mandate.cheque],
          [t("Deploying"), deployment === null ? null : t(deployment)],
        ]}
      />
      <div data-qp-anchor="fdr.04.investor.looks-for">
        <MatchesCard t={t} matches={matches} gate={gate} />
      </div>
      <Card title={t("Reaching them")}>
        <p className="text-[15px] leading-[1.55] text-(--cq-text-primary)">
          {t(REACH_WORDS[reach])}.{" "}
          <span className="text-(--cq-text-secondary)">
            {reach === "GATE"
              ? t("They take applications through their gate.")
              : reach === "OPEN"
                ? t("Any founder who can see them can ask to connect.")
                : reach === "QUALIFIED"
                  ? t(
                      "Only companies that meet the criteria they set can send a request.",
                    )
                  : reach === "CLOSED"
                    ? t("They aren’t taking requests from founders right now.")
                    : t("They haven’t said how founders can reach them.")}
          </span>
        </p>
        <History t={t} status={status} recordState={record?.state ?? null} />
      </Card>
      <Card title={t("People")}>
        <Unknown>{t("They haven’t listed their team on Capital Q.")}</Unknown>
      </Card>
      <Sources t={t} websiteUrl={investor.websiteUrl} card={card} />
    </>
  );

  const looksFor = (
    <>
      <QControl id="section.about" kind="SECTION">
        <Card title={t("What this investor looks for")}>
          {investor.publicDescription === null ? (
            <Unknown>
              {t("They haven’t written about their focus yet.")}
            </Unknown>
          ) : (
            <p className="text-[15px] leading-[1.55] whitespace-pre-line text-(--cq-text-primary)">
              {investor.publicDescription}
            </p>
          )}
          {mandate.sectors.length === 0 ? null : (
            <div className="flex flex-wrap gap-2">
              {mandate.sectors.map((sector) => (
                <span
                  key={sector}
                  className="inline-flex min-h-[30px] items-center rounded-full border border-(--cq-border) bg-(--cq-surface-raised) px-2.5 text-[13px] text-(--cq-text-secondary)"
                >
                  {sector}
                </span>
              ))}
            </div>
          )}
          <Exclusions t={t} gate={gate} />
        </Card>
      </QControl>
      <Card title={t("Cheque size")}>
        {mandate.cheque === null ? (
          <Unknown>{t("Not on their profile yet")}</Unknown>
        ) : (
          <p className="text-[15px] leading-[1.55] text-(--cq-text-primary)">
            {mandate.cheque}
            {mandate.stages.length === 0
              ? "."
              : `, ${t("at")} ${mandate.stages.join(", ")}.`}
          </p>
        )}
      </Card>
      <PublishedFocus t={t} mandate={mandate} />
    </>
  );

  const gateTab = (
    <GateTab
      t={t}
      gate={gate}
      investorName={investor.displayName}
      href={draftHref(gate)}
      prefill={prefill}
    />
  );

  return (
    <div className="flex flex-col">
      <Link
        href="/discover"
        className="cq-body-sm inline-flex min-h-10 items-center gap-1.5 self-start text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {t("Investors")}
      </Link>
      <QControl id="section.investor-actions" kind="SECTION">
        <div data-qp-anchor="fdr.04.investor.hero">
          <div className="mt-1 mb-[18px] flex items-center gap-4 max-sm:items-start">
            <LogoTile
              kind="investor"
              name={investor.displayName}
              src={investor.photoUrl ?? null}
              investorOrganisationId={id}
              size={52}
              className="max-sm:size-10!"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-[23px] leading-tight font-semibold tracking-[-0.02em] text-(--cq-text-primary) sm:text-[28px]">
                {investor.displayName}
              </h1>
              <p className="mt-0.5 text-sm text-(--cq-text-secondary)">
                {[t(type), deployment === null ? null : t(deployment), where]
                  .filter((part): part is string => part !== null)
                  .join(". ")}
                .
              </p>
            </div>
          </div>
          <QControl id="section.connect" kind="SECTION">
            <InvestorActions
              investorOrganisationId={id}
              investorName={investor.displayName}
              photoUrl={investor.photoUrl ?? null}
              lead={
                cta.kind === "OPEN"
                  ? "OPEN"
                  : cta.kind === "ANSWER"
                    ? "ANSWER"
                    : "REQUEST"
              }
              recordHref={recordHref}
              rehearseHref={`/rehearsals/investor/${encodeURIComponent(id)}`}
            />
          </QControl>
        </div>
      </QControl>
      <QControl id="section.mandate" kind="SECTION">
        <InvestorTabs
          label={investor.displayName}
          initial={typeof tabParam === "string" ? tabParam : undefined}
          tabs={[
            { key: "overview", label: t("Overview"), panel: overview },
            {
              key: "looks-for",
              label: t("What they look for"),
              panel: looksFor,
            },
            { key: "gate", label: t("Their gate"), panel: gateTab },
          ]}
        />
      </QControl>
    </div>
  );
}

type T = (english: string) => string;

function Card({
  title,
  icon,
  children,
  ...rest
}: {
  readonly title: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
} & { readonly [data: `data-${string}`]: string | undefined }) {
  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]"
      {...rest}
    >
      <h2 className="flex items-center gap-2 text-[13px] font-medium text-(--cq-text-secondary)">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Unknown stays unknown: a dashed ring and the honest words. */
function Unknown({ children }: { readonly children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[13px] text-(--cq-text-tertiary)"
      data-unknown
    >
      <span
        aria-hidden="true"
        className="size-2.5 flex-none rounded-full border-[1.5px] border-dashed border-(--cq-text-tertiary)"
      />
      {children}
    </span>
  );
}

function Glance({
  t,
  cells,
}: {
  readonly t: T;
  readonly cells: readonly (readonly [string, string | null])[];
}) {
  return (
    <div
      className="grid grid-cols-2 overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) sm:grid-cols-4"
      data-qp-anchor="fdr.04.investor.facts"
    >
      {cells.map(([label, value], at) => (
        <div
          key={label}
          className={cx(
            "flex min-w-0 flex-col gap-[3px] px-4 py-3.5",
            at % 2 === 1 ? "border-s border-(--cq-border-subtle)" : "",
            at >= 2 ? "max-sm:border-t max-sm:border-(--cq-border-subtle)" : "",
            at === 2 ? "sm:border-s sm:border-(--cq-border-subtle)" : "",
          )}
        >
          <span className="cq-caption text-(--cq-text-tertiary)">{label}</span>
          {value === null ? (
            <Unknown>{t("Not published")}</Unknown>
          ) : (
            <b className="text-[15px] font-semibold text-(--cq-text-primary)">
              {value}
            </b>
          )}
        </div>
      ))}
    </div>
  );
}

const MATCH_EXPLAINED: Readonly<
  Record<MatchDimension, Readonly<Record<MatchState, string>>>
> = {
  STAGE: {
    ok: "Your stage is within what they publish.",
    part: "Your stage meets some of their published stage rules.",
    no: "Your stage is outside what they publish.",
    unk: "Add your stage to your profile, or they haven’t published one.",
  },
  SECTOR: {
    ok: "Your sector is within what they publish, and not one they exclude.",
    part: "Your sector meets some of their published sector rules.",
    no: "Your sector is outside what they publish.",
    unk: "Add your sectors to your profile, or they haven’t published theirs.",
  },
  GEOGRAPHY: {
    ok: "Where you are based is within what they publish.",
    part: "Where you are based meets some of their published rules.",
    no: "Where you are based is outside what they publish.",
    unk: "Add where you are based to your profile, or they haven’t published it.",
  },
};

function MatchesCard({
  t,
  matches,
}: {
  readonly t: T;
  readonly matches: Readonly<Record<MatchDimension, MatchState>>;
  readonly gate: InvestorGateFitDto | null;
}) {
  return (
    <Card title={t("Where their public profile matches you")}>
      <div className="flex flex-col gap-2.5">
        {MATCH_DIMENSIONS.map((dimension) => (
          <div
            key={dimension}
            className="flex items-start gap-2.5 text-sm"
            data-match={matches[dimension]}
          >
            <span className="mt-px">
              <MatchMark state={matches[dimension]} />
            </span>
            <span className="min-w-0">
              <b className="font-semibold text-(--cq-text-primary)">
                {t(DIMENSION_WORDS[dimension])}
              </b>
              <span className="sr-only">
                : {t(MATCH_WORDS[matches[dimension]])}.
              </span>
              <br />
              <span className="text-[13px] text-(--cq-text-tertiary)">
                {t(MATCH_EXPLAINED[dimension][matches[dimension]])}
              </span>
            </span>
          </div>
        ))}
      </div>
      <span className="cq-caption text-(--cq-text-tertiary)">
        {t(
          "From their public profile and their published GateQ criteria only.",
        )}
      </span>
    </Card>
  );
}

/** The founder's own history with them: their record and their request. */
function History({
  t,
  status,
  recordState,
}: {
  readonly t: T;
  readonly status: ConnectionStatusDto | null;
  readonly recordState: keyof typeof STATE_WORDS | null;
}) {
  const request = status?.request ?? null;
  const lines: string[] = [];
  if (recordState !== null) {
    lines.push(`${t("In your CRM:")} ${t(STATE_WORDS[recordState])}.`);
  }
  if (request !== null) {
    lines.push(
      request.response === "PENDING"
        ? `${t("You sent a request")} ${formatDay(request.requestedAt)}; ${t("no answer yet.")}`
        : request.response === "ACCEPTED"
          ? `${t("They accepted your request")} ${formatDay(request.respondedAt ?? request.requestedAt)}.`
          : `${t("They didn’t take your request forward")} ${formatDay(request.respondedAt ?? request.requestedAt)}.`,
    );
  }
  return (
    <div className="flex flex-col gap-1 border-t border-(--cq-border-subtle) pt-3">
      <span className="cq-caption text-(--cq-text-tertiary)">
        {t("Your history with them")}
      </span>
      {lines.length === 0 ? (
        <Unknown>
          {t("Nothing yet: no request, no record in your CRM.")}
        </Unknown>
      ) : (
        lines.map((line) => (
          <p key={line} className="text-sm text-(--cq-text-primary)">
            {line}
          </p>
        ))
      )}
    </div>
  );
}

const VERIFIED_WORDS: Readonly<Record<string, string>> = {
  ORGANISATION_VERIFIED: "Organisation verified by Capital Q",
  FOUNDER_IDENTITY_VERIFIED: "Identity verified by Capital Q",
};

function Sources({
  t,
  websiteUrl,
  card,
}: {
  readonly t: T;
  readonly websiteUrl: string | null;
  readonly card: PublicCardDto | null;
}) {
  const verified = (card?.verified ?? []).filter(
    (label) => !(card?.demoAttested ?? []).includes(label),
  );
  const demo = card?.demoAttested ?? [];
  return (
    <Card title={t("What they publish")}>
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex items-center gap-2">
          <Globe
            size={16}
            aria-hidden="true"
            className="flex-none text-(--cq-text-tertiary)"
          />
          {websiteUrl === null ? (
            <Unknown>{t("No website on their profile")}</Unknown>
          ) : (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 break-all text-(--cq-text-primary) underline underline-offset-4"
            >
              {websiteUrl.replace(/^https?:\/\//iu, "").replace(/\/$/u, "")}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid size-4 flex-none place-items-center rounded-full border-[1.6px] border-current text-[9px] leading-none font-semibold text-(--cq-text-tertiary)"
          >
            Q
          </span>
          {card === null ? (
            <Unknown>{t("No Q Card yet")}</Unknown>
          ) : (
            <Link
              href={`/@${card.handle}`}
              className="text-(--cq-text-primary) underline underline-offset-4"
            >
              {t("Their Q Card")} @{card.handle}
            </Link>
          )}
        </li>
        {verified.map((label) => (
          <li key={label} className="flex items-center gap-2">
            <ShieldCheck
              size={16}
              aria-hidden="true"
              className="flex-none text-(--cq-positive)"
            />
            {t(VERIFIED_WORDS[label] ?? label)}
          </li>
        ))}
        {demo.length === 0 ? null : (
          <li className="cq-caption text-(--cq-text-tertiary)">
            {t(
              "A demo attestation, not a real-world check by Capital Q, is on their card.",
            )}
          </li>
        )}
      </ul>
      <span className="cq-caption text-(--cq-text-tertiary)">
        {t(
          "Their portfolio, private thesis and activity aren’t shared with founders on Capital Q.",
        )}
      </span>
    </Card>
  );
}

function Exclusions({
  t,
  gate,
}: {
  readonly t: T;
  readonly gate: InvestorGateFitDto | null;
}) {
  const excluded = (gate?.criteria ?? [])
    .filter((criterion) => criterion.dimension === "EXCLUDED_TAXONOMY")
    .map((criterion) => criterion.label);
  if (excluded.length === 0) return null;
  return (
    <span className="cq-caption text-(--cq-text-tertiary)">
      {t("Their gate excludes:")} {excluded.join("; ")}.
    </span>
  );
}

function PublishedFocus({
  t,
  mandate,
}: {
  readonly t: T;
  readonly mandate: PublishedMandate;
}) {
  const rows: readonly (readonly [string, readonly string[]])[] = [
    [t("Stages"), mandate.stages],
    [t("Sectors"), mandate.sectors],
    [t("Geographies"), mandate.geographies],
    [t("Business models"), mandate.businessModels],
    [t("Customer types"), mandate.customerTypes],
    [t("In founders and companies"), mandate.lookFor],
  ];
  return (
    <Card title={t("Their published focus")}>
      <dl className="flex flex-col">
        {rows.map(([label, values]) => (
          <div
            key={label}
            className="grid grid-cols-1 gap-1 border-t border-(--cq-border-subtle) py-2.5 first:border-t-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="text-[13px] text-(--cq-text-secondary)">{label}</dt>
            <dd className="text-sm text-(--cq-text-primary)">
              {values.length === 0 ? (
                <Unknown>{t("Not published")}</Unknown>
              ) : (
                values.join(", ")
              )}
            </dd>
          </div>
        ))}
      </dl>
      <span className="cq-caption text-(--cq-text-tertiary)">
        {t(
          "From the investor’s own Q Card: only what they chose to publish to people on Capital Q.",
        )}
      </span>
    </Card>
  );
}

function GateTab({
  t,
  gate,
  investorName,
  href,
  prefill,
}: {
  readonly t: T;
  readonly gate: InvestorGateFitDto | null;
  readonly investorName: string;
  readonly href: string | null;
  readonly prefill: {
    readonly companyName: string;
    readonly oneLiner: string | null;
    readonly stageCode: string | null;
    readonly country: string | null;
  } | null;
}) {
  if (gate === null || gate.criteria.length === 0) {
    return (
      <Card
        title={t("Their gate")}
        icon={<DoorOpen size={16} aria-hidden="true" />}
      >
        <div data-qp-anchor="fdr.09.gateq.criteria">
          <Unknown>
            {investorName}{" "}
            {t(
              "hasn’t published a gate on Capital Q. A Connection Request is the way to reach them.",
            )}
          </Unknown>
        </div>
      </Card>
    );
  }
  const required = gate.criteria.filter((c) => c.requiredness === "REQUIRED");
  const preferred = gate.criteria.filter((c) => c.requiredness !== "REQUIRED");
  const metRequired = required.filter((c) => c.standing === "MET").length;
  const missedRequired = required.filter(
    (c) => c.standing === "NOT_MET",
  ).length;
  const preferredUnknown = preferred.filter(
    (c) => c.standing === "UNKNOWN",
  ).length;
  const preferredMissed = preferred.filter(
    (c) => c.standing === "NOT_MET",
  ).length;
  const sub = [
    missedRequired > 0
      ? `${String(missedRequired)} ${missedRequired === 1 ? "required rule you don’t meet" : "required rules you don’t meet"}.`
      : null,
    required.length - metRequired - missedRequired > 0
      ? `${String(required.length - metRequired - missedRequired)} required not answered yet.`
      : null,
    preferredUnknown > 0
      ? `${String(preferredUnknown)} preferred ${preferredUnknown === 1 ? "rule isn’t" : "rules aren’t"} answered yet.`
      : null,
    preferredMissed > 0
      ? `${String(preferredMissed)} preferred ${preferredMissed === 1 ? "rule" : "rules"} you don’t meet.`
      : null,
    preferred.length > 0 ? "Preferred rules don’t stop you applying." : null,
  ].filter((part): part is string => part !== null);
  return (
    <>
      <div
        className="mb-1 flex items-center gap-3.5 rounded-(--cq-radius-lg) border border-(--cq-accent)/60 bg-(--cq-surface-raised) px-4 py-3.5 shadow-[inset_4px_0_0_var(--cq-accent)] max-sm:flex-col max-sm:items-stretch"
        data-gate-banner
      >
        <div className="min-w-0 flex-1">
          <b className="block text-[15px] font-semibold text-(--cq-text-primary)">
            {required.length === 0
              ? t("Their gate has no required rules")
              : `${t("You meet")} ${String(metRequired)} ${t("of their")} ${String(required.length)} ${t("required rules")}`}
          </b>
          {sub.length === 0 ? null : (
            <span className="text-[13px] text-(--cq-text-secondary)">
              {sub.join(" ")}
            </span>
          )}
        </div>
        {href === null ? (
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t("Their gate isn’t taking applications right now.")}
          </span>
        ) : (
          <a
            href="#apply"
            className="cq-crm-press inline-flex min-h-11 items-center justify-center rounded-(--cq-radius-md) bg-[var(--cq-primary-action,var(--cq-accent))] px-4 text-sm font-medium whitespace-nowrap text-[var(--cq-on-primary-action,var(--cq-text-inverse))] hover:bg-[var(--cq-primary-action-hover,var(--cq-accent-hover))]"
            data-draft-application
          >
            {t("Draft my application")}
          </a>
        )}
      </div>
      <Card
        title={gate.title.length > 0 ? gate.title : t("Their gate")}
        icon={<DoorOpen size={16} aria-hidden="true" />}
        data-qp-anchor="fdr.09.gateq.criteria"
      >
        <ul>
          {gate.criteria.map((criterion) => (
            <li
              key={`${criterion.dimension}-${criterion.label}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-(--cq-border-subtle) py-3 first:border-t-0"
              data-standing={criterion.standing}
            >
              <span className="min-w-0">
                <b className="block text-sm font-medium text-(--cq-text-primary)">
                  {criterion.label}
                </b>
                <small className="text-xs text-(--cq-text-tertiary)">
                  {criterion.requiredness === "REQUIRED"
                    ? t("Required by their rules.")
                    : t("Preferred by their rules.")}{" "}
                  {t(criterionWords(criterion.dimension, criterion.standing))}
                </small>
              </span>
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-(--cq-text-primary)">
                {criterion.standing === "MET" ? (
                  <Tick />
                ) : criterion.standing === "NOT_MET" ? (
                  <X
                    size={16}
                    aria-hidden="true"
                    className="text-(--cq-text-tertiary)"
                  />
                ) : (
                  <CircleHelp
                    size={16}
                    aria-hidden="true"
                    className="text-(--cq-text-tertiary)"
                  />
                )}
                {criterion.standing === "MET"
                  ? t("Meets")
                  : criterion.standing === "NOT_MET"
                    ? t("Doesn’t meet")
                    : t("Not answered")}
              </span>
            </li>
          ))}
        </ul>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t(
            "This is their published bar, not their private thesis. Meeting it is not a promise of interest.",
          )}
        </span>
      </Card>
      {href === null ? null : (
        <DraftFill
          id="apply"
          labelledBy="investor-draft"
          className="flex scroll-mt-4 flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="investor-draft"
              className="text-[13px] font-medium text-(--cq-text-secondary)"
            >
              {t("Your application, drafted by Q")}
            </h2>
            <span className="cq-caption text-(--cq-text-tertiary)">
              {t(
                "Q prepares · you approve · nothing is sent until you press Send",
              )}
            </span>
          </div>
          {prefill === null ? (
            <p className="text-sm text-(--cq-text-secondary)">
              {t("Q starts the form from your company profile.")}
            </p>
          ) : (
            <dl className="flex flex-col gap-1 text-sm">
              {(
                [
                  [
                    "fdr.09.gateq.field-company",
                    t("Company"),
                    prefill.companyName,
                  ],
                  ["fdr.09.gateq.field-line", t("One line"), prefill.oneLiner],
                  [
                    "fdr.09.gateq.field-stage",
                    t("Stage"),
                    stageLabel(prefill.stageCode),
                  ],
                  [
                    "fdr.09.gateq.field-country",
                    t("Country"),
                    countryLabel(prefill.country),
                  ],
                ] as const
              ).map(([anchor, label, value]) => (
                <div
                  key={anchor}
                  className="-mx-2 grid grid-cols-1 gap-x-4 px-2 py-0.5 sm:grid-cols-[10rem_1fr]"
                  data-qp-fill
                  data-qp-anchor={anchor}
                >
                  <dt className="text-(--cq-text-tertiary)">{label}</dt>
                  <dd className="text-(--cq-text-primary)">
                    {value ?? t("Not on your profile yet")}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div
            className="flex flex-wrap gap-2 self-start"
            data-qp-anchor="fdr.09.gateq.send"
          >
            <Link
              href={href}
              className="cq-crm-press inline-flex min-h-11 items-center justify-center rounded-(--cq-radius-md) bg-[var(--cq-primary-action,var(--cq-accent))] px-4 text-sm font-medium text-[var(--cq-on-primary-action,var(--cq-text-inverse))] hover:bg-[var(--cq-primary-action-hover,var(--cq-accent-hover))]"
            >
              {t("Review and send")}
            </Link>
          </div>
        </DraftFill>
      )}
    </>
  );
}
