import Link from "next/link";

import type { PublicCardDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { Check, Download, Globe, ICON_STROKE } from "@capital-q/ui/icons";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";
import { SeeMore } from "@/components/see-more";

import {
  cardDescriptor,
  cardFieldLabel,
  cardFieldValue,
  cardImage,
  fieldsForAudience,
  textFields,
  websiteLabel,
} from "./card-content";

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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function PublicCardView({ card }: { readonly card: PublicCardDto }) {
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
  const photo = cardImage(fields, "photo");
  const cover = cardImage(fields, "cover");
  const descriptor = cardDescriptor(card.subjectType, fields);
  const kind = card.subjectType === "COMPANY" ? "Company" : "Investor";
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

  return (
    <div className="mx-auto flex w-full max-w-(--cq-layout-reading) flex-col gap-6 pb-12 sm:px-6 sm:pt-6 sm:pb-16">
      <Link
        href="/"
        className="mx-2 flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-(--cq-text-secondary) hover:text-(--cq-text-primary) sm:mx-0"
      >
        <QNavIcon
          size={18}
          strokeWidth={2}
          aria-hidden="true"
          className="text-(--cq-accent)"
        />
        <span className="cq-label">Capital Q</span>
      </Link>

      <header
        className="overflow-hidden border-y border-(--cq-border-subtle) bg-(--cq-surface) sm:rounded-xl sm:border-x"
        data-card-hero
      >
        <div className="relative aspect-[4/1] min-h-24 w-full bg-(--cq-surface-strong)">
          {cover === null ? null : (
            // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage URL loaded by the browser from storage directly
            <img
              src={cover}
              alt=""
              className="absolute inset-0 size-full object-cover"
              data-card-cover
            />
          )}
        </div>
        <div className="flex flex-col gap-3 px-4 pb-5 sm:px-6">
          <div className="-mt-10 size-20 overflow-hidden rounded-2xl border-4 border-(--cq-surface) bg-(--cq-surface-subtle) sm:-mt-14 sm:size-28">
            {photo === null ? (
              <span
                aria-hidden="true"
                className="cq-title-lg flex size-full items-center justify-center text-(--cq-text-secondary)"
              >
                {initialsOf(card.name)}
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
              <img
                src={photo}
                alt={`${card.name} logo`}
                className="size-full object-cover"
                data-card-photo
              />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="cq-title-xl break-words">{card.name}</h1>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {descriptor === null ? kind : `${kind} · ${descriptor}`}
            </p>
          </div>
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
          <section aria-label="Actions" className="flex flex-col gap-3 pt-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <a
                href={`/@${card.handle}.vcf`}
                download={`${card.handle}.vcf`}
                data-card-action="save-contact"
                className={buttonClassName(
                  "primary",
                  "large",
                  "w-full sm:w-auto",
                )}
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
                className={buttonClassName(
                  "secondary",
                  "large",
                  "w-full sm:w-auto",
                )}
              >
                {participant ? "Open in Capital Q" : "Connect on Capital Q"}
              </Link>
              {website === undefined ? null : (
                <a
                  href={website.value}
                  rel="nofollow ugc noopener noreferrer"
                  target="_blank"
                  data-card-action="website"
                  className={buttonClassName(
                    "quiet",
                    "large",
                    "w-full sm:w-auto",
                  )}
                >
                  <Globe
                    aria-hidden="true"
                    size={18}
                    strokeWidth={ICON_STROKE}
                  />
                  {websiteLabel(website.value)}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>
            <p className="cq-caption max-w-prose text-(--cq-text-tertiary)">
              {participant
                ? `Ask Q about ${card.name}, save them or express interest from inside Capital Q.`
                : `Sign in to ask Q about ${card.name}, see what they share with members, or express interest.`}
            </p>
          </section>
        </div>
      </header>

      {tagline === null ? null : (
        <section
          aria-labelledby="about-heading"
          className="flex flex-col gap-2 px-4 sm:px-0"
        >
          <h2 id="about-heading" className="cq-title-sm">
            About
          </h2>
          <SeeMore text={tagline} />
        </section>
      )}

      {facts.length === 0 ? null : (
        <section
          aria-labelledby="facts-heading"
          className="flex flex-col gap-2 px-4 sm:px-0"
        >
          <h2 id="facts-heading" className="cq-title-sm">
            At a glance
          </h2>
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {facts.map((field) => (
              <div
                key={field.key}
                data-card-field={field.key}
                data-scope={field.scope}
                className="flex items-baseline justify-between gap-6 py-3"
              >
                <dt className="cq-body-sm shrink-0 text-(--cq-text-secondary)">
                  {cardFieldLabel(field.key)}
                </dt>
                <dd className="cq-body min-w-0 text-right break-words">
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
        </section>
      )}

      <footer className="mx-4 flex flex-col gap-1 border-t border-(--cq-border-subtle) pt-4 sm:mx-0">
        <p className="cq-caption text-(--cq-text-tertiary)">
          This is {card.name}&apos;s Q Card, @{card.handle}. Capital Q shows
          only what they chose to make public
          {participant ? " or share with members" : ""}. Nothing here is an
          endorsement.
        </p>
      </footer>
    </div>
  );
}
