import Link from "next/link";
import type { ReactNode } from "react";

import {
  COMPANY_SECTION_CARD_FIELDS,
  type PublicCardDto,
  type PublicCardField,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  Check,
  Download,
  ExternalLink,
  Globe,
  ICON_STROKE,
  Search,
  ShieldCheck,
} from "@capital-q/ui/icons";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";
import { DemonstrationNote } from "@/components/demonstration-note";
import { SeeMore } from "@/components/see-more";

import {
  cardDescriptor,
  cardFieldLabel,
  cardFieldValue,
  cardImage,
  cardListItems,
  fieldsForAudience,
  INVESTOR_PROVENANCE,
  textFields,
  websiteLabel,
} from "./card-content";
import {
  CARD_SECTION_IDS,
  CardSection,
  DocumentsSection,
  FocusSection,
  IntelligenceSection,
  MembersOnly,
  NumbersSection,
  RaiseSection,
  RelationshipsSection,
  TeamSection,
  chequeRangeText,
} from "./card-sections";
import { QCard } from "./q-card";

/**
 * What someone sees a second after scanning a Q Card, usually on a phone,
 * usually standing up (BIZ-004, R26). The stage answers three things in
 * order: who this is (the card itself), whether Capital Q vouches for
 * anything (only claims it verified, said exactly), and what to do now --
 * keep the contact, connect on Capital Q, or go to their website.
 *
 * Below it, the board (owner 2026-11-19: "too basic ... it feels scarce"):
 * everything this visitor may see, laid out as an institutional company
 * page rather than a list -- the story and the evidence in the main
 * column, Q's reading and the plain facts beside it from a laptop's width
 * up, one column on a phone. Shared sections lead; a section with nothing
 * for this visitor follows as one quiet row in the same words whatever is
 * behind it, so absence never hints at a reason and never reads as zero.
 *
 * Server-rendered, no client JS of its own: the name is the LCP element
 * and nothing waits on script. Everything shown comes from the API's
 * audience projection, re-filtered here by `fieldsForAudience` so a
 * members-only (network_visible) value can never reach an anonymous page.
 * The layout follows its own width (container queries), so the same page
 * reads right inside the Q Story's narrow panel.
 */

const VERIFIED_WORDS: Readonly<Record<string, string>> = {
  ORGANISATION_VERIFIED: "Organisation verified by Capital Q",
  FOUNDER_IDENTITY_VERIFIED: "Founder identity verified by Capital Q",
};

/**
 * The same claims when they rest on the synthetic-demo attestation: said as
 * what they are, the way the owner's own view says it, never as Capital
 * Q's verification. This page is public_external; honesty cannot depend on
 * who is looking.
 */
const DEMO_WORDS: Readonly<Record<string, string>> = {
  ORGANISATION_VERIFIED: "Organisation: demo data only, not verified",
  FOUNDER_IDENTITY_VERIFIED: "Founder identity: demo data only, not verified",
};

/** The facts list leaves out what the card, story and actions already say. */
const SHOWN_ELSEWHERE: ReadonlySet<string> = new Set([
  // The name, the story and the website action.
  "canonicalName",
  "displayName",
  "shortDescription",
  "publicDescription",
  "primaryDescription",
  "websiteUrl",
  // A person's name line, role line and headline.
  "headline",
  "roleTitle",
  "affiliation",
]);

/** Fields drawn by their own section, never again as a plain row. */
const SECTION_KEYS: ReadonlySet<string> = new Set([
  ...COMPANY_SECTION_CARD_FIELDS,
  "personFocus",
]);

/** Mandate facts shown in "Investment at a glance", not again below. */
const GLANCE_KEYS: ReadonlySet<string> = new Set([
  "mandateTypicalCheque",
  "mandateStages",
  "deploymentState",
  "mandateSectors",
  "mandateGeographies",
  "mandateBusinessModels",
  "mandateCustomerTypes",
  "mandateChequeRange",
  "mandateInvestmentRole",
  // Their own sections (owner 2026-11-19).
  "inboundPreference",
  "portfolioHighlights",
]);

/** The order the plain facts read in, whatever order the projection used. */
const FACT_ORDER: readonly string[] = [
  "currentStageCode",
  "investorType",
  "headquartersCity",
  "headquartersCountry",
  "hqCountry",
  "countryCode",
  "foundedDate",
];

export function PublicCardView({
  card,
  qrSvg,
  displayUrl,
}: {
  readonly card: PublicCardDto;
  /** The card's QR, server-rendered; absent draws no code. */
  readonly qrSvg?: string | undefined;
  /** Where the card lives, for display; defaults to its handle path. */
  readonly displayUrl?: string | undefined;
}) {
  const fields = fieldsForAudience(card);
  const participant = card.audience === "PARTICIPANT";
  const company = card.subjectType === "COMPANY";
  const person = card.subjectType === "PERSON";
  const byKey = (key: string): PublicCardField | undefined =>
    fields.find((field) => field.key === key);
  // The owner's own line, in full: long text folds behind "See more".
  const tagline =
    byKey(
      company ? "shortDescription" : person ? "headline" : "publicDescription",
    )?.value ?? null;
  // A company's longer story (owner 2026-11-19), when it is shared.
  const description = company ? byKey("primaryDescription") : undefined;
  const descriptor = cardDescriptor(card.subjectType, fields);
  const photo = cardImage(fields, "photo");
  const cover = cardImage(fields, "cover");
  const website = byKey("websiteUrl");
  const demo = new Set<string>(card.demoAttested);
  // On a person's card the organisation is their employer, named.
  const employer = person ? (byKey("affiliation")?.value ?? null) : null;
  // UX-07: a person's role and organisation, each on its own line.
  const roleField = person ? byKey("roleTitle") : undefined;
  const verified = card.verified.map((label) =>
    demo.has(label)
      ? {
          label,
          text:
            employer !== null && label === "ORGANISATION_VERIFIED"
              ? `${employer}: demo data only, not verified`
              : (DEMO_WORDS[label] ?? label),
          demo: true,
        }
      : {
          label,
          text:
            employer !== null && label === "ORGANISATION_VERIFIED"
              ? `${employer} verified by Capital Q`
              : (VERIFIED_WORDS[label] ?? label),
          demo: false,
        },
  );
  const signIn = `/auth/sign-in?next=${encodeURIComponent(`/@${card.handle}`)}`;

  const glance = [
    { key: "mandateTypicalCheque", label: "Typical cheque size" },
    { key: "mandateChequeRange", label: "Cheque range" },
    { key: "mandateStages", label: "Stage focus" },
    { key: "deploymentState", label: "Current status" },
  ].flatMap((item) => {
    const field = byKey(item.key);
    if (field === undefined) return [];
    // The envelope reads from its exact ends, never from the text line.
    const value =
      item.key === "mandateChequeRange"
        ? chequeRangeText(field)
        : cardFieldValue(field);
    return value === null ? [] : [{ ...item, value, scope: field.scope }];
  });
  // Three across fills three or six; four reads as two by two, then a row.
  const glanceColumns =
    glance.length % 3 === 0
      ? "@xl:grid-cols-3"
      : glance.length >= 2
        ? "@xl:grid-cols-2 @4xl:grid-cols-4"
        : "";
  const chipRows = [
    "mandateSectors",
    "mandateGeographies",
    "mandateBusinessModels",
    "mandateCustomerTypes",
    "mandateInvestmentRole",
  ].flatMap((key) => {
    const field = byKey(key);
    return field === undefined
      ? []
      : [
          {
            key,
            label: cardFieldLabel(field.key),
            scope: field.scope,
            items: cardListItems(field),
          },
        ];
  });
  const lookFor = byKey("mandateLookFor");
  // More of what the firm declared (owner 2026-11-19).
  const portfolio =
    company || person ? undefined : byKey("portfolioHighlights");
  const approach = company || person ? undefined : byKey("inboundPreference");
  // A section's marker when everything in it is the members' projection.
  const allMembers = (keys: readonly string[]) => {
    const shown = keys.flatMap((key) => {
      const field = byKey(key);
      return field === undefined ? [] : [field];
    });
    return (
      shown.length > 0 &&
      shown.every((field) => field.scope === "network_visible")
    );
  };
  const glanceKeys = [
    ...glance.map((item) => item.key),
    ...chipRows.map((row) => row.key),
  ];
  // One marker at the heading when all of it is members-only; mixed rows
  // carry it beside their own label.
  const glanceMembers = allMembers(glanceKeys);
  const storyEmpty = tagline === null && description === undefined;
  // One marker at the heading when all of the story is members-only; a
  // members-only description under a public line carries its own.
  const storyParts = [
    byKey(
      company ? "shortDescription" : person ? "headline" : "publicDescription",
    ),
    description,
  ].filter((part) => part !== undefined);
  const storyMembers =
    storyParts.length > 0 &&
    storyParts.every((part) => part.scope === "network_visible");

  const facts = textFields(fields)
    .filter(
      (field) =>
        !SHOWN_ELSEWHERE.has(field.key) &&
        !GLANCE_KEYS.has(field.key) &&
        !SECTION_KEYS.has(field.key) &&
        field.key !== "mandateLookFor",
    )
    .slice()
    .sort((a, b) => factRank(a.key) - factRank(b.key));
  const factsAllMembers =
    facts.length > 0 &&
    facts.every((field) => field.scope === "network_visible");

  // A company's sections: the ones this visitor may see lead, the others
  // follow as quiet rows. Every story section is always drawn, so the Q
  // Story can point at each (S6).
  const has = (key: string) => byKey(key)?.detail !== undefined;
  const intelligence = company && has("investabilitySummary");
  const documents = company && has("documentsOnRequest");
  const companySections = company
    ? [
        {
          shown: has("tractionMetrics"),
          node: (
            <NumbersSection key="numbers" field={byKey("tractionMetrics")} />
          ),
        },
        {
          shown: has("currentRaise"),
          node: <RaiseSection key="raise" field={byKey("currentRaise")} />,
        },
        {
          shown: has("team"),
          node: <TeamSection key="team" field={byKey("team")} empty />,
        },
        {
          shown: has("relationshipSummary"),
          node: (
            <RelationshipsSection
              key="relationships"
              field={byKey("relationshipSummary")}
            />
          ),
        },
      ]
    : [];
  const sharedSections = companySections.filter((section) => section.shown);
  const quietSections = companySections.filter((section) => !section.shown);
  const side =
    intelligence || documents || facts.length > 0 || approach !== undefined;

  return (
    <div className="@container mx-auto flex w-full max-w-(--cq-layout-content) flex-col gap-6 px-4 pb-12 sm:px-6 sm:pt-4 sm:pb-16">
      <nav
        aria-label="Capital Q"
        className="flex min-h-14 items-center justify-between gap-3"
      >
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-md text-(--cq-text-primary)"
        >
          <QNavIcon
            size={20}
            strokeWidth={2}
            aria-hidden="true"
            className="text-(--cq-accent)"
          />
          <span className="cq-label">Capital Q</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/discover"
            className="cq-body-sm hidden min-h-11 items-center px-2 text-(--cq-text-secondary) hover:text-(--cq-text-primary) sm:inline-flex"
          >
            Discover
          </Link>
          <Link
            href="/investors"
            className="cq-body-sm hidden min-h-11 items-center px-2 text-(--cq-text-secondary) hover:text-(--cq-text-primary) sm:inline-flex"
          >
            Investors
          </Link>
          <Link
            href="/search"
            aria-label="Search"
            className="inline-flex size-11 items-center justify-center rounded-md text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
          >
            <Search aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          </Link>
        </div>
      </nav>

      {cover === null ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage URL loaded by the browser from storage directly
        <img
          src={cover}
          alt=""
          className="aspect-[3/1] w-full rounded-xl object-cover @3xl:aspect-[4/1]"
          data-card-cover
        />
      )}

      {/* The stage: the card, then what Capital Q vouches for and what to
          do now. Side by side once there is room. */}
      <header className="grid gap-5 @3xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] @3xl:items-start @3xl:gap-8">
        <QCard
          nameAs="h1"
          portraitUrl={photo}
          name={card.name}
          descriptor={descriptor}
          role={roleField === undefined ? null : cardFieldValue(roleField)}
          organisation={employer}
          handle={card.handle}
          displayUrl={displayUrl ?? `@${card.handle}`}
          href={`/@${card.handle}`}
          qrSvg={qrSvg}
          className="max-w-none"
        />

        <div className="flex min-w-0 flex-col gap-4">
          {verified.length === 0 ? null : (
            <ul className="flex flex-col gap-1.5">
              {verified.map(({ label, text, demo: isDemo }) => (
                <li
                  key={label}
                  className={`cq-body-sm flex items-center gap-2 ${isDemo ? "text-(--cq-text-secondary)" : "text-(--cq-text-primary)"}`}
                  data-demo-attestation={isDemo ? "" : undefined}
                >
                  {isDemo ? null : (
                    <Check
                      aria-hidden="true"
                      size={16}
                      strokeWidth={ICON_STROKE}
                      className="shrink-0 text-(--cq-positive)"
                    />
                  )}
                  {text}
                </li>
              ))}
            </ul>
          )}

          {card.demonstration === true ? (
            <DemonstrationNote subject="card" />
          ) : null}

          <section aria-label="Actions" className="flex flex-col gap-2">
            <a
              href={`/@${card.handle}.vcf`}
              download={`${card.handle}.vcf`}
              data-card-action="save-contact"
              className={buttonClassName("primary", "large", "w-full")}
            >
              <Download
                aria-hidden="true"
                size={18}
                strokeWidth={ICON_STROKE}
              />
              Save contact
            </a>
            <Link
              href={participant ? "/home" : signIn}
              data-card-action="connect"
              className={buttonClassName("secondary", "large", "w-full")}
            >
              {participant ? "Open in Capital Q" : "Connect on Capital Q"}
              <ExternalLink
                aria-hidden="true"
                size={16}
                strokeWidth={ICON_STROKE}
              />
            </Link>
            {website === undefined ? null : (
              <a
                href={website.value}
                rel="nofollow ugc noopener noreferrer"
                target="_blank"
                data-card-action="website"
                className="flex min-h-12 items-center gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) px-4 text-(--cq-text-primary) hover:border-(--cq-border-strong)"
              >
                <Globe aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
                <span className="cq-body min-w-0 flex-1 truncate">
                  {websiteLabel(website.value)}
                </span>
                <ExternalLink
                  aria-hidden="true"
                  size={16}
                  strokeWidth={ICON_STROKE}
                  className="text-(--cq-text-tertiary)"
                />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            <p className="cq-caption text-(--cq-text-tertiary)">
              {participant
                ? `Ask Q about ${card.name}, save them or express interest from inside Capital Q.`
                : `Sign in to ask Q about ${card.name}, see what they share with members, or express interest.`}
            </p>
          </section>
        </div>
      </header>

      {/* The board: one surface for the story and the evidence, hairline
          rules inside it; Q's reading and the plain facts beside it with no
          box at all. */}
      <div
        className={`grid items-start gap-8 ${side ? "@4xl:grid-cols-[minmax(0,1fr)_20rem] @4xl:gap-10" : ""}`}
        data-card-board
      >
        <article
          aria-label={`${card.name}'s Q Card`}
          className="flex min-w-0 flex-col divide-y divide-(--cq-border-subtle) rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface) px-5 py-6 sm:px-8 sm:py-8"
          data-card-dossier
        >
          <CardSection
            id={CARD_SECTION_IDS.story}
            label="About"
            members={storyMembers}
            empty={storyEmpty}
          >
            {storyEmpty ? null : (
              <div className="flex flex-col gap-4">
                {tagline === null ? null : description === undefined ? (
                  <SeeMore
                    text={tagline}
                    className="cq-body-lg text-(--cq-text-primary)"
                  />
                ) : (
                  // With the longer story below, the one-liner is its lead.
                  <p className="cq-title-sm text-(--cq-text-primary)">
                    {tagline}
                  </p>
                )}
                {description === undefined ? null : (
                  <div
                    className="flex flex-col items-start gap-1"
                    data-card-description
                    data-scope={description.scope}
                  >
                    <SeeMore
                      text={description.value}
                      lines={6}
                      className="cq-body text-(--cq-text-secondary)"
                    />
                    {description.scope === "network_visible" &&
                    !storyMembers ? (
                      <MembersOnly />
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </CardSection>

          {sharedSections.map((section) => section.node)}

          {glance.length === 0 && chipRows.length === 0 ? null : (
            <CardSection
              id="glance"
              label="Investment at a glance"
              members={glanceMembers}
            >
              <Provenance text={INVESTOR_PROVENANCE.mandate} />
              {glance.length === 0 ? null : (
                <dl
                  className={`grid grid-cols-1 gap-4 ${glanceColumns}`}
                  data-card-glance
                >
                  {glance.map((item) => (
                    <div
                      key={item.key}
                      className="flex flex-col gap-0.5"
                      data-card-field={item.key}
                    >
                      <dd className="cq-numeric order-1 text-[1.5rem] leading-tight font-semibold tracking-tight text-(--cq-text-primary)">
                        {item.value}
                      </dd>
                      <dt className="cq-caption order-2 flex flex-wrap items-baseline gap-x-2 text-(--cq-text-secondary)">
                        {item.label}
                        {item.scope === "network_visible" && !glanceMembers ? (
                          <MembersOnly />
                        ) : null}
                      </dt>
                    </div>
                  ))}
                </dl>
              )}
              {chipRows.map((row) => (
                <div
                  key={row.key}
                  className="flex flex-col gap-2 pt-1"
                  data-card-field={row.key}
                >
                  <h3 className="cq-body-sm flex items-baseline gap-2 text-(--cq-text-secondary)">
                    {row.label}
                    {row.scope === "network_visible" && !glanceMembers ? (
                      <MembersOnly />
                    ) : null}
                  </h3>
                  <Chips items={row.items} />
                </div>
              ))}
            </CardSection>
          )}

          {lookFor === undefined ? null : (
            <CardSection
              id="look-for"
              label="What they look for"
              members={lookFor.scope === "network_visible"}
            >
              <Provenance text={INVESTOR_PROVENANCE.mandate} />
              <Chips items={cardListItems(lookFor)} />
            </CardSection>
          )}

          {portfolio === undefined ? null : (
            <CardSection
              id="portfolio"
              label="Portfolio"
              members={portfolio.scope === "network_visible"}
            >
              <Provenance text={INVESTOR_PROVENANCE.portfolio} />
              <div data-card-field="portfolioHighlights">
                <Chips items={cardListItems(portfolio)} />
              </div>
            </CardSection>
          )}

          {person ? <FocusSection field={byKey("personFocus")} /> : null}

          {company ? null : <TeamSection field={byKey("team")} empty={false} />}

          {quietSections.map((section) => section.node)}
          {company && !intelligence ? (
            <IntelligenceSection field={byKey("investabilitySummary")} />
          ) : null}
        </article>

        {side ? (
          <aside
            aria-label={`More about ${card.name}`}
            className="flex min-w-0 flex-col divide-y divide-(--cq-border-subtle) @4xl:pt-2"
            data-card-side
          >
            {intelligence ? (
              <IntelligenceSection field={byKey("investabilitySummary")} />
            ) : null}

            {approach === undefined ? null : (
              <CardSection
                id="approach"
                label="How to approach them"
                members={approach.scope === "network_visible"}
              >
                <p
                  className="cq-body text-(--cq-text-primary)"
                  data-card-field="inboundPreference"
                >
                  {cardFieldValue(approach)}
                </p>
                <Provenance text={INVESTOR_PROVENANCE.approach} />
              </CardSection>
            )}

            {facts.length === 0 ? null : (
              <CardSection
                id="facts"
                label={
                  company ? "Company facts" : person ? "Details" : "Firm facts"
                }
                // One marker at the heading when every row is members-only;
                // mixed rows carry it inline beside their own label.
                members={factsAllMembers}
              >
                <dl className="divide-y divide-(--cq-border-subtle)">
                  {facts.map((field) => (
                    <div
                      key={field.key}
                      data-card-field={field.key}
                      data-scope={field.scope}
                      className="flex min-h-11 items-baseline justify-between gap-6 py-2.5"
                    >
                      <dt className="cq-body-sm flex shrink-0 items-baseline gap-2 text-(--cq-text-secondary)">
                        {cardFieldLabel(field.key)}
                        {field.scope === "network_visible" &&
                        !factsAllMembers ? (
                          <MembersOnly />
                        ) : null}
                      </dt>
                      <dd className="cq-body min-w-0 text-end break-words text-(--cq-text-primary)">
                        {field.key === "foundedDate"
                          ? field.value.slice(0, 4)
                          : cardFieldValue(field)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardSection>
            )}

            {documents ? (
              <DocumentsSection field={byKey("documentsOnRequest")} />
            ) : null}
          </aside>
        ) : null}
      </div>

      <footer className="flex items-start gap-2 border-t border-(--cq-border-subtle) pt-4">
        <ShieldCheck
          aria-hidden="true"
          size={16}
          strokeWidth={ICON_STROKE}
          className="mt-0.5 shrink-0 text-(--cq-text-tertiary)"
        />
        <p className="cq-caption text-(--cq-text-tertiary)">
          This is {card.name}&apos;s public Q Card, @{card.handle}. Only
          information they have chosen to make public
          {participant ? " or share with members" : ""} is shown here. Nothing
          here is an endorsement.
        </p>
      </footer>
    </div>
  );
}

function factRank(key: string): number {
  const at = FACT_ORDER.indexOf(key);
  return at === -1 ? FACT_ORDER.length : at;
}

/** Where a section's facts come from, in words: always the firm's own. */
function Provenance({ text }: { readonly text: string }): ReactNode {
  return (
    <p
      className="cq-caption -mt-1 text-(--cq-text-tertiary)"
      data-card-provenance
    >
      {text}
    </p>
  );
}

function Chips({ items }: { readonly items: readonly string[] }): ReactNode {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="cq-body-sm rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-2.5 py-0.5"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}
