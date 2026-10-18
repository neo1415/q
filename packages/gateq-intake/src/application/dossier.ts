import {
  GATEQ_DOSSIER_SCHEMA_VERSION,
  GateqDossierV1Schema,
  type ApplicationContactDto,
  type GateqCoverageV1,
  type GateqDossierV1,
} from "@capital-q/contracts";
import type { QualificationResult } from "@capital-q/gateq";

import type {
  ApplicationDimension,
  ApplicationFact,
  FactProvenance,
} from "../contracts/index.js";
import { profileOf } from "../inbox/domain.js";
import {
  DIMENSION_LABELS,
  factSummary,
  INVESTMENT_DIMENSIONS,
} from "./coverage.js";
import { amountOfSummary, amountStatedIn } from "./stated-amount.js";

/**
 * The investor-ready GateQ dossier, built in the submission transaction
 * (GateQ slice 1, directive §7).
 *
 * Deterministic from end to end: the frozen facts with their provenance,
 * the engine's criterion statuses by published label, the coverage check,
 * the shared documents' titles and the transcript's length. No model is
 * involved, so nothing in it is anybody's opinion. Q's own reading arrives
 * later in `synthesis`, labelled nonbinding; v1 always writes null.
 *
 * Diligence questions are templates per dimension, chosen by what is
 * missing, unknown, declined or contradictory. They are suggestions for a
 * person to ask, never a finding.
 */

/** One fixed question per dimension. No model writes these. */
const DILIGENCE_TEMPLATES: Readonly<Record<ApplicationDimension, string>> = {
  "contact.name": "Who is the right person to speak to about this round?",
  "contact.email": "What is the best email address for follow-up?",
  "contact.role": "What is the contact's role in the company?",
  "company.name": "What is the company's registered name?",
  "company.description": "In one or two sentences, what does the company do?",
  "company.website": "Where can we see the product or company online?",
  "company.country":
    "Where is the company incorporated and where does the team operate?",
  "company.stage": "What stage is the company at today, and on what basis?",
  "company.problem":
    "What problem does the company solve, and for whom is it most acute?",
  "company.solution":
    "How does the product solve that problem, and what does it replace?",
  "company.market":
    "How large is the addressable market, and how was that estimated?",
  "company.customers":
    "Who are the paying customers today, and how were they acquired?",
  "company.team":
    "Who are the founders and key hires, and what is their relevant experience?",
  "company.business_model":
    "How does the company make money, and what are the unit economics?",
  "company.sector_phrases":
    "Which sector and sub-sector best describe the company?",
  "claims.revenue":
    "What is current revenue (period, recognition basis), and can it be supported with management accounts?",
  "claims.traction":
    "What traction metrics best show progress, and over what period?",
  "raise.amount": "How much is the company raising in this round?",
  "raise.currency": "In which currency is the round denominated?",
  "raise.instrument": "What instrument and terms are proposed for the round?",
  "raise.use_of_funds":
    "How will the funds be used, and what milestones will they reach?",
  "raise.lead_status":
    "Is there a lead investor, and what is committed so far?",
  "application.note": "Is there anything else the investor should know?",
};

const truthClassOf = (
  provenance: FactProvenance,
): GateqDossierV1["dimensions"][number]["facts"][number]["truthClass"] =>
  provenance === "ESTIMATED"
    ? "ESTIMATE"
    : provenance === "UNKNOWN"
      ? "UNKNOWN"
      : // An applicant's words, even when a document says the same: a
        // document supports a claim, it does not make it verified.
        "USER_CLAIM";

const evidenceStatusOf = (
  provenance: FactProvenance,
): GateqDossierV1["dimensions"][number]["facts"][number]["evidenceStatus"] =>
  provenance === "DOCUMENT_SUPPORTED"
    ? "DOCUMENT_SUPPORTED"
    : provenance === "UNKNOWN"
      ? "NO_EVIDENCE"
      : "SELF_REPORTED";

export function buildDossier(input: {
  readonly reference: string;
  readonly declaredName: string | null;
  readonly submittedAt: string;
  readonly generatedAt: string;
  readonly facts: readonly ApplicationFact[];
  readonly qualification: QualificationResult;
  readonly coverage: GateqCoverageV1;
  readonly contact: ApplicationContactDto | null;
  readonly documents: readonly {
    readonly documentId: string;
    readonly title: string;
  }[];
  readonly turnCount: number;
}): GateqDossierV1 {
  const current = input.facts.filter((fact) => fact.supersededAt === null);
  const profile = profileOf({
    declaredName: input.declaredName,
    reference: input.reference,
    facts: current.map((fact) => ({
      dimension: fact.dimension,
      value: fact.value,
      provenance: fact.provenance,
    })),
    documentIds: input.documents.map((d) => d.documentId),
  });
  const byDimension = new Map(current.map((f) => [f.dimension, f] as const));
  const sectors = byDimension.get("company.sector_phrases");
  const name = byDimension.get("company.name");

  const dimensions = INVESTMENT_DIMENSIONS.map((entry) => ({
    group: entry.group,
    label: entry.label,
    facts: entry.dimensions.flatMap((dimension) => {
      const fact = byDimension.get(dimension);
      // Unknown and declined are reported as such below, never as values.
      if (fact === undefined || fact.value.kind === "NONE") return [];
      return [
        {
          dimension,
          label: DIMENSION_LABELS[dimension],
          summary: factSummary(dimension, fact.value).slice(0, 2000),
          provenance: fact.provenance,
          // Lineage: the recorded fact itself, and the turn it was heard
          // in when it came from the interview.
          sourceFactId: fact.id,
          sourceTurnSeq: fact.sourceTurnSeq ?? null,
          truthClass: truthClassOf(fact.provenance),
          evidenceStatus: evidenceStatusOf(fact.provenance),
        },
      ];
    }),
  }));

  const diligenceQuestions: GateqDossierV1["diligenceQuestions"][number][] = [];
  for (const contradiction of input.coverage.contradictions) {
    diligenceQuestions.push({
      dimension: null,
      basis: "CONTRADICTION",
      question: `Please reconcile: ${contradiction}.`.slice(0, 400),
    });
  }
  const ask = (
    basis: "MISSING" | "UNKNOWN" | "DECLINED",
    gaps: readonly { readonly dimension: string }[],
  ) => {
    for (const gap of gaps) {
      const template = DILIGENCE_TEMPLATES[
        gap.dimension as ApplicationDimension
      ] as string | undefined;
      if (template === undefined) continue;
      diligenceQuestions.push({
        dimension: gap.dimension,
        basis,
        question: template,
      });
    }
  };
  ask("UNKNOWN", input.coverage.unknown);
  ask("DECLINED", input.coverage.declined);
  ask("MISSING", input.coverage.missing);

  return GateqDossierV1Schema.parse({
    schemaVersion: GATEQ_DOSSIER_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    application: {
      reference: input.reference,
      submittedAt: input.submittedAt,
    },
    company: {
      name:
        input.declaredName ??
        (name?.value.kind === "TEXT" ? name.value.text : null),
      description: profile.oneLiner,
      website: profile.website,
      country: profile.country,
      stage: profile.stage,
      sectorPhrases:
        sectors?.value.kind === "PHRASES" ? [...sectors.value.phrases] : [],
      note: profile.note,
    },
    contact: input.contact,
    qualification: {
      outcome: input.qualification.outcome,
      access: input.qualification.access,
      // Labels and status only: the investor already holds the rules, and
      // nothing here repeats a configuration or an observed private value.
      criteria: input.qualification.criteria.map((criterion) => ({
        label: criterion.label,
        requiredness: criterion.requiredness,
        status: criterion.status,
      })),
    },
    dimensions,
    unknowns: input.coverage.unknown,
    declined: input.coverage.declined,
    missing: input.coverage.missing,
    contradictions: input.coverage.contradictions,
    documents: input.documents.slice(0, 20),
    diligenceQuestions: diligenceQuestions.slice(0, 80),
    transcript: { turnCount: input.turnCount },
    synthesis: null,
  });
}

/**
 * A heard amount the person never said is Q's inference, not their claim
 * (lead decision 2026-10-15). Applied when the dossier is built and again
 * when a frozen one is read, so a submission made before the write-side
 * check is shown truthfully without rewriting what was received. Only an
 * amount from an interview turn whose words are on hand is judged; a fact
 * from the form, or a turn that was not kept, is left as recorded.
 */
export function withDerivedAmountsMarked<
  D extends Pick<GateqDossierV1, "dimensions">,
>(
  dossier: D,
  turns: readonly {
    readonly seq: number;
    readonly role: string;
    readonly text: string;
  }[],
): D {
  const said = new Map(
    turns
      .filter((turn) => turn.role === "PERSON")
      .map((turn) => [turn.seq, turn.text] as const),
  );
  return {
    ...dossier,
    dimensions: dossier.dimensions.map((group) => ({
      ...group,
      facts: group.facts.map((fact) => {
        if (fact.sourceTurnSeq === null || fact.truthClass === "Q_INFERENCE")
          return fact;
        const value = amountOfSummary(fact.summary);
        const words = said.get(fact.sourceTurnSeq);
        if (value === null || words === undefined) return fact;
        if (amountStatedIn(value.amount, words)) return fact;
        const quote = words.length > 400 ? `${words.slice(0, 399)}…` : words;
        return {
          ...fact,
          truthClass: "Q_INFERENCE" as const,
          derivation:
            `Not said in these words: Q derived it from interview turn ${String(fact.sourceTurnSeq)}, where the founder said “${quote}”`.slice(
              0,
              600,
            ),
        };
      }),
    })),
  };
}
