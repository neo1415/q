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

import {
  containsCompanyName,
  type ReadCompanyFigure,
  type RunRead,
} from "./card-subjects.js";
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
  /**
   * The companies a follow-up resolved, in order: only these, never the
   * other companies a fit sweep in the same run read.
   */
  readonly only?: readonly string[] | undefined;
  /** TURN_READER v62: the reader read a comparison; decides over the words. */
  readonly compareAsked?: boolean | undefined;
}): QResultBlock | null {
  if (!(input.compareAsked ?? asksToCompare(input.question))) return null;
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
  // O-I6 (live 23 Oct): "Compare Ledgerline, Duplo and Anchor" showed
  // Ledgerline vs Ledgerfold, a company the run read for another reason.
  // When the question names two or more companies the run read, the table
  // is those and only those.
  const namedInQuestion = ids
    .filter((id) => {
      const name = nameOf(id);
      return name !== "Company" && containsCompanyName(input.question, name);
    })
    // In the order the person named them.
    .sort((a, b) => at(a) - at(b));
  const only =
    (input.only ?? []).length >= 2
      ? (input.only ?? [])
      : namedInQuestion.length >= 2
        ? namedInQuestion
        : [];
  const columns =
    only.length >= 2
      ? only.filter((id) => ids.includes(id))
      : ids
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
  /**
   * TURN_READER v62: the comparison as the reader understood it, in any
   * words and any language. When given it decides, never the words; absent
   * (an older reader, a code path with no reading), the words do.
   */
  reading?: {
    readonly count: number | null;
    readonly names: readonly string[];
  },
): readonly string[] {
  if (cards.length < 2) return [];
  if (reading !== undefined) {
    const byName = reading.names.flatMap((name) => {
      const card = cards.find(
        (entry) =>
          entry.name.trim().length > 0 &&
          entry.name.toLowerCase() === name.trim().toLowerCase(),
      );
      return card === undefined ? [] : [card.companyId];
    });
    if (byName.length >= 2) return [...new Set(byName)].slice(0, 4);
    // Names the cards do not hold are read by name elsewhere (the named
    // reads); only a count over the cards is resolved here.
    if (reading.names.length > 0) return [];
    return cards
      .map((card) => card.companyId)
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, Math.min(Math.max(reading.count ?? 2, 2), 4));
  }
  if (!asksToCompare(question)) return [];
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
export function comparisonFactStatement(
  block: QResultBlock,
  /** This run's computed fits, for the one verdict (see verdictLine). */
  fits: readonly RunFit[] = [],
): string | null {
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
  return `COMPARED SIDE BY SIDE (Capital Q shows this table on their screen): ${names.join(" vs ")}. In words, give the two or three real differences between them (where they are, what they do, their traction numbers, how each fits the mandate), never what they share or the whole table. Say the one or two key figures from the Traction row as numbers (for example each one's monthly revenue), never "self-reported figures" without them. Company figures are company-stated, never verified.${verdictLine(block, fits)}\n${lines.join("\n")}`.slice(
    0,
    7_900,
  );
}

/**
 * Live 23 Oct 2026 (run a19bae24): the reply offered "I can compare their
 * stage, sector, … side by side" while the person had asked for exactly
 * that. A comparison that was asked for is done, never offered: such
 * sentences are removed wherever the table goes out.
 */
const OFFERS_TO_COMPARE =
  /[^.!?\n]*\b(?:I can|I could|I'd be happy to|happy to|want me to|shall I|should I|would you like me to|let me know if you'd like me to)\b[^.!?\n]*\bcompar[^.!?\n]*[.!?]?/giu;

export function withoutCompareOffers(text: string): string {
  return text
    .replace(OFFERS_TO_COMPARE, "")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

const plainCell = (cell: string | undefined): string =>
  (cell ?? "").replace(/\s*\(company-stated[^)]*\)/gu, "").trim();

/**
 * The real differences, said by code from the table's own cells (where
 * each is, what each does, the traction each states), for an answer whose
 * words were not spoken from the table. Null when the cells say nothing.
 */
export function comparisonSpokenLine(block: QResultBlock): string | null {
  if (block.kind !== "TABLE") return null;
  const cellsOf = (label: string) =>
    block.rows.find((row) => row.label === label)?.cells ?? [];
  const what = cellsOf("What they do");
  const where = cellsOf("Based in");
  const traction = cellsOf("Traction");
  const parts = block.columns.flatMap((column, index) => {
    const does = plainCell(what[index]).replace(/\.$/u, "");
    const place = plainCell(where[index]);
    const moved = (traction[index] ?? "").trim();
    const bits = [
      does.length === 0 ? null : does.charAt(0).toLowerCase() + does.slice(1),
      place.length === 0 ? null : `based in ${place}`,
    ].filter((bit): bit is string => bit !== null);
    if (bits.length === 0 && moved.length === 0) return [];
    const head =
      bits.length === 0 ? column.label : `${column.label}: ${bits.join(", ")}`;
    return [moved.length === 0 ? head : `${head}; traction: ${moved}`];
  });
  if (parts.length < 2) return null;
  return `Side by side, the differences: ${parts.join(". ")}. The full comparison is on screen.`.slice(
    0,
    1_200,
  );
}

/**
 * Coordinator 24 Oct 2026 ("which is better, Anchor or Afyascan?"): the
 * answer opened "Afyascan is the better-supported choice" and closed "I'd
 * take Anchor forward first" while Capital Q's fit ranked Anchor 7.6 and
 * Afyascan 7. Which one leads is decided here, by code, from the computed
 * mandate fit, and given to the answer as its one verdict; the condition
 * that would change it is the answer's own reading of the table.
 */
export type ComparisonVerdict = {
  readonly leader: string;
  readonly other: string;
  readonly leaderScore: string;
  readonly otherScore: string;
  readonly level: boolean;
};

/** Which company leads on Capital Q's computed mandate fit; null without two scores. */
export function comparisonVerdict(
  block: QResultBlock,
  fits: readonly RunFit[],
): ComparisonVerdict | null {
  if (block.kind !== "TABLE") return null;
  const scored = block.columns.flatMap((column) => {
    const id =
      column.subject?.kind === "COMPANY" ? column.subject.companyId : null;
    const fit = fits.find((entry) => entry.companyId === id);
    const score = fit === undefined ? null : fitScoreOutOf10(fit.profile);
    const value = score === null ? Number.NaN : Number(score);
    return score !== null && Number.isFinite(value)
      ? [{ name: column.label, score, value }]
      : [];
  });
  if (scored.length < 2) return null;
  const [first, second] = [...scored].sort((a, b) => b.value - a.value);
  if (first === undefined || second === undefined) return null;
  return {
    leader: first.name,
    other: second.name,
    leaderScore: first.score,
    otherScore: second.score,
    level: first.value === second.value,
  };
}

function verdictLine(
  block: Extract<QResultBlock, { kind: "TABLE" }>,
  fits: readonly RunFit[],
): string {
  const verdict = comparisonVerdict(block, fits);
  if (verdict === null) return "";
  if (verdict.level) {
    return ` VERDICT, if they ask which is better or which to take forward: ${verdict.leader} and ${verdict.other} are level on Capital Q's mandate fit (${verdict.leaderScore} each). Say so once, then the one difference in the table that would separate them; never call either the better one.`;
  }
  return ` VERDICT, if they ask which is better or which to take forward: lead with exactly one, ${verdict.leader} (Capital Q mandate fit ${verdict.leaderScore} against ${verdict.other}'s ${verdict.otherScore}), then the one condition in the table that would change it. Never name a different company as the better or first choice anywhere in the answer; mandate fit is not a judgement of quality.`;
}

/** The verdict as Capital Q says it, first, in its own words. */
export function verdictSentence(verdict: ComparisonVerdict): string {
  return verdict.level
    ? `${verdict.leader} and ${verdict.other} are level on Capital Q's mandate fit, at ${verdict.leaderScore} each.`
    : `On Capital Q's mandate fit, ${verdict.leader} leads: ${verdict.leaderScore} against ${verdict.other}'s ${verdict.otherScore}.`;
}

/**
 * Coordinator 24 Oct 2026 (live 11:29, run a86f114a): with the verdict in
 * its facts, the model still opened "Afyascan is the better-supported
 * fit" while Anchor led on fit, 7.6 to 7. Code decides the lead: the
 * answer opens with Capital Q's verdict, and an opening sentence of the
 * model's that names only the other company (its competing lead) gives way
 * to it. What follows is the model's own reading.
 */
export function ledByVerdict(text: string, verdict: ComparisonVerdict): string {
  // Live 24 Oct (9ff4a1118): "$1.8 million" was cut at its decimal point.
  // A sentence ends at . ! or ? followed by space and a capital (or a
  // quote or bracket), never inside a number or an abbreviation's tail.
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+(?=[\p{Lu}"'“‘([])/u)
    .filter((sentence) => sentence.length > 0);
  const [first, ...rest] = sentences;
  const names = (sentence: string, name: string) =>
    containsCompanyName(sentence, name);
  const competing =
    first !== undefined &&
    names(first, verdict.other) &&
    !names(first, verdict.leader);
  const body = (competing ? rest : sentences).join(" ").trim();
  const lead = verdictSentence(verdict);
  return body.startsWith(lead) ? body : `${lead} ${body}`.trim();
}
