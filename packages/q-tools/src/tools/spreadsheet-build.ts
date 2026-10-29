import {
  DecimalStringSchema,
  QWorkbookSchema,
  Q_SHEET_NAME_MAX,
  Q_SHEET_ROWS_MAX,
  Q_SHEET_TEXT_MAX,
  type Money,
  type QAnswerCardsBlock,
  type QResultBlock,
  type QSheet,
  type QSheetCell,
  type QSheetColumn,
  type QSheetSource,
  type QSubjectRef,
  type QWorkbook,
} from "@capital-q/contracts";

/**
 * XLSX-001: typed records into a workbook spec, by code.
 *
 * Every cell below is copied from a typed field of a record or of a result
 * block Q already showed the person -- never from a model's words. A model
 * may name the sheet and choose which of these columns to keep; it cannot
 * add a column, a row or a value. What is not known is `null` (drawn
 * blank), never zero; money stays an exact decimal with its own currency;
 * a total is written only over a column whose values are numbers, and a
 * money total only when every amount shares one currency.
 */

type Comparison = Extract<QResultBlock, { kind: "COMPARISON" }>;
type Ref = QSheetSource["refs"][number];

const answerRef = (messageId: string): Ref => ({
  kind: "Q_ANSWER",
  id: messageId,
});

/** A company or investor subject as a source record; null for any other. */
function subjectRef(
  subject: QSubjectRef | null | undefined,
  label: string | undefined,
): Ref | null {
  const named = label === undefined ? {} : { label: label.slice(0, 200) };
  if (subject?.kind === "COMPANY") {
    return { kind: "COMPANY", id: subject.companyId, ...named };
  }
  if (subject?.kind === "INVESTOR_ORGANISATION") {
    return {
      kind: "INVESTOR_ORGANISATION",
      id: subject.investorOrganisationId,
      ...named,
    };
  }
  return null;
}

const refs = (first: Ref, rest: readonly (Ref | null)[]): Ref[] =>
  [first, ...rest.filter((ref): ref is Ref => ref !== null)].slice(0, 50);
type Table = Extract<QResultBlock, { kind: "TABLE" }>;

/** What the model may choose: a name, and which of the builder's columns. */
export type SheetChoice = {
  readonly sheetName?: string | undefined;
  /** Column keys to keep, in the builder's order; unknown keys are ignored. */
  readonly columns?: readonly string[] | undefined;
};

/**
 * A column the person asked for that the sheet could not fill (live
 * 2026-10-28: "cheque fit" was asked for and silently left out).
 * NOT_KNOWN: the column is there, and these rows are blank because the
 * value is not known. NOT_AVAILABLE: the column is not in the sheet at
 * all, for the reason in `detail`.
 */
export type UnfilledColumn = {
  readonly column: string;
  readonly why: "NOT_KNOWN" | "NOT_AVAILABLE";
  /** NOT_KNOWN: how many rows are blank, of `of`. */
  readonly rows?: number | undefined;
  readonly of?: number | undefined;
  /**
   * NOT_KNOWN on a side-by-side sheet (one row per measure, one column per
   * company): the names whose cell in this row is blank.
   */
  readonly for?: readonly string[] | undefined;
  readonly detail?: string | undefined;
};

/**
 * Live 2026-10-29 ("put that side-by-side thing into a file"): a measure
 * row's blank cells, named by the column they sit under, so the receipt
 * says which cells were not filled as the pipeline sheet's does.
 */
function unfilledByRow(main: QSheet | undefined): UnfilledColumn[] {
  if (main === undefined) return [];
  return main.rows.flatMap((row) => {
    const names = main.columns.flatMap((column, at) =>
      at > 0 && row[at] === null ? [column.label] : [],
    );
    const label = row[0];
    return names.length === 0 || typeof label !== "string"
      ? []
      : [{ column: label, why: "NOT_KNOWN" as const, for: names }];
  });
}

export type BuiltSpreadsheet = {
  readonly title: string;
  readonly summary: string;
  readonly workbook: QWorkbook;
  /** What the sheet could not establish, for the artifact's "not known". */
  readonly gaps: readonly string[];
  /** Asked-for columns it could not fill, and why; for the reply's receipt. */
  readonly unfilled: readonly UnfilledColumn[];
};

/** "INTEREST_EXPRESSED" -> "Interest expressed". */
export function words(code: string): string {
  const lower = code.toLowerCase().replaceAll("_", " ");
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
}

/** A sheet name Excel accepts, from the model's choice or the default. */
export function sheetName(chosen: string | undefined, fallback: string) {
  const clean = (chosen ?? "")
    .replace(/[[\]:*?/\\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, Q_SHEET_NAME_MAX)
    .trim();
  return clean.length === 0 || clean.toLowerCase() === "sources"
    ? fallback
    : clean;
}

const text = (value: string | null | undefined): QSheetCell =>
  value === null || value === undefined || value.trim().length === 0
    ? null
    : value.slice(0, Q_SHEET_TEXT_MAX);

const dateOf = (value: string | null | undefined): QSheetCell => {
  const day = value?.slice(0, 10);
  return day !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(day) ? day : null;
};

const decimalOf = (value: unknown): QSheetCell => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const written = String(value);
    return DecimalStringSchema.safeParse(written).success ? written : null;
  }
  return typeof value === "string" &&
    DecimalStringSchema.safeParse(value).success
    ? value
    : null;
};

/** Keep the chosen columns (all when none of the choice is known). */
function choose(
  columns: readonly QSheetColumn[],
  rows: readonly (readonly QSheetCell[])[],
  choice: SheetChoice,
): { columns: QSheetColumn[]; rows: QSheetCell[][] } {
  const wanted = new Set(choice.columns ?? []);
  const keep = columns
    .map((column, at) => ({ column, at }))
    .filter(({ column }) => wanted.has(column.key));
  const kept =
    keep.length === 0 ? columns.map((column, at) => ({ column, at })) : keep;
  return {
    columns: kept.map(({ column }) => column),
    rows: rows.map((row) => kept.map(({ at }) => row[at] ?? null)),
  };
}

/** The one currency a money column holds, if it holds exactly one. */
function oneCurrency(rows: readonly (readonly QSheetCell[])[], at: number) {
  const currencies = new Set(
    rows.flatMap((row) => {
      const cell = row[at];
      return cell !== null && cell !== undefined && typeof cell === "object"
        ? [cell.currency]
        : [];
    }),
  );
  return currencies.size === 1 ? [...currencies][0] : undefined;
}

/** A sheet, with totals only where they are arithmetic. */
function sheet(
  name: string,
  columns: readonly QSheetColumn[],
  rows: readonly (readonly QSheetCell[])[],
  totals: readonly { column: string; fn: "SUM" | "AVERAGE" }[],
  choice: SheetChoice,
): QSheet {
  const chosen = choose(columns, rows.slice(0, Q_SHEET_ROWS_MAX), choice);
  const typed = chosen.columns.map((column, at) => {
    if (column.type !== "money") return column;
    const currency = oneCurrency(chosen.rows, at);
    return currency === undefined ? column : { ...column, currency };
  });
  const kept = totals.filter((total) => {
    const at = typed.findIndex((column) => column.key === total.column);
    const column = typed[at];
    if (column === undefined) return false;
    if (column.type === "money") return column.currency !== undefined;
    return chosen.rows.some((row) => row[at] !== null);
  });
  return { name, columns: typed, rows: chosen.rows, totals: kept };
}

function provenanceLine(today: string): string {
  return `Prepared by Q from your Capital Q records on ${today}. Every value is copied from the record named on this sheet; a blank cell is not known, never zero.`;
}

/**
 * The asked-for columns of the first sheet that came out blank, by code:
 * a column the choice named (or `also`, columns the ask is known to want)
 * with blank cells is NOT_KNOWN for those rows; a named key the builder
 * has no column for is NOT_AVAILABLE. With no choice, only a column blank
 * on every row is reported.
 */
function unfilledOf(
  main: QSheet | undefined,
  builderKeys: readonly string[],
  choice: SheetChoice,
  also: readonly string[] = [],
): UnfilledColumn[] {
  if (main === undefined) return [];
  const named = new Set([...(choice.columns ?? []), ...also]);
  const out: UnfilledColumn[] = [];
  main.columns.forEach((column, at) => {
    const blank = main.rows.filter((row) => row[at] === null).length;
    if (blank === 0) return;
    const asked = named.has(column.key);
    if (!asked && blank < main.rows.length) return;
    out.push({
      column: column.label,
      why: "NOT_KNOWN",
      rows: blank,
      of: main.rows.length,
    });
  });
  for (const key of choice.columns ?? []) {
    if (builderKeys.includes(key)) continue;
    out.push({
      column: key,
      why: "NOT_AVAILABLE",
      detail: "Capital Q holds no such column for this sheet",
    });
  }
  return out;
}

function finish(input: {
  readonly title: string;
  readonly summary: string;
  readonly sheets: readonly QSheet[];
  readonly sources: readonly QSheetSource[];
  readonly today: string;
  readonly gaps?: readonly string[] | undefined;
  readonly unfilled?: readonly UnfilledColumn[] | undefined;
}): BuiltSpreadsheet {
  return {
    title: input.title.slice(0, 160),
    summary: input.summary.slice(0, 600),
    workbook: QWorkbookSchema.parse({
      sheets: input.sheets,
      sources: input.sources,
      provenance: provenanceLine(input.today),
    }),
    gaps: [...(input.gaps ?? [])],
    unfilled: [...(input.unfilled ?? [])],
  };
}

/** Keep the labels of the columns a source covers, among those kept. */
const labelsOf = (sheetSpec: QSheet, keys: readonly string[]) => {
  const labels = sheetSpec.columns
    .filter((column) => keys.includes(column.key))
    .map((column) => column.label);
  return labels.length === 0 ? sheetSpec.columns.map((c) => c.label) : labels;
};

// --- the pipeline ----------------------------------------------------------

export type PipelineInput = {
  readonly side: "INVESTOR" | "COMPANY" | "NONE";
  readonly relationships: readonly {
    readonly relationshipId: string;
    readonly counterpart: {
      readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
      readonly id: string;
      readonly name: string;
    };
    readonly state: string;
    readonly stateSince: string;
    readonly nextStep: string;
    readonly lastMessage?:
      { readonly from: "THEM" | "YOU"; readonly at: string } | null | undefined;
    readonly lastMessageRead?: "OK" | "UNAVAILABLE" | undefined;
  }[];
  readonly decisions: readonly {
    readonly companyId: string;
    readonly name: string;
    readonly stageCode: string | null;
    readonly decision: "SAVED" | "PASSED";
  }[];
  readonly today: string;
  /**
   * Fit with their own mandate, joined on the company id, when the ask
   * names it or the run read it. Absent: not asked, no fit columns.
   */
  readonly fit?: PipelineFitJoin | undefined;
};

/** One company's fit, as the fit service computed it for this reader. */
export type PipelineFit = {
  /** Out of 10 as an exact decimal; null when too little is known. */
  readonly score: string | null;
  /** The band in words ("Good fit"). */
  readonly band: string;
  /** Each outcome in words; null when UNKNOWN (never a negative). */
  readonly cheque: {
    readonly outcome: string | null;
    readonly reason: string;
  } | null;
  readonly stage: {
    readonly outcome: string | null;
    readonly reason: string;
  } | null;
  readonly reasons: readonly string[];
  /** The round as disclosed to this reader, or null. */
  readonly round: Money | null;
};

export type PipelineFitJoin =
  | {
      readonly kind: "JOINED";
      readonly byCompany: ReadonlyMap<string, PipelineFit>;
      /** Their declared cheque range; null when not declared or not read. */
      readonly cheque: {
        readonly from: Money | null;
        readonly to: Money | null;
      } | null;
    }
  | {
      readonly kind: "NOT_AVAILABLE";
      /** Why, in plain words ("there is no active mandate yet"). */
      readonly detail: string;
    };

const PIPELINE_COLUMNS: readonly QSheetColumn[] = [
  { key: "counterparty", label: "Counterparty", type: "text" },
  { key: "kind", label: "Company or investor", type: "text" },
  { key: "stage", label: "Stage", type: "text" },
  { key: "since", label: "Since", type: "date" },
  { key: "nextStep", label: "Next step", type: "text" },
  { key: "lastMessageFrom", label: "Last message from", type: "text" },
  { key: "lastMessageOn", label: "Last message on", type: "date" },
];

/** Joined on the company id when fit is asked for (XLSX-002). */
export const PIPELINE_FIT_COLUMNS: readonly QSheetColumn[] = [
  { key: "fitScore", label: "Mandate fit (out of 10)", type: "number" },
  { key: "fitBand", label: "Fit", type: "text" },
  { key: "chequeFit", label: "Cheque fit", type: "text" },
  { key: "chequeFitWhy", label: "Cheque fit, why", type: "text" },
  { key: "stageFit", label: "Stage fit", type: "text" },
  { key: "round", label: "Round", type: "money" },
  { key: "chequeFrom", label: "Your cheque from", type: "money" },
  { key: "chequeTo", label: "Your cheque to", type: "money" },
  { key: "fitReasons", label: "Why it fits", type: "text" },
];

const money = (value: Money | null | undefined): QSheetCell =>
  value === null || value === undefined
    ? null
    : { amount: value.amount, currency: value.currency };

function unscoredOf(
  input: PipelineInput,
  joined: Extract<PipelineFitJoin, { kind: "JOINED" }> | null,
): string[] {
  if (joined === null) return [];
  const names = input.relationships
    .filter(
      (item) =>
        item.counterpart.kind === "COMPANY" &&
        !joined.byCompany.has(item.counterpart.id),
    )
    .map((item) => item.counterpart.name);
  if (names.length === 0) return [];
  return [
    `${andList(names)} ${names.length === 1 ? "has" : "have"} no fit score yet: Capital Q scores fit for companies eligible for Discover (for example once verification is complete), so ${names.length === 1 ? "its" : "their"} fit cells are blank.`,
  ];
}

export function buildPipelineSheet(
  input: PipelineInput,
  choice: SheetChoice,
): BuiltSpreadsheet | null {
  if (input.relationships.length === 0 && input.decisions.length === 0) {
    return null;
  }
  const joined = input.fit?.kind === "JOINED" ? input.fit : null;
  // "Company or investor" says something only when the pipeline holds
  // both; every row the same is a column of one repeated word.
  const mixed =
    new Set(input.relationships.map((item) => item.counterpart.kind)).size > 1;
  const base = PIPELINE_COLUMNS.filter(
    (column) => column.key !== "kind" || mixed,
  );
  const columns = joined === null ? base : [...base, ...PIPELINE_FIT_COLUMNS];
  const rows = input.relationships.map((item): QSheetCell[] => {
    // A chat that could not be read is unknown, never "no messages".
    const read = item.lastMessageRead === "OK";
    const message = item.lastMessage ?? null;
    const own: QSheetCell[] = [
      text(item.counterpart.name),
      ...(mixed
        ? [item.counterpart.kind === "COMPANY" ? "Company" : "Investor"]
        : []),
      words(item.state),
      dateOf(item.stateSince),
      item.nextStep === "NONE" ? null : words(item.nextStep),
      !read || message === null
        ? read
          ? "No messages"
          : null
        : message.from === "THEM"
          ? "Them"
          : "You",
      read && message !== null ? dateOf(message.at) : null,
    ];
    if (joined === null) return own;
    // Typed join on the company id; an investor counterpart, or a company
    // the fit could not be read for, is blank (not known), never zero.
    const fit =
      item.counterpart.kind === "COMPANY"
        ? joined.byCompany.get(item.counterpart.id)
        : undefined;
    return [
      ...own,
      fit === undefined ? null : decimalOf(fit.score),
      fit === undefined ? null : text(fit.band),
      text(fit?.cheque?.outcome),
      text(fit?.cheque?.reason),
      text(fit?.stage?.outcome),
      money(fit?.round),
      money(joined.cheque?.from),
      money(joined.cheque?.to),
      fit === undefined ? null : text(fit.reasons.join("\n")),
    ];
  });
  // Fit asked for and joined: its columns stay even where the model's
  // choice of columns did not name them.
  const fitKeys = PIPELINE_FIT_COLUMNS.map((column) => column.key);
  const kept: SheetChoice =
    joined !== null && (choice.columns?.length ?? 0) > 0
      ? {
          ...choice,
          columns: [
            ...(choice.columns ?? []),
            ...fitKeys.filter((key) => !(choice.columns ?? []).includes(key)),
          ],
        }
      : choice;
  const sheets: QSheet[] = [];
  const sources: QSheetSource[] = [];
  let main: QSheet | undefined;
  if (rows.length > 0) {
    main = sheet(
      sheetName(choice.sheetName, "Pipeline"),
      columns,
      rows,
      [],
      kept,
    );
    sheets.push(main);
    const ownLabels = labelsOf(
      main,
      base.map((column) => column.key),
    );
    sources.push({
      sheet: main.name,
      columns: ownLabels,
      from: "Your Capital Q relationship history, as your side sees it",
      truthClass: "VERIFIED",
      refs: input.relationships.slice(0, 50).map((item) => ({
        kind: "RELATIONSHIP",
        id: item.relationshipId,
        label: item.counterpart.name.slice(0, 200),
      })),
    });
    if (joined !== null) {
      const companyRefs = input.relationships
        .filter((item) => item.counterpart.kind === "COMPANY")
        .slice(0, 50)
        .map((item): Ref => ({
          kind: "COMPANY",
          id: item.counterpart.id,
          label: item.counterpart.name.slice(0, 200),
        }));
      const covered = (keys: readonly string[]) =>
        main?.columns.some((column) => keys.includes(column.key)) === true;
      const fitColumns = [
        "fitScore",
        "fitBand",
        "chequeFit",
        "chequeFitWhy",
        "stageFit",
        "fitReasons",
      ];
      if (covered(fitColumns)) {
        sources.push({
          sheet: main.name,
          columns: labelsOf(main, fitColumns),
          from: "Fit with your mandate, computed by code from Capital Q's fit rules; not a verified fact",
          truthClass: "Q_INFERENCE",
          refs: companyRefs,
        });
      }
      if (covered(["round"])) {
        sources.push({
          sheet: main.name,
          columns: labelsOf(main, ["round"]),
          from: "Each company's round, as it is disclosed to you on Capital Q",
          truthClass: "USER_CLAIM",
          refs: companyRefs,
        });
      }
      if (covered(["chequeFrom", "chequeTo"])) {
        sources.push({
          sheet: main.name,
          columns: labelsOf(main, ["chequeFrom", "chequeTo"]),
          from: "Your own declared mandate",
          truthClass: "USER_CLAIM",
          refs: [],
        });
      }
    }
  }
  if (input.decisions.length > 0) {
    const triage = sheet(
      sheets.some((s) => s.name === "Saved and passed")
        ? "Saved and passed (Discover)"
        : "Saved and passed",
      [
        { key: "company", label: "Company", type: "text" },
        { key: "decision", label: "Your decision", type: "text" },
        { key: "stageCode", label: "Stage", type: "text" },
      ],
      input.decisions.map((entry) => [
        text(entry.name),
        entry.decision === "SAVED" ? "Saved" : "Passed",
        entry.stageCode === null ? null : words(entry.stageCode),
      ]),
      [],
      {},
    );
    sheets.push(triage);
    sources.push({
      sheet: triage.name,
      columns: triage.columns.map((column) => column.label),
      from: "Your own Save and Pass decisions in Discover",
      truthClass: "VERIFIED",
      refs: input.decisions.slice(0, 50).map((entry) => ({
        kind: "COMPANY",
        id: entry.companyId,
        label: entry.name.slice(0, 200),
      })),
    });
  }
  const count = input.relationships.length;
  const unavailable =
    input.fit?.kind === "NOT_AVAILABLE"
      ? (["Mandate fit", "Cheque fit", "Stage fit"] as const).map(
          (column): UnfilledColumn => ({
            column,
            why: "NOT_AVAILABLE",
            detail: input.fit?.kind === "NOT_AVAILABLE" ? input.fit.detail : "",
          }),
        )
      : [];
  return finish({
    title: "Pipeline",
    summary: `Your pipeline as of ${input.today}: ${String(count)} relationship${count === 1 ? "" : "s"}${input.decisions.length > 0 ? ` and ${String(input.decisions.length)} saved or passed compan${input.decisions.length === 1 ? "y" : "ies"}` : ""}, from your Capital Q relationship history${joined === null ? "" : ", with each company's fit with your mandate"}.`,
    sheets,
    sources,
    today: input.today,
    gaps: [
      ...(input.relationships.some((item) => item.lastMessageRead !== "OK")
        ? ["Some chats could not be read; their last-message cells are blank."]
        : []),
      ...(input.fit?.kind === "NOT_AVAILABLE"
        ? [`Fit with your mandate is not in this sheet: ${input.fit.detail}.`]
        : []),
      // Live 2026-10-29 (LedgerBridge): the fit service scores only the
      // companies eligible for Discover, so one awaiting that has blank fit
      // cells; the reason is said, not left to read as a verdict.
      ...unscoredOf(input, joined),
    ],
    unfilled: [
      ...unfilledOf(
        main,
        [...PIPELINE_COLUMNS, ...PIPELINE_FIT_COLUMNS].map((c) => c.key),
        choice,
        joined === null ? [] : fitKeys,
      ),
      ...unavailable,
    ],
  });
}

// --- a comparison Q showed -------------------------------------------------

export function buildComparisonSheet(
  block: Comparison,
  input: {
    readonly names: ReadonlyMap<string, string>;
    readonly messageId: string;
    readonly today: string;
  },
  choice: SheetChoice,
): BuiltSpreadsheet {
  const subjectId = (subject: Comparison["subjects"][number]) =>
    "companyId" in subject
      ? subject.companyId
      : "investorOrganisationId" in subject
        ? subject.investorOrganisationId
        : null;
  const columns: QSheetColumn[] = [
    { key: "measure", label: "Measure", type: "text" },
    ...block.subjects.map((subject, at) => {
      const id = subjectId(subject);
      return {
        key: `subject${String(at + 1)}`,
        label: (
          (id === null ? undefined : input.names.get(id)) ??
          `Subject ${String(at + 1)}`
        ).slice(0, 80),
        type: "text" as const,
      };
    }),
  ];
  const rows = block.rows.map((row): QSheetCell[] => [
    text(row.label),
    ...row.values.map(text),
  ]);
  const main = sheet(
    sheetName(choice.sheetName, "Comparison"),
    columns,
    rows,
    [],
    choice,
  );
  return finish({
    title: `Comparison: ${main.columns
      .slice(1)
      .map((column) => column.label)
      .join(" vs ")}`.slice(0, 160),
    summary: `The comparison Q showed in this conversation, as a spreadsheet: ${String(block.rows.length)} measures side by side.`,
    sheets: [main],
    sources: [
      {
        sheet: main.name,
        columns: main.columns.map((column) => column.label),
        from: "Q's comparison in this conversation, built from the records it read",
        truthClass: null,
        refs: refs(
          answerRef(input.messageId),
          block.subjects.map((subject) => {
            const id = subjectId(subject);
            return subjectRef(
              subject,
              id === null ? undefined : input.names.get(id),
            );
          }),
        ),
      },
    ],
    today: input.today,
    gaps: rows.some((row) => row.some((cell) => cell === null))
      ? ["Blank cells were not known when Q compared them."]
      : [],
    unfilled: unfilledByRow(main),
  });
}

// --- a ranked list Q showed ------------------------------------------------

export function buildRankedSheet(
  block: QAnswerCardsBlock,
  input: { readonly messageId: string; readonly today: string },
  choice: SheetChoice,
): BuiltSpreadsheet {
  const columns: QSheetColumn[] = [
    { key: "rank", label: "#", type: "number" },
    { key: "name", label: "Name", type: "text" },
    { key: "line", label: "What they do", type: "text" },
    { key: "raise", label: "Raise", type: "text" },
    { key: "fit", label: "Fit (out of 10)", type: "number" },
    { key: "measured", label: "Measures known", type: "number" },
    { key: "reasons", label: "Why", type: "text" },
    { key: "view", label: "Q's view", type: "text" },
  ];
  const rows = block.cards.map((card, at): QSheetCell[] => [
    block.shape === "RANKED" ? String(at + 1) : null,
    text(card.name),
    text(card.about ?? card.line),
    // The raise is words ("$2 million") as the reader may see it; copied
    // as written rather than parsed into an amount nobody stated.
    text(card.raise ?? null),
    card.fit === null ? null : decimalOf(card.fit.score),
    card.fit === null ? null : `${String(card.fit.measured)}`,
    text(card.reasons.join("\n")),
    text(card.view),
  ]);
  const main = sheet(
    sheetName(choice.sheetName, block.shape === "RANKED" ? "Ranked" : "List"),
    columns,
    rows,
    [],
    choice,
  );
  const fitKeys = ["fit", "measured"];
  return finish({
    title: block.title,
    summary: `${block.title}: the ${String(block.cards.length)} Q showed in this conversation, as a spreadsheet.`,
    sheets: [main],
    sources: [
      {
        sheet: main.name,
        columns: labelsOf(
          main,
          main.columns.map((c) => c.key).filter((k) => !fitKeys.includes(k)),
        ),
        from: "Q's answer in this conversation, from the records it read",
        truthClass: null,
        refs: refs(
          answerRef(input.messageId),
          block.cards.map((card) => subjectRef(card.subject, card.name)),
        ),
      },
      ...(main.columns.some((c) => fitKeys.includes(c.key))
        ? [
            {
              sheet: main.name,
              columns: labelsOf(main, fitKeys),
              from: "Fit computed by code from the measures known for each; not a verified fact",
              truthClass: "Q_INFERENCE" as const,
              refs: [answerRef(input.messageId)],
            },
          ]
        : []),
    ],
    today: input.today,
  });
}

// --- a table Q showed ------------------------------------------------------

export function buildTableSheet(
  block: Table,
  input: { readonly messageId: string; readonly today: string },
  choice: SheetChoice,
): BuiltSpreadsheet {
  // A column is a number column only when every known cell is an exact
  // decimal as written ("6400", "3.8"); anything else stays text as shown.
  const numeric = block.columns.map((_column, at) => {
    const known = block.rows
      .map((row) => row.cells[at] ?? "")
      .filter((cell) => cell.trim().length > 0);
    return (
      known.length > 0 &&
      known.every((cell) => DecimalStringSchema.safeParse(cell.trim()).success)
    );
  });
  const columns: QSheetColumn[] = [
    { key: "row", label: block.title.slice(0, 80), type: "text" },
    ...block.columns.map((column, at) => ({
      key: `col${String(at + 1)}`,
      label: column.label,
      type: numeric[at] === true ? ("number" as const) : ("text" as const),
    })),
  ];
  const rows = block.rows.map((row): QSheetCell[] => [
    text(row.label),
    ...row.cells.map((cell, at) =>
      numeric[at] === true ? decimalOf(cell.trim()) : text(cell),
    ),
  ]);
  const main = sheet(
    sheetName(choice.sheetName, "Table"),
    columns,
    rows,
    [],
    choice,
  );
  return finish({
    title: block.title,
    summary: `${block.title}: the table Q showed in this conversation, as a spreadsheet.`,
    sheets: [main],
    sources: [
      {
        sheet: main.name,
        columns: main.columns.map((column) => column.label),
        from: "Q's table in this conversation, built from the records it read",
        truthClass: null,
        refs: refs(
          answerRef(input.messageId),
          block.columns.map((column) =>
            subjectRef(column.subject, column.label),
          ),
        ),
      },
    ],
    today: input.today,
    gaps: rows.some((row) => row.some((cell) => cell === null))
      ? ["Blank cells were not known in Q's table."]
      : [],
    unfilled: unfilledByRow(main),
  });
}

// --- named things side by side as cards Q showed ------------------------------

type ComparisonCards = Extract<QResultBlock, { kind: "COMPARISON_CARDS" }>;

export function buildComparisonCardsSheet(
  block: ComparisonCards,
  input: { readonly messageId: string; readonly today: string },
  choice: SheetChoice,
): BuiltSpreadsheet {
  const points = Math.max(...block.items.map((item) => item.points.length));
  const columns: QSheetColumn[] = [
    { key: "name", label: "Name", type: "text" },
    { key: "subtitle", label: "About", type: "text" },
    ...Array.from({ length: points }, (_unused, at) => ({
      key: `point${String(at + 1)}`,
      label: `Point ${String(at + 1)}`,
      type: "text" as const,
    })),
  ];
  const rows = block.items.map((item): QSheetCell[] => [
    text(item.name),
    text(item.subtitle),
    ...Array.from({ length: points }, (_unused, at) => text(item.points[at])),
  ]);
  const title = block.title ?? "Side by side";
  const main = sheet(
    sheetName(choice.sheetName, "Side by side"),
    columns,
    rows,
    [],
    choice,
  );
  return finish({
    title,
    summary: `${title}: the ${String(block.items.length)} Q set side by side in this conversation, as a spreadsheet.`,
    sheets: [main],
    sources: [
      {
        sheet: main.name,
        columns: main.columns.map((column) => column.label),
        from: "Q's answer in this conversation, from the records it read",
        truthClass: null,
        refs: [answerRef(input.messageId)],
      },
    ],
    today: input.today,
  });
}

/**
 * The tabular blocks of one answer, best first: a side-by-side comparison
 * or table before cards, so "put that in a file" after a comparison is the
 * comparison (live 2026-10-28), never the list beside it.
 */
export const TABULAR_BLOCK_KINDS = [
  "COMPARISON",
  "TABLE",
  "COMPARISON_CARDS",
  "ANSWER_CARDS",
] as const;
export type TabularBlock = Extract<
  QResultBlock,
  { kind: (typeof TABULAR_BLOCK_KINDS)[number] }
>;

export function tabularBlocks(
  blocks: readonly QResultBlock[],
): readonly TabularBlock[] {
  return TABULAR_BLOCK_KINDS.flatMap((kind) =>
    blocks.filter((block): block is TabularBlock => block.kind === kind),
  );
}

/** The best tabular block of an answer as a spreadsheet, or null. */
export function buildShownSheet(
  blocks: readonly QResultBlock[],
  input: {
    readonly messageId: string;
    readonly today: string;
    readonly names?: ReadonlyMap<string, string> | undefined;
  },
  choice: SheetChoice,
): BuiltSpreadsheet | null {
  const block = tabularBlocks(blocks)[0];
  if (block === undefined) return null;
  const at = { messageId: input.messageId, today: input.today };
  switch (block.kind) {
    case "COMPARISON":
      return buildComparisonSheet(
        block,
        { ...at, names: input.names ?? new Map<string, string>() },
        choice,
      );
    case "TABLE":
      return buildTableSheet(block, at, choice);
    case "COMPARISON_CARDS":
      return buildComparisonCardsSheet(block, at, choice);
    case "ANSWER_CARDS":
      return buildRankedSheet(block, at, choice);
  }
}

/**
 * What the reply says after a spreadsheet is made, written by code from
 * the built workbook (live 2026-10-28: the whole reply was an offer): what
 * was made -- sheets, rows, columns -- and which asked-for columns could
 * not be filled and why. The model adds at most one offer after it.
 */
const andList = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

export function spreadsheetReceipt(built: BuiltSpreadsheet): string {
  const list = (labels: readonly string[], max: number) =>
    labels.length <= max
      ? labels.join(", ")
      : `${labels.slice(0, max).join(", ")} and ${String(labels.length - max)} more`;
  const sheets = built.workbook.sheets.map((one, at) => {
    const rows = `${String(one.rows.length)} row${one.rows.length === 1 ? "" : "s"}`;
    return at === 0
      ? `${one.name} (${rows}; columns ${list(
          one.columns.map((column) => column.label),
          10,
        )})`
      : `${one.name} (${rows})`;
  });
  const made = `I've made “${built.title}” as an Excel spreadsheet, with a CSV: ${sheets.join("; ")}, plus a Sources sheet saying where each column came from.`;
  const missing = built.unfilled
    .slice(0, 6)
    .map((gap) =>
      gap.why === "NOT_AVAILABLE"
        ? `${gap.column}: not available${gap.detail === undefined || gap.detail.length === 0 ? "" : ` (${gap.detail})`}`
        : gap.for !== undefined && gap.for.length > 0
          ? `${gap.column}: not known for ${andList(gap.for)}, left blank`
          : gap.rows !== undefined && gap.of !== undefined && gap.rows < gap.of
            ? `${gap.column}: not known for ${String(gap.rows)} of ${String(gap.of)} rows, left blank`
            : `${gap.column}: not known for any row, left blank`,
    );
  return (
    missing.length === 0 ? made : `${made} Not filled: ${missing.join("; ")}.`
  ).slice(0, 900);
}

// --- a company's stated figures ---------------------------------------------

export type FigureInput = {
  readonly key: string;
  readonly statement: string;
  readonly value: Readonly<Record<string, unknown>> | null;
  readonly asOf: string | null;
  readonly truthClass: string;
  readonly evidenceStatus: string;
};

const FIGURE_COLUMNS: readonly QSheetColumn[] = [
  { key: "figure", label: "Figure", type: "text" },
  { key: "statement", label: "As stated", type: "text" },
  { key: "amount", label: "Amount", type: "money" },
  { key: "number", label: "Number", type: "number" },
  { key: "percent", label: "Percent", type: "percent" },
  { key: "asOf", label: "As of", type: "date" },
  { key: "truthClass", label: "Truth class", type: "text" },
  { key: "evidence", label: "Evidence", type: "text" },
];

/** A figure's typed value: money, a count or number, or a percent. */
function figureCells(
  value: FigureInput["value"],
): [QSheetCell, QSheetCell, QSheetCell] {
  if (value === null) return [null, null, null];
  const kind = value["kind"];
  if (kind === "MONEY") {
    const amount = decimalOf(value["amount"]);
    const currency = value["currency"];
    return [
      typeof amount === "string" &&
      typeof currency === "string" &&
      /^[A-Z]{3}$/u.test(currency)
        ? { amount, currency }
        : null,
      null,
      null,
    ];
  }
  if (kind === "PERCENT") return [null, null, decimalOf(value["value"])];
  if (kind === "COUNT" || kind === "NUMBER") {
    return [null, decimalOf(value["value"]), null];
  }
  return [null, null, null];
}

export function buildFiguresSheet(
  input: {
    readonly companyId: string;
    readonly companyName: string;
    readonly figures: readonly FigureInput[];
    readonly today: string;
  },
  choice: SheetChoice,
): BuiltSpreadsheet | null {
  if (input.figures.length === 0) return null;
  const rows = input.figures.map((figure): QSheetCell[] => {
    const [amount, number, percent] = figureCells(figure.value);
    const asOf =
      figure.asOf ??
      (typeof figure.value?.["asOf"] === "string"
        ? figure.value["asOf"]
        : null);
    return [
      text(figure.key),
      text(figure.statement),
      amount,
      number,
      percent,
      dateOf(asOf),
      words(figure.truthClass),
      words(figure.evidenceStatus),
    ];
  });
  const main = sheet(
    sheetName(choice.sheetName, "Figures"),
    FIGURE_COLUMNS,
    rows,
    [],
    choice,
  );
  return finish({
    title: `${input.companyName}: stated figures`,
    summary: `${input.companyName}'s current figures as the company published them on Capital Q (${String(input.figures.length)}), each with its truth class and evidence. A self-reported figure is the company's claim, not verified.`,
    sheets: [main],
    sources: [
      {
        sheet: main.name,
        columns: main.columns.map((column) => column.label),
        from: `${input.companyName}'s current published claims on Capital Q`,
        // Each figure carries its own truth class, in its own column.
        truthClass: null,
        refs: [
          {
            kind: "COMPANY",
            id: input.companyId,
            label: input.companyName.slice(0, 200),
          },
        ],
      },
    ],
    today: input.today,
    gaps: rows.some(
      (row) => row[2] === null && row[3] === null && row[4] === null,
    )
      ? [
          "Some figures have no structured value; only their statement is shown.",
        ]
      : [],
  });
}

/** What the artifact's prose says about the workbook it carries. */
export function spreadsheetSections(built: BuiltSpreadsheet) {
  return [
    {
      heading: "What is in this spreadsheet",
      body: [
        built.summary,
        ...built.workbook.sheets.map(
          (one) =>
            `${one.name}: ${String(one.rows.length)} row${one.rows.length === 1 ? "" : "s"}, ${one.columns.map((c) => c.label).join(", ")}.`,
        ),
        "The Sources sheet says where every column came from and its truth class.",
      ]
        .join("\n")
        .slice(0, 6_000),
      findings: [],
    },
  ];
}
