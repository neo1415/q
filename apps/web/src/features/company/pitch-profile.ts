import type {
  CompanyProfileTeamMember,
  DeckFact,
  DeckSection,
  DeckSectionCode,
  PitchClaimDto,
  PitchClaimKind,
  PitchSectionFactDto,
} from "@capital-q/contracts";
import {
  FOUNDER_PROFILE_SECTIONS,
  type FounderProfileSection,
} from "@capital-q/founder-onboarding/profile-sections";

import {
  deckFactSource,
  type ReadFact,
  type ReadSection,
} from "./material/read-section";
import { compactMoneyText, moneyText } from "./money-text";
import { pitchMoment } from "./overview-sections";

/**
 * The profile's Overview as the pitch deck's shape (owner 2026-10-16): the
 * same sections, in the same order, for every company, so an investor
 * never needs to open the deck. The sections, their order and titles are
 * the founder profile's one versioned list (`FOUNDER_PROFILE_SECTIONS`,
 * lane ob1); this file only says where each section's facts come from.
 *
 * Sources, in order: Q's confirmed read of the deck, then what the pitch
 * videos this reader may play say, then the founder's confirmed answers.
 * Every input is what the server already sent THIS reader (the deck read
 * only where they may see the deck, pitch claims only from pitches they may
 * play, the raise only where it is disclosed to them): nothing here reads
 * or decides access, so founder-private data cannot reach an investor
 * through it (Context Firewall). Unknown stays "Not provided", never zero
 * and never "poor"; every row keeps its truth class in its source line.
 */

/** Where one section's facts may come from in the deck read. */
type DeckSource = {
  readonly from: readonly DeckSectionCode[] | "ANY";
  /**
   * Only facts whose label matches (a section the deck has no heading
   * for: Moats, Roadmap). Such facts belong to this section, not to their
   * deck heading's. Absent: the whole deck section, summary included.
   */
  readonly match?: RegExp;
  /** The rows' sub-heading inside the card ("Traction"). */
  readonly group?: string;
};

type SectionSources = {
  readonly deck: readonly DeckSource[];
  readonly pitch: readonly PitchClaimKind[];
  readonly answers: readonly ("SUMMARY" | "SECTOR" | "TEAM" | "RAISE")[];
  /** Closing is the founder's own last word: hidden when absent, not a gap. */
  readonly hideWhenEmpty?: boolean;
  /** A short chip where the title is long. */
  readonly chip?: string;
};

const MOAT =
  /\b(moats?|advantages?|defensib\w*|barriers?|patents?|proprietary|network effects?|\bip\b)/iu;
const HOW =
  /\b(how it works|product|technology|platform|workflow|mechanism|architecture)\b/iu;
const VISION = /\b(vision|mission|long[- ]term)\b/iu;
const ROADMAP = /\b(roadmap|milestones?|timeline|next \d+ months)\b/iu;
const WHY_NOW = /\b(why now|why us|timing|tailwinds?)\b/iu;
const CLOSING = /\b(closing|next steps?|call to action|contact)\b/iu;

/**
 * The source map, by section key. A key the list adds later and this map
 * lacks is still shown, honestly empty ("Not provided"), never dropped.
 */
export const PROFILE_SECTION_SOURCES: Readonly<Record<string, SectionSources>> =
  {
    opportunity: {
      deck: [
        { from: ["MARKET", "VALUE_PROPOSITION"] },
        { from: ["TRACTION"], group: "Traction" },
        { from: ["FINANCIALS"], group: "Economics" },
      ],
      pitch: ["TRACTION"],
      answers: ["SECTOR"],
      chip: "Opportunity",
    },
    problem: {
      deck: [{ from: ["PROBLEM"] }],
      pitch: [],
      answers: [],
      chip: "Problem",
    },
    solution: {
      deck: [{ from: ["SOLUTION"] }],
      pitch: [],
      answers: ["SUMMARY"],
    },
    how_it_works: {
      deck: [{ from: ["SOLUTION", "VALUE_PROPOSITION"], match: HOW }],
      pitch: [],
      answers: [],
    },
    business_model: {
      deck: [{ from: ["BUSINESS_MODEL"] }],
      pitch: [],
      answers: [],
    },
    vision: {
      deck: [{ from: "ANY", match: VISION }],
      pitch: [],
      answers: [],
      chip: "Vision",
    },
    team: {
      deck: [{ from: ["FOUNDERS", "TEAM"] }],
      pitch: [],
      answers: ["TEAM"],
      chip: "Team",
    },
    go_to_market: {
      deck: [{ from: ["GO_TO_MARKET"] }],
      pitch: [],
      answers: [],
      chip: "Go-to-market",
    },
    competition: {
      deck: [{ from: ["COMPETITION"] }],
      pitch: [],
      answers: [],
      chip: "Competition",
    },
    moats: {
      deck: [
        { from: ["COMPETITION", "VALUE_PROPOSITION", "SOLUTION"], match: MOAT },
      ],
      pitch: [],
      answers: [],
    },
    roadmap: {
      deck: [{ from: "ANY", match: ROADMAP }],
      pitch: [],
      answers: [],
    },
    why_us_why_now: {
      deck: [{ from: "ANY", match: WHY_NOW }],
      pitch: [],
      answers: [],
      chip: "Why us, why now",
    },
    ask: {
      deck: [{ from: ["THE_ASK"] }],
      pitch: ["RAISE", "INSTRUMENT", "USE_OF_FUNDS"],
      answers: ["RAISE"],
      chip: "Ask",
    },
    closing: {
      deck: [{ from: "ANY", match: CLOSING }],
      pitch: [],
      answers: [],
      hideWhenEmpty: true,
    },
  };

/** What a video row is covered by in the deck: the deck wins. */
const PITCH_COVERED_BY: Readonly<Record<PitchClaimKind, RegExp>> = {
  RAISE: /\b(amount|rais\w*|round size|sought|target)\b/iu,
  INSTRUMENT: /\binstrument\b/iu,
  USE_OF_FUNDS: /\b(use of funds|allocation|spend)\b/iu,
  TRACTION: /\btraction\b/iu,
  STAGE: /\bstage\b/iu,
};
const PITCH_LABEL: Readonly<Record<PitchClaimKind, string>> = {
  RAISE: "Raising",
  INSTRUMENT: "Instrument",
  USE_OF_FUNDS: "Use of funds",
  TRACTION: "Traction",
  STAGE: "Stage",
};

export type PitchProfileInput = {
  readonly companyName: string;
  /** The owner (and their team) reading their own company. */
  readonly own: boolean;
  /** Q's read of the deck as this reader may see it; null: none. */
  readonly deckSections: readonly DeckSection[] | null;
  readonly pitchClaims: readonly PitchClaimDto[];
  /**
   * Q's stored reading of the pitches this reader may play, by section
   * (`sectionKey` is the section's factKey, else its key). Absent: none.
   */
  readonly pitchSections?: readonly PitchSectionFactDto[];
  readonly answers: {
    readonly shortDescription: string | null;
    readonly sectorLabels: readonly string[];
    readonly team: readonly CompanyProfileTeamMember[];
    /** The raise, only where it is disclosed to this reader. */
    readonly raise: {
      readonly amount: string;
      readonly currency: string;
    } | null;
  };
  /** Where a founder's "tell Q" goes for a section. */
  readonly tellQHref?: (section: FounderProfileSection) => string;
};

const ANSWER_SOURCE = "Founder's claim · Confirmed answer";

/** "$1.5m" and "$1.5M" are one figure; "$750K" and "$1.5m" are not. */
function sameFigure(a: string | null, b: string): boolean {
  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/[\s,“”"]/gu, "")
      .replace(/\.0+(?=[a-z]|$)/u, "");
  return a !== null && plain(a) === plain(b);
}

function slideLine(pages: readonly number[]): string | null {
  const unique = [...new Set(pages)].sort((a, b) => a - b);
  const first = unique[0];
  const last = unique.at(-1);
  if (first === undefined || last === undefined) return null;
  return first === last
    ? `Slide ${String(first)}`
    : `Slides ${String(first)}–${String(last)}`;
}

function deckRow(fact: DeckFact, group?: string): ReadFact {
  return {
    key: `deck-${fact.label}-${fact.pages.join(",")}`,
    label: fact.label,
    value: fact.value,
    source: deckFactSource(fact),
    group: group ?? null,
  };
}

/** The facts a label-matched section takes away from its deck heading. */
function claimedFacts(sections: readonly DeckSection[]): ReadonlySet<DeckFact> {
  const claimed = new Set<DeckFact>();
  for (const sources of Object.values(PROFILE_SECTION_SOURCES)) {
    for (const source of sources.deck) {
      if (source.match === undefined) continue;
      for (const section of sections) {
        if (source.from !== "ANY" && !source.from.includes(section.section))
          continue;
        for (const fact of section.facts) {
          if (source.match.test(fact.label)) claimed.add(fact);
        }
      }
    }
  }
  return claimed;
}

export type PitchProfileSection = ReadSection & {
  readonly sectionKey: string;
  readonly provided: boolean;
};

/** Every section of the Overview, in the list's order, for this reader. */
export function pitchProfileSections(
  input: PitchProfileInput,
): readonly PitchProfileSection[] {
  const deck = input.deckSections;
  const claimed = deck === null ? new Set<DeckFact>() : claimedFacts(deck);
  const ordered = [...FOUNDER_PROFILE_SECTIONS].sort(
    (a, b) => a.order - b.order,
  );
  const out: PitchProfileSection[] = [];
  for (const spec of ordered) {
    const sources = PROFILE_SECTION_SOURCES[spec.key] ?? {
      deck: [],
      pitch: [],
      answers: [],
    };
    const rows: ReadFact[] = [];
    const pages: number[] = [];
    let summary: string | null = null;
    let summarySource: string | null = null;
    let fromDeck = false;
    let unclear: DeckSection["status"] | null = null;

    // 1. Q's confirmed read of the deck.
    for (const source of sources.deck) {
      for (const section of deck ?? []) {
        if (source.from !== "ANY" && !source.from.includes(section.section))
          continue;
        if (source.match === undefined) {
          if (section.status === "CONTRADICTORY") unclear = "CONTRADICTORY";
          else if (section.status === "UNCLEAR" && unclear === null)
            unclear = "UNCLEAR";
          if (section.status !== "PRESENT") continue;
          fromDeck = true;
          pages.push(...section.pages);
          if (summary === null && section.summary !== null) {
            summary = section.summary;
          }
          for (const fact of section.facts) {
            if (!claimed.has(fact)) rows.push(deckRow(fact, source.group));
          }
        } else {
          for (const fact of section.facts) {
            if (fact.value === null || !source.match.test(fact.label)) continue;
            fromDeck = true;
            pages.push(...fact.pages);
            rows.push(deckRow(fact, source.group));
          }
        }
      }
    }

    // 2. The pitch videos this reader may play, where the deck lacks it:
    // Q's reading of each transcript for this section, else (for the few
    // topics it covers) the code-read claims.
    const sectionKey = spec.factKey ?? spec.key;
    const spoken = fromDeck
      ? []
      : (input.pitchSections ?? []).filter(
          (fact) => fact.sectionKey === sectionKey,
        );
    for (const fact of spoken) {
      rows.push({
        key: `said-${fact.pitchId}-${String(fact.atSeconds)}-${fact.label}`,
        label: fact.label,
        value: fact.value,
        source: `Founder's claim · Pitch video ${pitchMoment(fact.atSeconds)}`,
        group: null,
      });
    }
    for (const kind of spoken.length > 0 ? [] : sources.pitch) {
      const covered =
        kind === "TRACTION"
          ? rows.some((row) => row.group === "Traction")
          : rows.some((row) => PITCH_COVERED_BY[kind].test(row.label));
      // The raise is the one figure both may state: a pitch that says a
      // different amount from the deck is shown beside it, never dropped
      // (contradictions coexist until reconciled).
      if (covered && kind !== "RAISE") continue;
      for (const claim of input.pitchClaims.filter((c) => c.kind === kind)) {
        const value =
          kind === "RAISE" && claim.money !== null
            ? compactMoneyText(claim.money)
            : kind === "INSTRUMENT" && claim.instrument !== null
              ? claim.instrument
              : `“${claim.statement}”`;
        if (
          covered &&
          rows.some(
            (row) =>
              PITCH_COVERED_BY.RAISE.test(row.label) &&
              sameFigure(row.value, value),
          )
        ) {
          continue;
        }
        rows.push({
          key: `pitch-${claim.pitchId}-${String(claim.atSeconds)}-${kind}`,
          label: covered
            ? `${PITCH_LABEL[kind]}, in the pitch`
            : PITCH_LABEL[kind],
          value,
          source: `Founder's claim · Pitch video ${pitchMoment(claim.atSeconds)}`,
          group:
            kind === "TRACTION" && spec.key === "opportunity"
              ? "Traction"
              : null,
        });
      }
    }

    // 3. The founder's confirmed answers, where neither said it.
    const answers = input.answers;
    for (const answer of sources.answers) {
      if (answer === "SUMMARY") {
        if (summary === null && answers.shortDescription !== null) {
          summary = answers.shortDescription;
          summarySource = ANSWER_SOURCE;
        }
      } else if (answer === "SECTOR") {
        if (
          answers.sectorLabels.length > 0 &&
          !rows.some((row) => /\b(sector|industry)\b/iu.test(row.label))
        ) {
          rows.push({
            key: "answer-sector",
            label: "Sector",
            value: answers.sectorLabels.join(", "),
            source: ANSWER_SOURCE,
            group: null,
          });
        }
      } else if (answer === "TEAM") {
        for (const [index, member] of answers.team.entries()) {
          if (rows.some((row) => (row.value ?? "").includes(member.name)))
            continue;
          rows.push({
            key: `answer-team-${String(index)}`,
            label: member.name,
            value:
              member.businessTitle ?? (member.isFounder ? "Founder" : "Team"),
            source:
              member.source === "PUBLIC_SOURCE"
                ? "From public sources, unconfirmed"
                : ANSWER_SOURCE,
            group: null,
          });
        }
      } else if (
        answers.raise !== null &&
        !rows.some((row) => PITCH_COVERED_BY.RAISE.test(row.label))
      ) {
        rows.push({
          key: "answer-raise",
          label: "Raising",
          value: moneyText(answers.raise),
          source: ANSWER_SOURCE,
          group: null,
        });
      }
    }

    const provided = rows.length > 0 || summary !== null;
    if (!provided && sources.hideWhenEmpty === true) continue;
    const label = spec.title;
    const status: DeckSection["status"] =
      unclear === "CONTRADICTORY"
        ? "CONTRADICTORY"
        : fromDeck
          ? "PRESENT"
          : (unclear ?? "NOT_IN_DECK");
    const statusWords =
      status === "CONTRADICTORY"
        ? "Numbers disagree"
        : status === "PRESENT"
          ? "In the deck"
          : status === "UNCLEAR"
            ? "Unclear in the deck"
            : deck === null
              ? "No deck read yet"
              : input.own
                ? "Not in your deck yet"
                : "Not in the deck";
    const where = slideLine(pages);
    out.push({
      key: spec.key,
      sectionKey: spec.key,
      provided,
      label,
      chip: sources.chip ?? label,
      status,
      statusWords,
      summary,
      summarySource,
      emptyText: provided
        ? ""
        : input.own
          ? "Not in your deck yet — tell Q."
          : "Not provided. Unknown, not zero: ask them.",
      facts: rows,
      where: where === null ? null : `${where} of the deck`,
      askHref: `/home?ask=${encodeURIComponent(`About ${input.companyName}'s ${label.toLowerCase()}: `)}`,
      askLabel: `Ask Q about ${label.toLowerCase()}`,
      ...(input.own &&
      !provided &&
      spec.askable &&
      input.tellQHref !== undefined
        ? {
            prompt: {
              href: input.tellQHref(spec),
              label: "Tell Q",
              question: spec.question,
            },
          }
        : {}),
    });
  }
  return out;
}

/** A section's position by key; -1 when the list has no such key. */
export function pitchProfileIndex(
  sections: readonly Pick<PitchProfileSection, "sectionKey">[],
  key: string | null,
): number {
  if (key === null) return -1;
  const wanted = key.toLowerCase();
  return sections.findIndex((section) => section.sectionKey === wanted);
}
