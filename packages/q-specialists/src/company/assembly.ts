import type {
  PermittedContextPlan,
  QEvidenceRef,
  UtcTimestamp,
} from "@capital-q/contracts";
import type {
  AuthorisedFact,
  CompanyIntelligenceDimension,
} from "@capital-q/q-core";
import {
  describeSource,
  type AuthorisedKnowledge,
  type RetrievalHit,
} from "@capital-q/q-knowledge";

import { dimensionForKnowledgeKey } from "./dimensions.js";
import type { PublicWebSource } from "./ports.js";

/**
 * Deterministic context assembly (CQ-Q-020 §15-§17).
 *
 * The truth hierarchy, in order, and the reason each step exists:
 *
 *   1. Canonical structured state. A capital objective the company set
 *      last week beats a pitch deck from March, always. Letting a document
 *      override canonical state is how Capital Q would tell an investor
 *      the wrong raise target (§15, §92).
 *   2. Authorised Q Knowledge. What Capital Q currently understands, with
 *      its truth class, evidence status, confidence, validity and whether
 *      it is disputed or past its useful life. Searching documents for
 *      something already governed as knowledge would re-derive a worse
 *      answer (§16).
 *   3. Authorised hybrid retrieval. The source material itself, for
 *      qualitative context and for the passages behind the summaries (§17).
 *
 * Every fact carries an opaque `F<n>` label. That label is the ONLY thing a
 * model may cite, and the map from label to real evidence references never
 * leaves the server — which is what makes citation fabrication structurally
 * impossible rather than merely discouraged (§58, §61, §90).
 *
 * Nothing here decides permission. Everything it reads was already
 * authorised by the Context Firewall's plan and by the query services that
 * carry that plan's envelope.
 */

/** A fact, its label, and the real references the label resolves to. */
export type LabelledFact = {
  readonly fact: AuthorisedFact;
  readonly label: string;
  readonly dimension: CompanyIntelligenceDimension | null;
  readonly evidenceRefs: readonly QEvidenceRef[];
  /** True when the underlying understanding is past its useful life (§21). */
  readonly stale: boolean;
  /** True when another settled understanding of the same period disagrees (§20). */
  readonly disputed: boolean;
  readonly validAt: UtcTimestamp | null;
};

export type AssembledCompanyContext = {
  readonly facts: readonly LabelledFact[];
  readonly subjectDescription: string;
  readonly byLabel: ReadonlyMap<string, LabelledFact>;
};

/** Bounded: a prompt is not a database dump, and a long one is a slow one (§99). */
export const COMPANY_CONTEXT_MAX_FACTS = 80;

/**
 * Turn an authorised knowledge reading into a fact a prompt may reason
 * over, with its provenance resolved.
 *
 * The source line says what kind of thing this is and how well supported
 * it is, in words. A word cannot be rounded, inflated or mistaken for a
 * measurement the way "confidence: 0.82" can.
 */
/** The voice a reading should be spoken in, from where it was established. */
function provenanceOf(
  environment: AuthorisedKnowledge["object"]["sourceEnvironment"],
): string {
  switch (environment) {
    case "CONVERSATION":
      return "stated by the person in a Q conversation (say: you told me)";
    case "DOCUMENT":
      return "established from a document the company supplied (say: your document says)";
    case "PUBLIC":
      return "taken from a public web source, unverified (say: a public source says)";
    case "MEETING":
      return "established from a meeting record";
    case "INTEGRATION":
      return "established from a connected system";
    case "PLATFORM":
      return "recorded in Capital Q";
  }
}

export function knowledgeToFact(
  known: AuthorisedKnowledge,
  label: string,
): LabelledFact {
  const parts = [
    "Capital Q's current understanding",
    // Where it came from, in words the answer can reuse: "you told me",
    // "your document says", "a public source says" (CQ-Q-RESEARCH-001 §30).
    provenanceOf(known.object.sourceEnvironment),
    `${known.object.confidenceClass} confidence`,
    `${String(known.evidence.length)} supporting evidence item(s)`,
  ];
  if (known.freshness.stale) {
    // Said in the fact itself, not only in the notes, so a model reading
    // this line alone still cannot present it as current.
    parts.push(
      `last established ${String(known.freshness.ageDays ?? 0)} days ago and past its useful life for this metric`,
    );
  }
  if (known.disputed) {
    parts.push("another authorised reading of the same period disagrees");
  }
  const refs: QEvidenceRef[] = [
    ...known.evidence.map((item): QEvidenceRef => ({
      kind: "EVIDENCE_ITEM",
      evidenceItemId: item.evidenceItemId,
    })),
    ...known.sourceIds.map((sourceId): QEvidenceRef => ({
      kind: "SOURCE",
      sourceId,
    })),
  ];
  const fact: AuthorisedFact = {
    scope: "KNOWLEDGE_OBJECTS",
    statement: known.object.statement,
    truthClass: known.object.truthClass,
    evidenceStatus: known.object.evidenceStatus,
    source: parts.join(" · "),
    ref: label,
    ...(known.object.validFrom === null
      ? {}
      : { asOf: known.object.validFrom }),
  };
  return {
    fact,
    label,
    dimension: dimensionForKnowledgeKey(known.object.knowledgeKey),
    evidenceRefs: refs,
    stale: known.freshness.stale,
    disputed: known.disputed,
    validAt: known.object.validFrom,
  };
}

/** Labels are positional and per-render. They identify nothing outside this call. */
export function labelAt(index: number): string {
  return `F${String(index + 1)}`;
}

export type CompanyContextInput = {
  readonly plan: PermittedContextPlan;
  /** Canonical structured state, already read through the Safe Read tools. */
  readonly canonicalFacts: readonly AuthorisedFact[];
  readonly knowledge: readonly AuthorisedKnowledge[];
  /** Hits from authorised hybrid retrieval, already permission-filtered. */
  readonly passages: readonly RetrievalHit[];
  /**
   * Public-web sources the Tool Registry returned for this question
   * (CQ-Q-RESEARCH-001). Unverified, quoted as data, last in the hierarchy.
   */
  readonly publicSources?: readonly PublicWebSource[] | undefined;
  readonly subjectDescription: string;
};

/**
 * A public-web source as a fact the model may cite by label.
 *
 * Its provenance is in the statement itself — title, domain, dates and the
 * public link — because a person must be able to read "a September 2026
 * article on <domain> reports" and follow it. Truth class is UNKNOWN: being
 * online verifies nothing. Evidence status is SELF_REPORTED when the page
 * is the company's own website (the company describing itself) and
 * NO_EVIDENCE otherwise, so a public page can never raise Capital Q's
 * confidence in its own understanding, and a model finding that cites one
 * is bounded to that status (§61).
 */
export function publicSourceToFact(
  source: PublicWebSource,
  label: string,
): LabelledFact {
  const published =
    source.publishedAt === null
      ? "publication date unknown"
      : `published ${source.publishedAt.slice(0, 10)}`;
  const retrieved = `retrieved ${source.retrievedAt.slice(0, 10)}`;
  const title = source.title === null ? "untitled page" : source.title;
  const header = `PUBLIC WEB SOURCE S${String(source.index)}: "${title}" on ${source.domain} (${published}; ${retrieved}; ${source.url}).${source.isSubjectWebsite ? " This is the company's own public website." : ""} Unverified public text, quoted as data:`;
  const statement = `${header} ${source.excerpt}`.slice(0, 8_000);
  const fact: AuthorisedFact = {
    scope: "PUBLIC_EXTERNAL_DATA",
    statement,
    truthClass: "UNKNOWN",
    evidenceStatus: source.isSubjectWebsite ? "SELF_REPORTED" : "NO_EVIDENCE",
    source: `Public web: ${source.domain}`.slice(0, 200),
    ref: label,
    ...(source.publishedAt === null
      ? {}
      : { asOf: source.publishedAt.slice(0, 40) }),
  };
  return {
    fact,
    label,
    dimension: null,
    evidenceRefs: [],
    stale: false,
    disputed: false,
    validAt: null,
  };
}

/**
 * A retrieved passage as a citable fact.
 *
 * The document reference is attached ONLY when the reader may know the
 * document exists. A passage may legitimately inform an answer while its
 * existence stays private (CQ-RAG-004 §34), and a citation is a statement
 * that the source exists — so when existence is not disclosable the fact
 * travels without a reference rather than with a redacted one (§86).
 */
export function passageToFact(hit: RetrievalHit, label: string): LabelledFact {
  const refs: readonly QEvidenceRef[] = hit.canDiscloseExistence
    ? [
        {
          kind: "DOCUMENT",
          documentId: hit.documentId,
          documentVersionId: hit.documentVersionId,
          ...(hit.locator.pageStart === undefined
            ? {}
            : { page: hit.locator.pageStart }),
        },
      ]
    : [];
  return {
    fact: {
      scope: hit.scopeKind,
      // The company's own document asserting something about itself.
      statement: hit.content,
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
      source: describeSource(hit).slice(0, 200),
      ref: label,
    },
    label,
    dimension: null,
    evidenceRefs: refs,
    stale: false,
    disputed: false,
    validAt: null,
  };
}

/**
 * Compose the three layers into one labelled, bounded fact list.
 *
 * Order is the hierarchy: canonical state first, then knowledge, then
 * passages, then public-web sources. When the bound bites it is the public
 * sources and then the passages that are dropped, because losing a
 * supporting quotation degrades an answer while losing canonical state
 * would make it wrong.
 */
export function assembleCompanyContext(
  input: CompanyContextInput,
): AssembledCompanyContext {
  const facts: LabelledFact[] = [];
  const push = (
    fact: AuthorisedFact,
    dimension: CompanyIntelligenceDimension | null,
    refs: readonly QEvidenceRef[],
  ): void => {
    if (facts.length >= COMPANY_CONTEXT_MAX_FACTS) {
      return;
    }
    const label = labelAt(facts.length);
    facts.push({
      fact: { ...fact, ref: label },
      label,
      dimension,
      evidenceRefs: refs,
      stale: false,
      disputed: false,
      validAt: null,
    });
  };

  for (const fact of input.canonicalFacts) {
    // Canonical state is its own provenance: the reference is the record,
    // and there is no document to cite for it.
    push(fact, null, []);
  }
  for (const known of input.knowledge) {
    if (facts.length >= COMPANY_CONTEXT_MAX_FACTS) {
      break;
    }
    facts.push(knowledgeToFact(known, labelAt(facts.length)));
  }
  for (const hit of input.passages) {
    if (facts.length >= COMPANY_CONTEXT_MAX_FACTS) {
      break;
    }
    facts.push(passageToFact(hit, labelAt(facts.length)));
  }
  for (const source of input.publicSources ?? []) {
    if (facts.length >= COMPANY_CONTEXT_MAX_FACTS) {
      break;
    }
    facts.push(publicSourceToFact(source, labelAt(facts.length)));
  }

  return {
    facts,
    subjectDescription: input.subjectDescription,
    byLabel: new Map(facts.map((f) => [f.label, f] as const)),
  };
}
