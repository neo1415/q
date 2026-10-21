"use client";

import Link from "next/link";
import { useState } from "react";

import { cx } from "@capital-q/ui";
import { Check, DoorOpen, Pause, Search } from "@capital-q/ui/icons";

import { RequestToConnect } from "@/features/network/request-to-connect";
import {
  CrmSheet,
  CrmToastProvider,
  Tag,
  crmButton,
} from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import {
  LogoTile,
  MatchMark,
  MatchWord,
  MATCH_WORDS,
  type MatchState,
} from "./match-marks";
import {
  DIMENSION_WORDS,
  MATCH_DIMENSIONS,
  REACH_WORDS,
  type MatchDimension,
  type Reach,
} from "./published-focus";

/**
 * Investors a founder may look at (ADR 0023; app prototype "investors",
 * option 1, "Directory cards"): who they are, whether they are deploying,
 * what they publish that they focus on, how that matches the founder's
 * company in three plain words (never a percentage), and the one way in.
 * A card opens a sheet with what they look for, where their public
 * profile matches, and the request (or their gate, or why not).
 *
 * Every entry is built on the server from what the investor publishes;
 * the order is the server's. Filters only narrow what was already shown.
 */

export type DirectoryEntry = {
  readonly investorOrganisationId: string;
  readonly name: string;
  readonly photoUrl: string | null;
  /** "Venture fund". */
  readonly type: string;
  /** "Actively investing"; null when they have not said. */
  readonly deployment: string | null;
  /** "Seed and Series A. Security." from their card; null not published. */
  readonly focus: string | null;
  /** "Seed, Security, United Kingdom." for the sheet; null not published. */
  readonly looksFor: string | null;
  /** Their typical cheque as their card states it, with its currency. */
  readonly cheque: string | null;
  readonly matches: Readonly<Record<MatchDimension, MatchState>>;
  readonly reach: Reach;
  /** Their gate's form, when they take applications. */
  readonly gateHref: string | null;
  /** Where they invest (their card) or are based; null not known. */
  readonly where: string | null;
  /** Q Pitch v6: the tour's anchor for this card, when it has one. */
  readonly anchor?: string | undefined;
};

const TYPES = [
  "All",
  "Venture fund",
  "Syndicate",
  "Family office",
  "Corporate venture",
  "Accelerator",
  "Angel",
] as const;

const REACH_TONE: Readonly<
  Record<Reach, "accent" | "positive" | "stone" | "dash">
> = {
  GATE: "accent",
  OPEN: "positive",
  QUALIFIED: "stone",
  CLOSED: "dash",
  NOT_STATED: "dash",
};

export function ReachTag({ reach }: { readonly reach: Reach }) {
  const t = useT();
  return (
    <Tag
      tone={REACH_TONE[reach]}
      icon={
        reach === "CLOSED" ? (
          <Pause aria-hidden="true" />
        ) : reach === "GATE" ? (
          <DoorOpen aria-hidden="true" />
        ) : null
      }
    >
      <span data-reach={reach}>{t(REACH_WORDS[reach])}</span>
    </Tag>
  );
}

export function InvestorDirectory({
  entries,
}: {
  readonly entries: readonly DirectoryEntry[];
}) {
  return (
    <CrmToastProvider>
      <Directory entries={entries} />
    </CrmToastProvider>
  );
}

function Directory({
  entries,
}: {
  readonly entries: readonly DirectoryEntry[];
}) {
  const t = useT();
  const [type, setType] = useState<(typeof TYPES)[number]>("All");
  const [takingOnly, setTakingOnly] = useState(false);
  const [open, setOpen] = useState<DirectoryEntry | null>(null);
  const shown = entries.filter(
    (entry) =>
      (type === "All" || entry.type === type) &&
      (!takingOnly || entry.reach !== "CLOSED"),
  );
  const chip = (on: boolean) =>
    cx(
      "cq-crm-press inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-[30px] lg:px-2.5",
      on
        ? "border-[var(--cq-tile,var(--cq-text-primary))] bg-[var(--cq-tile,var(--cq-text-primary))] text-[var(--cq-on-tile,var(--cq-text-inverse))]"
        : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-secondary) hover:border-(--cq-text-tertiary) hover:text-(--cq-text-primary)",
    );

  return (
    <div className="flex flex-col" data-investor-directory>
      <div
        className="relative -mx-4 mb-3.5 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:mb-4 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={t("Filter investors")}
      >
        {TYPES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={type === option}
            className={chip(type === option)}
            onClick={() => setType(option)}
            data-investor-type={option}
          >
            {t(option)}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={takingOnly}
          className={chip(takingOnly)}
          onClick={() => setTakingOnly((on) => !on)}
          data-taking-requests
        >
          <Check size={14} aria-hidden="true" />
          {t("Taking requests")}
        </button>
      </div>
      {shown.length === 0 ? (
        <div
          className="cq-crm-swap flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-6 py-10 text-center"
          data-state="empty"
        >
          <span
            aria-hidden="true"
            className="grid size-12 place-items-center rounded-full bg-(--cq-surface-strong) text-(--cq-text-secondary)"
          >
            <Search size={22} />
          </span>
          <b className="text-base text-(--cq-text-primary)">
            {entries.length === 0
              ? t("No investors are discoverable yet.")
              : t("No investors of that type yet")}
          </b>
          <p className="max-w-[44ch] text-sm text-(--cq-text-secondary)">
            {t("Only investors who chose to be discoverable appear here.")}
          </p>
        </div>
      ) : (
        <ul
          key={`${type}-${String(takingOnly)}`}
          className="cq-crm-stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          data-investor-cards
        >
          {shown.map((entry) => (
            <li
              key={entry.investorOrganisationId}
              data-q-item
              data-qp-anchor={entry.anchor}
              className="min-w-0"
            >
              <Card entry={entry} onOpen={() => setOpen(entry)} />
            </li>
          ))}
        </ul>
      )}
      {open === null ? null : (
        <InvestorSheet entry={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function matchLabel(
  t: (english: string) => string,
  dimension: MatchDimension,
  state: MatchState,
): string {
  return `${t(DIMENSION_WORDS[dimension])}: ${t(MATCH_WORDS[state]).toLowerCase()}`;
}

function Card({
  entry,
  onOpen,
}: {
  readonly entry: DirectoryEntry;
  readonly onOpen: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-[18px] text-start transition-[transform,box-shadow,border-color] duration-[180ms] ease-(--cq-ease) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-(--cq-shadow-sm)"
      data-investor-card={entry.investorOrganisationId}
      data-investor-open={entry.investorOrganisationId}
    >
      <span className="flex items-center gap-3">
        <LogoTile
          kind="investor"
          name={entry.name}
          src={entry.photoUrl}
          investorOrganisationId={entry.investorOrganisationId}
        />
        <span className="min-w-0">
          <b className="block text-base font-semibold text-(--cq-text-primary)">
            {entry.name}
          </b>
          <span className="text-[13px] text-(--cq-text-secondary)">
            {entry.deployment === null
              ? t(entry.type)
              : `${t(entry.type)}, ${t(entry.deployment).toLowerCase()}`}
          </span>
        </span>
      </span>
      <span className="text-sm leading-[1.45] text-(--cq-text-primary)">
        {entry.focus ?? (
          <span className="text-[13px] text-(--cq-text-tertiary)">
            {t("Focus not published yet")}
          </span>
        )}
      </span>
      <span className="flex flex-wrap gap-x-3.5 gap-y-1.5">
        {MATCH_DIMENSIONS.map((dimension) => (
          <MatchWord
            key={dimension}
            state={entry.matches[dimension]}
            label={matchLabel(t, dimension, entry.matches[dimension])}
          />
        ))}
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 border-t border-(--cq-border-subtle) pt-2.5">
        <ReachTag reach={entry.reach} />
        {entry.where === null ? null : (
          <span className="cq-caption truncate text-(--cq-text-tertiary)">
            {entry.where}
          </span>
        )}
      </span>
    </button>
  );
}

function InvestorSheet({
  entry,
  onClose,
}: {
  readonly entry: DirectoryEntry;
  readonly onClose: () => void;
}) {
  const t = useT();
  const sub = [
    t(entry.type),
    entry.deployment === null ? null : t(entry.deployment),
  ]
    .filter((part): part is string => part !== null)
    .join(". ");
  return (
    <CrmSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={entry.name}
      sub={sub}
      avatar={
        <LogoTile
          kind="investor"
          name={entry.name}
          src={entry.photoUrl}
          investorOrganisationId={entry.investorOrganisationId}
        />
      }
      data-investor-sheet={entry.investorOrganisationId}
    >
      <section className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]">
        <h3 className="text-[13px] font-medium text-(--cq-text-secondary)">
          {t("What this investor looks for")}
        </h3>
        <p className="text-[15px] leading-[1.55] text-(--cq-text-primary)">
          {entry.looksFor ?? t("They haven’t published their focus yet.")}
        </p>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {entry.cheque === null
            ? t("Cheque size: not on their profile yet")
            : `${t("Typical cheque:")} ${entry.cheque}`}
        </span>
      </section>
      <section className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]">
        <h3 className="text-[13px] font-medium text-(--cq-text-secondary)">
          {t("Where their public profile matches you")}
        </h3>
        <div className="flex flex-col gap-2">
          {MATCH_DIMENSIONS.map((dimension) => (
            <span
              key={dimension}
              className="inline-flex items-center gap-1.5 text-sm text-(--cq-text-primary)"
              data-match={entry.matches[dimension]}
            >
              <MatchMark state={entry.matches[dimension]} />
              {t(DIMENSION_WORDS[dimension])}:{" "}
              {t(MATCH_WORDS[entry.matches[dimension]])}
            </span>
          ))}
        </div>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t(
            "From their public profile and their published GateQ criteria only.",
          )}
        </span>
      </section>
      {entry.reach === "CLOSED" ? (
        <div
          className="flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-6 py-8 text-center"
          data-connection="CLOSED"
        >
          <b className="text-base text-(--cq-text-primary)">
            {t("Not taking requests")}
          </b>
          <p className="max-w-[44ch] text-sm text-(--cq-text-secondary)">
            {t("This investor isn’t taking requests from founders right now.")}
          </p>
        </div>
      ) : entry.reach === "GATE" && entry.gateHref !== null ? (
        <>
          <Link
            href={entry.gateHref}
            className={crmButton("primary")}
            data-apply-gate
          >
            {t("Apply via GateQ")}
          </Link>
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t(
              "Q drafts your application from your profile. Nothing is sent until you review it and press Send.",
            )}
          </span>
        </>
      ) : (
        <>
          <RequestToConnect
            investorOrganisationId={entry.investorOrganisationId}
            investorName={entry.name}
          />
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t(
              "They see your company profile. Connecting isn’t an investment.",
            )}
          </span>
        </>
      )}
      <Link
        href={`/investors/${encodeURIComponent(entry.investorOrganisationId)}`}
        className={crmButton("quiet", "self-start")}
      >
        {t("Open their full profile")}
      </Link>
    </CrmSheet>
  );
}
