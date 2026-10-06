import Link from "next/link";

import type {
  CompanyProfileTeamMember,
  DeckFact,
  FounderPersonDto,
} from "@capital-q/contracts";
import {
  ChevronRight,
  FileText,
  ICON_SIZE,
  MapPin,
  MessageSquare,
  Search,
  ShieldCheck,
  UserRound,
} from "@capital-q/ui/icons";
import { buttonClassName } from "@capital-q/ui/button";

import { EntityAvatar } from "../../entity/entity-avatar";

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

export function TeamTab({
  companyId,
  team,
  fromDeck,
}: {
  readonly companyId: string;
  readonly team: readonly CompanyProfileTeamMember[];
  readonly fromDeck: readonly DeckFact[];
}) {
  const founders = team.filter((member) => member.isFounder);
  const others = team.filter((member) => !member.isFounder);
  if (team.length === 0 && fromDeck.length === 0) {
    return (
      <p className="cq-body py-6 text-(--cq-text-secondary)" data-team="empty">
        No team shown to you yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-8" data-team="full">
      {founders.length === 0 ? null : (
        <section
          className="flex flex-col gap-2"
          aria-labelledby="founders-title"
        >
          <h2
            id="founders-title"
            className="cq-title-sm text-(--cq-text-primary)"
          >
            Founders
          </h2>
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
            {founders.map((member, index) => (
              <li key={`${member.name}-${String(index)}`}>
                <Link
                  href={`/company/${encodeURIComponent(companyId)}/founder/${String(index + 1)}`}
                  className="flex items-start gap-4 py-4 hover:bg-(--cq-surface-subtle)"
                >
                  <EntityAvatar kind="person" name={member.name} decorative />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="cq-title-sm text-(--cq-text-primary)">
                      {member.name}
                    </span>
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {["Co-founder", member.businessTitle]
                        .filter(Boolean)
                        .join(" and ")}
                    </span>
                    {member.shortBio === null ? null : (
                      <span className="cq-body-sm line-clamp-2 text-(--cq-text-primary)">
                        {member.shortBio}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    size={ICON_SIZE.regular}
                    aria-hidden="true"
                    className="mt-3 text-(--cq-text-tertiary)"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {others.length === 0 ? null : (
        <section className="flex flex-col gap-3" aria-labelledby="team-title">
          <div className="flex items-baseline justify-between">
            <h2
              id="team-title"
              className="cq-title-sm text-(--cq-text-primary)"
            >
              Team
            </h2>
            <span className="cq-caption text-(--cq-text-secondary)">
              {team.length} people
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {others.map((member, index) => (
              <li
                key={`${member.name}-${String(index)}`}
                className="flex items-center gap-3"
              >
                <EntityAvatar kind="person" name={member.name} decorative />
                <span className="flex min-w-0 flex-col">
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {member.name}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {member.businessTitle ??
                      RELATIONSHIP_WORDS[member.relationshipType]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {fromDeck.length === 0 ? null : (
        <section
          className="flex flex-col gap-2"
          aria-labelledby="deck-team-title"
        >
          <h2
            id="deck-team-title"
            className="cq-title-sm text-(--cq-text-primary)"
          >
            What the deck says about the team
          </h2>
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
            {fromDeck.map((fact) => (
              <li
                key={`${fact.label}-${fact.pages.join(",")}`}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <span className="cq-body text-(--cq-text-primary)">
                  {fact.label}
                  {fact.value === null ? null : (
                    <span className="text-(--cq-text-secondary)">
                      : {fact.value}
                    </span>
                  )}
                </span>
                <span className="cq-caption shrink-0 text-(--cq-text-secondary)">
                  From the deck
                  {fact.pages.length === 0
                    ? ""
                    : `, slide ${String(fact.pages[0])}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function FounderPerson({
  person,
}: {
  readonly person: FounderPersonDto;
}) {
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
          {person.identityVerified ? (
            <p className="cq-caption flex items-center gap-1.5 text-(--cq-text-secondary)">
              <ShieldCheck size={ICON_SIZE.compact} aria-hidden="true" />{" "}
              Identity verified by Capital Q
            </p>
          ) : null}
        </div>
      </header>
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/relationships/company/${encodeURIComponent(person.companyId)}`}
          className={buttonClassName("secondary", "regular")}
        >
          <MessageSquare size={ICON_SIZE.compact} aria-hidden="true" /> Message
        </Link>
        <Link
          href={`/q?ask=${encodeURIComponent(`Tell me about ${person.name} of ${person.companyName}.`)}`}
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
            In their words
          </h2>
          <p className="cq-body text-(--cq-text-primary)">
            {person.inTheirWords}
          </p>
        </section>
      )}
      <section className="flex flex-col gap-2" aria-labelledby="background">
        <h2 id="background" className="cq-title-sm text-(--cq-text-primary)">
          Background
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
            What they&rsquo;re looking for
          </h2>
          <p className="cq-body text-(--cq-text-primary)">
            {person.lookingFor}
          </p>
        </section>
      )}
    </article>
  );
}
