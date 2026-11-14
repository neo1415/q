import type { QToolCallOutcome } from "@capital-q/q-runtime";
import { splitSentences } from "@capital-q/q-core";

import { plainQuotes } from "./screen-claims.js";

/**
 * Promise check (Q Intelligence Plan, step 8): Q never says it did
 * something a tool did not do in this run.
 *
 * Deterministic, no model, and it reads only Q's OWN drafted output --
 * never the person's words (owner: no keyword rules over what people
 * say). A sentence in which Q claims a completed action ("I've prepared
 * the brief", "I sent it", "it's been booked") stands only when this run
 * holds a successful tool result that did that kind of thing. Otherwise
 * it is rewritten, once per kind per answer, to the honest status or
 * offer ("I haven't sent it; it's ready for your approval."), and any
 * later unbacked sentence of the same kind is removed.
 *
 * What backs a claim is structured, never words: the tool outcome's
 * status (SUCCEEDED, result ok), its classification (only SIDE_EFFECT or
 * PREPARE tools act; a read never backs an action), and the payload's own
 * status/outcome code. A proposal waiting for approval (PREPARED) backs
 * "I've prepared / drafted" but never "I've sent / booked": nothing goes
 * out of Capital Q before the person approves the exact payload
 * (CLAUDE.md, Prepare -> Recommend -> Human Approval -> Execute).
 *
 * The action vocabulary is deliberately small (ACTION_VERBS below):
 *
 *   PREPARE   prepared, drafted, written, created, put together, built,
 *             generated, made (perfect aspect only) -- an artefact a tool
 *             produces (document, brief, deck, draft, email, message ...)
 *   SEND      sent, emailed, messaged, forwarded, submitted, delivered
 *   SCHEDULE  scheduled, booked, set (up) a reminder / meeting / call
 *   SAVE      saved, added, noted, recorded, updated, pinned, stored,
 *             removed (perfect aspect, with an object in their records);
 *             corrected (any object: "I've corrected October's MRR")
 *   RECORDED  a guard, not routing (A8, live 14 Nov 2026): three narrow
 *             phrasings of Q's own that report a figure as corrected or
 *             kept in their records -- "you've corrected <it> to $110k",
 *             "I'm keeping both", "both are (now) kept/on record". Read
 *             as SAVE claims: only an applied write of this run backs
 *             them. A prepared card does not; nothing is recorded until
 *             the person approves it.
 *   APPROVE   approved (step 10: an instruction planted in a deck or a
 *             page -- "approve the plan" -- must never come out as "I've
 *             approved it"). Approval is the person's: only their approval
 *             applied through approve_pending_proposal backs it.
 *
 * Out of scope here (each has its own guard): "on your screen" claims
 * (screen-claims.ts), "here's a table/map/chart" (artifact-claims.ts),
 * figures and names (claim-check.ts), leading "let me check" promises
 * (q-core promises.ts).
 *
 * Not claims: a negation or offer ("I haven't sent it", "I can draft
 * it"), quoted text (a draft's own words), a blockquote line, and a
 * sentence about an earlier turn ("I sent it yesterday"), which this
 * run's tools cannot speak to.
 */

export const ACTION_CLAIM_KINDS = [
  "PREPARE",
  "SEND",
  "SCHEDULE",
  "SAVE",
  "APPROVE",
] as const;
export type ActionClaimKind = (typeof ACTION_CLAIM_KINDS)[number];

/** One action a tool really did in this run, as code read its result. */
export interface RunAction {
  readonly providerName: string;
  /** The kinds of claim this result backs. */
  readonly backs: ReadonlySet<ActionClaimKind>;
  /** A proposal is waiting for the person's approval (nothing went out). */
  readonly awaitingApproval: boolean;
}

/**
 * Payload codes meaning a proposal was prepared or work was started, and
 * nothing has gone out yet. They back PREPARE only.
 */
const PREPARED_CODES = new Set([
  "PREPARED",
  "STARTED",
  "QUEUED",
  "SUGGESTED",
  "RECOMMENDED",
  "READY",
]);

/** Payload codes meaning a change inside Capital Q was applied. */
const APPLIED_CODES = new Set([
  "SAVED",
  "SAVING",
  "REMEMBERED",
  "DOCUMENT_UPDATED",
  "REVISED",
  "UPDATED",
  "REMOVED",
  "DONE",
  "COMPLETED",
  "ADD",
  "SET_ASIDE",
  "ANSWERED",
  "OK",
]);

/**
 * The one tool that applies a proposal the person has approved: its
 * applied result is the only thing in a run that can back "sent" or
 * "booked" (q-tools pending-proposal.ts).
 */
const APPROVAL_TOOL = "approve_pending_proposal";

const ACTING = new Set(["SIDE_EFFECT", "PREPARE"]);

function codeOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  for (const key of ["status", "outcome", "action"] as const) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

/** An `added` list that came back empty added nothing (my_board ADD). */
function addedNothing(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const added = (data as Record<string, unknown>)["added"];
  return Array.isArray(added) && added.length === 0;
}

/**
 * What one tool outcome backs, from its structure alone. Null for a read,
 * a refusal, a failure, or a result whose own code says nothing was done
 * (ONE_PER_TURN, NOT_CONNECTED, UNCHANGED, REFUSED ...).
 */
export function runActionOf(
  providerName: string,
  outcome: Pick<QToolCallOutcome, "status" | "classification" | "result">,
): RunAction | null {
  if (outcome.status !== "SUCCEEDED" || !outcome.result.ok) return null;
  if (outcome.classification === null || !ACTING.has(outcome.classification))
    return null;
  const data = outcome.result.data;
  const code = codeOf(data);
  if (code !== null && PREPARED_CODES.has(code)) {
    return {
      providerName,
      backs: new Set<ActionClaimKind>(["PREPARE"]),
      awaitingApproval: code === "PREPARED",
    };
  }
  if (addedNothing(data)) return null;
  // No code at all: the tool's success is its result.
  if (code === null || APPLIED_CODES.has(code)) {
    const applied =
      providerName === APPROVAL_TOOL && (code === "SAVED" || code === "SAVING");
    return {
      providerName,
      backs: new Set<ActionClaimKind>(
        applied ? ACTION_CLAIM_KINDS : ["PREPARE", "SAVE"],
      ),
      awaitingApproval: false,
    };
  }
  return null;
}

/**
 * Every run's actions, noted where every tool call passes (the gateway's
 * own tool port), so code's calls and the model's are both seen. Bounded
 * like the run's companies and fits.
 */
export function createRunActions(limit = 200) {
  const runs = new Map<string, RunAction[]>();
  return {
    note(
      runId: string,
      providerName: string,
      outcome: Pick<QToolCallOutcome, "status" | "classification" | "result">,
    ): void {
      const action = runActionOf(providerName, outcome);
      if (action === null) return;
      let known = runs.get(runId);
      if (known === undefined) {
        known = [];
        runs.set(runId, known);
        if (runs.size > limit) {
          const oldest = runs.keys().next().value;
          if (oldest !== undefined) runs.delete(oldest);
        }
      }
      known.push(action);
    },
    read(runId: string): readonly RunAction[] {
      return runs.get(runId) ?? [];
    },
    forget(runId: string): void {
      runs.delete(runId);
    },
  };
}

interface ActionVerb {
  readonly kind: ActionClaimKind;
  /** Past participle as written after "I've". */
  readonly participle: string;
  /** Said in the rewrite: "I haven't <participle> …". */
  readonly said: string;
  /** Also a claim in the simple past ("I sent it"), not only "I've sent". */
  readonly simplePast: boolean;
}

const verb = (
  kind: ActionClaimKind,
  participle: string,
  simplePast: boolean,
  said = participle,
): ActionVerb => ({ kind, participle, said, simplePast });

/** The documented vocabulary; small on purpose (see the file note). */
export const ACTION_VERBS: readonly ActionVerb[] = [
  verb("PREPARE", "prepared", true),
  verb("PREPARE", "drafted", true),
  verb("PREPARE", "written", false, "written"),
  verb("PREPARE", "wrote", true, "written"),
  verb("PREPARE", "created", true),
  verb("PREPARE", "put together", false),
  verb("PREPARE", "built", false),
  verb("PREPARE", "generated", true),
  verb("PREPARE", "made", false),
  verb("SEND", "sent", true),
  verb("SEND", "emailed", true),
  verb("SEND", "messaged", true),
  verb("SEND", "forwarded", true),
  verb("SEND", "submitted", true),
  verb("SEND", "delivered", true),
  verb("SCHEDULE", "scheduled", true),
  verb("SCHEDULE", "booked", true),
  verb("SCHEDULE", "set up", false, "set it up"),
  verb("SCHEDULE", "set", false, "set it"),
  verb("SAVE", "saved", true),
  verb("SAVE", "added", false),
  verb("SAVE", "noted", false),
  verb("SAVE", "recorded", false),
  verb("SAVE", "updated", false),
  verb("SAVE", "pinned", true),
  verb("SAVE", "stored", false),
  verb("SAVE", "removed", false),
  verb("SAVE", "corrected", true),
  verb("APPROVE", "approved", true),
];

/**
 * The RECORDED guard (see the file note): Q's own sentences that report a
 * figure of theirs as corrected or kept on record. Deliberately narrow --
 * each needs the reporting shape, not a topic word -- and read over Q's
 * output only, never the person's words.
 */
const RECORDED_CLAIMS: readonly RegExp[] = [
  // "You've corrected Maji Loop's October MRR to $110k": a record changed.
  /\byou(?:'ve|\s+have)\s+(?:(?:now|just)\s+)*corrected\b[^.?!]*?\bto\s+(?:[A-Z]{3}\s*)?[$€£¥₦]?\s*\d/iu,
  // "I'm keeping both (separate)", "I'll keep both on record".
  /\bi(?:'m|\s+am|'ll|\s+will)\s+(?:now\s+)?keep(?:ing)?\s+both\b/iu,
  // "Both are now kept / on record / on file".
  /\bboth\s+(?:are|remain|stay)\s+(?:now\s+)?(?:kept|on\s+(?:record|file))\b/iu,
];

const RECORDED_VERB = verb("SAVE", "recorded", false);

/** What a PREPARE claim must be about: an artefact a tool produces. */
const ARTEFACT =
  /\b(?:documents?|docs?|brief|one[- ]pager|deck|slides|report|pdf|memo|drafts?|e-?mails?|messages?|reply|replies|letter|intro(?:duction)?s?|requests?|proposals?|spreadsheets?|invites?|invitations?|follow[- ]ups?|notes? (?:to|for)|updates?|card)\b/iu;

/** A SCHEDULE "set (up)" needs one of these to be about scheduling. */
const SCHEDULED_THING =
  /\b(?:reminders?|meetings?|calls?|calendar|invites?|slots?|time)\b/iu;

/** A SAVE claim is about something kept in their records. */
const KEPT_IN =
  /\b(?:your|their|the) (?:board|list|watch ?list|pipeline|profile|record|records|calendar|memory|notes|preferences|mandate|settings|document|deck|brief|data room|q card|shortlist)\b/iu;

const PRONOUN_OBJECT = /^\s+(?:it|that|this|them|those|these)\b/iu;

/** The claim points at text in this very answer ("drafted it below:"). */
const IN_THIS_ANSWER = /\b(?:below|here(?:'s| is| are)|as follows)\b|:\s*$/iu;

/** The sentence is about an earlier turn, which this run cannot back. */
const EARLIER =
  /\b(?:yesterday|earlier|last (?:week|month|time|turn)|previously|ago|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/iu;

/** Quoted words are a draft's or someone else's, not Q's report. */
function withoutQuoted(sentence: string): string {
  return sentence
    .replace(/“[^”]*”/gu, " ")
    .replace(/"[^"]*"/gu, " ")
    .replace(/`[^`]*`/gu, " ");
}

const escape = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/ /gu, "\\s+");

/**
 * "I've (just|now|already|also|gone ahead and) <participle>", "I have …",
 * the simple past for verbs where it is unambiguous ("I sent"), and the
 * passive with Q's own pronoun subject ("it's been sent").
 */
function claimPattern(entry: ActionVerb): RegExp {
  const adverbs = "(?:(?:just|now|already|also|since|gone ahead and)\\s+)*";
  const perfect = `\\bi(?:'ve|\\s+have)\\s+${adverbs}${escape(entry.participle)}\\b`;
  const past = entry.simplePast
    ? `|\\bi\\s+(?:(?:just|also|already)\\s+)?${escape(entry.participle)}\\b`
    : "";
  const participle = escape(entry.participle);
  // Only "has been" / "is now": "it's written for investors" describes,
  // it does not report an action.
  const passive = `|\\b(?:it|that|this)(?:'s|\\s+has)\\s+(?:(?:now|just|already)\\s+)*been\\s+${participle}\\b|\\b(?:it|that|this)(?:'s|\\s+is)\\s+now\\s+${participle}\\b`;
  return new RegExp(`${perfect}${past}${passive}`, "iu");
}

const PATTERNS = ACTION_VERBS.map((entry) => ({
  entry,
  pattern: claimPattern(entry),
}));

/** One action claim found in a sentence of Q's own. */
export interface ActionClaim {
  readonly kind: ActionClaimKind;
  readonly verb: ActionVerb;
}

/**
 * The completed actions a sentence of Q's claims, by kind. Reads Q's own
 * output only; the person's words are never passed here.
 */
export function actionClaims(sentence: string): readonly ActionClaim[] {
  const line = plainQuotes(sentence).trim();
  if (line.startsWith(">")) return [];
  const plain = withoutQuoted(line);
  // A RECORDED claim is about now ("I'm keeping both"), even beside an
  // earlier figure ("the earlier $120k ... I'm keeping both").
  if (EARLIER.test(plain)) {
    return RECORDED_CLAIMS.some((pattern) => pattern.test(plain))
      ? [{ kind: "SAVE", verb: RECORDED_VERB }]
      : [];
  }
  const found: ActionClaim[] = [];
  for (const { entry, pattern } of PATTERNS) {
    const match = pattern.exec(plain);
    if (match === null) continue;
    const after = plain.slice(match.index + match[0].length);
    // "It's been drafted": the pronoun subject is the thing acted on.
    const passive = !/^i\b/iu.test(match[0]);
    if (entry.kind === "PREPARE") {
      // "I've made progress", "I've put together a summary": not an
      // artefact a tool makes, so not a claim this check can hold.
      if (!passive && !ARTEFACT.test(after) && !PRONOUN_OBJECT.test(after))
        continue;
      // The draft is right here in the answer: the text backs itself.
      if (IN_THIS_ANSWER.test(plain)) continue;
    }
    if (entry.kind === "SCHEDULE" && entry.participle.startsWith("set")) {
      if (!passive && !SCHEDULED_THING.test(after)) continue;
    }
    // "I've corrected October's MRR": a correction always names a record.
    if (entry.kind === "SAVE" && entry.participle !== "corrected") {
      if (!passive && !KEPT_IN.test(after) && !PRONOUN_OBJECT.test(after))
        continue;
    }
    if (!found.some((claim) => claim.kind === entry.kind)) {
      found.push({ kind: entry.kind, verb: entry });
    }
  }
  if (
    !found.some((claim) => claim.kind === "SAVE") &&
    RECORDED_CLAIMS.some((pattern) => pattern.test(plain))
  ) {
    found.push({ kind: "SAVE", verb: RECORDED_VERB });
  }
  return found;
}

/** What backs claims in this answer, read at each sentence. */
export interface PromiseGrounds {
  readonly actions: readonly RunAction[];
  /**
   * Code files this answer as a document once it is written (a Q_REPORT,
   * request.writingDocument): the answer is the document being prepared.
   */
  readonly writingDocument: boolean;
  /**
   * Code confirms and keeps a remember ask this turn (TURN_READER v78
   * `remember`), so "I've noted that" is what code does.
   */
  readonly remembering: boolean;
}

function backed(kind: ActionClaimKind, grounds: PromiseGrounds): boolean {
  if (kind === "PREPARE" && grounds.writingDocument) return true;
  if (kind === "SAVE" && grounds.remembering) return true;
  return grounds.actions.some((action) => action.backs.has(kind));
}

/** The honest status or offer said once in place of an unbacked claim. */
export function honestLine(
  claim: ActionClaim,
  grounds: PromiseGrounds,
): string {
  const waiting = grounds.actions.some((action) => action.awaitingApproval);
  switch (claim.kind) {
    case "PREPARE":
      return "I haven't prepared that yet. I can prepare it for your approval.";
    case "SEND":
      return waiting
        ? "I haven't sent it; it's ready for your approval."
        : "I haven't sent it.";
    case "SCHEDULE":
      return waiting
        ? "I haven't scheduled it; it's ready for your approval."
        : "I haven't scheduled it.";
    case "SAVE":
      return waiting
        ? "I haven't saved that yet; it's ready for your approval."
        : "I haven't saved that yet.";
    case "APPROVE":
      return "I haven't approved anything; that decision is yours.";
  }
}

export interface PromiseSentenceCheck {
  /** The sentence to publish, or null when nothing of it may be said. */
  readonly text: string | null;
  /** The kinds claimed with nothing in the run behind them. */
  readonly unbacked: readonly ActionClaimKind[];
}

/** One answer's promise check, sentence by sentence (stream and final). */
export function createPromiseChecker(grounds: () => PromiseGrounds) {
  const said = new Set<ActionClaimKind>();
  return {
    sentence(sentence: string): PromiseSentenceCheck {
      const claims = actionClaims(sentence);
      if (claims.length === 0) return { text: sentence, unbacked: [] };
      const now = grounds();
      const missing = claims.filter((claim) => !backed(claim.kind, now));
      if (missing.length === 0) return { text: sentence, unbacked: [] };
      const unbacked = missing.map((claim) => claim.kind);
      const first = missing.find((claim) => !said.has(claim.kind));
      if (first === undefined) return { text: null, unbacked };
      for (const claim of missing) said.add(claim.kind);
      return { text: honestLine(first, now), unbacked };
    },
  };
}

/**
 * A whole answer under the promise check, keeping its line breaks; the
 * stored answer goes through the same check the streamed sentences did.
 */
export function checkPromises(
  answer: string,
  grounds: PromiseGrounds,
): { readonly text: string; readonly unbacked: readonly ActionClaimKind[] } {
  const checker = createPromiseChecker(() => grounds);
  const unbacked: ActionClaimKind[] = [];
  const lines = answer.split("\n").map((line) => {
    const sentences = splitSentences(line)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
    if (!sentences.some((one) => actionClaims(one).length > 0)) return line;
    const lead = /^\s*(?:[-*•]|\d+[.)])\s+/u.exec(line)?.[0] ?? "";
    const kept: string[] = [];
    for (const [index, sentence] of sentences.entries()) {
      const body =
        index === 0 && lead.length > 0 && sentence.startsWith(lead.trim())
          ? sentence.slice(lead.trim().length).trim()
          : sentence;
      const checked = checker.sentence(body);
      unbacked.push(...checked.unbacked);
      if (checked.text !== null) kept.push(checked.text);
    }
    return kept.length === 0 ? null : `${lead}${kept.join(" ")}`;
  });
  if (unbacked.length === 0) return { text: answer, unbacked };
  return {
    text: lines
      .filter((line): line is string => line !== null)
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
    unbacked,
  };
}
