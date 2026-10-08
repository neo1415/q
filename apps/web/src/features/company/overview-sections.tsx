import Link from "next/link";
import type { ReactNode } from "react";

import type { PitchClaimDto, PitchRaiseNotice } from "@capital-q/contracts";
import { ChevronDown, ICON_SIZE } from "@capital-q/ui/icons";

import { stageLabel } from "./declared-labels";
import { compactMoneyText, moneyText } from "./money-text";

/**
 * The Overview's parts (founder, 2026-10-08: "as much as I want all the
 * information in Overview, it's cluttered"; design
 * docs/design/2026-10-08/overview).
 *
 * Everything stays; it is arranged to be scanned. Each section is a fold
 * whose closed state is still informative: a heading and ONE line saying
 * what is inside, so the page first reads as a table of contents. One
 * hairline between folds, definition lists and quotes inside, no cards in
 * cards, no badges. Unknown is said in words, never a zero.
 *
 * What a pitch says is shown as the founder's own words with the moment
 * they said it, labelled as their claim -- never as a verified figure.
 */

/** "0:43", "1:02:05". */
export function pitchMoment(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${String(minutes)}:${rest}`;
}

/** "$4M seed": the raise as a pitch said it, in the strip's short form. */
export function pitchRaiseText(claim: PitchClaimDto): string {
  const money = claim.money === null ? null : compactMoneyText(claim.money);
  const stage =
    claim.stageCode === null
      ? null
      : stageLabel(claim.stageCode)?.toLowerCase();
  return [money, stage]
    .filter((part) => part !== null && part !== undefined)
    .join(" ");
}

/**
 * A section, folded behind its heading and one summary line. Native
 * <details>, so it opens by keyboard and assistive technology with no
 * script; the summary is a 56px target.
 */
export function Fold({
  id,
  title,
  summary,
  children,
  open = false,
}: {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly children: ReactNode;
  readonly open?: boolean;
}) {
  return (
    <details
      className="group border-b border-(--cq-border-subtle)"
      data-overview-fold={id}
      open={open}
    >
      <summary className="grid min-h-14 cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-3 py-3 [&::-webkit-details-marker]:hidden">
        <h2 id={id} className="cq-title-sm text-(--cq-text-primary)">
          {title}
        </h2>
        <ChevronDown
          size={ICON_SIZE.regular}
          aria-hidden="true"
          className="row-span-2 text-(--cq-text-tertiary) transition-transform group-open:rotate-180"
        />
        <p className="cq-body-sm text-(--cq-text-secondary)">{summary}</p>
      </summary>
      <div className="flex flex-col gap-3 pb-5">{children}</div>
    </details>
  );
}

/** A hairline definition list: words, never badges. */
export function ProfileRows({
  rows,
}: {
  readonly rows: readonly (readonly [string, ReactNode])[];
}) {
  return (
    <dl className="flex flex-col divide-y divide-(--cq-border-subtle)">
      {rows.map(([term, value]) => (
        <div
          key={term}
          className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3"
        >
          <dt className="cq-label text-(--cq-text-secondary)">{term}</dt>
          <dd className="cq-body text-right text-(--cq-text-primary)">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Where the pitch can be watched: the Elevator tab, never a raw URL. */
export function elevatorHref(companyId: string): string {
  return `/company/${encodeURIComponent(companyId)}?tab=elevator`;
}

/** The founder's words from a pitch, with the video and the moment. */
export function PitchQuote({
  claim,
  companyId,
}: {
  readonly claim: PitchClaimDto;
  readonly companyId: string;
}) {
  const video =
    claim.pitchTitle === null ? "Pitch video" : `“${claim.pitchTitle}”`;
  return (
    <blockquote
      className="flex flex-col gap-1 border-l-2 border-(--cq-border) pl-3"
      data-pitch-claim={claim.kind}
    >
      <p className="cq-body text-(--cq-text-primary)">
        &ldquo;{claim.statement}&rdquo;
      </p>
      <footer className="cq-caption text-(--cq-text-secondary)">
        {video}, at{" "}
        <Link
          href={elevatorHref(companyId)}
          className="underline underline-offset-4"
        >
          {pitchMoment(claim.atSeconds)}
        </Link>{" "}
        · the company&rsquo;s own claim, self-reported
      </footer>
    </blockquote>
  );
}

/** Traction said in the pitches, one line each with its moment. */
export function PitchClaimList({
  claims,
}: {
  readonly claims: readonly PitchClaimDto[];
}) {
  return (
    <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
      {claims.map((claim) => (
        <li
          key={`${claim.pitchId}-${String(claim.atSeconds)}-${claim.statement}`}
          className="cq-body py-2.5 text-(--cq-text-primary)"
          data-pitch-claim={claim.kind}
        >
          {claim.statement}
          <span className="cq-caption text-(--cq-text-secondary)">
            {" "}
            · said at {pitchMoment(claim.atSeconds)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The owner's notice: what their pitch says about the raise against what
 * their profile shows. It tells; it never changes a setting for them.
 */
export function OwnerPitchNotice({
  notice,
}: {
  readonly notice: PitchRaiseNotice;
}) {
  const said = pitchRaiseText(notice.said);
  const at = pitchMoment(notice.said.atSeconds);
  const detail =
    notice.state === "HIDDEN_BY_FOUNDER"
      ? "You turned off sharing your raise, so your overview shows no raise to investors. Anyone who can watch the video still hears it there."
      : notice.state === "DIFFERS_FROM_DECLARED"
        ? `Your raise on Capital Q says ${notice.said.money === null ? "something else" : "a different amount"}. Investors who can see both see both, side by side.`
        : "Your raise itself isn't shared with investors, so investors who can watch the video see this on your overview, labelled as said in your pitch.";
  return (
    <section
      className="flex flex-col gap-2 rounded-(--cq-radius-lg) border border-(--cq-border) bg-(--cq-surface-raised) p-4"
      aria-labelledby="pitch-raise-notice"
      data-pitch-raise-notice={notice.state}
    >
      <h2
        id="pitch-raise-notice"
        className="cq-body font-semibold text-(--cq-text-primary)"
      >
        Your pitch video says you&rsquo;re raising {said} ({at}).
      </h2>
      <p className="cq-body-sm text-(--cq-text-secondary)">{detail}</p>
      <Link
        href="/company/visibility"
        className="cq-body-sm inline-flex min-h-11 items-center self-start underline underline-offset-4"
      >
        Choose who sees your raise
      </Link>
    </section>
  );
}

export { moneyText };
