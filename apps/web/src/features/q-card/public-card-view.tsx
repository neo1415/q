import Link from "next/link";
import type { ReactNode } from "react";

import {
  COMPANY_SECTION_CARD_FIELDS,
  type PublicCardDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  Check,
  Download,
  ExternalLink,
  Globe,
  ICON_STROKE,
  MapPin,
  Search,
  ShieldCheck,
} from "@capital-q/ui/icons";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";
import { SeeMore } from "@/components/see-more";

import {
  cardDescriptor,
  cardFieldLabel,
  cardFieldValue,
  cardImage,
  cardListItems,
  fieldsForAudience,
  textFields,
  websiteLabel,
} from "./card-content";
import {
  CARD_SECTION_IDS,
  CardSection,
  DocumentsSection,
  IntelligenceSection,
  NumbersSection,
  RaiseSection,
  RelationshipsSection,
  TeamSection,
} from "./card-sections";
import { QCard } from "./q-card";

/**
 * What someone sees a second after scanning a Q Card, usually on a phone,
 * usually standing up (BIZ-004, R26). One screen answers three things in
 * order: who this is (name, what kind of organisation, their own line),
 * whether Capital Q vouches for anything (only claims it verified, said
 * exactly), and what to do now -- keep the contact, connect on Capital Q,
 * or go to their website. The facts below are there for the second look.
 *
 * Server-rendered, no client JS of its own: the name is the LCP element
 * and nothing waits on script. Everything shown comes from the API's
 * audience projection, re-filtered here by `fieldsForAudience` so a
 * members-only (network_visible) value can never reach an anonymous page.
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

/** The facts list leaves out what the hero and actions already say. */
const SHOWN_ELSEWHERE: ReadonlySet<string> = new Set([
  // The descriptor line.
  "currentStageCode",
  "headquartersCity",
  "headquartersCountry",
  "investorType",
  "hqCountry",
  // The name, the tagline and the website action.
  "canonicalName",
  "displayName",
  "shortDescription",
  "publicDescription",
  "websiteUrl",
]);

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
  // The owner's own line, in full: long text folds behind "See more".
  const tagline =
    fields.find(
      (field) =>
        field.key ===
        (card.subjectType === "COMPANY"
          ? "shortDescription"
          : "publicDescription"),
    )?.value ?? null;
  const descriptor = cardDescriptor(card.subjectType, fields);
  const photo = cardImage(fields, "photo");
  const cover = cardImage(fields, "cover");
  const website = fields.find((field) => field.key === "websiteUrl");
  const facts = textFields(fields).filter(
    (field) => !SHOWN_ELSEWHERE.has(field.key),
  );
  const demo = new Set<string>(card.demoAttested);
  const verified = card.verified.map((label) =>
    demo.has(label)
      ? { label, text: DEMO_WORDS[label] ?? label, demo: true }
      : { label, text: VERIFIED_WORDS[label] ?? label, demo: false },
  );
  const signIn = `/auth/sign-in?next=${encodeURIComponent(`/@${card.handle}`)}`;

  const byKey = (key: string) => fields.find((field) => field.key === key);
  const glance = [
    { key: "mandateTypicalCheque", label: "Typical cheque size" },
    { key: "mandateStages", label: "Stage focus" },
    { key: "deploymentState", label: "Current status" },
  ].flatMap((item) => {
    const field = byKey(item.key);
    return field === undefined
      ? []
      : [{ ...item, value: cardFieldValue(field) }];
  });
  const chipRows = [
    "mandateSectors",
    "mandateBusinessModels",
    "mandateCustomerTypes",
  ].flatMap((key) => {
    const field = byKey(key);
    return field === undefined
      ? []
      : [
          {
            key,
            label: cardFieldLabel(field.key),
            items: cardListItems(field),
          },
        ];
  });
  const lookFor = byKey("mandateLookFor");
  const location = byKey(
    card.subjectType === "COMPANY" ? "headquartersCountry" : "hqCountry",
  );
  // Said once: an investor's status already leads the glance when shown.
  const status =
    card.subjectType === "COMPANY"
      ? byKey("currentStageCode")
      : glance.some((item) => item.key === "deploymentState")
        ? undefined
        : byKey("deploymentState");
  const company = card.subjectType === "COMPANY";
  const storyEmpty =
    tagline === null && status === undefined && location === undefined;
  const more = facts.filter(
    (field) =>
      !GLANCE_KEYS.has(field.key) &&
      !SECTION_KEYS.has(field.key) &&
      field.key !== "mandateLookFor" &&
      field.key !== location?.key &&
      field.key !== status?.key,
  );

  return (
    <div className="mx-auto flex w-full max-w-(--cq-layout-reading) flex-col gap-4 px-4 pb-12 sm:px-6 sm:pt-4 sm:pb-16">
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
          className="aspect-[4/1] w-full rounded-xl object-cover"
          data-card-cover
        />
      )}
      <QCard
        nameAs="h1"
        brand={photo === null ? undefined : { logoUrl: photo }}
        name={card.name}
        descriptor={descriptor}
        handle={card.handle}
        displayUrl={displayUrl ?? `@${card.handle}`}
        href={`/@${card.handle}`}
        qrSvg={qrSvg}
        className="max-w-none"
      />

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

      <section aria-label="Actions" className="flex flex-col gap-2">
        <a
          href={`/@${card.handle}.vcf`}
          download={`${card.handle}.vcf`}
          data-card-action="save-contact"
          className={buttonClassName("primary", "large", "w-full")}
        >
          <Download aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
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

      <article
        aria-label={`${card.name}'s Q Card`}
        className="flex flex-col divide-y divide-(--cq-border-subtle) rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface) px-5 py-6 sm:px-8 sm:py-8"
        data-card-dossier
      >
        <CardSection
          id={CARD_SECTION_IDS.story}
          label="Story"
          empty={storyEmpty}
        >
          {storyEmpty ? null : (
            <>
              {tagline === null ? null : (
                <div className="cq-body text-(--cq-text-primary)">
                  <SeeMore text={tagline} />
                </div>
              )}
              {status === undefined && location === undefined ? null : (
                <dl className="flex flex-wrap gap-x-8 gap-y-2" data-card-tiles>
                  {status === undefined ? null : (
                    <Fact
                      label={
                        card.subjectType === "COMPANY"
                          ? "Stage"
                          : "Current status"
                      }
                      value={cardFieldValue(status)}
                    />
                  )}
                  {location === undefined ? null : (
                    <Fact
                      label="Location"
                      value={cardFieldValue(location)}
                      icon={
                        <MapPin
                          aria-hidden="true"
                          size={14}
                          strokeWidth={ICON_STROKE}
                        />
                      }
                    />
                  )}
                </dl>
              )}
            </>
          )}
        </CardSection>

        {company ? (
          <>
            <NumbersSection field={byKey("tractionMetrics")} />
            <RaiseSection field={byKey("currentRaise")} />
            <IntelligenceSection field={byKey("investabilitySummary")} />
            <RelationshipsSection field={byKey("relationshipSummary")} />
          </>
        ) : null}

        {glance.length === 0 && chipRows.length === 0 ? null : (
          <CardSection id="glance" label="Investment at a glance">
            {glance.length === 0 ? null : (
              <dl
                className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                data-card-glance
              >
                {glance.map((item) => (
                  <div key={item.key} className="flex flex-col gap-0.5">
                    <dd className="cq-title-sm cq-numeric order-1">
                      {item.value}
                    </dd>
                    <dt className="cq-caption order-2 text-(--cq-text-secondary)">
                      {item.label}
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
                <h3 className="cq-body-sm text-(--cq-text-secondary)">
                  {row.label}
                </h3>
                <Chips items={row.items} />
              </div>
            ))}
          </CardSection>
        )}

        {lookFor === undefined ? null : (
          <CardSection id="look-for" label="What they look for">
            <Chips items={cardListItems(lookFor)} />
          </CardSection>
        )}

        <TeamSection field={byKey("team")} empty={company} />
        {company ? (
          <DocumentsSection field={byKey("documentsOnRequest")} />
        ) : null}

        {more.length === 0 ? null : (
          <CardSection id="more" label="Additional information">
            <dl className="divide-y divide-(--cq-border-subtle)">
              {more.map((field) => (
                <div
                  key={field.key}
                  data-card-field={field.key}
                  data-scope={field.scope}
                  className="flex items-baseline justify-between gap-6 py-3"
                >
                  <dt className="cq-body-sm shrink-0 text-(--cq-text-secondary)">
                    {cardFieldLabel(field.key)}
                  </dt>
                  <dd className="cq-body min-w-0 text-end break-words">
                    {field.key === "foundedDate"
                      ? field.value.slice(0, 4)
                      : cardFieldValue(field)}
                    {field.scope === "network_visible" ? (
                      <span className="cq-caption block text-(--cq-text-tertiary)">
                        Shown to Capital Q members
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </CardSection>
        )}
      </article>

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

/** Fields drawn by their own section, never again as a plain row. */
const SECTION_KEYS: ReadonlySet<string> = new Set([
  ...COMPANY_SECTION_CARD_FIELDS,
]);

/** Mandate facts shown in "Investment at a glance", not again below. */
const GLANCE_KEYS: ReadonlySet<string> = new Set([
  "mandateTypicalCheque",
  "mandateStages",
  "deploymentState",
  "mandateSectors",
  "mandateBusinessModels",
  "mandateCustomerTypes",
]);

function Fact({
  label,
  value,
  icon,
}: {
  readonly label: string;
  readonly value: string;
  readonly icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <dt className="cq-caption order-2 text-(--cq-text-secondary)">{label}</dt>
      <dd className="cq-body order-1 flex items-center gap-1.5 text-(--cq-text-primary)">
        {icon}
        {value}
      </dd>
    </div>
  );
}

function Chips({ items }: { readonly items: readonly string[] }) {
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
