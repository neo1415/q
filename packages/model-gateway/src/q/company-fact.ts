import { AuthorisedFactSchema, type AuthorisedFact } from "@capital-q/q-core";
import { latestFigures } from "./latest-figures.js";

/**
 * The company on the person's screen, read for them before the model is
 * asked (speed sweep 2026-10-01). On Discover, "how does this company
 * compare with Kazikit?" was answered "the company currently on your
 * screen is not identified": the model looked up the other company and
 * not this one, and every question about the company in front of them
 * paid a tool round (~1.4 s) plus a second model call to learn its name.
 *
 * Built from get_company's output, read through the same tool and plan
 * the model would use, so a company the firewall did not admit is never
 * read. What the company declared about itself, said as such.
 */

type CompanyRead = {
  readonly canonicalName?: unknown;
  readonly legalName?: unknown;
  readonly websiteUrl?: unknown;
  readonly foundedDate?: unknown;
  readonly headquartersCountry?: unknown;
  readonly headquartersCity?: unknown;
  readonly currentStageCode?: unknown;
  readonly shortDescription?: unknown;
  readonly primaryDescription?: unknown;
  readonly relationToYou?: unknown;
  readonly team?: unknown;
};

/**
 * The team as the company's page shows it (QA F-16, live 2026-10-23: on
 * Silo Credit's page, Team showing 4 members, Q said the team was not
 * known). Present only when get_company could read it for them; said
 * before the description so a long description never cuts it off.
 */
function teamLine(team: unknown): string | null {
  if (!Array.isArray(team)) return null;
  if (team.length === 0) return "No team members are recorded on its page.";
  const members = team.slice(0, 8).flatMap((member: unknown) => {
    if (typeof member !== "object" || member === null) return [];
    const one = member as {
      readonly name?: unknown;
      readonly businessTitle?: unknown;
      readonly isFounder?: unknown;
      readonly shortBio?: unknown;
    };
    const name = text(one.name);
    if (name === null) return [];
    const roles = [
      ...(text(one.businessTitle) === null ? [] : [text(one.businessTitle)]),
      ...(one.isFounder === true ? ["founder"] : []),
    ];
    const bio = text(one.shortBio);
    return [
      `${name}${roles.length === 0 ? "" : ` (${roles.join(", ")})`}${
        bio === null ? "" : `: ${bio.slice(0, 160)}`
      }`,
    ];
  });
  if (members.length === 0) return null;
  const more =
    team.length > members.length
      ? `; and ${String(team.length - members.length)} more`
      : "";
  return `Team, as its page shows it (${String(team.length)}): ${members.join("; ")}${more}.`;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export function onScreenCompanyFact(
  data: unknown,
  // R2 (owner live 7 Nov): the screen answers a pointing word only when
  // the conversation names no other, and never first person.
  label = 'The company on their screen (what they mean by "this company" when the conversation names no other; never what they mean by me or my)',
): AuthorisedFact | null {
  if (typeof data !== "object" || data === null) return null;
  const read = data as CompanyRead;
  const name = text(read.canonicalName);
  if (name === null) return null;
  const where = [text(read.headquartersCity), text(read.headquartersCountry)]
    .filter((part): part is string => part !== null)
    .join(", ");
  const parts = [
    ...(text(read.currentStageCode) === null
      ? []
      : [`stage ${text(read.currentStageCode) ?? ""}`]),
    ...(where.length === 0 ? [] : [`based in ${where}`]),
    ...(text(read.foundedDate) === null
      ? []
      : [`founded ${text(read.foundedDate) ?? ""}`]),
    ...(text(read.websiteUrl) === null
      ? []
      : [`website ${text(read.websiteUrl) ?? ""}`]),
  ];
  const description =
    text(read.primaryDescription) ?? text(read.shortDescription);
  const own = read.relationToYou === "OWN";
  const team = teamLine(read.team);
  return {
    scope: "COMPANY_PROFILE",
    statement: `${own ? "Their own company" : label}: ${name}${
      parts.length === 0 ? "" : ` -- ${parts.join("; ")}`
    }.${team === null ? "" : ` ${team}`}${description === null ? "" : ` As the company describes itself: ${description}`}`.slice(
      0,
      2_000,
    ),
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    source: "Capital Q canonical company profile",
  };
}

/**
 * K Part 4: a founder's own company from their Tier A working snapshot
 * (their own organisation's canonical record), said the same way. Only
 * when this run's plan holds that company's profile scope: the snapshot
 * never widens what the Context Firewall admitted for the run.
 */
export function ownCompanySnapshotFact(
  own: {
    readonly companyId: string;
    readonly name: string;
    readonly shortDescription: string | null;
    readonly stageCode: string | null;
    readonly countryCode: string | null;
  },
  plan: { readonly scopes: readonly unknown[] },
): AuthorisedFact | null {
  const permitted = plan.scopes.some((scope) => {
    const held = scope as {
      readonly kind?: unknown;
      readonly companyId?: unknown;
    };
    return held.kind === "COMPANY_PROFILE" && held.companyId === own.companyId;
  });
  if (!permitted) return null;
  return onScreenCompanyFact(
    {
      canonicalName: own.name,
      shortDescription: own.shortDescription,
      currentStageCode: own.stageCode,
      headquartersCountry: own.countryCode,
      relationToYou: "OWN",
    },
    'Their own company (the one they mean by "my company")',
  );
}

/** At most this many of one company's figures go to the model. */
const FIGURES_MAX = 12;

/**
 * A named company's published figures (owner 2026-10-23), from
 * read_company_figures' output, one fact each, so the model can cite them.
 * Each keeps the company's own truth class, evidence status and date: a
 * self-reported figure is said as the company's statement, never verified.
 * Anything malformed is dropped rather than repaired; none is no fact.
 */
export function companyFiguresFacts(
  data: unknown,
  companyName: string,
): readonly AuthorisedFact[] {
  if (typeof data !== "object" || data === null) return [];
  const figures = (data as { readonly figures?: unknown }).figures;
  if (!Array.isArray(figures)) return [];
  // One value per metric: an earlier month of a metric the company also
  // states for a later date is history (the chart's), never handed to the
  // model as a current figure it could quote as today's.
  const readable = (figures as readonly unknown[]).flatMap((figure, index) => {
    if (typeof figure !== "object" || figure === null) return [];
    const f = figure as Record<string, unknown>;
    const value = f["value"];
    return [
      {
        record: f,
        // A reading with no key is never grouped with another.
        key: typeof f["key"] === "string" ? f["key"] : `#${String(index)}`,
        statement: text(f["statement"]) ?? "",
        asOf: text(f["asOf"]),
        value:
          typeof value === "object" && value !== null && !Array.isArray(value)
            ? (value as Readonly<Record<string, unknown>>)
            : null,
      },
    ];
  });
  const facts: AuthorisedFact[] = [];
  for (const { record: f } of latestFigures(readable).slice(0, FIGURES_MAX)) {
    const statement = text(f["statement"]);
    if (statement === null) continue;
    const parsed = AuthorisedFactSchema.safeParse({
      scope: "COMPANY_FIGURES",
      statement: `${companyName}, as the company states it: ${statement}`.slice(
        0,
        2_000,
      ),
      truthClass: f["truthClass"],
      evidenceStatus: f["evidenceStatus"],
      source: "The company's published figures on Capital Q",
      ...(text(f["asOf"]) === null ? {} : { asOf: text(f["asOf"]) ?? "" }),
    });
    if (parsed.success) facts.push(parsed.data);
  }
  return facts;
}

/** At most this many of one deck's figures go to the model. */
const DECK_FIGURES_MAX = 24;
/** At most this many from one section, so no section crowds out another. */
const DECK_FIGURES_PER_SECTION = 8;
/**
 * The deck sections whose figures the profile's Key numbers draw on, in
 * the order they are taken. Live 2026-11-04 (55936724d): Ledgerline's
 * traction figures filled the cap in deck order before FINANCIALS was
 * reached, so the burn its profile shows never reached Q. Burn, runway
 * and the ask come first; no section gives more than its share.
 */
const DECK_FIGURE_SECTIONS: readonly string[] = [
  "FINANCIALS",
  "THE_ASK",
  "TRACTION",
  "BUSINESS_MODEL",
];

/**
 * A4 (rehearsal 2026-11-04): an investor on Ledgerline's profile saw "Current
 * monthly net burn: About $39,000" under Key numbers ("From the deck,
 * founder's claims"), and Q said the profile gave no burn rate. The Key
 * numbers come from the deck as Q read it, which the profile serves to
 * this reader; Q read only the company's published figures and never the
 * deck. These are the deck's figures from read_company_deck's own output
 * -- the same read, authorize step and plan as the person's Deck tab, so
 * nothing beyond what their screen may show -- each the founder's claim
 * with the deck's own truth class, evidence status, date and slide.
 * Anything malformed is dropped rather than repaired.
 */
export function companyDeckFiguresFacts(
  data: unknown,
  companyName: string,
): readonly AuthorisedFact[] {
  if (typeof data !== "object" || data === null) return [];
  const sections = (data as { readonly sections?: unknown }).sections;
  if (!Array.isArray(sections)) return [];
  const facts: AuthorisedFact[] = [];
  const present = (sections as readonly unknown[]).flatMap((section) => {
    if (typeof section !== "object" || section === null) return [];
    const s = section as Record<string, unknown>;
    if (s["status"] !== "PRESENT" || typeof s["section"] !== "string") {
      return [];
    }
    return [s];
  });
  for (const code of DECK_FIGURE_SECTIONS) {
    const s = present.find((one) => one["section"] === code);
    if (s === undefined) continue;
    const listed = Array.isArray(s["facts"])
      ? (s["facts"] as readonly unknown[])
      : [];
    let taken = 0;
    for (const fact of listed) {
      if (facts.length >= DECK_FIGURES_MAX) return facts;
      if (taken >= DECK_FIGURES_PER_SECTION) break;
      if (typeof fact !== "object" || fact === null) continue;
      const f = fact as Record<string, unknown>;
      const label = text(f["label"]);
      const value = text(f["value"]);
      // A deck fact with no value is unknown, never a figure (deck.ts).
      if (label === null || value === null) continue;
      const pages = Array.isArray(f["pages"])
        ? (f["pages"] as readonly unknown[]).filter(
            (page): page is number => typeof page === "number",
          )
        : [];
      const slide =
        pages.length === 0 ? "" : `, slide ${String(Math.min(...pages))}`;
      const asOf = text(f["asOf"]);
      const parsed = AuthorisedFactSchema.safeParse({
        scope: "COMPANY_DECK_FIGURES",
        statement:
          `${companyName}'s pitch deck states (the founder's claim): ${label}: ${value}${
            asOf === null ? "" : ` (as of ${asOf})`
          }${slide}.`.slice(0, 2_000),
        truthClass: f["truthClass"],
        evidenceStatus: f["evidenceStatus"],
        source: "The company's pitch deck, as Q read it (founder's claims)",
        ...(asOf === null ? {} : { asOf: asOf.slice(0, 40) }),
      });
      if (parsed.success) {
        facts.push(parsed.data);
        taken += 1;
      }
    }
  }
  return facts;
}

/**
 * A4: what an unlisted figure means. Q is given the figures it could read
 * for this person; one it was not given is unknown to Q, never absent from
 * the company. Said by code, beside the figures, so the answer says "I
 * can't see or verify that figure" instead of "the profile has no burn
 * rate" -- and, when the deck was not available to Q for this person,
 * that figures their screen may show from it cannot be confirmed here.
 * Nothing is disclosed by it: it names no value and widens no read.
 */
export function companyFiguresLimitFact(
  companyName: string,
  reads: {
    /** read_company_figures returned (AVAILABLE or NONE) for them. */
    readonly published: boolean;
    /**
     * read_company_deck: READ (its figures are above), NOT_AVAILABLE (asked
     * and refused or failed), or NOT_ASKED (not offered to this run).
     */
    readonly deck: "READ" | "NOT_AVAILABLE" | "NOT_ASKED";
  },
): AuthorisedFact {
  const read = [
    ...(reads.published ? ["its published figures on Capital Q"] : []),
    ...(reads.deck === "READ" ? ["the figures its pitch deck states"] : []),
  ];
  const what =
    read.length === 0
      ? `Q could not read ${companyName}'s figures for this person.`
      : `What Q could read of ${companyName}'s figures for this person is ${read.join(" and ")}, given as facts here.`;
  const deck =
    reads.deck === "NOT_AVAILABLE"
      ? ` Its pitch deck was not available to Q for this person, so a figure their screen shows from the deck cannot be read or confirmed by Q: say so, never that it does not exist.`
      : "";
  return {
    scope: "COMPANY_FIGURES",
    statement: `${what} Any figure about ${companyName} not given here (burn, runway, payroll or any other) is unknown to Q, not absent: say you can't see or verify it, and never that ${companyName}, its profile or its deck has no such figure.${deck}`,
    truthClass: "UNKNOWN",
    evidenceStatus: "NO_EVIDENCE",
    source: "Capital Q's record of what Q read for this answer",
  };
}
