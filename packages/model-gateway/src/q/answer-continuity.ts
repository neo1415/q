import type {
  AccountDigestRelationship,
  QAccountDigest,
  RelationshipStateV2,
} from "@capital-q/contracts";

/**
 * RC4 (voice audit 15 Nov 2026): continuity facts held by code at the one
 * place an answer is stored.
 *
 *   - A place the person pointed at ("the first company") that code bound
 *     to one of Q's own lists is said with the answer, naming the record
 *     and the list it was counted in, so a wrong guess is visible at once.
 *   - A relationship stage the answer states about a named counterpart is
 *     held to the canonical projection (the account digest, read for this
 *     person by code from the deterministic relationship projector): "Nixo
 *     is not connected" while the relationship is INVESTED (investor audit
 *     t-55d45f25-11-09_14-53-008) cannot be stored. The sentence that
 *     contradicts the projection is replaced by the stage as recorded.
 *
 * No model is called; nothing is read beyond the digest already in hand.
 */

export type ReferenceLeadInput = {
  readonly line: string;
  readonly name: string;
  readonly always: boolean;
};

function plain(text: string): string {
  return text
    .replace(/\s*\([^)]*\)\s*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The answer opens by saying which record and list a place meant. */
export function withReferenceLead(
  content: string,
  lead: ReferenceLeadInput | undefined,
): string {
  if (lead === undefined) return content;
  if (content.includes(lead.line)) return content;
  const named = content.toLowerCase().includes(plain(lead.name).toLowerCase());
  if (named && !lead.always) return content;
  return content.trim().length === 0 ? lead.line : `${lead.line}\n\n${content}`;
}

/** What an answer can claim about where a relationship stands. */
type StageClaim =
  | "NOT_CONNECTED"
  | "NOT_IN_PIPELINE"
  | "AWAITING_ACCEPTANCE"
  | "IN_DILIGENCE"
  | "INVESTED";

const CLAIMS: readonly [StageClaim, RegExp][] = [
  [
    "NOT_CONNECTED",
    /\b(?:not|n't|never)\s+(?:yet\s+|been\s+|even\s+)*(?:connected|in\s+touch)\b|\bno\s+(?:relationship|connection)\s+(?:yet\s+)?(?:with|to)\b|\bhaven'?t\s+(?:yet\s+)?connected\b/iu,
  ],
  // Live recheck 651a3bd50 T4: "Yes, but only as a diligence item, not yet
  // as a pipeline relationship" about a relationship IN_DILIGENCE.
  [
    "NOT_IN_PIPELINE",
    /(?:\bnot|n't|\bnever)\s+(?:yet\s+|currently\s+|actually\s+|really\s+|formally\s+|even\s+)*(?:(?:in|on|part\s+of)\s+(?:your|the)\s+(?:active\s+|current\s+)?pipeline|(?:as\s+)?an?\s+(?:active\s+|formal\s+|real\s+)?pipeline\s+(?:relationship|company|deal|entry|item|opportunity))\b|\bno\s+pipeline\s+relationship\b|\boutside\s+(?:of\s+)?your\s+pipeline\b/iu,
  ],
  [
    "AWAITING_ACCEPTANCE",
    /\b(?:has\s*n[o']t|have\s*n[o']t|not\s+yet|yet\s+to)\s+(?:been\s+)?accept(?:ed)?\b|\bwaiting\s+for\s+(?:them\s+to\s+accept|(?:their\s+)?acceptance)\b|\bawaiting\s+(?:their\s+)?acceptance\b/iu,
  ],
  ["IN_DILIGENCE", /\b(?:in|into)\s+(?:due\s+)?diligence\b/iu],
  [
    "INVESTED",
    /\b(?:you(?:'ve|\s+have)?\s+invested\s+in|an?\s+invested\s+relationship)\b/iu,
  ],
];

/** Stages a claim cannot be true of. */
const CONTRADICTS: Readonly<
  Record<StageClaim, ReadonlySet<RelationshipStateV2>>
> = {
  NOT_CONNECTED: new Set<RelationshipStateV2>([
    "CONNECTED",
    "MEETING_HELD",
    "IN_DILIGENCE",
    "INVESTED",
    "PAUSED",
  ]),
  // A relationship at any stage from interest expressed onward is in the
  // pipeline (their pipeline is their relationships: early-lead PIPELINE_NOTE).
  NOT_IN_PIPELINE: new Set<RelationshipStateV2>([
    "INTEREST_EXPRESSED",
    "CONNECTED",
    "MEETING_HELD",
    "IN_DILIGENCE",
    "PAUSED",
    "INVESTED",
  ]),
  AWAITING_ACCEPTANCE: new Set<RelationshipStateV2>([
    "CONNECTED",
    "MEETING_HELD",
    "IN_DILIGENCE",
    "INVESTED",
    "PAUSED",
    "DECLINED",
    "PASSED",
  ]),
  IN_DILIGENCE: new Set<RelationshipStateV2>([
    "DISCOVERED",
    "INTEREST_EXPRESSED",
    "CONNECTED",
    "MEETING_HELD",
    "INVESTED",
    "DECLINED",
    "PASSED",
  ]),
  INVESTED: new Set<RelationshipStateV2>([
    "DISCOVERED",
    "INTEREST_EXPRESSED",
    "CONNECTED",
    "MEETING_HELD",
    "IN_DILIGENCE",
    "DECLINED",
    "PASSED",
  ]),
};

const STAGE_WORDS: Readonly<Record<RelationshipStateV2, string>> = {
  DISCOVERED: "discovered",
  INTEREST_EXPRESSED: "interest expressed, waiting to be accepted",
  CONNECTED: "connected",
  DECLINED: "declined",
  MEETING_HELD: "meeting held",
  IN_DILIGENCE: "in diligence",
  PAUSED: "paused",
  PASSED: "passed",
  INVESTED: "invested",
};

/** The counterpart's name as it is said: its distinctive first word. */
function nameMatcher(name: string): RegExp | null {
  const word = plain(name)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .find(
      (part) =>
        part.length >= 3 &&
        !/^(?:the|and|for|of|ltd|inc|llc|group|capital|partners|ventures)$/u.test(
          part,
        ),
    );
  if (word === undefined) return null;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

function since(isoTime: string): string {
  const at = new Date(isoTime);
  if (Number.isNaN(at.getTime())) return "";
  return ` since ${new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(at)}`;
}

/** The stage as recorded, said plainly. */
export function stageLine(row: AccountDigestRelationship): string {
  return `From your records: ${plain(row.counterpart.name)} is ${STAGE_WORDS[row.stage]}${since(row.stageSince)}.`;
}

/** Their pipeline holds it, with the stage as recorded. */
export function pipelineLine(row: AccountDigestRelationship): string {
  return `From your records: ${plain(row.counterpart.name)} is in your pipeline, ${STAGE_WORDS[row.stage]}${since(row.stageSince)}.`;
}

/** A stated stage that the projection contradicts, with the row it is about. */
export type StageContradiction = {
  readonly sentence: string;
  readonly claim: StageClaim;
  readonly row: AccountDigestRelationship;
};

/** Sentences of an answer, each with its own end. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/u).filter((one) => one.trim() !== "");
}

/**
 * Every sentence that names exactly one counterpart the digest holds and
 * states a stage the projection contradicts. A sentence naming several is
 * left alone: which one the stage is about is not code's to guess. A
 * sentence denying pipeline membership that names no counterpart ("Yes,
 * but not yet as a pipeline relationship") is about the one counterpart
 * the person's own question named, when it named exactly one.
 */
export function stageContradictions(
  content: string,
  digest: QAccountDigest | null,
  asked?: string,
): readonly StageContradiction[] {
  if (digest === null || digest.relationships.length === 0) return [];
  const rows = digest.relationships
    .map((row) => ({ row, matcher: nameMatcher(row.counterpart.name) }))
    .filter(
      (
        entry,
      ): entry is {
        readonly row: AccountDigestRelationship;
        readonly matcher: RegExp;
      } => entry.matcher !== null,
    );
  const askedAbout =
    asked === undefined
      ? []
      : rows.filter((entry) => entry.matcher.test(asked));
  const [askedOnly] = askedAbout;
  const found: StageContradiction[] = [];
  for (const sentence of sentencesOf(content)) {
    const named = rows.filter((entry) => entry.matcher.test(sentence));
    const [only] = named;
    if (named.length > 1) continue;
    const words = sentence.replace(/[’]/gu, "'");
    for (const [claim, pattern] of CLAIMS) {
      if (!pattern.test(words)) continue;
      const about =
        only ??
        (claim === "NOT_IN_PIPELINE" && askedAbout.length === 1
          ? askedOnly
          : undefined);
      if (about === undefined) continue;
      if (CONTRADICTS[claim].has(about.row.stage)) {
        found.push({ sentence, claim, row: about.row });
        break;
      }
    }
  }
  return found;
}

/**
 * The answer with every contradicted stage replaced by the stage as
 * recorded (once per counterpart). Unchanged when nothing contradicts.
 */
export function withRelationshipStagesChecked(
  content: string,
  digest: QAccountDigest | null,
  asked?: string,
): { readonly content: string; readonly corrected: readonly string[] } {
  const found = stageContradictions(content, digest, asked);
  if (found.length === 0) return { content, corrected: [] };
  let text = content;
  const said = new Set<string>();
  for (const one of found) {
    const id = one.row.relationshipId;
    const replacement = said.has(id)
      ? ""
      : one.claim === "NOT_IN_PIPELINE"
        ? pipelineLine(one.row)
        : stageLine(one.row);
    said.add(id);
    text = text.replace(one.sentence, replacement);
  }
  return {
    content: text
      .replace(/[ \t]{2,}/gu, " ")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
    corrected: [...new Set(found.map((one) => one.row.counterpart.name))],
  };
}

/**
 * RC4 (investor audit, 7 Nov, run e8267645): "The Tensorgate rehearsal page
 * is being opened on the person's screen." Q's notes and a delegated
 * objective speak of the person in the third person; an answer that echoed
 * them leaked that wording. An answer speaks TO the person: the internal
 * phrasings of them are said in the second person. Only phrases that can
 * only mean the person Q is talking to are changed ("the person's screen",
 * "the user had been discussing"); "the user" in a description of someone
 * else's product is left alone.
 */
const THIRD_PERSON: readonly [RegExp, string][] = [
  [/\b(?:on|to)\s+the\s+(?:person|user)['’]s\s+screen\b/giu, "on your screen"],
  [/\bthe\s+person['’]s\s+screen\b/giu, "your screen"],
  [
    /\bthe\s+(?:person|user)\s+(had|has)\s+been\s+(discussing|asking|talking|looking)\b/giu,
    "you $1 been $2",
  ],
  [/\bthe\s+person\s+(?:is|was)\s+asking\b/giu, "you asked"],
  [/\bthe\s+person['’]s\b/giu, "your"],
];

export function inSecondPerson(content: string): string {
  let text = content;
  for (const [pattern, replacement] of THIRD_PERSON) {
    text = text.replace(pattern, replacement);
  }
  // A sentence that now opens with a lower-case "you" or "your".
  return text.replace(
    /(^|[.!?]\s+|\n)(you|your)\b/gu,
    (_all, start: string, word: string) =>
      `${start}${word.charAt(0).toUpperCase()}${word.slice(1)}`,
  );
}

/**
 * A first contact (Express Interest) is for a company they are not yet in
 * touch with. The digest's row when the target is one they are already
 * connected with or further along (never a first contact), else null.
 */
export function connectedAlready(
  digest: QAccountDigest | null,
  target: { readonly companyId?: string; readonly company?: string },
): AccountDigestRelationship | null {
  if (digest === null) return null;
  const past = CONTRADICTS.NOT_CONNECTED;
  for (const row of digest.relationships) {
    if (!past.has(row.stage)) continue;
    if (
      target.companyId !== undefined &&
      row.counterpart.id.toLowerCase() === target.companyId.toLowerCase()
    ) {
      return row;
    }
    if (target.company !== undefined) {
      const matcher = nameMatcher(row.counterpart.name);
      if (matcher?.test(target.company) === true) return row;
    }
  }
  return null;
}
