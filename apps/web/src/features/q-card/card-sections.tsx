import type { ReactNode } from "react";

import type {
  CardDetail,
  CardMetric,
  EvidenceStatus,
  PublicCardField,
  TruthClass,
} from "@capital-q/contracts";

import { Check, ICON_STROKE } from "@capital-q/ui/icons";

import { compactMoneyText, moneyText } from "@/features/company/money-text";

import {
  cardFieldLabel,
  cardFieldValue,
  cardListItems,
  CARD_LIST_FIELDS,
} from "./card-content";

/**
 * The Q Card's sections (owner 2026-10-21, Q Story S6): "one living
 * private-capital identity with your story, your numbers, your raise,
 * your intelligence, and your relationships."
 *
 * Server-rendered, no client JS. Each section draws only the field the
 * audience projection handed it; a section with nothing for this visitor
 * says "Not shared yet" in exactly the same words whether the owner never
 * filled it, kept it to members, or kept it private -- so the empty state
 * never hints at what is behind it. Every number carries how it is known
 * (truth class) and how it is supported (evidence status), in words.
 */

/** Stable ids: the story engine highlights these at beats #48-49. */
export const CARD_SECTION_IDS = {
  story: "story",
  numbers: "numbers",
  raise: "raise",
  intelligence: "intelligence",
  relationships: "relationships",
  team: "team",
  documents: "documents",
  focus: "focus",
} as const;

export const EVIDENCE_WORDS: Readonly<Record<EvidenceStatus, string>> = {
  NO_EVIDENCE: "No evidence yet",
  SELF_REPORTED: "Self-reported",
  DOCUMENT_SUPPORTED: "Document-supported",
  MULTI_SOURCE_SUPPORTED: "Supported by several sources",
  EXTERNALLY_VERIFIED: "Externally verified",
  PLATFORM_VERIFIED: "Verified by Capital Q",
};

export const TRUTH_WORDS: Readonly<Record<TruthClass, string>> = {
  VERIFIED: "Verified fact",
  USER_CLAIM: "Company's statement",
  ESTIMATE: "Estimate",
  Q_INFERENCE: "Q's inference",
  UNKNOWN: "Unknown",
};

const INSTRUMENT_WORDS: Readonly<Record<string, string>> = {
  safe: "SAFE",
  equity: "Equity",
  priced_equity: "Priced equity",
  convertible: "Convertible note",
  convertible_note: "Convertible note",
  asa: "ASA",
  debt: "Debt",
};

function words(code: string): string {
  const known = INSTRUMENT_WORDS[code.toLowerCase()];
  if (known !== undefined) return known;
  const spaced = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "$1.2M", "38%", "1,240 customers": exact digits, never a float. */
export function metricText(metric: CardMetric): string {
  if (metric.amount === null) return "Unknown";
  if (metric.currency !== null) {
    return compactMoneyText({
      amount: metric.amount,
      currency: metric.currency,
    });
  }
  if (metric.unit === "%") return `${metric.amount}%`;
  const [whole = "0", fraction] = metric.amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Support a third party or Capital Q itself checked: marked with a tick too. */
const STRONG: ReadonlySet<EvidenceStatus> = new Set([
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
]);

/** The truth line under a number: how it's supported, then what it is. */
export function truthLine(item: {
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
}): string {
  return `${EVIDENCE_WORDS[item.evidenceStatus]} · ${TRUTH_WORDS[item.truthClass]}`;
}

function detailOf<K extends CardDetail["kind"]>(
  field: PublicCardField | undefined,
  kind: K,
): Extract<CardDetail, { kind: K }> | null {
  const detail = field?.detail;
  return detail !== undefined && detail.kind === kind
    ? (detail as Extract<CardDetail, { kind: K }>)
    : null;
}

export function CardSection({
  id,
  label,
  title,
  members,
  empty,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly title?: string | undefined;
  /** The content is the members' (network_visible) projection. */
  readonly members?: boolean | undefined;
  /** Nothing this visitor may see: one quiet row, the same words always. */
  readonly empty?: boolean | undefined;
  readonly children?: ReactNode;
}) {
  const heading = `card-${id}-heading`;
  if (empty === true) {
    return (
      <section
        id={`card-${id}`}
        aria-labelledby={heading}
        data-card-section={id}
        className="flex min-h-11 scroll-mt-20 items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
      >
        <h2 id={heading} className="cq-label text-(--cq-text-secondary)">
          {label}
        </h2>
        <NotShared what={label.toLowerCase()} />
      </section>
    );
  }
  return (
    <section
      id={`card-${id}`}
      aria-labelledby={heading}
      data-card-section={id}
      className="flex scroll-mt-20 flex-col gap-3 py-6 first:pt-0 last:pb-0"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id={heading}
          className="cq-label min-w-0 text-(--cq-text-secondary)"
        >
          {label}
        </h2>
        {members === true ? <MembersOnly /> : null}
      </div>
      {title === undefined ? null : (
        <p className="cq-title-sm text-(--cq-text-primary)">{title}</p>
      )}
      {children}
    </section>
  );
}

/**
 * The one marker for content shown because the visitor is a signed-in
 * member: short enough to sit at the right of every section heading, even
 * at 390 px, with the full meaning for screen readers.
 */
export function MembersOnly() {
  return (
    <span
      className="cq-caption shrink-0 text-end whitespace-nowrap text-(--cq-text-tertiary)"
      data-members-only
    >
      Members only
      <span className="sr-only">: shown to signed-in Capital Q members</span>
    </span>
  );
}

/** One quiet line for a section with nothing this visitor may see. */
export function NotShared({ what }: { readonly what: string }) {
  return (
    <p className="cq-body-sm text-(--cq-text-tertiary)" data-card-empty>
      Not shared yet<span className="sr-only">: {what}</span>
    </p>
  );
}

export function NumbersSection({
  field,
}: {
  readonly field: PublicCardField | undefined;
}) {
  const detail = detailOf(field, "METRICS");
  return (
    <CardSection
      id={CARD_SECTION_IDS.numbers}
      label="Numbers"
      members={field?.scope === "network_visible"}
      empty={detail === null}
    >
      {detail === null ? null : (
        <dl className="grid grid-cols-2 gap-x-5 sm:gap-x-8" data-card-metrics>
          {detail.metrics.map((metric, index) => (
            <div
              key={`${metric.label}-${index}`}
              className="flex flex-col gap-0.5 border-t border-(--cq-border-subtle) py-3"
              data-card-metric={metric.label}
              data-evidence={metric.evidenceStatus}
              data-truth={metric.truthClass}
            >
              <dt className="cq-body-sm order-2 text-(--cq-text-secondary)">
                {metric.label}
                {metric.period === null ? null : (
                  <span className="text-(--cq-text-tertiary)">
                    {" "}
                    · {metric.period}
                  </span>
                )}
              </dt>
              <dd className="cq-numeric order-1 text-[1.75rem] leading-tight font-semibold tracking-tight text-(--cq-text-primary)">
                {metricText(metric)}
              </dd>
              <dd
                className={`cq-caption order-3 flex items-start gap-1 ${STRONG.has(metric.evidenceStatus) ? "text-(--cq-text-secondary)" : "text-(--cq-text-tertiary)"}`}
              >
                {STRONG.has(metric.evidenceStatus) ? (
                  <Check
                    aria-hidden="true"
                    size={13}
                    strokeWidth={ICON_STROKE}
                    className="mt-0.5 shrink-0 text-(--cq-positive)"
                  />
                ) : null}
                <span>{truthLine(metric)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </CardSection>
  );
}

export function RaiseSection({
  field,
}: {
  readonly field: PublicCardField | undefined;
}) {
  const detail = detailOf(field, "RAISE");
  return (
    <CardSection
      id={CARD_SECTION_IDS.raise}
      label="The raise"
      members={field?.scope === "network_visible"}
      empty={detail === null}
    >
      {detail === null ? null : (
        <div className="flex flex-col gap-3" data-card-raise>
          <div className="flex flex-col gap-0.5">
            <p className="cq-numeric text-[2rem] leading-tight font-semibold tracking-tight text-(--cq-text-primary)">
              {compactMoneyText(detail.target)}
            </p>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {[
                detail.stageCode === null
                  ? "Round not stated"
                  : `${cardFieldValue({ key: "currentStageCode", value: detail.stageCode, scope: "network_visible" })} round`,
                detail.instrumentCode === null
                  ? "Instrument not stated"
                  : words(detail.instrumentCode),
                detail.targetCloseDate === null
                  ? null
                  : `Closing ${new Date(`${detail.targetCloseDate}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}`,
              ]
                .filter((part) => part !== null)
                .join(" · ")}
            </p>
            <p className="cq-caption text-(--cq-text-tertiary)">
              Target {moneyText(detail.target)} · {truthLine(detail)}
            </p>
          </div>
          <div className="flex flex-col gap-1 border-t border-(--cq-border-subtle) pt-3">
            <h3 className="cq-body-sm text-(--cq-text-secondary)">
              Use of funds
            </h3>
            <p className="cq-body whitespace-pre-line text-(--cq-text-primary)">
              {detail.useOfFunds ?? "Not stated"}
            </p>
          </div>
        </div>
      )}
    </CardSection>
  );
}

export function IntelligenceSection({
  field,
}: {
  readonly field: PublicCardField | undefined;
}) {
  const detail = detailOf(field, "INTELLIGENCE");
  return (
    <CardSection
      id={CARD_SECTION_IDS.intelligence}
      label="Intelligence"
      members={field?.scope === "network_visible"}
      empty={detail === null}
    >
      {detail === null ? null : (
        <div className="flex flex-col gap-2" data-card-intelligence>
          <p className="text-[1.75rem] leading-tight font-semibold tracking-tight text-(--cq-text-primary)">
            {detail.status === "ASSESSED"
              ? (detail.band ?? "Assessed")
              : "Not enough evidence yet"}
          </p>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {detail.status === "ASSESSED"
              ? `Q's reading on ${detail.method}, from ${detail.areasScored} of ${detail.areasTotal} areas with enough evidence${detail.confidence === null ? "" : ` · ${detail.confidence}`}.`
              : "Q has too little shared evidence to read this company yet. That says nothing about its quality."}
          </p>
          {detail.strengths.length === 0 ? null : (
            <p className="cq-body-sm text-(--cq-text-primary)">
              Strongest areas: {detail.strengths.join(", ")}
            </p>
          )}
          {/* As legible as any metadata on the card, and never clipped: it
              is what keeps the biggest word on the card honest. */}
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {TRUTH_WORDS.Q_INFERENCE}, not a verified fact or a recommendation.
          </p>
        </div>
      )}
    </CardSection>
  );
}

export function RelationshipsSection({
  field,
}: {
  readonly field: PublicCardField | undefined;
}) {
  const detail = detailOf(field, "RELATIONSHIPS");
  return (
    <CardSection
      id={CARD_SECTION_IDS.relationships}
      label="Relationships"
      members={field?.scope === "network_visible"}
      empty={detail === null}
    >
      {detail === null ? null : (
        <>
          <ol
            className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4"
            data-card-relationships
          >
            {detail.stages.map((stage) => (
              <li key={stage.label} className="flex flex-col">
                <span className="cq-numeric text-[1.5rem] leading-tight font-semibold text-(--cq-text-primary)">
                  {stage.count}
                </span>
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  {stage.label}
                </span>
              </li>
            ))}
          </ol>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Investor conversations on Capital Q, by stage. Never who.
          </p>
        </>
      )}
    </CardSection>
  );
}

export function TeamSection({
  field,
  empty,
}: {
  readonly field: PublicCardField | undefined;
  /** Draw "Not shared yet" when absent; false leaves the section out. */
  readonly empty: boolean;
}) {
  const detail = detailOf(field, "TEAM");
  if (detail === null && !empty) return null;
  return (
    <CardSection
      id={CARD_SECTION_IDS.team}
      label="Team"
      members={field?.scope === "network_visible"}
      empty={detail === null}
    >
      {detail === null ? null : (
        <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2" data-card-team>
          {detail.members.map((member, index) => (
            <li
              key={`${member.name}-${index}`}
              className="flex min-w-0 items-center gap-3 border-t border-(--cq-border-subtle) py-2.5"
              data-card-member={member.name}
            >
              <MemberFace name={member.name} photoUrl={member.photoUrl} />
              <span className="flex min-w-0 flex-col">
                <span className="cq-body truncate text-(--cq-text-primary)">
                  {member.name}
                </span>
                <span className="cq-body-sm truncate text-(--cq-text-secondary)">
                  {member.role ?? "Role not stated"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </CardSection>
  );
}

/**
 * A team member's own profile photo when the card carries one (it follows
 * their name), else their initials. Decorative: the name beside it is the
 * text.
 */
function MemberFace({
  name,
  photoUrl,
}: {
  readonly name: string;
  readonly photoUrl?: string | null | undefined;
}) {
  const initials = name
    .split(/\s+/)
    .filter((part) => part.length > 0 && !/^captain$/i.test(part))
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return typeof photoUrl === "string" ? (
    // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage URL loaded by the browser from storage directly
    <img
      src={photoUrl}
      alt=""
      width={40}
      height={40}
      className="size-10 shrink-0 rounded-full object-cover"
      data-member-photo
    />
  ) : (
    <span
      aria-hidden="true"
      className="cq-body-sm inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-(--cq-border) bg-(--cq-surface-subtle) font-semibold text-(--cq-text-secondary)"
      data-member-initials
    >
      {initials}
    </span>
  );
}

export function DocumentsSection({
  field,
}: {
  readonly field: PublicCardField | undefined;
}) {
  const detail = detailOf(field, "DOCUMENTS");
  if (detail === null) return null;
  return (
    <CardSection
      id={CARD_SECTION_IDS.documents}
      label="Documents on request"
      members={field?.scope === "network_visible"}
      empty={detail === null}
    >
      <ul
        className="flex flex-col divide-y divide-(--cq-border-subtle)"
        data-card-documents
      >
        {detail.documents.map((doc, index) => (
          <li
            key={`${doc.title}-${index}`}
            className="flex min-h-11 items-center justify-between gap-4 py-2"
          >
            <span className="cq-body min-w-0 truncate text-(--cq-text-primary)">
              {doc.title}
            </span>
            {doc.category === null ? null : (
              <span className="cq-caption shrink-0 text-(--cq-text-tertiary)">
                {doc.category}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="cq-caption text-(--cq-text-tertiary)">
        Titles only. Ask for access from inside Capital Q; the company decides.
      </p>
    </CardSection>
  );
}

/**
 * A person's "what they're looking for" (owner 2026-10-22): their firm's or
 * company's own card facts, exactly as that card shows them to this
 * audience, with a link to it. Said as the organisation's, never the
 * person's own claim.
 */
export function FocusSection({
  field,
}: {
  readonly field: PublicCardField | undefined;
}) {
  const detail = detailOf(field, "FOCUS");
  const lists =
    detail?.fields.filter((item) => CARD_LIST_FIELDS.has(item.key)) ?? [];
  const facts =
    detail?.fields.filter(
      (item) =>
        !CARD_LIST_FIELDS.has(item.key) && item.key !== "shortDescription",
    ) ?? [];
  const about = detail?.fields.find((item) => item.key === "shortDescription");
  return (
    <CardSection
      id={CARD_SECTION_IDS.focus}
      label="What they're looking for"
      members={field?.scope === "network_visible"}
      empty={detail === null}
    >
      {detail === null ? null : (
        <div className="flex flex-col gap-3" data-card-focus={detail.side}>
          {detail.raise === null ? null : (
            <div className="flex flex-col gap-0.5">
              <p className="cq-numeric text-[1.75rem] leading-tight font-semibold tracking-tight text-(--cq-text-primary)">
                Raising {compactMoneyText(detail.raise.target)}
              </p>
              {detail.raise.stageCode === null ? null : (
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  {cardFieldValue({
                    key: "currentStageCode",
                    value: detail.raise.stageCode,
                    scope: "network_visible",
                  })}{" "}
                  round · {TRUTH_WORDS.USER_CLAIM}
                </p>
              )}
            </div>
          )}
          {about === undefined ? null : (
            <p className="cq-body text-(--cq-text-primary)">{about.value}</p>
          )}
          {facts.length === 0 ? null : (
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
              {facts.map((item) => (
                <div key={item.key} className="flex flex-col gap-0.5">
                  <dd className="cq-title-sm cq-numeric order-1 text-(--cq-text-primary)">
                    {cardFieldValue({ ...item, scope: "network_visible" })}
                  </dd>
                  <dt className="cq-caption order-2 text-(--cq-text-secondary)">
                    {cardFieldLabel(item.key)}
                  </dt>
                </div>
              ))}
            </dl>
          )}
          {lists.map((item) => (
            <div key={item.key} className="flex flex-col gap-2">
              <h3 className="cq-body-sm text-(--cq-text-secondary)">
                {cardFieldLabel(item.key)}
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {cardListItems({ ...item, scope: "network_visible" }).map(
                  (entry) => (
                    <li
                      key={entry}
                      className="cq-body-sm rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-2.5 py-0.5"
                    >
                      {entry}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
          <p className="cq-caption text-(--cq-text-tertiary)">
            From{" "}
            {detail.organisationHandle === null ? (
              "their organisation's Q Card"
            ) : (
              <a
                href={`/@${detail.organisationHandle}`}
                className="underline underline-offset-4 hover:text-(--cq-text-primary)"
              >
                @{detail.organisationHandle}
              </a>
            )}
            , as it shows to you.
          </p>
        </div>
      )}
    </CardSection>
  );
}
