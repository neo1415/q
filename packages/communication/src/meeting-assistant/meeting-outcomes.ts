import { createHash } from "node:crypto";

import type { QMeetingCommitmentSignal } from "@capital-q/contracts";
import { parseSpokenAmount } from "@capital-q/network";

import { matchParty } from "../meeting-host/host.js";
import { affirms, dueTextOf, readLine } from "../meeting-host/memory.js";

/**
 * S5 (docs/specs/meetings/2026-11-18-meetings-design.md, R7): what was said
 * in a call, read after it ended (never in the call, so answers in the
 * call are no slower).
 *
 * Three things, each tied to the transcript line it rests on (speaker,
 * their side, the provider's timestamp when it gave one, and the exact
 * words):
 *
 *   commitments  money a side said it might put in, SOFT or HARD, with the
 *                amount, currency, share and condition kept apart;
 *   requests     who asked whom for what (a diligence request when the
 *                investor side asks the company), and whether it was
 *                accepted;
 *   promises     a person undertaking to do something ("I'll send both by
 *                Friday"), referring to the request it accepts.
 *
 * Levels are balanced (owner, 2026-11-18). Too strict is worse than too
 * loose, so any first-person statement of investing with an amount or a
 * share is at least SOFT; it is HARD only when unhedged and firm ("we will
 * put in $X", "we're in for $X"). A hedge ("probably", "likely", "around",
 * "if ...", "we'd") always keeps it SOFT, whatever a model said, and a
 * statement with no amount and no share is no commitment at all ("we
 * might invest" is interest, not money).
 *
 * The model's typed record (MEETING_NOTES, through the gateway) is read
 * alongside: a signal it found is kept only when its quote is found in
 * the transcript, and then the words, not the model, decide its level and
 * amount. Anything it wrote that no line says is dropped.
 *
 * Everything here is Q's reading of what people said: truth class
 * Q_INFERENCE over a USER_CLAIM, evidence SELF_REPORTED, never VERIFIED.
 * A material item (money, a request filed as diligence) needs the
 * relevant side's confirmation before it is authoritative.
 */

export const MEETING_OUTCOMES_VERSION = "meeting-outcomes.v1";

export type OutcomeSide = "FOUNDER" | "INVESTOR";

export type OutcomeParty = {
  readonly name: string;
  readonly side: OutcomeSide | null;
  readonly userId?: string | null | undefined;
};

export type OutcomeLine = {
  readonly speaker: string | null;
  readonly text: string;
  /** Seconds from the recording's start, when the provider gave it. */
  readonly at?: number | null | undefined;
};

export type OutcomeEvidence = {
  /** The transcript line's index (0-based). */
  readonly line: number;
  readonly speaker: string | null;
  readonly speakerUserId: string | null;
  readonly side: OutcomeSide | null;
  readonly at: number | null;
  /** The exact words it rests on. */
  readonly quote: string;
};

/** The evidence axes (ADR-001), kept apart: what Q read, from what was said. */
type Axes = {
  readonly truthClass: "Q_INFERENCE";
  readonly claimTruthClass: "USER_CLAIM";
  readonly evidenceStatus: "SELF_REPORTED";
  /** Not authoritative until the relevant side confirms. */
  readonly confirmation: "PENDING";
};

const AXES: Axes = {
  truthClass: "Q_INFERENCE",
  claimTruthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  confirmation: "PENDING",
};

export type MeetingCommitmentReading = Axes & {
  readonly id: string;
  readonly level: "SOFT" | "HARD";
  /** Exact decimal string; null when no exact figure was said. */
  readonly amount: string | null;
  /** ISO code only when the words named it; never guessed. */
  readonly currencyCode: string | null;
  /** A share of the round as said ("1/4", "25%"); null when none. */
  readonly share: string | null;
  readonly condition: string | null;
  /** CODE: the words alone; MODEL: the model's, found in a line; BOTH. */
  readonly readBy: "CODE" | "MODEL" | "BOTH";
  readonly evidence: OutcomeEvidence;
};

export type MeetingRequestReading = Axes & {
  readonly id: string;
  readonly askerName: string | null;
  readonly askerUserId: string | null;
  readonly askerSide: OutcomeSide | null;
  /** The other side of the call; null when the asker's side is unknown. */
  readonly askedSide: OutcomeSide | null;
  /** What was asked for, in the asker's words. */
  readonly item: string;
  readonly dueText: string | null;
  /** The investor side asking the company: a diligence request. */
  readonly diligence: boolean;
  readonly evidence: OutcomeEvidence;
  /** The asked side's yes, when one followed. */
  readonly accepted: OutcomeEvidence | null;
};

export type MeetingPromiseReading = Axes & {
  readonly id: string;
  readonly ownerName: string | null;
  readonly ownerUserId: string | null;
  readonly ownerSide: OutcomeSide | null;
  readonly what: string;
  readonly dueText: string | null;
  readonly stance: "COMMITMENT" | "TENTATIVE";
  /** The request it accepts, when it answers one. */
  readonly refersToRequest: string | null;
  readonly evidence: OutcomeEvidence;
};

export type MeetingOutcomes = {
  readonly version: typeof MEETING_OUTCOMES_VERSION;
  readonly commitments: readonly MeetingCommitmentReading[];
  readonly requests: readonly MeetingRequestReading[];
  readonly promises: readonly MeetingPromiseReading[];
  /** Model signals whose quote no line says: dropped, counted. */
  readonly ungrounded: number;
};

const MAX_ITEMS = 20;
/** A yes counts for a request said at most this many lines before it. */
const ACCEPT_WITHIN_LINES = 4;

const plain = (text: string): string =>
  ` ${text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/’/gu, "'")
    .replace(/\b(i|we|you|they)'ll\b/gu, "$1 will")
    .replace(/\b(i|we|you|they)'d\b/gu, "$1 would")
    .replace(/\bi'm\b/gu, "i am")
    .replace(/\bwe're\b/gu, "we are")
    .replace(/'/gu, "")
    .replace(/[^a-z0-9$€£₦%.,/?\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()} `;

const FIRST_PERSON = /\b(?:we|i|us|our|my)\b/u;
const INVEST =
  /\b(?:put in|putting in|come in|coming in|invest|investing|commit|committing|write (?:a |the )?(?:cheque|check|ticket)|lead|leading|participate|allocate|deploy|take (?:up )?(?:a |the )?(?:allocation|ticket|share|half|quarter|third|\d)|in for|do (?:the|a) (?:ticket|cheque|check))\b/u;
const NEGATED =
  /\b(?:not|wont|cannot|cant|never|unable|no longer|pass on|passing)\b/u;
const HEDGED =
  /\b(?:probably|likely|maybe|perhaps|possibly|potentially|hopefully|around|about|roughly|approximately|circa|ballpark|in the region of|up to|could|might|would|should|if|subject to|assuming|provided|depending|pending|looking at|thinking|considering|hope to|try to|ideally|tentatively)\b/u;
const FIRM =
  /\b(?:we will|i will|we are going to|i am going to|we commit|i commit|we are in for|i am in for|we are putting in|i am putting in|count us in|we have approved|we can confirm|confirmed)\b/u;
const CONDITION =
  /\b(if|subject to|assuming|provided(?: that)?|pending|depending on|as long as|once)\b\s+([^.,;?!]{3,160})/iu;

const SHARES: readonly (readonly [RegExp, string])[] = [
  [/\b(?:a |one )?quarter of (?:the|this|your) (?:round|raise)\b/u, "1/4"],
  [/\bhalf (?:of )?(?:the|this|your) (?:round|raise)\b/u, "1/2"],
  [/\b(?:a |one )?third of (?:the|this|your) (?:round|raise)\b/u, "1/3"],
  [/\b(?:the )?(?:whole|full|entire) (?:round|raise)\b/u, "1/1"],
];

const UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Readonly<Record<string, bigint>> = {
  thousand: 1_000n,
  k: 1_000n,
  million: 1_000_000n,
  m: 1_000_000n,
  mn: 1_000_000n,
  billion: 1_000_000_000n,
  bn: 1_000_000_000n,
};
const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  $: "USD",
  usd: "USD",
  dollar: "USD",
  dollars: "USD",
  "€": "EUR",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  "£": "GBP",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  "₦": "NGN",
  ngn: "NGN",
  naira: "NGN",
  kes: "KES",
  shillings: "KES",
  zar: "ZAR",
  rand: "ZAR",
  ghs: "GHS",
  cedis: "GHS",
};

/**
 * A figure said in words ("two hundred and fifty thousand") or digits
 * ("250k", "$1.5m"), and its currency only when said. Two different
 * figures, or none, read as unknown.
 */
export function spokenFigure(text: string): {
  readonly amount: string | null;
  readonly currencyCode: string | null;
} {
  const exact = parseSpokenAmount(text);
  if (exact !== null) {
    return { amount: exact.amount, currencyCode: exact.currencyCode };
  }
  const t = plain(text);
  const found = new Set<string>();
  const currencies = new Set<string>();
  // Digits: "$250k", "1.5 million", "250,000".
  for (const m of t.matchAll(
    /([$€£₦])?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|mn|bn|thousand|million|billion)?\b(?!\s?%)/gu,
  )) {
    const [, symbol, raw = "", unit] = m;
    const value = scaled(raw.replaceAll(",", ""), unit);
    if (value === null) continue;
    found.add(value);
    if (symbol !== undefined) currencies.add(CURRENCY_WORDS[symbol] ?? "");
  }
  // Words: a run of number words, with "and" and scales.
  const words = t.trim().split(" ");
  let i = 0;
  while (i < words.length) {
    const start = i;
    let total = 0n;
    let group = 0n;
    let saw = false;
    while (i < words.length) {
      const w = words[i] ?? "";
      const unit = UNITS[w];
      if (unit !== undefined) {
        group += BigInt(unit);
        saw = true;
      } else if (w === "hundred" && saw) {
        group *= 100n;
      } else if (SCALES[w] !== undefined && saw && w.length > 2) {
        total += group * (SCALES[w] ?? 1n);
        group = 0n;
      } else if (w === "and" && saw) {
        // "two hundred and fifty"
      } else {
        break;
      }
      i += 1;
    }
    if (saw) {
      const value = total + group;
      // A bare small number ("two documents") is not money.
      if (value >= 1_000n) found.add(value.toString());
    }
    if (i === start) i += 1;
  }
  for (const word of t.trim().split(" ")) {
    const code = CURRENCY_WORDS[word];
    if (code !== undefined && !/^[$€£₦]$/u.test(word)) currencies.add(code);
  }
  const amounts = [...found].filter((a) => a !== "0");
  return {
    amount: amounts.length === 1 ? (amounts[0] ?? null) : null,
    currencyCode:
      amounts.length === 1 && currencies.size === 1
        ? ([...currencies][0] ?? null) || null
        : null,
  };
}

function scaled(figure: string, unit: string | undefined): string | null {
  const [whole = "", fraction = ""] = figure.split(".");
  if (!/^\d+$/u.test(whole)) return null;
  const multiplier = unit === undefined ? 1n : (SCALES[unit] ?? 1n);
  const places = 10n ** BigInt(fraction.length);
  const digits = BigInt(whole + fraction) * multiplier;
  if (digits % places !== 0n) return null;
  const value = digits / places;
  // Small bare digits ("2 documents", "Friday the 3rd") are not money.
  if (unit === undefined && value < 1_000n) return null;
  return value.toString();
}

function shareOf(text: string): string | null {
  const t = plain(text);
  for (const [pattern, share] of SHARES) if (pattern.test(t)) return share;
  const percent =
    /\b(\d{1,2}(?:\.\d)?) ?(?:%|percent)(?: of (?:the|this|your) (?:round|raise))?/u.exec(
      t,
    );
  return percent?.[1] === undefined ? null : `${percent[1]}%`;
}

function conditionOf(text: string): string | null {
  const m = CONDITION.exec(text);
  if (m?.[1] === undefined || m[2] === undefined) return null;
  return `${m[1].toLowerCase()} ${m[2].trim()}`.slice(0, 200);
}

/** The level a line's words commit to, or null: no money said. */
export function commitmentLevelOf(text: string): "SOFT" | "HARD" | null {
  const t = plain(text);
  if (t.trim().endsWith("?")) return null;
  if (!FIRST_PERSON.test(t) || !INVEST.test(t) || NEGATED.test(t)) return null;
  const { amount } = spokenFigure(text);
  if (amount === null && shareOf(text) === null) return null;
  if (HEDGED.test(t)) return "SOFT";
  return FIRM.test(t) ? "HARD" : "SOFT";
}

/** What a request asks for: the words after the ask, before the due time. */
function itemOf(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const m =
    /\b(?:send|share|provide|forward|email|get|give)\s+(?:us|me|over|across)?\s*(.+?)(?:\s+(?:by|before|until|latest)\b.*)?[?.!]*$/iu.exec(
      flat,
    );
  const item = (m?.[1] ?? flat).replace(/[?.!]+$/u, "").trim();
  return item.slice(0, 200);
}

const sameWords = (a: string) =>
  plain(a)
    .replace(/[^a-z0-9 ]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

function idOf(meetingId: string, kind: string, line: number): string {
  const hex = createHash("sha256")
    .update(`${meetingId}:${kind}:${String(line)}`)
    .digest("hex");
  // A stable v4-shaped id: one per item, the same on every settle.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Reads a call's transcript, with the model's typed notes, after it ended. */
export function readMeetingOutcomes(input: {
  readonly meetingId: string;
  readonly lines: readonly OutcomeLine[];
  readonly parties: readonly OutcomeParty[];
  /** The model's money signals (MEETING_NOTES), grounded here or dropped. */
  readonly noted?: readonly QMeetingCommitmentSignal[] | undefined;
}): MeetingOutcomes {
  // The invited person a caption name is, by the host's own matcher;
  // unknown stays unknown (no side, no user).
  const hostParties = input.parties.map((p, i) => ({
    userId: String(i),
    name: p.name,
    email: null,
    side: p.side ?? "FOUNDER",
    organisation: "",
  }));
  const party = (speaker: string | null): OutcomeParty | null => {
    if (speaker === null) return null;
    const found = matchParty(
      { id: speaker, name: speaker, email: null },
      hostParties,
    );
    return found === null
      ? null
      : (input.parties[Number(found.userId)] ?? null);
  };
  const evidence = (index: number, quote?: string): OutcomeEvidence => {
    const line = input.lines[index];
    const who = party(line?.speaker ?? null);
    return {
      line: index,
      speaker: who?.name ?? line?.speaker ?? null,
      speakerUserId: who?.userId ?? null,
      side: who?.side ?? null,
      at: line?.at ?? null,
      quote: (quote ?? line?.text ?? "").trim().slice(0, 300),
    };
  };

  // --- Money, by the words. --------------------------------------------
  // Only an investor puts money in: a founder's "we'll come in at 50k MRR"
  // is a figure about the company, never a commitment. A speaker whose
  // side is unknown is still read (too strict is worse than too loose).
  const mayCommit = (index: number) => {
    const line = input.lines[index];
    if (line === undefined || line.speaker === null || line.speaker === "Q")
      return false;
    return party(line.speaker)?.side !== "FOUNDER";
  };
  const commitments = new Map<number, MeetingCommitmentReading>();
  input.lines.forEach((line, index) => {
    if (!mayCommit(index)) return;
    const level = commitmentLevelOf(line.text);
    if (level === null) return;
    const figure = spokenFigure(line.text);
    commitments.set(index, {
      ...AXES,
      id: idOf(input.meetingId, "commitment", index),
      level,
      amount: figure.amount,
      currencyCode: figure.currencyCode,
      share: shareOf(line.text),
      condition: conditionOf(line.text),
      readBy: "CODE",
      evidence: evidence(index),
    });
  });

  // --- The model's signals, kept only where a line says them. ----------
  let ungrounded = 0;
  for (const signal of input.noted ?? []) {
    const quote = sameWords(signal.quote);
    const index =
      quote.length < 6
        ? -1
        : input.lines.findIndex((line) => {
            const said = sameWords(line.text);
            return (
              said.includes(quote) || (said.length > 12 && quote.includes(said))
            );
          });
    const line = index < 0 ? undefined : input.lines[index];
    if (line === undefined) {
      ungrounded += 1;
      continue;
    }
    if (!mayCommit(index)) continue;
    const held = commitments.get(index);
    if (held !== undefined) {
      commitments.set(index, { ...held, readBy: "BOTH" });
      continue;
    }
    // Code missed the phrasing: the words still decide level and amount.
    const t = plain(line.text);
    if (NEGATED.test(t) || t.trim().endsWith("?")) continue;
    const figure = spokenFigure(line.text);
    const share = shareOf(line.text);
    if (figure.amount === null && share === null) continue;
    commitments.set(index, {
      ...AXES,
      id: idOf(input.meetingId, "commitment", index),
      level: !HEDGED.test(t) && signal.firmness === "FIRM" ? "HARD" : "SOFT",
      amount: figure.amount,
      currencyCode: figure.currencyCode,
      share,
      condition: conditionOf(line.text),
      readBy: "MODEL",
      evidence: evidence(index),
    });
  }

  // --- Requests and promises, by the meeting memory's own reading. -----
  const requests: MeetingRequestReading[] = [];
  const promises: MeetingPromiseReading[] = [];
  input.lines.forEach((line, index) => {
    if (line.speaker === null || line.speaker === "Q") return;
    if (commitments.has(index)) return;
    const reads = readLine(line.text);
    const who = evidence(index);
    if (reads.some((r) => r.kind === "ACTION_ITEM")) {
      const askedSide: OutcomeSide | null =
        who.side === null
          ? null
          : who.side === "FOUNDER"
            ? "INVESTOR"
            : "FOUNDER";
      requests.push({
        ...AXES,
        id: idOf(input.meetingId, "request", index),
        askerName: who.speaker,
        askerUserId: who.speakerUserId,
        askerSide: who.side,
        askedSide,
        item: itemOf(line.text),
        dueText: dueTextOf(line.text),
        diligence: who.side === "INVESTOR",
        evidence: who,
        accepted: null,
      });
      return;
    }
    const promise = reads.find((r) => r.kind === "COMMITMENT");
    // The asked side's yes to a recent request: accepted, and a promise.
    const open = [...requests]
      .reverse()
      .find(
        (r) =>
          r.accepted === null &&
          index - r.evidence.line <= ACCEPT_WITHIN_LINES &&
          r.askedSide !== null &&
          r.askedSide === who.side,
      );
    const yes =
      open !== undefined && (promise !== undefined || affirms(line.text));
    if (yes) {
      const at = requests.indexOf(open);
      requests[at] = { ...open, accepted: who };
    }
    if (promise !== undefined || yes) {
      promises.push({
        ...AXES,
        id: idOf(input.meetingId, "promise", index),
        ownerName: who.speaker,
        ownerUserId: who.speakerUserId,
        ownerSide: who.side,
        what: line.text.replace(/\s+/gu, " ").trim().slice(0, 300),
        dueText: dueTextOf(line.text) ?? (yes ? open.dueText : null),
        stance: promise?.stance === "TENTATIVE" ? "TENTATIVE" : "COMMITMENT",
        refersToRequest: yes ? open.id : null,
        evidence: who,
      });
    }
  });

  return {
    version: MEETING_OUTCOMES_VERSION,
    commitments: [...commitments.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => c)
      .slice(0, MAX_ITEMS),
    requests: requests.slice(0, MAX_ITEMS),
    promises: promises.slice(0, MAX_ITEMS),
    ungrounded,
  };
}
