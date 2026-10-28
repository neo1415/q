import { answerCardsBlock, type ModelAnswerCardsLike } from "./answer-cards.js";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { asksForSummary } from "./artifact-preview.js";
import { RunRead, type ReadInvestor } from "./card-subjects.js";
import {
  EvidenceStatusSchema,
  Q_SUMMARY_POINTS_MAX,
  QFindingIdSchema,
  TruthClassSchema,
  chartableSeries,
  parseQResultBlocks,
  type QResultBlockDrop,
  type PermittedContextPlan,
  type QConfidenceLevel,
  type QFindingType,
  type EvidenceStatus,
  type QResultBlock,
  type QSubjectRef,
  type TruthClass,
} from "@capital-q/contracts";

/**
 * What the analyst already produced, as blocks a client can act on
 * (QX-002/003 §C1-§C2).
 *
 * The analyst schema has carried this structure since it was written —
 * "the rest is structure the runtime can check and later surface as
 * result blocks" — and nothing surfaced it. The answer travelled as prose
 * and the findings, the gaps and the questions Q wanted to ask were
 * dropped on the floor. This is that projection, and it invents nothing:
 * every block below is a field the model already filled or a subject the
 * server already authorised for the run.
 *
 * Three rules.
 *
 * **Nothing is fabricated to make a card appear.** A run with no findings
 * produces no finding blocks. A run about no subject produces no
 * reference. The absence of a block is information.
 *
 * **Subjects come from the run, never from the model.** A COMPANY_REFERENCE
 * names the company the run was already authorised against. A model cannot
 * cause a reference to a company by mentioning one, because it is not
 * consulted about which subjects exist.
 *
 * **No identifier travels that the person could not already resolve.**
 * Evidence references are deliberately absent: a reference is only ids,
 * and whether somebody may see the document behind one is disclosure's
 * decision at render time (the QX-001 finding). Findings carry their own
 * evidence refs in the contract, so they are emitted with an empty list
 * rather than with ids the browser has no business holding.
 */

/** The fields of the analyst result this projection reads. */
export type AnalystResultLike = {
  readonly findings?:
    | readonly {
        readonly statement: string;
        readonly type?: string | undefined;
        readonly confidence?: string | undefined;
        readonly truthClass?: string | undefined;
        readonly evidenceStatus?: string | undefined;
        /** The company dimension it speaks to, when the producer has one. */
        readonly dimension?: string | undefined;
        /**
         * DETERMINISTIC: Capital Q computed it from state before any model
         * ran. A deterministic GAP is a claim about a whole dimension
         * ("holds no authorised understanding of customers").
         */
        readonly derivation?: string | undefined;
      }[]
    | undefined;
  readonly missingEvidence?: readonly string[] | undefined;
  readonly contradictions?: readonly string[] | undefined;
  /** The answer's words; a holding line is no answer (clarification). */
  readonly answer?: string | undefined;
  readonly insufficientEvidence?: boolean | undefined;
  readonly clarifyingQuestions?:
    readonly { readonly question: string }[] | undefined;
  /** v17: things to see together, already schema-checked (ADR 0053). */
  readonly answerCards?: ModelAnswerCardsLike | null | undefined;
  /** v12: named things side by side, already schema-checked. */
  readonly comparisonCards?:
    | {
        readonly title: string | null;
        readonly items: readonly {
          readonly name: string;
          readonly subtitle: string | null;
          readonly points: readonly string[];
        }[];
      }
    | null
    | undefined;
  /**
   * E4: how the model would lay the answer out ("MAP", "TABLE", ...),
   * when the analyst schema carries it (requested of workstream B). The
   * kind is the model's choice; the content never is.
   */
  readonly visual?: string | null | undefined;
  /** v26 (L-13): the model's search words for a PICTURE; a proposal only. */
  readonly pictureQuery?: string | null | undefined;
};

const FINDING_TYPES = new Set<string>([
  "FACT",
  "OBSERVATION",
  "INFERENCE",
  "RISK",
  "STRENGTH",
  "GAP",
  "RECOMMENDATION",
  "UNCERTAINTY",
]);

const TRUTH_CLASSES = new Set<string>([
  "VERIFIED",
  "USER_CLAIM",
  "ESTIMATE",
  "Q_INFERENCE",
  "UNKNOWN",
]);

const EVIDENCE_STATUSES = new Set<string>([
  "NO_EVIDENCE",
  "SELF_REPORTED",
  "DOCUMENT_SUPPORTED",
  "MULTI_SOURCE_SUPPORTED",
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
]);

const CONFIDENCE_LEVELS = new Set<string>([
  "HIGH",
  "MODERATE",
  "LOW",
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_EVIDENCE",
]);

/**
 * The contract refuses an uncertainty claiming HIGH, which is the right
 * refusal: a block whose whole content is "this was not established"
 * cannot also be certain. Its three levels say exactly what the analyst
 * meant — nothing was found, or two things disagree — so each list maps
 * to the one that is true of it rather than to a generic "low".
 */
const NOT_ESTABLISHED = "INSUFFICIENT_EVIDENCE" as const;
const DISAGREES = "CONFLICTING_EVIDENCE" as const;

/**
 * A reference block for each subject the run was authorised against.
 *
 * Only the two kinds a client can currently do anything with. A
 * relationship, a capital objective, a document or a user has no card and
 * no action, so emitting one would be a rectangle that does nothing.
 */
function subjectBlocks(
  subjects: readonly QSubjectRef[],
): readonly QResultBlock[] {
  return subjects.flatMap((subject): readonly QResultBlock[] => {
    switch (subject.kind) {
      case "COMPANY":
        return [{ kind: "COMPANY_REFERENCE", companyId: subject.companyId }];
      case "INVESTOR_ORGANISATION":
        return [
          {
            kind: "INVESTOR_REFERENCE",
            investorOrganisationId: subject.investorOrganisationId,
          },
        ];
      // A relationship, a capital objective, a document, a person or an
      // organisation has no card and no action, so a reference to one
      // would be a rectangle that does nothing.
      case "RELATIONSHIP":
      case "CAPITAL_OBJECTIVE":
      case "DOCUMENT":
      case "USER":
      case "ORGANISATION":
        return [];
    }
  });
}

/**
 * Whether a finding stands on evidence: a claim about the business that
 * rests on at least one authorised source. Gaps and uncertainties are
 * about evidence, not on it.
 */
function supportedOn(finding: {
  readonly type?: string | undefined;
  readonly evidenceStatus?: string | undefined;
}): boolean {
  return (
    finding.type !== "GAP" &&
    finding.type !== "UNCERTAINTY" &&
    finding.evidenceStatus !== undefined &&
    finding.evidenceStatus !== "NO_EVIDENCE"
  );
}

/**
 * One answer never says two opposite things about its own evidence
 * (CQ-QX-007 F1).
 *
 * Capital Q computes a gap per asked-about dimension before the model
 * runs, from its structured knowledge: "holds no authorised understanding
 * of customers". A document passage has no dimension until a finding
 * gives it one, so a question answered from the one-pager still produced
 * that gap — beside the FACT that answered it from the one-pager. The
 * whole-dimension gap is only true when nothing in the same answer
 * stands on evidence for that dimension; when something does, the gap is
 * withdrawn here, at assembly, rather than trusted to a model or a
 * sentence match. A narrower gap the analyst wrote about part of the
 * dimension ("the other 62% of loads is not established") is not
 * contradicted by a fact about the rest, and stays.
 */
export function withoutContradictedGaps<
  F extends {
    readonly type?: string | undefined;
    readonly evidenceStatus?: string | undefined;
    readonly dimension?: string | undefined;
    readonly derivation?: string | undefined;
  },
>(findings: readonly F[]): readonly F[] {
  const evidenced = new Set(
    findings.flatMap((finding) =>
      finding.dimension !== undefined && supportedOn(finding)
        ? [finding.dimension]
        : [],
    ),
  );
  return findings.filter(
    (finding) =>
      !(
        finding.type === "GAP" &&
        finding.derivation === "DETERMINISTIC" &&
        finding.dimension !== undefined &&
        evidenced.has(finding.dimension)
      ),
  );
}

/**
 * Where the answer's supported findings came from, as one line the person
 * reads (CQ-QX-007 F1): "Source: kivu-one-pager.pdf, page 1." Built only
 * from the sources the findings' own citations resolved to — the
 * producer's person-facing names, never identifiers and never anything the
 * model wrote about its sources. Null when nothing named supports the
 * answer: an answer from the profile alone does not need a footnote, and
 * an undisclosable document is never named.
 */
export const PROVENANCE_SOURCES_MAX = 4;

export function provenanceLine(
  findings: readonly {
    readonly type?: string | undefined;
    readonly evidenceStatus?: string | undefined;
    readonly sources?: readonly string[] | undefined;
  }[],
): string | null {
  const named = [
    ...new Set(
      findings.flatMap((finding) =>
        supportedOn(finding) ? [...(finding.sources ?? [])] : [],
      ),
    ),
  ]
    .map((source) => source.trim())
    .filter((source) => source.length > 0)
    .slice(0, PROVENANCE_SOURCES_MAX);
  if (named.length === 0) return null;
  return named.length === 1
    ? `Source: ${named[0] ?? ""}.`
    : `Sources: ${named.join("; ")}.`;
}

/**
 * The person's OWN investor organisation, when the run carries it beside a
 * company (CQ-QX-007 fit): the organisation an INVESTOR_MANDATE scope is
 * bound to. The firewall admits a mandate to its owner and to nobody else,
 * so a bound mandate scope is the proof — never the subject list, which a
 * client may have declared.
 */
export function ownInvestorOrganisationIn(
  plan: Pick<PermittedContextPlan, "scopes">,
): string | null {
  for (const scope of plan.scopes) {
    if (
      scope.kind === "INVESTOR_MANDATE" &&
      scope.subject?.kind === "INVESTOR_ORGANISATION"
    ) {
      return scope.subject.investorOrganisationId;
    }
  }
  return null;
}

/**
 * What the question is about, without the person's own organisation
 * carried along as context. "Is this company worth my time?" is about the
 * company; the investor's own firm is why the answer can be specific, not
 * a second subject to show a card for or to route by.
 */
export function askedSubjects(
  subjects: readonly QSubjectRef[],
  plan: Pick<PermittedContextPlan, "scopes">,
): readonly QSubjectRef[] {
  const own = ownInvestorOrganisationIn(plan);
  if (own === null || !subjects.some((subject) => subject.kind === "COMPANY")) {
    return subjects;
  }
  return subjects.filter(
    (subject) =>
      !(
        subject.kind === "INVESTOR_ORGANISATION" &&
        subject.investorOrganisationId === own
      ),
  );
}

/** Below this many characters an answer is a holding line, not an answer. */
const SUBSTANTIVE_ANSWER_CHARS = 160;

/**
 * Whether the reading is one where Q could not answer: it said the
 * evidence was insufficient, or wrote no more than a holding line.
 */
export function couldNotAnswer(result: AnalystResultLike): boolean {
  if (result.insufficientEvidence === true) return true;
  const answer = result.answer?.trim() ?? "";
  return answer.length < SUBSTANTIVE_ANSWER_CHARS;
}

/**
 * The conversation's findings, read from the specialist channel when the
 * model left its own empty. Live 2026-10-13: a risks follow-up wrote nine
 * evidence-backed points as companyFindings (the company specialist's
 * channel, which no conversation surface renders) and none as findings,
 * so the person saw a long answer with no findings beside it. Each point
 * keeps its own statement, type, truth class and confidence; it carries
 * no evidence status of its own, so the renderer's weakest honest reading
 * applies (never a stronger one). Its own findings, when any, win.
 */
export function withConversationFindings<
  T extends AnalystResultLike & {
    readonly companyFindings?:
      | readonly {
          readonly statement: string;
          readonly type?: string | undefined;
          readonly confidence?: string | undefined;
          readonly truthClass?: string | undefined;
          readonly dimension?: string | undefined;
        }[]
      | undefined;
  },
>(result: T): T {
  if ((result.findings?.length ?? 0) > 0) return result;
  const specialist = result.companyFindings ?? [];
  if (specialist.length === 0) return result;
  return {
    ...result,
    findings: specialist.map((finding) => ({
      statement: finding.statement,
      type: finding.type,
      confidence: finding.confidence,
      truthClass: finding.truthClass,
      dimension: finding.dimension,
    })),
  };
}

type FindingLike = NonNullable<AnalystResultLike["findings"]>[number];

/**
 * One finding as the person sees it, from the model's own reading of it.
 * The same for a finding shown while the answer streams and for the
 * completed message, so the two never differ. Null for an empty one.
 */
export function findingBlockOf(
  finding: FindingLike,
  subjects: readonly QSubjectRef[],
  findingId: string,
): Extract<QResultBlock, { kind: "FINDING" }> | null {
  const statement = finding.statement.trim();
  if (statement.length === 0) return null;
  return {
    kind: "FINDING",
    finding: {
      findingId: QFindingIdSchema.parse(findingId),
      // An unrecognised type is an observation, not a guess at a
      // stronger one: reading a model's label as RISK when the contract
      // does not know it would be inventing severity.
      type: (FINDING_TYPES.has(finding.type ?? "")
        ? finding.type
        : "OBSERVATION") as QFindingType,
      statement,
      confidence: (CONFIDENCE_LEVELS.has(finding.confidence ?? "")
        ? finding.confidence
        : "MODERATE") as QConfidenceLevel,
      // The model's own reading of what kind of claim this is, passed
      // through rather than re-decided here. An unrecognised value
      // becomes the weakest honest one: a claim whose standing we
      // cannot read is a user claim with no evidence, never a fact.
      truthClass: (TRUTH_CLASSES.has(finding.truthClass ?? "")
        ? finding.truthClass
        : "USER_CLAIM") as TruthClass,
      evidenceStatus: (EVIDENCE_STATUSES.has(finding.evidenceStatus ?? "")
        ? finding.evidenceStatus
        : "SELF_REPORTED") as EvidenceStatus,
      // Deliberately empty. The finding's supporting evidence is real
      // and its identifiers are not the browser's to hold.
      evidenceRefs: [],
      // What the run was authorised about, never what the model named.
      subjects: [...subjects],
    },
  };
}

export function analystResultBlocks(input: {
  readonly result: AnalystResultLike;
  readonly subjects: readonly QSubjectRef[];
  /** E4: what this run's tools returned (investors, places); absent: none read. */
  readonly read?: RunRead | undefined;
  /** E3: blocks the contract refused, for the caller to log. */
  readonly onDropped?:
    ((dropped: readonly QResultBlockDrop[]) => void) | undefined;
  /**
   * A finding's id, by its place and its statement: a finding already
   * shown while the answer streamed keeps the id it was shown under
   * (`q.finding.available`). Overridable so a test can pin its ids.
   */
  readonly findingId?:
    ((index: number, statement: string) => string) | undefined;
  /** The person's question: a summary asked for is laid out as one (L-14). */
  readonly question?: string | undefined;
}): QResultBlock[] | undefined {
  const idFor = input.findingId ?? (() => randomUUID());
  const blocks: QResultBlock[] = [];

  // The cards lead: they are the answer's shape when the person compared
  // things. Copied as written, in the order written; nothing here sorts.
  // v17's answer cards replace v12's comparison cards when both came.
  const answer =
    input.result.answerCards === null || input.result.answerCards === undefined
      ? null
      : answerCardsBlock(input.result.answerCards);
  if (answer !== null) blocks.push(answer);
  const cards = answer === null ? input.result.comparisonCards : null;
  if (cards !== null && cards !== undefined && cards.items.length >= 2) {
    blocks.push({
      kind: "COMPARISON_CARDS",
      title: cards.title,
      items: cards.items.map((item) => ({
        name: item.name,
        subtitle: item.subtitle,
        points: [...item.points],
      })),
    });
  }

  for (const [index, finding] of withoutContradictedGaps(
    input.result.findings ?? [],
  ).entries()) {
    const block = findingBlockOf(
      finding,
      input.subjects,
      idFor(index, finding.statement),
    );
    if (block !== null) blocks.push(block);
  }

  // What the supplied context did not establish, and what conflicts in it.
  // Both are absence reported as absence — never a low score for anybody.
  for (const statement of input.result.missingEvidence ?? []) {
    const text = statement.trim();
    if (text.length === 0) continue;
    blocks.push({
      kind: "UNCERTAINTY",
      statement: text,
      confidence: NOT_ESTABLISHED,
    });
  }
  for (const statement of input.result.contradictions ?? []) {
    const text = statement.trim();
    if (text.length === 0) continue;
    blocks.push({
      kind: "UNCERTAINTY",
      statement: text,
      confidence: DISAGREES,
    });
  }

  // A question back is a card only when Q genuinely could not answer
  // (Zino live 2026-10-07: "I'm asking you something but you're giving me
  // a card asking me another question"). Beside an answer, the question
  // is already in the words, said once, in voice or text.
  if (couldNotAnswer(input.result)) {
    for (const clarification of input.result.clarifyingQuestions ?? []) {
      const question = clarification.question.trim();
      if (question.length === 0) continue;
      blocks.push({ kind: "CLARIFICATION_REQUEST", question });
    }
  }

  blocks.push(...subjectBlocks(input.subjects));

  // L-14: the summary the person asked for, from the answer's findings.
  if (input.question !== undefined) {
    const summary = summaryBlock({
      result: input.result,
      question: input.question,
    });
    if (summary !== null) blocks.push(summary);
  }

  // E4: what the model asked to be laid out, built only from this run's
  // own reads (never its words). Nothing read, nothing drawn.
  if (input.read !== undefined) {
    const visual = visualBlock(input.result.visual, input.read);
    if (visual !== null) blocks.push(visual);
  }

  if (blocks.length === 0) {
    return undefined;
  }
  // Parsed rather than asserted: a block that does not satisfy the public
  // contract must not reach a client, and the answer is still good text
  // without it. E3 (audit E-07): block by block, so one bad block costs
  // only itself, and the drop is reported rather than silent.
  const parsed = parseQResultBlocks(blocks);
  if (parsed.dropped.length > 0) input.onDropped?.(parsed.dropped);
  return parsed.blocks.length === 0 ? undefined : parsed.blocks;
}

// ---------------------------------------------------------------------------
// E4: tables, maps, timelines and charts, from validated data only.

export const Q_VISUAL_KINDS = ["MAP", "TABLE", "TIMELINE", "CHART"] as const;
export type QVisualKind = (typeof Q_VISUAL_KINDS)[number];

function investorsOf(read: RunRead): readonly ReadInvestor[] {
  return [...read.investors.values()].slice(0, 8);
}

/** Where the run's investors are, as they publish it. */
export function investorsMapBlock(
  investors: readonly ReadInvestor[],
): QResultBlock | null {
  if (!investors.some((investor) => investor.country !== null)) return null;
  return {
    kind: "MAP",
    title: "Where they're based",
    basis: "Head-office country, as each investor publishes it on Capital Q.",
    places: investors.slice(0, 20).map((investor) => ({
      label: investor.name.slice(0, 80),
      countryCode: investor.country,
      subject: {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: investor.investorOrganisationId,
      },
      note: null,
    })),
  };
}

/**
 * Lane A (live 2026-10-15: "show me on a map where they are based" about
 * three companies drew nothing, though their countries had been read):
 * where the run's companies are, as each publishes it. Only companies an
 * authorised read of this run returned; a company with no published
 * country is listed without a place, never guessed.
 */
export function companiesMapBlock(read: RunRead): QResultBlock | null {
  const companies = [...read.companyNames.entries()].slice(0, 20);
  if (!companies.some(([companyId]) => read.countries.has(companyId))) {
    return null;
  }
  return {
    kind: "MAP",
    title: "Where they're based",
    basis: "Country, as each company publishes it on Capital Q.",
    places: companies.map(([companyId, name]) => ({
      label: name.slice(0, 80),
      countryCode: read.countries.get(companyId) ?? null,
      subject: { kind: "COMPANY", companyId },
      note: null,
    })),
  };
}

/**
 * The run's investors side by side, each column headed by its name and
 * opening its profile; rows are what they publish. An unread fact is an
 * empty cell ("not known"), never a guess.
 */
export function investorsTableBlock(
  investors: readonly ReadInvestor[],
): QResultBlock | null {
  if (investors.length < 2) return null;
  const columns = investors.slice(0, 8);
  const rows = [
    { label: "Based in", cells: columns.map((one) => one.country ?? "") },
    {
      label: "Why they fit (what they publish)",
      cells: columns.map((one) => one.basis.join("; ").slice(0, 500)),
    },
  ];
  return {
    kind: "TABLE",
    title: "Side by side",
    columns: columns.map((one) => ({
      label: one.name.slice(0, 80),
      subject: {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: one.investorOrganisationId,
      },
    })),
    rows,
  };
}

/**
 * Artifacts live (L-14): the summary the person asked for, as one object
 * Q speaks over. Its points are the answer's own findings, in order, each
 * keeping its truth class and evidence status (an inference stays labelled
 * as one); what is missing is listed as missing. Fewer than two findings:
 * no summary, the words say it.
 */
export function summaryBlock(input: {
  readonly result: AnalystResultLike;
  readonly question: string;
}): QResultBlock | null {
  if (!asksForSummary(input.question)) return null;
  const points = (input.result.findings ?? [])
    .map((finding) => ({
      text: finding.statement.trim().slice(0, 300),
      truthClass: TruthClassSchema.safeParse(finding.truthClass),
      evidenceStatus: EvidenceStatusSchema.safeParse(finding.evidenceStatus),
    }))
    .flatMap((point) =>
      point.text.length > 0 &&
      point.truthClass.success &&
      point.evidenceStatus.success
        ? [
            {
              text: point.text,
              truthClass: point.truthClass.data,
              evidenceStatus: point.evidenceStatus.data,
            },
          ]
        : [],
    )
    .slice(0, Q_SUMMARY_POINTS_MAX);
  if (points.length < 2) return null;
  return {
    kind: "SUMMARY",
    title: "Summary",
    points,
    missing: (input.result.missingEvidence ?? [])
      .map((gap) => gap.trim().slice(0, 200))
      .filter((gap) => gap.length > 0)
      .slice(0, 3),
  };
}

/** "SERIES_A" -> "Series A"; a code is reference data, shown as words. */
function stageWords(code: string | null): string {
  if (code === null || code.trim().length === 0) return "";
  return code
    .trim()
    .toLowerCase()
    .split(/[_\s]+/u)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/**
 * Artifacts live (audit 2026-10-15 §4: a company table was only ever
 * side-by-side cards): the run's companies side by side, for either role.
 * Each column is a company an authorised read of this run returned and
 * opens its profile; each row is what the company states about itself,
 * from a complete profile read. An unread fact is an empty cell ("not
 * known"), never a guess, and a row nobody has anything for is left out.
 */
/** Its title: a comparison table built from fit takes its place (QO-05). */
export const COMPANIES_TABLE_TITLE = "Side by side, as each company states it";

export function companiesTableBlock(read: RunRead): QResultBlock | null {
  const ids = [
    ...read.companyFacts.keys(),
    ...[...read.companyNames.keys()].filter((id) => !read.companyFacts.has(id)),
  ].slice(0, 8);
  if (ids.length < 2) return null;
  const fact = (id: string) => read.companyFacts.get(id);
  const place = (id: string) => {
    const facts = fact(id);
    const country = facts?.country ?? read.countries.get(id) ?? null;
    return [facts?.city ?? null, country]
      .filter((part) => part !== null && part.trim().length > 0)
      .join(", ");
  };
  const candidates = [
    {
      label: "What they do",
      cells: ids.map((id) => (fact(id)?.about ?? "").slice(0, 500)),
    },
    {
      label: "Stage",
      cells: ids.map((id) => stageWords(fact(id)?.stageCode ?? null)),
    },
    { label: "Based in", cells: ids.map(place) },
    {
      label: "Founded",
      cells: ids.map((id) => (fact(id)?.founded ?? "").slice(0, 4)),
    },
    {
      label: "Website",
      cells: ids.map((id) => (fact(id)?.website ?? "").slice(0, 200)),
    },
  ];
  const rows = candidates.filter((row) =>
    row.cells.some((cell) => cell.length > 0),
  );
  if (rows.length === 0) return null;
  return {
    kind: "TABLE",
    title: COMPANIES_TABLE_TITLE,
    columns: ids.map((companyId) => ({
      label: (read.companyNames.get(companyId) ?? "Company").slice(0, 80),
      subject: { kind: "COMPANY", companyId },
    })),
    rows,
  };
}

/** Events in time order, oldest first; undated events are not placed. */
export function timelineBlock(input: {
  readonly title: string;
  readonly events: readonly {
    readonly at: string;
    readonly label: string;
    readonly note?: string | null | undefined;
    readonly subject?: QSubjectRef | null | undefined;
  }[];
}): QResultBlock | null {
  const dated = input.events
    .filter((event) => Number.isFinite(Date.parse(event.at)))
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-20);
  if (dated.length === 0) return null;
  return {
    kind: "TIMELINE",
    title: input.title,
    events: dated.map((event) => ({
      at: event.at,
      label: event.label.slice(0, 120),
      note: event.note?.slice(0, 240) ?? null,
      subject: event.subject ?? null,
    })),
  };
}

/**
 * A chart from figures that carry their own standing. A series that is
 * not chartable (an inference, an estimate, a bare self-report) is left
 * out rather than drawn as if it were fact; none left, no chart.
 */
export function chartBlock(input: {
  readonly chart: "BAR" | "LINE";
  readonly title: string;
  readonly unit: string;
  readonly currency: string | null;
  readonly series: readonly {
    readonly label: string;
    readonly truthClass: TruthClass;
    readonly evidenceStatus: EvidenceStatus;
    readonly source: string;
    readonly points: readonly {
      readonly label: string;
      readonly value: number;
    }[];
  }[];
}): QResultBlock | null {
  const series = input.series
    .filter(chartableSeries)
    .filter((one) => one.points.every((point) => Number.isFinite(point.value)))
    .slice(0, 4);
  if (series.length === 0) return null;
  return {
    kind: "CHART",
    chart: input.chart,
    title: input.title,
    unit: input.unit,
    currency: input.currency,
    series: series.map((one) => ({
      label: one.label,
      truthClass: one.truthClass,
      evidenceStatus: one.evidenceStatus,
      source: one.source,
      points: one.points.slice(0, 24).map((point) => ({ ...point })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Live 2026-10-28: their day as a card, from list_schedule's own result.

const ScheduleReadSchema = z
  .object({
    meetings: z
      .array(
        z
          .object({
            id: z.string(),
            relationshipId: z.string(),
            purpose: z.string(),
            startsAt: z.string(),
            organisedByYou: z.boolean(),
            with: z.array(z.string()),
            brief: z.string().nullable(),
          })
          .passthrough(),
      )
      .default([]),
    reminders: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            dueAt: z.string(),
            relationshipId: z.string().nullable(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

const ApprovalsReadSchema = z
  .object({
    items: z.array(z.object({ summary: z.string() }).passthrough()).default([]),
  })
  .passthrough();

function dayKeyIn(at: Date, zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return null;
  }
}

/**
 * Their day, built only from the `list_schedule` tool's authorised result
 * (and the pending-approvals read beside it): today's calls and reminders
 * when there are any, else the next seven days', each in time order. A
 * reminder past due still shows (it is open). Null when the read did not
 * parse: nothing is drawn from a guess.
 */
export function scheduleBlock(input: {
  readonly schedule: unknown;
  readonly approvals?: unknown;
  readonly now: Date;
  /** Their zone; null when not known (the card then says UTC). */
  readonly timeZone: string | null;
}): QResultBlock | null {
  const read = ScheduleReadSchema.safeParse(input.schedule);
  if (!read.success) return null;
  const zone = input.timeZone ?? "UTC";
  const today = dayKeyIn(input.now, zone);
  const nowMs = input.now.getTime();
  const horizon = nowMs + 7 * 24 * 3_600_000;
  const parsed = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  };
  const isToday = (iso: string) =>
    today !== null && dayKeyIn(new Date(iso), zone) === today;
  const calls = read.data.meetings
    .filter((meeting) => {
      const ms = parsed(meeting.startsAt);
      return ms !== null && ms >= nowMs - 3_600_000 && ms <= horizon;
    })
    .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const reminders = read.data.reminders
    .filter((reminder) => {
      const ms = parsed(reminder.dueAt);
      return ms !== null && ms <= horizon;
    })
    .toSorted((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const todayCalls = calls.filter((call) => isToday(call.startsAt));
  const todayReminders = reminders.filter((reminder) =>
    isToday(reminder.dueAt),
  );
  const span: "TODAY" | "WEEK" =
    todayCalls.length > 0 || todayReminders.length > 0 ? "TODAY" : "WEEK";
  const shownCalls = (span === "TODAY" ? todayCalls : calls).slice(0, 8);
  const shownReminders = (span === "TODAY" ? todayReminders : reminders).slice(
    0,
    8,
  );
  const approvals = ApprovalsReadSchema.safeParse(input.approvals ?? {});
  const uuid = (value: string | null): string | null =>
    value !== null && UUID_RE.test(value) ? value.toLowerCase() : null;
  const block = {
    kind: "SCHEDULE" as const,
    title: span === "TODAY" ? "Your day" : "Your next seven days",
    span,
    timeZone: input.timeZone,
    calls: shownCalls.map((call) => ({
      meetingId: call.id.slice(0, 64),
      relationshipId: uuid(call.relationshipId),
      purpose: call.purpose.trim().slice(0, 160) || "Call",
      startsAt: new Date(call.startsAt).toISOString(),
      with: call.with
        .map((name) => name.trim().slice(0, 120))
        .filter((name) => name.length > 0)
        .slice(0, 6),
      organisedByYou: call.organisedByYou,
      briefReady: call.brief !== null && call.brief.trim().length > 0,
    })),
    reminders: shownReminders.map((reminder) => ({
      reminderId: reminder.id.slice(0, 64),
      title: reminder.title.trim().slice(0, 200) || "Reminder",
      dueAt: new Date(reminder.dueAt).toISOString(),
      relationshipId: uuid(reminder.relationshipId),
    })),
    approvals: (approvals.success ? approvals.data.items : [])
      .map((item) => item.summary.trim().slice(0, 200))
      .filter((summary) => summary.length > 0)
      .slice(0, 5),
  };
  return parseQResultBlocks([block]).blocks[0] ?? null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The block the model asked for, from what the run read; null when none fits. */
function visualBlock(
  hint: string | null | undefined,
  read: RunRead,
): QResultBlock | null {
  if (hint === "MAP") {
    return (
      investorsMapBlock(investorsOf(read)) ??
      // Companies when the run read no investor with a published place.
      companiesMapBlock(read)
    );
  }
  if (hint === "TABLE") {
    return (
      investorsTableBlock(investorsOf(read)) ??
      // Companies when the run read fewer than two investors (either role).
      companiesTableBlock(read)
    );
  }
  if (hint === "TIMELINE" && read.relationships.size === 1) {
    const relationship = [...read.relationships.values()][0];
    if (relationship === undefined || relationship.relationship === null)
      return null;
    const counterpart = relationship.counterpart;
    const subject: QSubjectRef =
      counterpart.kind === "COMPANY"
        ? { kind: "COMPANY", companyId: counterpart.id }
        : {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: counterpart.id,
          };
    const seen = new Set<string>();
    return timelineBlock({
      title: `Relationship history${counterpart.name === null ? "" : ` with ${counterpart.name.slice(0, 120)}`}`,
      events: relationship.relationship.milestones
        .filter((event) => {
          const key = `${event.at}:${event.state}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((event) => ({
          at: event.at,
          label: event.state.toLowerCase().replaceAll("_", " "),
          note: relationship.source,
          subject,
        })),
    });
  }
  // CHART still requires a typed read of evidenced figures. No numbers
  // are extracted from model prose to fill a visual.
  return null;
}

// ---------------------------------------------------------------------------
// L-13 (owner ask 2026-10-20): a picture of something visual, credited.

export type QPictureBlock = Extract<QResultBlock, { readonly kind: "PICTURE" }>;

/**
 * Finds one picture for an answer. The model's words are a proposal: the
 * port composes what may leave Capital Q from the person's own words
 * (q-research egress allowlist) and refuses when nothing safe survives.
 * Null is "no picture": a refusal, a miss, a timeout, a failure.
 */
export type QPicturePort = {
  readonly find: (input: {
    readonly requestedQuery: string;
    readonly userText: string;
    readonly earlierUserText: readonly string[];
    /**
     * Names of the companies, investors, people and organisations this
     * run read. The picture library never receives one, even when the
     * person typed it: a picture search carries no identity.
     */
    readonly withheld?: readonly string[] | undefined;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QPictureBlock | null>;
};

/**
 * Pictures of the company or person a turn names, from public pages (owner
 * 2026-10-23), found by Capital Q's image search from the name the person
 * said. The port composes the search through the egress policy; the blocks
 * are built here, by code, and parsed by the contract before they leave.
 */
export type QPublicPicturePort = {
  readonly find: (input: {
    readonly name: string;
    /** For a person: the organisation a public lookup placed them at. */
    readonly organisation?: string | undefined;
    readonly userText: string;
    readonly earlierUserText: readonly string[];
    /** What Q said to them: a name in it they pointed at may be searched. */
    readonly shownText?: readonly string[] | undefined;
    readonly signal?: AbortSignal | undefined;
    /** The run asking: one image search a run (spend rule 2026-10-25). */
    readonly runId?: string | undefined;
  }) => Promise<
    readonly {
      readonly imageUrl: string;
      readonly pageUrl: string;
      readonly domain: string;
      readonly title: string;
    }[]
  >;
};

/** The pictures found, as PICTURE blocks credited to their pages. */
export function publicPictureBlocks(
  found: Awaited<ReturnType<QPublicPicturePort["find"]>>,
  retrievedAt: string,
): QPictureBlock[] {
  const blocks: QPictureBlock[] = [];
  for (const picture of found) {
    const parsed = parseQResultBlocks([
      {
        kind: "PICTURE",
        url: picture.imageUrl,
        alt: picture.title.slice(0, 200),
        credit: { name: picture.domain.slice(0, 120), url: picture.pageUrl },
        source: "PUBLIC_WEB",
        pageUrl: picture.pageUrl,
        retrievedAt,
      },
    ]).blocks[0];
    if (parsed?.kind === "PICTURE") blocks.push(parsed);
  }
  return blocks;
}

/** Every name a run read, for a picture search to withhold (L-13). */
export function namesReadByRun(read: {
  readonly companyNames: ReadonlyMap<string, string>;
  readonly profiles: ReadonlyMap<string, string>;
  readonly investors: ReadonlyMap<string, { readonly name: string }>;
  readonly externals: ReadonlyMap<string, { readonly name: string }>;
  readonly relationships: ReadonlyMap<
    string,
    { readonly counterpart: { readonly name: string | null } }
  >;
}): readonly string[] {
  const names = new Set<string>([
    ...read.companyNames.values(),
    ...read.profiles.values(),
    ...[...read.investors.values()].map((one) => one.name),
    ...[...read.externals.values()].map((one) => one.name),
    ...[...read.relationships.values()].map(
      (one) => one.counterpart.name ?? "",
    ),
  ]);
  return [...names].filter((name) => name.trim().length > 0).slice(0, 100);
}

/**
 * How long a picture may hold the finished answer. The answer's words have
 * already been said by then; a slow picture search is no picture rather
 * than a slower turn.
 */
export const PICTURE_WAIT_MS = 2_000;

/** The picture the model asked for, or null; never throws. */
export async function pictureBlock(input: {
  readonly result: Pick<AnalystResultLike, "visual" | "pictureQuery">;
  readonly pictures: QPicturePort | undefined;
  readonly userText: string;
  readonly earlierUserText: readonly string[];
  readonly withheld?: readonly string[] | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly waitMs?: number | undefined;
}): Promise<QPictureBlock | null> {
  const query = input.result.pictureQuery?.trim() ?? "";
  if (
    input.result.visual !== "PICTURE" ||
    query.length === 0 ||
    input.pictures === undefined
  ) {
    return null;
  }
  const timeout = AbortSignal.timeout(input.waitMs ?? PICTURE_WAIT_MS);
  const signal =
    input.signal === undefined
      ? timeout
      : AbortSignal.any([input.signal, timeout]);
  const aborted = new Promise<null>((resolve) => {
    if (signal.aborted) resolve(null);
    signal.addEventListener("abort", () => resolve(null), { once: true });
  });
  try {
    const found = await Promise.race([
      input.pictures.find({
        requestedQuery: query,
        userText: input.userText,
        earlierUserText: input.earlierUserText,
        withheld: input.withheld ?? [],
        signal,
      }),
      aborted,
    ]);
    if (found === null) return null;
    // Parsed, not trusted: a port that returns another host is refused.
    const parsed = parseQResultBlocks([found]).blocks[0];
    return parsed?.kind === "PICTURE" ? parsed : null;
  } catch {
    return null;
  }
}
