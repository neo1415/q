/**
 * How Q says where a fact comes from, the way an analyst would (owner,
 * HQ-2, 20 Nov 2026). Live: "Ledgerfold is at the seed stage. That is what
 * the company declares on Capital Q; it isn't verified." -- right in
 * substance, robotic in form. The invariant stays: a value the company
 * reported itself is never said as plain fact. Its provenance is carried
 * by the sentence ("Ledgerfold describes itself as being at the seed
 * stage"), not by a disclaimer bolted on after it.
 *
 * The evidence axes drive the words (ADR-001): the evidence status picks
 * the attribution, never the wording of a template. Verified values are
 * said plainly. The phrasing varies by a stable hash of the subject and the
 * field, so nothing is random and every test is deterministic.
 */

export type AttributedField = "STAGE" | "HEADQUARTERS" | "FOUNDED" | "WHAT";

/** The evidence statuses of ADR-001, as the words treat them. */
export type AttributionEvidence =
  | "NO_EVIDENCE"
  | "SELF_REPORTED"
  | "DOCUMENT_SUPPORTED"
  | "MULTI_SOURCE_SUPPORTED"
  | "EXTERNALLY_VERIFIED"
  | "PLATFORM_VERIFIED";

/** How the words carry the evidence: the subject's own word, a document, or plain. */
export type AttributionKind = "CLAIMED" | "DOCUMENTED" | "PLAIN";

export function attributionKindOf(
  evidence: AttributionEvidence,
): AttributionKind | null {
  switch (evidence) {
    case "NO_EVIDENCE":
      return null;
    case "SELF_REPORTED":
      return "CLAIMED";
    case "DOCUMENT_SUPPORTED":
    case "MULTI_SOURCE_SUPPORTED":
      return "DOCUMENTED";
    case "EXTERNALLY_VERIFIED":
    case "PLATFORM_VERIFIED":
      return "PLAIN";
  }
}

type Phrase = (name: string, value: string) => string;

const CLAIMED: Readonly<Record<AttributedField, readonly Phrase[]>> = {
  STAGE: [
    (n, v) => `${n} describes itself as being at the ${v} stage.`,
    (n, v) => `According to its own profile, ${n} is at the ${v} stage.`,
    (n, v) => `${n} lists its stage as ${v}.`,
  ],
  HEADQUARTERS: [
    (n, v) => `${n} lists ${v} as its base.`,
    (n, v) => `According to its own profile, ${n} is based in ${v}.`,
    (n, v) => `${n} says it's based in ${v}.`,
  ],
  FOUNDED: [
    (n, v) => `${n} says it was founded in ${v}.`,
    (n, v) => `According to its own profile, ${n} was founded in ${v}.`,
    (n, v) => `${n} gives ${v} as the year it was founded.`,
  ],
  WHAT: [
    (_, v) => `In its own words: ${v}`,
    (n, v) => `Here's how ${n} describes itself: ${v}`,
    (n, v) => `${n} describes what it does like this: ${v}`,
  ],
};

const DOCUMENTED: Readonly<Record<AttributedField, Phrase>> = {
  STAGE: (n, v) => `${n}'s documents show it at the ${v} stage.`,
  HEADQUARTERS: (n, v) => `${n}'s documents put it in ${v}.`,
  FOUNDED: (n, v) => `${n}'s documents show it was founded in ${v}.`,
  WHAT: (n, v) => `From ${n}'s documents: ${v}`,
};

const PLAIN: Readonly<Record<AttributedField, Phrase>> = {
  STAGE: (n, v) => `${n} is at the ${v} stage.`,
  HEADQUARTERS: (n, v) => `${n} is based in ${v}.`,
  FOUNDED: (n, v) => `${n} was founded in ${v}.`,
  WHAT: (_, v) => v,
};

const UNKNOWN: Readonly<Record<AttributedField, (name: string) => string>> = {
  STAGE: (n) => `${n} hasn't said what stage it's at yet.`,
  HEADQUARTERS: (n) => `${n} hasn't said where it's based yet.`,
  FOUNDED: (n) => `${n} hasn't said when it was founded yet.`,
  WHAT: (n) => `${n} hasn't described what it does yet.`,
};

/** A stable choice among `count` phrasings: FNV-1a over the seed. */
export function stableChoice(seed: string, count: number): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < seed.length; at += 1) {
    hash ^= seed.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return count <= 1 ? 0 : hash % count;
}

/**
 * One fact as Q says it. `value` null is unknown, said as unknown, never
 * guessed; NO_EVIDENCE is unknown too. `seed` (the subject's id) keeps the
 * wording stable for the same subject and field.
 */
export function attributedFact(input: {
  readonly name: string;
  readonly field: AttributedField;
  readonly value: string | null;
  readonly evidence: AttributionEvidence;
  readonly seed: string;
}): string {
  const kind = attributionKindOf(input.evidence);
  if (input.value === null || kind === null) {
    return UNKNOWN[input.field](input.name);
  }
  if (kind === "PLAIN") return PLAIN[input.field](input.name, input.value);
  if (kind === "DOCUMENTED") {
    return DOCUMENTED[input.field](input.name, input.value);
  }
  const phrases = CLAIMED[input.field];
  const phrase =
    phrases[stableChoice(`${input.seed}|${input.field}`, phrases.length)] ??
    phrases[0];
  return phrase === undefined ? "" : phrase(input.name, input.value);
}

/** The lead of a list of claimed values: "Here's where each says it's based:". */
export function attributedListLead(
  field: Exclude<AttributedField, "WHAT">,
  evidence: AttributionEvidence,
): string {
  const kind = attributionKindOf(evidence);
  const lead: Readonly<Record<Exclude<AttributedField, "WHAT">, string>> =
    kind === "PLAIN"
      ? {
          STAGE: "Here's each one's stage:",
          HEADQUARTERS: "Here's where they're based:",
          FOUNDED: "Here's when each was founded:",
        }
      : kind === "DOCUMENTED"
        ? {
            STAGE: "Here's each one's stage, from their documents:",
            HEADQUARTERS: "Here's where each one's documents put it:",
            FOUNDED: "Here's when each was founded, from their documents:",
          }
        : {
            STAGE: "Here's the stage each gives for itself:",
            HEADQUARTERS: "Here's where each says it's based:",
            FOUNDED: "Here's when each says it was founded:",
          };
  return lead[field];
}
