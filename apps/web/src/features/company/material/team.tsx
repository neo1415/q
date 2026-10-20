"use client";

import Link from "next/link";
import { useState } from "react";

import type {
  CompanyProfileTeamMember,
  DeckFact,
  FounderPersonDto,
} from "@capital-q/contracts";
import {
  Check,
  ChevronRight,
  FileText,
  ICON_SIZE,
  MapPin,
  MessageSquare,
  Search,
  UserRound,
} from "@capital-q/ui/icons";
import { buttonClassName } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { VerifiedBadge } from "@/components/verified-badge";

import { EntityAvatar } from "../../entity/entity-avatar";
import { useT } from "@/features/i18n/language";
import {
  BriefCard,
  BriefGrid,
  ClaimLine,
  initials,
  QReadCard,
} from "../brief/parts";

/**
 * The Team tab (A1) and a founder as a person (A7). The team is ADR 0041's
 * allow-listed projection; a founder opens their own page by position,
 * never by an id. What the deck says about the team is labelled as the
 * deck's own words, with its slide.
 */

const RELATIONSHIP_WORDS: Readonly<
  Record<CompanyProfileTeamMember["relationshipType"], string>
> = {
  team_member: "Team",
  advisor: "Advisor",
  board_member: "Board",
  contractor: "Contractor",
  other: "Other",
};

/**
 * A member's role in one line. The founder flag and the declared title
 * often say the same thing ("Co-founder & CEO"), so the founder word is
 * added only when the title does not already carry it.
 */
export function memberRole(member: CompanyProfileTeamMember): string {
  const title = member.businessTitle?.trim() ?? "";
  if (member.isFounder) {
    if (title === "") return "Co-founder";
    return /founder/i.test(title) ? title : `Co-founder · ${title}`;
  }
  return title === "" ? RELATIONSHIP_WORDS[member.relationshipType] : title;
}

export function TeamTab({
  companyId,
  companyName = "The company",
  team,
  fromDeck,
  founders = [],
  investor = false,
}: {
  readonly companyId: string;
  readonly companyName?: string | undefined;
  readonly team: readonly CompanyProfileTeamMember[];
  readonly fromDeck: readonly DeckFact[];
  /**
   * The founders' own pages, by position (1-based order of the founders in
   * the team), where this reader may open them; null where not.
   */
  readonly founders?: readonly (FounderPersonDto | null)[] | undefined;
  /** Message and the relationship are an investor's. */
  readonly investor?: boolean | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  // Founders first, in the server's order: a founder's page is addressed
  // by that position, so the position is kept beside each member.
  const people = [
    ...team
      .filter((member) => member.isFounder)
      .map((member, index) => ({
        member,
        founderIndex: index + 1,
        person: founders[index] ?? null,
      })),
    ...team
      .filter((member) => !member.isFounder)
      .map((member) => ({ member, founderIndex: null, person: null })),
  ];
  const chosen = open === null ? undefined : people[open];
  if (team.length === 0 && fromDeck.length === 0) {
    return (
      <p className="cq-body py-6 text-(--cq-text-secondary)" data-team="empty">
        {t("No team shown to you yet.")}
      </p>
    );
  }
  const verified = people.filter((p) => p.person?.identityVerified === true);
  const others = people.length - verified.length;
  const main = (
    <>
      {people.length === 0 ? null : (
        <section aria-labelledby="team-title">
          <div className="cq-brief-row" style={{ marginBottom: 4 }}>
            <h2 id="team-title" className="cq-brief-title m-0">
              {t("Team")}
            </h2>
            <span className="cq-brief-label">
              {people.length} {people.length === 1 ? "person" : "people"}
            </span>
          </div>
          <ul className="cq-brief-people m-0 list-none p-0">
            {people.map(({ member, person }, index) => (
              <li key={`${member.name}-${String(index)}`}>
                <button
                  type="button"
                  onClick={() => setOpen(index)}
                  className="cq-brief-person"
                  data-team-member
                >
                  <span className="cq-brief-av" aria-hidden="true">
                    {initials(member.name)}
                  </span>
                  <span className="pp">
                    <b>{member.name}</b>
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {memberRole(member)}
                    </span>
                    {member.shortBio === null ? (
                      <span className="cq-brief-label">
                        {t("No bio shared yet.")}
                      </span>
                    ) : (
                      <span className="pbio">{member.shortBio}</span>
                    )}
                    <span className="mt-1.5">
                      <IdentityTag
                        verified={person?.identityVerified === true}
                        source={member.source}
                      />
                    </span>
                  </span>
                  <ChevronRight
                    size={ICON_SIZE.regular}
                    aria-hidden="true"
                    className="mt-2 text-(--cq-text-tertiary)"
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {fromDeck.length === 0 ? null : (
        <section className="cq-brief-card" aria-labelledby="deck-team-title">
          <h2 id="deck-team-title" className="cq-brief-title m-0">
            {t("What the deck says about the team")}
          </h2>
          <div>
            {fromDeck.map((fact) => (
              <div
                key={`${fact.label}-${fact.pages.join(",")}`}
                className="cq-brief-erow"
                data-two=""
              >
                <span className="ek">
                  {fact.label}
                  {fact.value === null ? null : (
                    <span className="text-(--cq-text-secondary)">
                      : {fact.value}
                    </span>
                  )}
                </span>
                <span className="cq-brief-label">
                  From the deck
                  {fact.pages.length === 0
                    ? ""
                    : `, slide ${String(fact.pages[0])}`}
                </span>
              </div>
            ))}
          </div>
          <ClaimLine>{t("Founder’s claims, not verified")}</ClaimLine>
        </section>
      )}
    </>
  );
  const rail = (
    <>
      <QReadCard>
        <p data-size="sm">
          {people.length === 0
            ? `${companyName} names no one for you yet; the deck describes the team in its own words.`
            : `${String(people.length)} ${people.length === 1 ? "person" : "people"} named by ${companyName}, ${String(people.filter((p) => p.member.isFounder).length)} of them founders.`}
        </p>
        <p className="qual">
          {verified.length === 0
            ? "No identity is verified by Capital Q yet. Roles and backgrounds are in their own words."
            : "Roles and backgrounds are in their own words; only the identities marked are checked."}
        </p>
      </QReadCard>
      <BriefCard title={t("What is verified")}>
        {verified.map(({ member }) => (
          <div key={member.name} className="cq-brief-rq">
            <span className="cq-brief-dot" data-k="ok" />
            <div>
              <b>{member.name}’s identity</b>
              <span className="cq-brief-label">{t("Checked by Capital Q")}</span>
            </div>
          </div>
        ))}
        {others === 0 ? null : (
          <div className="cq-brief-rq">
            <span className="cq-brief-dot" data-k="miss" />
            <div>
              <b>
                {verified.length === 0
                  ? `${others === 1 ? "The person" : `The ${String(others)} people`} named`
                  : `The other ${others === 1 ? "person" : `${String(others)} people`}`}
              </b>
              <span className="cq-brief-label">
                Named by {companyName}, not checked
              </span>
            </div>
          </div>
        )}
        <div className="cq-brief-rq">
          <span className="cq-brief-dot" data-k="miss" />
          <div>
            <b>{t("Their roles and backgrounds")}</b>
            <span className="cq-brief-label">{t("In their own words")}</span>
          </div>
        </div>
      </BriefCard>
    </>
  );
  return (
    <div data-team="full">
      <BriefGrid main={main} rail={rail} />
      <SheetRoot
        open={chosen !== undefined}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        {chosen === undefined ? null : (
          <SheetContent side="side" title={chosen.member.name}>
            <PersonSheet
              companyId={companyId}
              companyName={companyName}
              member={chosen.member}
              founderIndex={chosen.founderIndex}
              person={chosen.person}
              investor={investor}
            />
          </SheetContent>
        )}
      </SheetRoot>
    </div>
  );
}

function IdentityTag({
  verified,
  source,
}: {
  readonly verified: boolean;
  readonly source: CompanyProfileTeamMember["source"];
}) {
  const t = useT();
  if (verified)
    return (
      <span className="cq-brief-tag" data-tone="positive">
        <Check size={ICON_SIZE.compact} aria-hidden="true" />
        {t("Identity verified by Capital Q")}
      </span>
    );
  return (
    <span className="cq-brief-tag">
      {source === "PUBLIC_SOURCE"
        ? t("From public sources, unconfirmed")
        : t("Identity not verified yet")}
    </span>
  );
}

/** One person, in a side sheet: what they shared, and what is checked. */
function PersonSheet({
  companyId,
  companyName,
  member,
  founderIndex,
  person,
  investor,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly member: CompanyProfileTeamMember;
  readonly founderIndex: number | null;
  readonly person: FounderPersonDto | null;
  readonly investor: boolean;
}) {
  const t = useT();
  const first = member.name.split(" ")[0] ?? member.name;
  const background: readonly (readonly [string, string | null])[] =
    founderIndex === null
      ? []
      : [
          [
            "Building since",
            person?.buildingSince === null || person === null
              ? null
              : String(person.buildingSince),
          ],
          [
            "Companies founded",
            person?.companiesFounded === null || person === null
              ? null
              : String(person.companiesFounded),
          ],
        ];
  return (
    <div className="flex flex-col gap-4 pb-4" data-team-member-sheet>
      <div className="flex items-center gap-3.5">
        <span className="cq-brief-av" data-size="lg" aria-hidden="true">
          {initials(member.name)}
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="cq-body text-(--cq-text-primary)">
            {memberRole(member)}
          </span>
          <span>
            <IdentityTag
              verified={person?.identityVerified === true}
              source={member.source}
            />
          </span>
        </div>
      </div>
      {member.shortBio === null ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t("No bio shared yet.")}
        </p>
      ) : (
        <p className="cq-body text-(--cq-text-primary)">{member.shortBio}</p>
      )}
      {person?.inTheirWords === null || person === null ? null : (
        <div>
          <p className="cq-brief-label" style={{ marginBottom: 6 }}>
            {t("In their words")}
          </p>
          <blockquote className="cq-brief-quote">
            “{person.inTheirWords}”
          </blockquote>
        </div>
      )}
      {background.length === 0 ? null : (
        <div>
          <p className="cq-brief-label" style={{ marginBottom: 6 }}>
            {t("Background")}
          </p>
          <dl className="cq-brief-kv" data-cols="2">
            {background.map(([term, value]) => (
              <div key={term}>
                <dt className="cq-brief-label">{term}</dt>
                <dd className="m-0">
                  <b
                    style={
                      value === null
                        ? { fontWeight: 400, color: "var(--cq-text-tertiary)" }
                        : undefined
                    }
                  >
                    {value ?? "Not shared"}
                  </b>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <ClaimLine>Shared by {companyName}, not verified</ClaimLine>
      <div className="flex flex-wrap gap-2">
        {founderIndex === null ? null : (
          <Link
            href={`/company/${encodeURIComponent(companyId)}/founder/${String(founderIndex)}`}
            className={buttonClassName("secondary", "compact")}
          >
            {t("Open full profile")}
            <ChevronRight size={ICON_SIZE.compact} aria-hidden="true" />
          </Link>
        )}
        {investor ? (
          <Link
            href={`/relationships/company/${encodeURIComponent(companyId)}/messages`}
            className={buttonClassName("secondary", "compact")}
          >
            <MessageSquare size={ICON_SIZE.compact} aria-hidden="true" />{" "}
            {t("Message")}
          </Link>
        ) : null}
        <Link
          href={`/home?ask=${encodeURIComponent(`Tell me about ${member.name} of ${companyName}.`)}`}
          className={buttonClassName("quiet", "compact")}
        >
          <Search size={ICON_SIZE.compact} aria-hidden="true" /> Ask Q about{" "}
          {first}
        </Link>
      </div>
    </div>
  );
}

export function FounderPerson({
  person,
}: {
  readonly person: FounderPersonDto;
}) {
  const t = useT();
  const all: readonly (readonly [string, string | null])[] = [
    ["Age", person.age === null ? null : String(person.age)],
    [
      "Building since",
      person.buildingSince === null ? null : String(person.buildingSince),
    ],
    [
      "Companies founded",
      person.companiesFounded === null ? null : String(person.companiesFounded),
    ],
    ["Exits", person.exits],
  ];
  const stats = all.filter(
    (entry): entry is readonly [string, string] => entry[1] !== null,
  );
  const first = person.name.split(" ")[0] ?? person.name;
  return (
    <article
      className="flex max-w-(--cq-layout-narrow) flex-col gap-6"
      aria-labelledby="person-name"
      data-founder-person
    >
      <header className="flex items-start gap-4">
        <EntityAvatar kind="person" name={person.name} decorative />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id="person-name" className="cq-title-lg text-(--cq-text-primary)">
            {person.name}
          </h1>
          <p className="cq-body text-(--cq-text-primary)">
            {person.roleLine.replace(`, ${person.companyName}`, "")},{" "}
            <Link
              href={`/company/${encodeURIComponent(person.companyId)}`}
              className="underline underline-offset-4"
            >
              {person.companyName}
            </Link>
          </p>
          {person.location === null ? null : (
            <p className="cq-caption flex items-center gap-1.5 text-(--cq-text-secondary)">
              <MapPin size={ICON_SIZE.compact} aria-hidden="true" />{" "}
              {person.location}
            </p>
          )}
          <VerifiedBadge
            status={person.identityVerified ? "VERIFIED" : null}
            className="self-start"
          >
            {t("Identity verified by Capital Q")}
          </VerifiedBadge>
        </div>
      </header>
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/relationships/company/${encodeURIComponent(person.companyId)}`}
          className={buttonClassName("secondary", "regular")}
        >
          <MessageSquare size={ICON_SIZE.compact} aria-hidden="true" />{" "}
          {t("Message")}
        </Link>
        <Link
          href={`/home?ask=${encodeURIComponent(`Tell me about ${person.name} of ${person.companyName}.`)}`}
          className={buttonClassName("quiet", "regular")}
        >
          <Search size={ICON_SIZE.compact} aria-hidden="true" /> Ask Q about{" "}
          {first}
        </Link>
      </div>
      {stats.length === 0 ? null : (
        <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-(--cq-border-subtle) py-4">
          {stats.map(([term, value]) => (
            <div key={term} className="flex flex-col gap-0.5">
              <dt className="cq-caption text-(--cq-text-secondary)">{term}</dt>
              <dd className="cq-title-sm cq-numeric text-(--cq-text-primary)">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {person.inTheirWords === null ? null : (
        <section className="flex flex-col gap-2" aria-labelledby="their-words">
          <h2 id="their-words" className="cq-title-sm text-(--cq-text-primary)">
            {t("In their words")}
          </h2>
          <p className="cq-body text-(--cq-text-primary)">
            {person.inTheirWords}
          </p>
        </section>
      )}
      <section className="flex flex-col gap-2" aria-labelledby="background">
        <h2 id="background" className="cq-title-sm text-(--cq-text-primary)">
          {t("Background")}
        </h2>
        {person.background.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {first} hasn&rsquo;t shared their background here yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
            {person.background.map((line) => (
              <li
                key={`${line.title}-${line.from ?? ""}`}
                className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 py-4"
              >
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  {line.from ?? ""}
                  {line.current
                    ? " – now"
                    : line.to === null
                      ? ""
                      : ` – ${line.to}`}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="cq-body text-(--cq-text-primary)">
                    {line.title}
                  </span>
                  {line.detail === null ? null : (
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {line.detail}
                    </span>
                  )}
                  <span
                    className="cq-caption inline-flex items-center gap-1 text-(--cq-text-secondary)"
                    data-evidence={line.evidence}
                  >
                    {line.evidence === "MATCHES_SHARED_DOCUMENT" ? (
                      <>
                        <FileText size={ICON_SIZE.compact} aria-hidden="true" />{" "}
                        Matches a shared document
                      </>
                    ) : (
                      <>
                        <UserRound
                          size={ICON_SIZE.compact}
                          aria-hidden="true"
                        />{" "}
                        Founder&rsquo;s claim
                      </>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {person.lookingFor === null ? null : (
        <section className="flex flex-col gap-2" aria-labelledby="looking-for">
          <h2 id="looking-for" className="cq-title-sm text-(--cq-text-primary)">
            {t("What they’re looking for")}
          </h2>
          <p className="cq-body text-(--cq-text-primary)">
            {person.lookingFor}
          </p>
        </section>
      )}
    </article>
  );
}
