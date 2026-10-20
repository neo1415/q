import {
  deckAskTerms,
  type AssumptionBoardDto,
  type CompanyProfileDto,
  type DeckSection,
  type DeckSectionCode,
} from "@capital-q/contracts";

import { formatLongDay } from "@/components/date-format";

import { countryLabel } from "../declared-labels";
import { compactMoneyText, moneyText } from "../money-text";
import type { PitchProfileSection } from "../pitch-profile";
import { raiseWords } from "../raise-words";
import { deckEvidence, deckWhere, pitchWhere, plural } from "./model";
import type { Evidence } from "./parts";

/**
 * The Diligence tab's ledger (profile option 1, ptabs "Diligence"): every
 * fact this reader has, in six folds, each with its evidence label and
 * where it came from. Built from the profile read, the deck read and the
 * questions board only (what the server sent this reader). A fact nobody
 * stated is a row "not known yet", never a zero and never a weakness.
 */

export type LedgerRow = {
  readonly key: string;
  readonly label: string;
  /** Null: not known yet. */
  readonly value: string | null;
  readonly evidence: Evidence;
  readonly where: string | null;
};

export type LedgerFold = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** A line above the rows (the raise's pitch-only explainer). */
  readonly lead: string | null;
  /** A line below the rows. */
  readonly note: string | null;
  readonly rows: readonly LedgerRow[];
};

function sectionOf(
  deck: readonly DeckSection[] | null,
  code: DeckSectionCode,
): DeckSection | undefined {
  return (deck ?? []).find(
    (section) => section.section === code && section.status === "PRESENT",
  );
}

function deckRows(
  deck: readonly DeckSection[] | null,
  codes: readonly DeckSectionCode[],
  skip?: RegExp,
): LedgerRow[] {
  return codes.flatMap((code) =>
    (sectionOf(deck, code)?.facts ?? [])
      .filter((fact) => skip === undefined || !skip.test(fact.label))
      .map((fact) => ({
        key: `deck-${code}-${fact.label}`,
        label: fact.label,
        value: fact.value,
        evidence: deckEvidence(fact),
        where: fact.value === null ? "Not in the deck" : deckWhere(fact),
      })),
  );
}

/** The board's unknowns for one of its section labels, as open rows. */
function unknownRows(
  board: AssumptionBoardDto | null,
  sections: RegExp,
  taken: Set<string>,
): LedgerRow[] {
  return (board?.assumptions ?? [])
    .filter(
      (a) =>
        a.standing === "UNKNOWN" &&
        sections.test(a.sectionLabel) &&
        !taken.has(a.id),
    )
    .map((a) => {
      taken.add(a.id);
      return {
        key: `unknown-${a.id}`,
        label: a.label,
        value: null,
        evidence: "unk" as const,
        where: a.source ?? "Not in the deck",
      };
    });
}

function summaryOf(rows: readonly LedgerRow[], lead: string): string {
  const known = rows.filter((row) => row.value !== null).length;
  const open = rows
    .filter((row) => row.value === null)
    .map((row) => row.label.toLowerCase());
  return [
    lead,
    open.length === 0
      ? null
      : `${open.slice(0, 2).join(" and ")} not known yet${open.length > 2 ? `, and ${String(open.length - 2)} more` : ""}`,
  ]
    .filter((part) => part !== null && part !== "")
    .join(". ")
    .replace(/^$/u, `${plural(known, "fact")}`);
}

export function diligenceLedger(input: {
  readonly profile: CompanyProfileDto;
  readonly own: boolean;
  readonly sectorLabels: readonly string[];
  readonly deck: readonly DeckSection[] | null;
  readonly sections: readonly PitchProfileSection[];
  readonly board: AssumptionBoardDto | null;
  readonly sharedInDiligence: readonly string[];
  readonly verified: boolean;
}): readonly LedgerFold[] {
  const { profile, own, deck, board } = input;
  const overview = profile.overview;
  if (overview === null) return [];
  const name = profile.canonicalName;
  const taken = new Set<string>();
  const claims = overview.pitchClaims;

  // 1. The raise.
  const view =
    overview.raiseView === undefined ? null : raiseWords(overview.raiseView, own);
  const said = overview.raiseFromPitch ?? claims.find((c) => c.kind === "RAISE");
  const terms = deckAskTerms(deck);
  const ask = sectionOf(deck, "THE_ASK");
  const askWhere = (value: string | undefined) => {
    const fact = ask?.facts.find((f) => f.value === value);
    return fact === undefined ? "Deck" : deckWhere(fact);
  };
  const amount =
    view?.amount ??
    (overview.raise !== null
      ? compactMoneyText(overview.raise)
      : said?.money !== null && said?.money !== undefined
        ? compactMoneyText(said.money)
        : null);
  const pitchOnly = overview.raise === null && said !== undefined && said !== null;
  const instrument = claims.find((c) => c.kind === "INSTRUMENT");
  const raiseRows: LedgerRow[] = [
    {
      key: "raising",
      label: "Raising",
      value: amount ?? terms.amount ?? null,
      evidence:
        amount === null && terms.amount === undefined
          ? own
            ? "unk"
            : "lock"
          : "claim",
      where:
        amount === null
          ? terms.amount === undefined
            ? null
            : askWhere(terms.amount)
          : said !== undefined && said !== null && view?.source !== "DISCLOSED_OBJECTIVE"
            ? pitchWhere(said)
            : "Declared on Capital Q",
    },
    ...(instrument === undefined && terms.instrument === undefined
      ? []
      : [
          {
            key: "instrument",
            label: "Instrument",
            value: instrument?.instrument ?? terms.instrument ?? instrument?.statement ?? null,
            evidence: "claim" as const,
            where:
              instrument === undefined
                ? askWhere(terms.instrument)
                : pitchWhere(instrument),
          },
        ]),
    ...(terms.valuationCap !== undefined
      ? [
          {
            key: "cap",
            label: "Valuation cap",
            value: terms.valuationCap,
            evidence: "claim" as const,
            where: askWhere(terms.valuationCap),
          },
        ]
      : terms.valuation !== undefined
        ? [
            {
              key: "valuation",
              label: "Valuation",
              value: terms.valuation,
              evidence: "claim" as const,
              where: askWhere(terms.valuation),
            },
          ]
        : []),
    ...(terms.minimumCheque === undefined
      ? []
      : [
          {
            key: "minimum",
            label: "Minimum cheque",
            value: terms.minimumCheque,
            evidence: "claim" as const,
            where: askWhere(terms.minimumCheque),
          },
        ]),
    ...claims
      .filter((c) => c.kind === "USE_OF_FUNDS")
      .slice(0, 1)
      .map((c) => ({
        key: "use",
        label: "Use of funds",
        value: `“${c.statement}”`,
        evidence: "claim" as const,
        where: pitchWhere(c),
      })),
    ...(terms.committedInvestors === "PRESENT"
      ? [
          {
            key: "lead",
            label: "Lead investor",
            value:
              ask?.facts.find((f) =>
                /\b(committed|lead)\b/iu.test(f.label),
              )?.value ?? null,
            evidence: "claim" as const,
            where: "Deck",
          },
        ]
      : [
          {
            key: "lead",
            label: "Lead investor",
            value: null,
            evidence: "unk" as const,
            where: deck === null ? null : "Not in the deck",
          },
        ]),
    ...(own
      ? []
      : [
          {
            key: "round",
            label: "Round details",
            value:
              overview.raise === null ? "Not shared yet" : moneyText(overview.raise),
            evidence: overview.raise === null ? ("lock" as const) : ("claim" as const),
            where: overview.raise === null ? null : "Shared with you",
          },
        ]),
    {
      key: "deck",
      label: "Pitch deck",
      value: overview.deck?.title ?? (own ? "Not added yet" : "Not shared yet"),
      evidence: overview.deck === null ? (own ? "unk" : "lock") : "doc",
      where: overview.deck === null ? null : "Shared with you",
    },
    ...(input.sharedInDiligence.length === 0
      ? []
      : [
          {
            key: "shared",
            label: "Shared in diligence",
            value: input.sharedInDiligence.join(", "),
            evidence: "doc" as const,
            where: "Diligence",
          },
        ]),
  ];
  const raiseLead =
    pitchOnly && !own
      ? `${name} states ${amount ?? "a raise"} in its pitch, its own statement; the round isn’t formally shared with you yet.`
      : pitchOnly && own
        ? "Investors who can watch your pitch see the amount you say in it, as your statement. Your round details stay private until you share them."
        : null;

  // 2. Traction.
  const tractionRows: LedgerRow[] = [
    ...deckRows(deck, ["TRACTION"]),
    ...claims
      .filter((c) => c.kind === "TRACTION")
      .map((c, i) => ({
        key: `pitch-traction-${String(i)}`,
        label: "Said in the pitch",
        value: `“${c.statement}”`,
        evidence: "claim" as const,
        where: pitchWhere(c),
      })),
    ...unknownRows(board, /traction|customers?|revenue/iu, taken),
  ];

  // 3. Team.
  const teamRows: LedgerRow[] = [
    ...overview.team.map((member, i) => ({
      key: `member-${String(i)}`,
      label: [member.name, member.businessTitle]
        .filter((part) => part !== null && part !== "")
        .join(", "),
      value:
        member.source === "PUBLIC_SOURCE"
          ? "From public sources, unconfirmed"
          : "Named by the company",
      evidence: "claim" as const,
      where: null,
    })),
    ...deckRows(deck, ["FOUNDERS", "TEAM"]),
    ...unknownRows(board, /team|founders?/iu, taken),
  ];

  // 4. Market.
  const marketRows: LedgerRow[] = [
    {
      key: "sector",
      label: "Sector",
      value: input.sectorLabels.length === 0 ? null : input.sectorLabels.join(", "),
      evidence: input.sectorLabels.length === 0 ? "unk" : "claim",
      where: input.sectorLabels.length === 0 ? "Not declared" : "Declared by the company",
    },
    ...deckRows(deck, ["MARKET"]),
    ...unknownRows(board, /market/iu, taken),
  ];

  // 5. Risks and unknowns: the money left, and every section not provided.
  const gaps = input.sections.filter((section) => !section.provided);
  const riskRows: LedgerRow[] = [
    ...deckRows(deck, ["FINANCIALS"]),
    ...gaps.map((section) => ({
      key: `gap-${section.sectionKey}`,
      label: section.label,
      value: null,
      evidence: "unk" as const,
      where: deck === null ? "No deck read yet" : "Not in the deck",
    })),
    ...unknownRows(board, /./u, taken),
  ];
  const openNames = riskRows
    .concat(raiseRows, tractionRows, marketRows)
    .filter((row) => row.value === null)
    .map((row) => row.label.toLowerCase());
  const uniqueOpen = [...new Set(openNames)];

  // 6. Company details.
  const founded = /^\d{4}/u.exec(overview.foundedDate ?? "")?.[0] ?? null;
  const detailRows: LedgerRow[] = [
    {
      key: "legal",
      label: "Legal name",
      value: overview.legalName,
      evidence: overview.legalName === null ? "unk" : "claim",
      where: overview.legalName === null ? "Not declared" : "Declared by the company",
    },
    {
      key: "founded",
      label: "Founded",
      value: overview.foundedDate === null ? null : formatLongDay(overview.foundedDate),
      evidence: overview.foundedDate === null ? "unk" : "claim",
      where: overview.foundedDate === null ? "Not declared" : "Declared by the company",
    },
    {
      key: "hq",
      label: "Headquarters",
      value:
        [profile.headquartersCity, countryLabel(profile.headquartersCountry)]
          .filter((part): part is string => part !== null && part !== "")
          .join(", ") || null,
      evidence:
        profile.headquartersCity === null && profile.headquartersCountry === null
          ? "unk"
          : "claim",
      where: null,
    },
    ...(overview.websiteUrl === null
      ? []
      : [
          {
            key: "web",
            label: "Website",
            value: overview.websiteUrl,
            evidence: "claim" as const,
            where: null,
          },
        ]),
    {
      key: "verification",
      label: "Organisation",
      value: input.verified
        ? "Verified by Capital Q"
        : "Not verified by Capital Q yet",
      evidence: input.verified ? "ver" : "none",
      where: null,
    },
  ];

  return [
    {
      id: "company-raise",
      title: "The raise",
      summary:
        amount === null
          ? own
            ? "Not added yet"
            : "Not shared with you"
          : `${amount} ${view?.source === "DISCLOSED_OBJECTIVE" ? "declared by the company" : own ? "stated in your pitch" : "stated in their pitch"}.${overview.raise === null && !own ? " The round isn’t formally shared with you yet." : ""}`,
      lead: raiseLead,
      note: null,
      rows: raiseRows,
    },
    {
      id: "company-traction",
      title: "Traction",
      summary:
        tractionRows.filter((r) => r.value !== null).length === 0
          ? "Nothing stated yet"
          : summaryOf(
              tractionRows,
              `${plural(tractionRows.filter((r) => r.value !== null).length, "figure")}, all the company’s own claims`,
            ),
      lead: null,
      note:
        tractionRows.length === 0
          ? "No traction figure is stated in what you can see. That is not known yet, not zero."
          : "The company’s own claims, from its deck and pitch video. Not verified.",
      rows: tractionRows,
    },
    {
      id: "company-team",
      title: "Team",
      summary:
        overview.team.length === 0
          ? "No one named yet"
          : `${plural(overview.team.length, "person", "people")} named`,
      lead: null,
      note: null,
      rows: teamRows,
    },
    {
      id: "company-market",
      title: "Market",
      summary: summaryOf(
        marketRows,
        input.sectorLabels.length === 0
          ? "Sector not declared"
          : input.sectorLabels.join(", "),
      ),
      lead: null,
      note: null,
      rows: marketRows,
    },
    {
      id: "company-unknowns",
      title: "Risks and unknowns",
      summary:
        uniqueOpen.length === 0
          ? "Every key fact is stated; see what rests on what"
          : `Not known yet: ${uniqueOpen.slice(0, 3).join(", ")}${uniqueOpen.length > 3 ? ` and ${String(uniqueOpen.length - 3)} more` : ""}`,
      lead: null,
      note:
        uniqueOpen.length === 0
          ? null
          : `Not known yet: ${uniqueOpen.join(", ")}. Unknown is not negative; it is a question to ask.`,
      rows: riskRows,
    },
    {
      id: "company-details",
      title: "Company details",
      summary: [
        founded === null ? "Founded date not declared" : `Founded ${founded}`,
        input.verified ? "Verified by Capital Q" : "Not verified by Capital Q yet",
      ].join(" · "),
      lead: null,
      note: null,
      rows: detailRows,
    },
  ];
}

/** The ledger's counts, for the coverage head and strip. */
export function ledgerCounts(folds: readonly LedgerFold[]): {
  readonly marks: readonly Evidence[];
  readonly doc: number;
  readonly claim: number;
  readonly unknown: number;
} {
  const marks = folds.flatMap((fold) =>
    fold.rows.map((row) => (row.value === null ? "unk" : row.evidence)),
  );
  return {
    marks,
    doc: marks.filter((m) => m === "doc" || m === "ver").length,
    claim: marks.filter((m) => m === "claim").length,
    unknown: marks.filter((m) => m === "unk").length,
  };
}
