import { answerCardsBlock, type ModelAnswerCardsLike } from "./answer-cards.js";
import { randomUUID } from "node:crypto";

import { RunRead, type ReadInvestor } from "./card-subjects.js";
import {
  QFindingIdSchema,
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
  readonly visual?: string | undefined;
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

export function analystResultBlocks(input: {
  readonly result: AnalystResultLike;
  readonly subjects: readonly QSubjectRef[];
  /** E4: what this run's tools returned (investors, places); absent: none read. */
  readonly read?: RunRead | undefined;
  /** E3: blocks the contract refused, for the caller to log. */
  readonly onDropped?:
    ((dropped: readonly QResultBlockDrop[]) => void) | undefined;
  /** Overridable so a test can pin the ids it asserts on. */
  readonly findingId?: ((index: number) => string) | undefined;
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
    const statement = finding.statement.trim();
    if (statement.length === 0) continue;
    blocks.push({
      kind: "FINDING",
      finding: {
        findingId: QFindingIdSchema.parse(idFor(index)),
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
        subjects: [...input.subjects],
      },
    });
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

/** Events in time order, oldest first; undated events are not placed. */
export function timelineBlock(input: {
  readonly title: string;
  readonly events: readonly {
    readonly at: string;
    readonly label: string;
    readonly detail?: string | null | undefined;
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
      detail: event.detail?.slice(0, 240) ?? null,
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

/** The block the model asked for, from what the run read; null when none fits. */
function visualBlock(
  hint: string | undefined,
  read: RunRead,
): QResultBlock | null {
  if (hint === "MAP") return investorsMapBlock(investorsOf(read));
  if (hint === "TABLE") return investorsTableBlock(investorsOf(read));
  // TIMELINE and CHART need dated events or evidenced figures, which no
  // run read carries yet; nothing is drawn rather than something made up
  // (docs/recovery/specs/E-rich-ui-promises.md §3.3).
  return null;
}
