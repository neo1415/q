import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_OUTCOME_LABELS,
  FIT_PARAMETER_LABELS,
  fitScoreOutOf10,
  type FitParameter,
  type FitProfileDto,
  type QResultBlock,
} from "@capital-q/contracts";

import type { ReadCompanyFigure, RunRead } from "./card-subjects.js";
import { cardRaiseWords, type RunFit } from "./fit-cards.js";

/**
 * Owner 23 Oct 2026 ("compare the top two side by side" came back as two
 * sentences): when an investor asks to compare companies, the answer
 * carries a TABLE built by code from this run's authorised reads -- each
 * company's own profile (get_company) and Capital Q's computed fit with
 * its per-row reasons. The model writes only the spoken differences.
 *
 * Every cell says where it comes from: "(company-stated)" for what the
 * company declared, "(Capital Q fit)" for what the fit computed, and an
 * estimate keeps its own words. An unknown stays an empty cell (the TABLE
 * contract's "not known"), never a zero, a dash or a guess.
 */

const COMPARE =
  /\b(?:compar(?:e|ed|ing|ison)|side[\s-]by[\s-]side|versus|vs\.?|head[\s-]to[\s-]head|stack (?:them|up))\b/iu;

export function asksToCompare(question: string): boolean {
  return COMPARE.test(question);
}

const STAGE_WORDS = (code: string | null | undefined): string =>
  code === null || code === undefined || code.trim().length === 0
    ? ""
    : code
        .trim()
        .toLowerCase()
        .split(/[_\s]+/u)
        .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
        .join(" ");

const stated = (value: string): string =>
  value.trim().length === 0 ? "" : `${value.trim()} (company-stated)`;

function row(profile: FitProfileDto | null, parameter: FitParameter): string {
  const found = profile?.parameters.find((p) => p.parameter === parameter);
  if (found === undefined) return "";
  if (!found.applicable) return "Your mandate sets no preference";
  if (found.outcome === "UNKNOWN") return `Not known: ${found.reason}`;
  return `${FIT_OUTCOME_LABELS[found.outcome]}: ${found.reason}`;
}

/** Traction-type figures, in the order an investor reads them. */
const TRACTION_KEYS: readonly RegExp[] = [
  /\b(arr|annual(ised|ized)? recurring)\b/iu,
  /\b(mrr|monthly recurring)\b/iu,
  /revenue/iu,
  /growth/iu,
  /\b(customers?|clients?|users?|merchants?)\b/iu,
  /margin/iu,
  /\b(gmv|volume|transactions?)\b/iu,
];

function tractionRank(figure: ReadCompanyFigure): number {
  const text = `${figure.key} ${figure.statement}`;
  const at = TRACTION_KEYS.findIndex((pattern) => pattern.test(text));
  return at < 0 ? Number.POSITIVE_INFINITY : at;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "2026-09-30T…" -> "Sep 2026"; null when there is no usable date. */
function asOfWords(asOf: string | null): string | null {
  if (asOf === null) return null;
  const match = /^(\d{4})-(\d{2})/u.exec(asOf);
  const month = match === null ? undefined : MONTHS[Number(match[2]) - 1];
  return match === null || month === undefined
    ? null
    : `${month} ${match[1] ?? ""}`;
}

/**
 * Owner 23 Oct 2026: traction numbers first. The company's own published
 * figures (read_company_figures), each "company-stated" with its date,
 * never verified; then the fit's traction reading. Unknown stays empty.
 */
function tractionCell(
  figures: readonly ReadCompanyFigure[] | undefined,
  fitRow: string,
): string {
  const stated = (figures ?? [])
    .filter((figure) => Number.isFinite(tractionRank(figure)))
    .sort((a, b) => tractionRank(a) - tractionRank(b))
    .slice(0, 4)
    .map((figure) => {
      const when = asOfWords(figure.asOf);
      const said = figure.statement
        .trim()
        .replace(/[.\s]+$/u, "")
        .slice(0, 140);
      return `${said} (company-stated${when === null ? "" : `, ${when}`})`;
    });
  return [...stated, ...(fitRow.length === 0 ? [] : [fitRow])].join("; ");
}

function measures(profile: FitProfileDto | null): {
  readonly strong: string;
  readonly open: string;
} {
  if (profile === null) return { strong: "", open: "" };
  const labels = (keep: (p: FitProfileDto["parameters"][number]) => boolean) =>
    profile.parameters
      .filter((p) => p.applicable && keep(p))
      .map((p) => FIT_PARAMETER_LABELS[p.parameter])
      .join(", ");
  return {
    strong: labels((p) => p.outcome === "STRONG"),
    open: labels((p) => p.outcome === "UNKNOWN"),
  };
}

function fitWords(profile: FitProfileDto | null): string {
  if (profile === null) return "";
  const score = fitScoreOutOf10(profile);
  const known = profile.parameters.filter(
    (p) => p.applicable && p.outcome !== "UNKNOWN",
  ).length;
  const applicable = profile.parameters.filter((p) => p.applicable).length;
  return `${score === null ? "" : `${score}/10 · `}${FIT_BAND_LABELS[profile.band]}, ${String(known)} of ${String(applicable)} measures known (Capital Q fit)`;
}

/**
 * The companies the run read, side by side; null unless the question asks
 * to compare and at least two companies were read.
 */
export function comparisonTableBlock(input: {
  readonly question: string;
  readonly read: RunRead;
  readonly fits: readonly RunFit[];
}): QResultBlock | null {
  if (!asksToCompare(input.question)) return null;
  const fitById = new Map(input.fits.map((fit) => [fit.companyId, fit]));
  const ids = [
    ...input.fits.map((fit) => fit.companyId),
    ...input.read.companyFacts.keys(),
  ].filter((id, index, all) => all.indexOf(id) === index);
  // In the order the person named them, when they named them.
  const nameOf = (id: string) =>
    input.read.companyNames.get(id) ?? fitById.get(id)?.name ?? "Company";
  const at = (id: string) => {
    const where = input.question
      .toLowerCase()
      .indexOf(nameOf(id).toLowerCase());
    return where < 0 ? Number.MAX_SAFE_INTEGER : where;
  };
  const columns = ids
    .map((id, index) => ({ id, index }))
    .sort((a, b) => at(a.id) - at(b.id) || a.index - b.index)
    .map(({ id }) => id)
    .slice(0, 8);
  if (columns.length < 2) return null;

  const facts = (id: string) => input.read.companyFacts.get(id);
  const profile = (id: string) => fitById.get(id)?.profile ?? null;
  const candidates = [
    {
      label: "What they do",
      cells: columns.map((id) =>
        stated(
          (facts(id)?.about ?? fitById.get(id)?.about ?? "").slice(0, 300),
        ),
      ),
    },
    {
      label: "Stage",
      cells: columns.map((id) => stated(STAGE_WORDS(facts(id)?.stageCode))),
    },
    {
      label: "Based in",
      cells: columns.map((id) => {
        const f = facts(id);
        return stated(
          [f?.city ?? null, f?.country ?? input.read.countries.get(id) ?? null]
            .filter((part) => part !== null && part.trim().length > 0)
            .join(", "),
        );
      }),
    },
    {
      label: "Raise",
      cells: columns.map((id) => {
        const fit = fitById.get(id);
        const words = fit === undefined ? null : cardRaiseWords(fit);
        return words === null ? "" : stated(words);
      }),
    },
    { label: "Mandate fit", cells: columns.map((id) => fitWords(profile(id))) },
    {
      label: "Cheque fit",
      cells: columns.map((id) => row(profile(id), "CHEQUE_SIZE")),
    },
    {
      label: "Traction",
      cells: columns.map((id) =>
        tractionCell(
          input.read.companyFigures.get(id),
          row(profile(id), "TRACTION"),
        ),
      ),
    },
    { label: "Team", cells: columns.map((id) => row(profile(id), "TEAM")) },
    {
      label: "Round terms",
      cells: columns.map((id) => row(profile(id), "ROUND_TERMS")),
    },
    {
      label: "Strong on",
      cells: columns.map((id) => measures(profile(id)).strong),
    },
    {
      label: "Evidence",
      cells: columns.map((id) => {
        const p = profile(id);
        return p === null ? "" : FIT_CONFIDENCE_LABELS[p.confidence];
      }),
    },
    {
      label: "Open questions",
      cells: columns.map((id) => {
        const open = measures(profile(id)).open;
        return open.length === 0 ? "" : `Not known yet: ${open}`;
      }),
    },
  ];
  const rows = candidates
    .filter((one) => one.cells.some((cell) => cell.length > 0))
    .map((one) => ({
      label: one.label,
      cells: one.cells.map((cell) => cell.slice(0, 500)),
    }));
  if (rows.length === 0) return null;
  return {
    kind: "TABLE",
    title: "Side by side",
    columns: columns.map((companyId) => ({
      label: nameOf(companyId).slice(0, 80),
      subject: { kind: "COMPANY", companyId },
    })),
    rows,
  };
}

const COUNT_WORDS: Readonly<Record<string, number>> = {
  two: 2,
  both: 2,
  pair: 2,
  three: 3,
  four: 4,
};

/**
 * Coordinator 23 Oct 2026 ("compare the top two side by side" after a list
 * of five: no table, because the follow-up read nothing): the companies a
 * compare question means, from the cards Q itself showed in its newest
 * answer. Those it names, in the order named; otherwise the top N it asks
 * for ("top two", "both", "the first three"), else the top two. Only ids Q
 * put on screen: never an id from the words, never a guess.
 */
export function compareTargets(
  question: string,
  cards: readonly { readonly companyId: string; readonly name: string }[],
): readonly string[] {
  if (!asksToCompare(question) || cards.length < 2) return [];
  const lower = question.toLowerCase();
  const named = cards
    .map((card) => ({ card, at: lower.indexOf(card.name.toLowerCase()) }))
    .filter((entry) => entry.card.name.trim().length > 0 && entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.card.companyId);
  if (named.length >= 2) return [...new Set(named)].slice(0, 4);
  const word = /\b(two|both|pair|three|four|\d)\b/iu.exec(lower)?.[1];
  const count =
    word === undefined
      ? 2
      : /^\d$/u.test(word)
        ? Number(word)
        : (COUNT_WORDS[word] ?? 2);
  return cards
    .map((card) => card.companyId)
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, Math.min(Math.max(count, 2), 4));
}

/** The cards Q showed in its newest answer, in order. */
export function newestAnswerCards(
  earlier: readonly {
    readonly role: string;
    readonly blocks?: readonly unknown[] | null | undefined;
  }[],
): readonly { readonly companyId: string; readonly name: string }[] {
  for (const message of [...earlier].reverse()) {
    if (message.role !== "Q") continue;
    const cards = (message.blocks ?? []).flatMap((block: unknown) => {
      if (typeof block !== "object" || block === null) return [];
      if (Reflect.get(block, "kind") !== "ANSWER_CARDS") return [];
      const list: unknown = Reflect.get(block, "cards");
      if (!Array.isArray(list)) return [];
      return list.flatMap((card: unknown) => {
        if (typeof card !== "object" || card === null) return [];
        const subject: unknown = Reflect.get(card, "subject");
        const name: unknown = Reflect.get(card, "name");
        if (typeof subject !== "object" || subject === null) return [];
        const id: unknown = Reflect.get(subject, "companyId");
        return Reflect.get(subject, "kind") === "COMPANY" &&
          typeof id === "string" &&
          typeof name === "string"
          ? [{ companyId: id, name }]
          : [];
      });
    });
    // The newest answer is the one meant; an older list is not "them".
    return cards;
  }
  return [];
}

/**
 * The table as a fact the answer is spoken from: the same cells, so the
 * words and the table never disagree. Each cell keeps its source label.
 */
export function comparisonFactStatement(block: QResultBlock): string | null {
  if (block.kind !== "TABLE") return null;
  const names = block.columns.map((column) => column.label);
  const lines = block.rows.map(
    (row) =>
      `${row.label}: ${row.cells
        .map(
          (cell, index) =>
            `${names[index] ?? "?"}: ${cell.length === 0 ? "not known" : cell}`,
        )
        .join(" | ")}`,
  );
  return `COMPARED SIDE BY SIDE (Capital Q shows this table on their screen): ${names.join(" vs ")}. In words, give the two or three real differences between them (where they are, what they do, their traction numbers, how each fits the mandate), never what they share or the whole table. Company figures are company-stated, never verified.\n${lines.join("\n")}`.slice(
    0,
    7_900,
  );
}
