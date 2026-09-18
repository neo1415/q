import { createHash } from "node:crypto";

import {
  COMPANY_REPRESENTATION_VERSION,
  INVESTOR_REPRESENTATION_VERSION,
  REPRESENTATION_PURPOSE,
} from "./contracts.js";

/**
 * Deterministic representations (doc 19 §25–§26).
 *
 * A representation is a labelled textual projection of canonical,
 * purpose-approved fields. No model rewrites it, no source is summarised,
 * nothing is inferred: the same canonical snapshot under the same
 * representation version is the same text and the same hash, every time,
 * on every machine. That is what makes staleness a hash comparison and an
 * embedding a cache rather than a guess.
 *
 * What can appear here is decided by the input types below, and those are
 * filled only by ports that read the investor-visible layer. There is no
 * field for a memory, a conversation, a document, an evidence passage, a
 * research finding or a Q summary, so none can be embedded.
 */

/** A canonical classification a company carries, named for the reader. */
export type RepresentationClassification = {
  readonly vocabularyCode: string;
  readonly canonicalCode: string;
  readonly displayName: string;
};

export type CompanyRepresentationInput = {
  readonly companyId: string;
  /** The canonical row version: part of the source fingerprint. */
  readonly sourceVersion: number;
  readonly canonicalName: string;
  /** The network-visible short description; the only free text. */
  readonly shortDescription: string | null;
  readonly currentStageCode: string | null;
  readonly headquartersCountry: string | null;
  /** ACTIVE canonical classifications; order does not matter. */
  readonly classifications: readonly RepresentationClassification[];
};

export type InvestorRepresentationInput = {
  readonly mandateId: string;
  readonly mandateVersion: number;
  readonly name: string;
  /** The investor's declared narrative. Investor-private; never emitted. */
  readonly rawMandateText: string | null;
  /** Positive structured intent, as REC-002 derives it. Exclusions never enter. */
  readonly stageCodes: readonly string[];
  readonly countryCodes: readonly string[];
  /** Positive taxonomy preferences (MUST / STRONG / NICE) only. */
  readonly preferences: readonly RepresentationClassification[];
};

export type BuiltRepresentation = {
  readonly purpose: typeof REPRESENTATION_PURPOSE;
  readonly representationVersion: string;
  readonly text: string;
  /** sha256 of `text`: the start of the embedding work identity. */
  readonly contentSha256: string;
  /** sha256 of the canonical inputs: detects staleness without the text. */
  readonly sourceFingerprint: string;
};

/** The embedding runtime's input ceiling; a representation stays under it. */
export const REPRESENTATION_MAX_CHARACTERS = 4_000;

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Collapse whitespace and trim: presentation noise is not content. */
function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** `series_c_plus` → `series c plus`: a code, made readable, still exact. */
function readableCode(code: string): string {
  return code.replace(/_/g, " ");
}

/** Vocabulary code → the label its line carries; unknown vocabularies keep their code. */
const VOCABULARY_LABELS: Readonly<Record<string, string>> = {
  industry: "Sector",
  geography: "Markets",
  technology: "Technology",
  business_model: "Business model",
  customer_segment: "Customers",
};

function vocabularyLabel(vocabularyCode: string): string {
  return (
    VOCABULARY_LABELS[vocabularyCode] ??
    readableCode(vocabularyCode).replace(/^./, (c) => c.toUpperCase())
  );
}

/** One line per vocabulary, vocabularies and names in canonical order. */
function classificationLines(
  classifications: readonly RepresentationClassification[],
): readonly string[] {
  const byVocabulary = new Map<string, Map<string, string>>();
  for (const c of classifications) {
    const names =
      byVocabulary.get(c.vocabularyCode) ?? new Map<string, string>();
    names.set(c.canonicalCode, clean(c.displayName));
    byVocabulary.set(c.vocabularyCode, names);
  }
  return [...byVocabulary.keys()].sort().map((vocabulary) => {
    const names = byVocabulary.get(vocabulary) ?? new Map<string, string>();
    const ordered = [...names.keys()]
      .sort()
      .map((code) => names.get(code) ?? code);
    return `${vocabularyLabel(vocabulary)}: ${ordered.join(", ")}`;
  });
}

function bounded(text: string): string {
  return text.length <= REPRESENTATION_MAX_CHARACTERS
    ? text
    : text.slice(0, REPRESENTATION_MAX_CHARACTERS);
}

/**
 * The company investment representation (doc 19 §25), version 1.
 *
 * Lines, in a fixed order, each present only when the canonical field is
 * known — unknown stays unknown and is not rendered as a value:
 *
 *   Company: <canonical name>
 *   Stage: <canonical stage>
 *   Headquarters: <ISO country>
 *   <vocabulary>: <canonical classifications>   (one line per vocabulary)
 *   Summary: <network-visible short description>
 *
 * Deliberately absent, because no canonical, discovery-safe field exists
 * for them in V1: business model, customer type, raise and traction (doc
 * 19 §25 lists them as candidates, not as requirements; inventing them
 * from private material is exactly what this generator must not do).
 */
export function buildCompanyInvestmentRepresentation(
  input: CompanyRepresentationInput,
): BuiltRepresentation {
  const lines: string[] = [`Company: ${clean(input.canonicalName)}`];
  if (input.currentStageCode !== null) {
    lines.push(`Stage: ${readableCode(input.currentStageCode)}`);
  }
  if (input.headquartersCountry !== null) {
    lines.push(`Headquarters: ${input.headquartersCountry.toUpperCase()}`);
  }
  lines.push(...classificationLines(input.classifications));
  if (input.shortDescription !== null && clean(input.shortDescription) !== "") {
    lines.push(`Summary: ${clean(input.shortDescription)}`);
  }
  const text = bounded(lines.join("\n"));
  const fingerprint = sha256(
    JSON.stringify([
      COMPANY_REPRESENTATION_VERSION,
      input.companyId,
      input.sourceVersion,
      input.classifications
        .map((c) => `${c.vocabularyCode}:${c.canonicalCode}`)
        .sort(),
    ]),
  );
  return {
    purpose: REPRESENTATION_PURPOSE,
    representationVersion: COMPANY_REPRESENTATION_VERSION,
    text,
    contentSha256: sha256(text),
    sourceFingerprint: fingerprint,
  };
}

/**
 * The investor semantic representation (doc 19 §26), version 1: the
 * declared mandate, as the investor stated and structured it.
 *
 *   Mandate: <name>
 *   Thesis: <raw mandate text>
 *   Stages: <positive stage codes>
 *   Countries: <positive ISO countries>
 *   <vocabulary>: <positive preference nodes>
 *
 * Hard exclusions and AVOID preferences never appear: retrieval is not
 * where a "never" is enforced (REC-001 is), and a soft avoidance is not a
 * retrieval signal. Investor-private by construction of its storage.
 */
export function buildInvestorMandateRepresentation(
  input: InvestorRepresentationInput,
): BuiltRepresentation {
  const lines: string[] = [`Mandate: ${clean(input.name)}`];
  if (input.rawMandateText !== null && clean(input.rawMandateText) !== "") {
    lines.push(`Thesis: ${clean(input.rawMandateText)}`);
  }
  if (input.stageCodes.length > 0) {
    lines.push(
      `Stages: ${[...input.stageCodes].sort().map(readableCode).join(", ")}`,
    );
  }
  if (input.countryCodes.length > 0) {
    lines.push(
      `Countries: ${[...input.countryCodes]
        .map((c) => c.toUpperCase())
        .sort()
        .join(", ")}`,
    );
  }
  lines.push(...classificationLines(input.preferences));
  const text = bounded(lines.join("\n"));
  const fingerprint = sha256(
    JSON.stringify([
      INVESTOR_REPRESENTATION_VERSION,
      input.mandateId,
      input.mandateVersion,
    ]),
  );
  return {
    purpose: REPRESENTATION_PURPOSE,
    representationVersion: INVESTOR_REPRESENTATION_VERSION,
    text,
    contentSha256: sha256(text),
    sourceFingerprint: fingerprint,
  };
}
