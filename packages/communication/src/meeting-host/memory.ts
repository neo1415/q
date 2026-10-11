import { randomUUID } from "node:crypto";

import { matchParty, type HostParty } from "./host.js";
import type { SnapshotSide } from "./snapshot.js";

/**
 * Meeting memory (founder ask P3, 2026-10-11): an append-only record of what
 * happened in a call, kept apart from the audit trail and from Q's long-term
 * memory. Events are never edited or deleted; a correction is a new event
 * that supersedes an earlier one in the EFFECTIVE view only. Compaction
 * writes a working summary event and shrinks what the model is shown, never
 * the events.
 *
 * Suggestion, tentative and commitment are different things:
 *   SUGGESTION  "we could ...", a request, a proposed time: nobody has agreed
 *   TENTATIVE   "I'll try ...": hedged
 *   COMMITMENT  a firm first-person promise, or a request accepted by the
 *               addressee. Only a COMMITMENT carries an owner and a due time.
 * Silence is never agreement: nothing here is driven by a clock.
 */

export type MeetingEventKind =
  | "QUESTION"
  | "AGREEMENT"
  | "DISAGREEMENT"
  | "PROPOSAL"
  | "PENDING_APPROVAL"
  | "COMMITMENT"
  | "ACTION_ITEM"
  | "CORRECTION"
  | "NOTE"
  | "SUMMARY"
  | "FOLLOW_UP";

export type MeetingStance = "SUGGESTION" | "TENTATIVE" | "COMMITMENT";

export type MeetingEvent = {
  readonly id: string;
  readonly meetingId: string;
  readonly seq: number;
  readonly at: string;
  readonly speakerName: string | null;
  readonly speakerUserId: string | null;
  readonly speakerSide: SnapshotSide | null;
  readonly kind: MeetingEventKind;
  readonly stance: MeetingStance | null;
  readonly text: string;
  readonly ownerName: string | null;
  readonly ownerUserId: string | null;
  readonly dueText: string | null;
  /** The earlier event this one answers, accepts, disputes or corrects. */
  readonly refersTo: string | null;
  /** Transcript lines / snapshot facts it rests on, e.g. "line:42". */
  readonly sourceRefs: readonly string[];
};

export type SpeakerRef = {
  readonly name: string | null;
  readonly userId: string | null;
  readonly side: SnapshotSide | null;
};

/** The invited person a caption name is; unknown stays unknown. */
export function attributeSpeaker(
  callName: string,
  parties: readonly HostParty[],
): SpeakerRef {
  const party = matchParty(
    { id: callName, name: callName, email: null },
    parties,
  );
  return party === null
    ? { name: callName, userId: null, side: null }
    : { name: party.name, userId: party.userId, side: party.side };
}

// ---------------------------------------------------------------------------
// Reading a line. Code, not a model: the stance is what the words commit to.
// ---------------------------------------------------------------------------

const plain = (text: string): string =>
  ` ${text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/’/g, "'")
    // "I'll" is a promise; "ill" and "well" are not, so expand before the
    // apostrophes go.
    .replace(/\b(i|we|you|they|he|she)'ll\b/g, "$1 will")
    .replace(/\bi'm\b/g, "i am")
    .replace(/\bwe're\b/g, "we are")
    .replace(/'/g, "")
    .replace(/[^a-z0-9:?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

const DAYS =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun";
const TIME_WORD = new RegExp(
  `\\b(?:${DAYS}|tomorrow|tonight|next week|this week|\\d{1,2}(?::\\d{2})? ?(?:am|pm)|\\d{1,2}:\\d{2}|noon|midday)\\b`,
);
const TIME_PROPOSAL =
  /\b(?:lets (?:do|go for|make it|meet|say|have it|schedule|book|talk|speak|reconvene|catch up)|how about|what about|can we (?:do|meet|move|make it|talk|speak|reconvene)|shall we (?:do|meet|say|talk)|i propose|i suggest|why not|would .{0,20} work|does .{0,25} work)\b/;
const NEGATION =
  /\b(?:not|cant|cannot|wont|doesnt|dont|isnt|never|no|nope|unfortunately|unable)\b/;
const ACCEPT =
  /\b(?:i accept|accepted|confirmed?|that works|works for me|works for us|sounds good|sounds great|agreed|we have a deal|its a deal|yes please|yes lets do (?:it|that)|lets do it|go ahead and book|perfect)\b/;
const DISAGREE =
  /\b(?:i disagree|i dont think so|not really|doesnt work|wont work|cant do|cannot do|i object|not comfortable|that is not right|thats not right|thats wrong|i dont agree)\b/;
const CORRECTION =
  /\b(?:thats not what i (?:meant|said)|not what i meant|i didnt (?:mean|say)|let me (?:correct|rephrase)|correction|scratch that|i misspoke|sorry i meant|what i meant (?:was|is)|i meant to say|hold on thats not)\b/;
const FIRM =
  /\b(?:i will|we will|i shall|we shall|i am going to|we are going to|i promise|i commit|you have my word|will do|leave it with me|consider it done|let me revert|i can send|we can send)\b/;
const HEDGE =
  /\b(?:probably|maybe|perhaps|hopefully|try to|ill try|i will try|might|should be able|i think i can|if possible|let me see|if i can|not sure|depending|we shall see)\b/;
const REQUEST =
  /\b(?:can you|could you|would you|will you|would you mind|please|kindly|i need you to|i would like you to|id like you to|do send|abeg)\b/;
// Asking to be heard or explained to is a question, not a task for anyone.
const NOT_A_TASK =
  /\b(?:can|could|would) you (?:hear|see|repeat|speak up|say that again|explain|tell (?:me|us)|clarify|summari[sz]e|help)\b/;
const SUGGEST =
  /\b(?:we could|you could|maybe we|perhaps we|what if|i suggest|id suggest|it would be (?:good|great|nice|helpful|useful) to|should we|we should|you should|might be worth|lets consider|one option)\b/;
const AFFIRM =
  /\b(?:yes|yeah|yep|sure|okay|ok|will do|of course|no problem|noted|certainly|absolutely|sure thing|i will|ill|happy to|gladly|done)\b/;
const QUESTION_START =
  /^ (?:who|what|when|where|why|how|which|can|could|would|do|does|did|is|are|was|were|will|have|has|should) /;

/** "by Friday", "Friday latest", "tomorrow", "end of the week". Null: none said. */
export function dueTextOf(text: string): string | null {
  const t = plain(text);
  const by = new RegExp(
    `\\b(?:by|before|on|until|till)(?: the)? ((?:next |this |coming )?(?:${DAYS}|tomorrow|tonight)|end of (?:the )?(?:day|week|month|quarter)|eod|eow|close of business|cob|\\d{1,2}(?:st|nd|rd|th)?(?: of)? [a-z]+(?: \\d{4})?)\\b`,
  ).exec(t);
  if (by?.[1] !== undefined) return by[1].trim();
  const latest = new RegExp(`\\b((?:${DAYS}|tomorrow)) latest\\b`).exec(t);
  if (latest?.[1] !== undefined) return `${latest[1]} latest`;
  const bare = /\b(tomorrow|tonight|next week|this week)\b/.exec(t);
  return bare?.[1] ?? null;
}

export type ReadLine = {
  readonly kind: MeetingEventKind;
  readonly stance: MeetingStance | null;
  readonly firstPerson: boolean;
};

/** What a line says, in order. At most three results. */
export function readLine(text: string): ReadLine[] {
  const t = plain(text);
  const out: ReadLine[] = [];
  if (CORRECTION.test(t)) {
    return [{ kind: "CORRECTION", stance: null, firstPerson: false }];
  }
  const negated = NEGATION.test(t);
  if (DISAGREE.test(t) || (negated && /\b(?:works?|agree)\b/.test(t))) {
    out.push({ kind: "DISAGREEMENT", stance: null, firstPerson: false });
  } else if (ACCEPT.test(t) && !negated) {
    out.push({ kind: "AGREEMENT", stance: null, firstPerson: false });
  }
  const timed = TIME_WORD.test(t) && TIME_PROPOSAL.test(t);
  if (timed && out.length === 0) {
    out.push({ kind: "PROPOSAL", stance: "SUGGESTION", firstPerson: false });
    out.push({
      kind: "PENDING_APPROVAL",
      stance: "SUGGESTION",
      firstPerson: false,
    });
    return out;
  }
  if (FIRM.test(t)) {
    // "i will" inside a question or request ("will you ...") is not a promise.
    if (!/\b(?:will you|can you|could you)\b/.test(t)) {
      out.push({
        kind: "COMMITMENT",
        stance: HEDGE.test(t) ? "TENTATIVE" : "COMMITMENT",
        firstPerson: true,
      });
      return out;
    }
  }
  if (
    REQUEST.test(t) &&
    !NOT_A_TASK.test(t) &&
    !/\bplease (?:note|remember)\b/.test(t)
  ) {
    out.push({ kind: "ACTION_ITEM", stance: "SUGGESTION", firstPerson: false });
    return out;
  }
  if (SUGGEST.test(t)) {
    out.push({ kind: "PROPOSAL", stance: "SUGGESTION", firstPerson: false });
    return out;
  }
  if (out.length === 0 && (text.includes("?") || QUESTION_START.test(t))) {
    out.push({ kind: "QUESTION", stance: null, firstPerson: false });
  }
  return out.slice(0, 3);
}

/** Whether a reply affirms what was asked (never silence, never bare noise). */
export function affirms(text: string): boolean {
  const t = plain(text);
  return AFFIRM.test(t) && !NEGATION.test(t.replace(/\bno problem\b/, ""));
}

// ---------------------------------------------------------------------------
// The memory.
// ---------------------------------------------------------------------------

export type WorkingSummary = {
  readonly upToSeq: number;
  readonly commitments: readonly string[];
  readonly tentative: readonly string[];
  readonly suggestions: readonly string[];
  readonly pendingApproval: readonly string[];
  readonly open: readonly string[];
  readonly text: string;
};

export type FollowUp = {
  readonly text: string;
  readonly kind: "COMMITMENT" | "APPROVAL" | "SUGGESTION";
  /** Always false: a follow-up is proposed, never sent or booked by Q. */
  readonly autoSend: false;
  readonly ownerName: string | null;
  readonly dueText: string | null;
  readonly sourceEventId: string;
};

type Draft = Partial<
  Omit<MeetingEvent, "id" | "meetingId" | "seq" | "at" | "kind">
> &
  Pick<MeetingEvent, "kind" | "text">;

const PENDING_REQUEST_LINES = 4;
const COMPACT_EVERY = 25;
const TEXT_CHARS = 500;

export type MeetingMemory = {
  /** One heard line from a person. Returns the events it produced. */
  readonly observe: (line: {
    readonly speaker: SpeakerRef;
    readonly text: string;
    readonly sourceRef: string;
    readonly at?: number;
  }) => MeetingEvent[];
  /** A direct request to Q to note something ("Q, note that ..."). */
  readonly noteRequest: (line: {
    readonly speaker: SpeakerRef;
    readonly text: string;
    readonly sourceRef: string;
  }) => { readonly events: MeetingEvent[]; readonly say: string };
  /** "Q, remember that commitment". */
  readonly remember: (speaker: SpeakerRef) => {
    readonly event: MeetingEvent | null;
    readonly say: string;
  };
  /** "That's not what I meant": supersedes the speaker's last item. */
  readonly correct: (
    speaker: SpeakerRef,
    sourceRef: string,
  ) => { readonly event: MeetingEvent; readonly say: string };
  readonly events: () => readonly MeetingEvent[];
  /** Events not superseded by a correction. */
  readonly effective: () => MeetingEvent[];
  readonly pendingApprovals: () => MeetingEvent[];
  readonly compact: () => WorkingSummary;
  readonly summary: () => WorkingSummary | null;
  /** The working summary plus the newest effective events, bounded. */
  readonly contextForModel: (maxChars?: number) => string;
  /** "Where are we", in words, from the working summary. */
  readonly sayWhereWeAre: () => string;
  readonly closing: () => {
    readonly summary: WorkingSummary;
    readonly followUps: readonly FollowUp[];
  };
};

export function createMeetingMemory(options: {
  readonly meetingId: string;
  /** Called once for every appended event (the runtime persists it). */
  readonly onEvent?: (event: MeetingEvent) => void;
  /** The next sequence number (after a restart, one past what is stored). */
  readonly startSeq?: number;
  readonly now?: () => number;
  readonly newId?: () => string;
}): MeetingMemory {
  const log: MeetingEvent[] = [];
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => randomUUID());
  let nextSeq = options.startSeq ?? 1;
  let summary: WorkingSummary | null = null;
  let compactedAt = 0;
  // Requests waiting for the addressee to say yes: never timed out into a yes.
  let pendingRequests: {
    event: MeetingEvent;
    askedBy: SpeakerRef;
    lines: number;
  }[] = [];

  function append(speaker: SpeakerRef | null, draft: Draft, at?: number) {
    const event: MeetingEvent = {
      id: newId(),
      meetingId: options.meetingId,
      seq: nextSeq++,
      at: new Date(at ?? now()).toISOString(),
      speakerName: speaker?.name ?? null,
      speakerUserId: speaker?.userId ?? null,
      speakerSide: speaker?.side ?? null,
      kind: draft.kind,
      stance: draft.stance ?? null,
      text: draft.text.trim().slice(0, TEXT_CHARS),
      // An owner and a due time exist only on a commitment (also a DB check).
      ownerName:
        draft.stance === "COMMITMENT" ? (draft.ownerName ?? null) : null,
      ownerUserId:
        draft.stance === "COMMITMENT" ? (draft.ownerUserId ?? null) : null,
      dueText: draft.stance === "COMMITMENT" ? (draft.dueText ?? null) : null,
      refersTo: draft.refersTo ?? null,
      sourceRefs: draft.sourceRefs ?? [],
    };
    log.push(event);
    options.onEvent?.(event);
    return event;
  }

  const superseded = (): Set<string> =>
    new Set(
      log
        .filter((e) => e.kind === "CORRECTION" && e.refersTo !== null)
        .map((e) => e.refersTo as string),
    );

  function effective(): MeetingEvent[] {
    const gone = superseded();
    return log.filter((e) => !gone.has(e.id));
  }

  /** Resolved: accepted by an investor-side person, or disputed by anyone. */
  function pendingApprovals(): MeetingEvent[] {
    const gone = superseded();
    const resolved = new Set(
      log
        .filter(
          (e) =>
            e.refersTo !== null &&
            (e.kind === "AGREEMENT" || e.kind === "DISAGREEMENT") &&
            e.speakerSide !== null,
        )
        .filter(
          (e) => e.kind === "DISAGREEMENT" || e.speakerSide === "INVESTOR",
        )
        .map((e) => e.refersTo as string),
    );
    return log.filter(
      (e) =>
        e.kind === "PENDING_APPROVAL" && !gone.has(e.id) && !resolved.has(e.id),
    );
  }

  function observe(line: {
    speaker: SpeakerRef;
    text: string;
    sourceRef: string;
    at?: number;
  }): MeetingEvent[] {
    const made: MeetingEvent[] = [];
    const { speaker, text } = line;
    const refs = [line.sourceRef];
    // A waiting request is answered only by a DIFFERENT person's yes.
    pendingRequests = pendingRequests
      .map((p) => ({ ...p, lines: p.lines + 1 }))
      .filter((p) => p.lines <= PENDING_REQUEST_LINES);
    const answered = pendingRequests.find(
      (p) =>
        p.askedBy.name !== speaker.name &&
        affirms(text) &&
        readLine(text).every((r) => r.kind !== "QUESTION"),
    );
    if (answered !== undefined) {
      pendingRequests = pendingRequests.filter((p) => p !== answered);
      made.push(
        append(
          speaker,
          {
            kind: "COMMITMENT",
            stance: "COMMITMENT",
            text: answered.event.text,
            ownerName: speaker.name,
            ownerUserId: speaker.userId,
            dueText: dueTextOf(answered.event.text) ?? dueTextOf(text),
            refersTo: answered.event.id,
            sourceRefs: [...answered.event.sourceRefs, ...refs],
          },
          line.at,
        ),
      );
      return made;
    }
    for (const read of readLine(text)) {
      if (read.kind === "CORRECTION") {
        made.push(correctWith(speaker, line.sourceRef, line.at).event);
        continue;
      }
      let refersTo: string | null = null;
      if (read.kind === "AGREEMENT" || read.kind === "DISAGREEMENT") {
        refersTo = pendingApprovals().at(-1)?.id ?? null;
        // Agreement with nothing in front of it is just talk.
        if (refersTo === null) continue;
      }
      if (read.kind === "PENDING_APPROVAL") {
        refersTo = made.at(-1)?.id ?? null;
      }
      const event = append(
        speaker,
        {
          kind: read.kind,
          stance: read.stance,
          text,
          ...(read.kind === "COMMITMENT" && read.stance === "COMMITMENT"
            ? {
                ownerName: speaker.name,
                ownerUserId: speaker.userId,
                dueText: dueTextOf(text),
              }
            : {}),
          refersTo,
          sourceRefs: refs,
        },
        line.at,
      );
      made.push(event);
      if (read.kind === "ACTION_ITEM") {
        pendingRequests.push({ event, askedBy: speaker, lines: 0 });
      }
    }
    if (log.length - compactedAt >= COMPACT_EVERY) compact();
    return made;
  }

  function correctWith(speaker: SpeakerRef, sourceRef: string, at?: number) {
    const gone = superseded();
    // Their own most recent item that is not itself a correction or summary.
    const target = [...log]
      .reverse()
      .find(
        (e) =>
          !gone.has(e.id) &&
          e.speakerName === speaker.name &&
          e.kind !== "CORRECTION" &&
          e.kind !== "SUMMARY" &&
          e.kind !== "FOLLOW_UP",
      );
    const event = append(
      speaker,
      {
        kind: "CORRECTION",
        text:
          target === undefined
            ? "Corrected: nothing earlier of theirs was on record."
            : `Corrected: ${target.text}`,
        refersTo: target?.id ?? null,
        sourceRefs: [sourceRef, ...(target?.sourceRefs ?? [])],
      },
      at,
    );
    if (target !== undefined) {
      pendingRequests = pendingRequests.filter((p) => p.event.id !== target.id);
    }
    return {
      event,
      say:
        target === undefined
          ? "Understood. Go ahead and say it again."
          : "Understood, I've set that aside. Say it the way you meant it.",
    };
  }

  function noteRequest(line: {
    speaker: SpeakerRef;
    text: string;
    sourceRef: string;
  }) {
    const body = line.text
      .replace(
        /^\s*(?:hey |ok |okay )?(?:q|cue|queue)[,.:]?\s*(?:please |kindly )?(?:can you |could you )?(?:note(?: down)?|remember|add|make a note|write down|record|log)(?: that| this| an? (?:action item|action|note|commitment))?[:,]?\s*/i,
        "",
      )
      .trim();
    const read = readLine(body).filter(
      (r) =>
        r.kind === "COMMITMENT" ||
        r.kind === "ACTION_ITEM" ||
        r.kind === "PROPOSAL",
    );
    if (body.length === 0) {
      return {
        events: [],
        say: "Tell me what to note, and who is doing it by when.",
      };
    }
    const events = observe({
      speaker: line.speaker,
      text: body,
      sourceRef: line.sourceRef,
    });
    if (read.length > 0 && events.length > 0) {
      const first = events[0];
      return {
        events,
        say:
          first?.stance === "COMMITMENT"
            ? `Noted: ${first.ownerName ?? "they"} will do that${first.dueText === null ? "" : `, by ${first.dueText}`}.`
            : "Noted as a suggestion. It becomes a commitment once the person doing it agrees.",
      };
    }
    const item = append(line.speaker, {
      kind: "ACTION_ITEM",
      stance: "SUGGESTION",
      text: body,
      sourceRefs: [line.sourceRef],
    });
    return {
      events: [item],
      say: "Noted as an action item. It becomes a commitment once the person doing it agrees.",
    };
  }

  function remember(speaker: SpeakerRef) {
    const candidate = [...effective()]
      .reverse()
      .find(
        (e) =>
          e.kind === "COMMITMENT" ||
          e.kind === "ACTION_ITEM" ||
          e.kind === "PROPOSAL",
      );
    if (candidate === undefined) {
      return {
        event: null,
        say: "I don't have a commitment to hold yet. Tell me who will do what, and by when.",
      };
    }
    const event = append(speaker, {
      kind: "NOTE",
      stance: candidate.stance,
      text: `Held at ${speaker.name ?? "a participant"}'s request: ${candidate.text}`,
      refersTo: candidate.id,
      sourceRefs: candidate.sourceRefs,
      ...(candidate.stance === "COMMITMENT"
        ? {
            ownerName: candidate.ownerName,
            ownerUserId: candidate.ownerUserId,
            dueText: candidate.dueText,
          }
        : {}),
    });
    const say =
      candidate.stance === "COMMITMENT"
        ? `Held: ${candidate.ownerName ?? "someone"} will do that${candidate.dueText === null ? "" : `, by ${candidate.dueText}`}.`
        : candidate.stance === "TENTATIVE"
          ? "I have that as tentative, not agreed. I'll hold it that way until it's firm."
          : "That was a suggestion, not an agreement. I've held it as a suggestion; it needs someone to take it on.";
    return { event, say };
  }

  function compact(): WorkingSummary {
    const live = effective().filter(
      (e) =>
        e.kind !== "SUMMARY" && e.kind !== "FOLLOW_UP" && e.kind !== "NOTE",
    );
    const pending = new Set(pendingApprovals().map((e) => e.refersTo));
    const pick = (stance: MeetingStance, kinds: MeetingEventKind[]) =>
      live
        .filter((e) => e.stance === stance && kinds.includes(e.kind))
        .map((e) =>
          e.stance === "COMMITMENT"
            ? `${e.ownerName ?? "Someone"}: ${e.text}${e.dueText === null ? "" : ` (by ${e.dueText})`}`
            : e.text,
        )
        .slice(-8);
    const commitments = pick("COMMITMENT", ["COMMITMENT"]);
    const tentative = pick("TENTATIVE", ["COMMITMENT"]);
    const suggestions = pick("SUGGESTION", ["PROPOSAL", "ACTION_ITEM"]).filter(
      Boolean,
    );
    const pendingApproval = live
      .filter((e) => e.kind === "PROPOSAL" && pending.has(e.id))
      .map(
        (e) =>
          `${e.text} (proposed by ${e.speakerName ?? "someone"}; not confirmed)`,
      )
      .slice(-5);
    const open = live
      .filter((e) => e.kind === "QUESTION")
      .map((e) => e.text)
      .slice(-5);
    const parts = [
      commitments.length > 0 ? `Agreed: ${commitments.join(" | ")}` : "",
      tentative.length > 0 ? `Tentative: ${tentative.join(" | ")}` : "",
      suggestions.length > 0
        ? `Suggested, not agreed: ${suggestions.join(" | ")}`
        : "",
      pendingApproval.length > 0
        ? `Awaiting approval: ${pendingApproval.join(" | ")}`
        : "",
      open.length > 0 ? `Questions raised: ${open.join(" | ")}` : "",
    ].filter((p) => p.length > 0);
    summary = {
      upToSeq: nextSeq - 1,
      commitments,
      tentative,
      suggestions,
      pendingApproval,
      open,
      text: parts.join("\n").slice(0, 2_000),
    };
    compactedAt = log.length;
    if (summary.text.length > 0) {
      append(null, {
        kind: "SUMMARY",
        text: summary.text,
        sourceRefs: [`events:1-${String(summary.upToSeq)}`],
      });
    }
    return summary;
  }

  return {
    observe,
    noteRequest,
    remember,
    correct: (speaker, sourceRef) => correctWith(speaker, sourceRef),
    events: () => log,
    effective,
    pendingApprovals,
    compact,
    summary: () => summary,
    contextForModel: (maxChars = 2_500) => {
      const base = summary?.text ?? "";
      const since = summary?.upToSeq ?? 0;
      const recent = effective()
        .filter((e) => e.seq > since && e.kind !== "SUMMARY")
        .slice(-12)
        .map(
          (e) =>
            `- ${e.kind.toLowerCase()}${e.stance === null ? "" : `/${e.stance.toLowerCase()}`} (${e.speakerName ?? "Q"}): ${e.text}`,
        );
      return [base, ...recent]
        .filter((p) => p.length > 0)
        .join("\n")
        .slice(0, maxChars);
    },
    sayWhereWeAre: () => {
      const s = compact();
      if (s.text.length === 0) {
        return "Nothing has been agreed yet. So far it has been discussion.";
      }
      const lead: string[] = [];
      if (s.commitments.length > 0)
        lead.push(`Agreed: ${s.commitments.slice(-3).join("; ")}.`);
      if (s.pendingApproval.length > 0)
        lead.push(
          `Awaiting approval: ${s.pendingApproval.slice(-2).join("; ")}.`,
        );
      if (s.suggestions.length > 0)
        lead.push(
          `Suggested but not agreed: ${s.suggestions.slice(-2).join("; ")}.`,
        );
      return lead.length > 0
        ? lead.join(" ")
        : "Nothing has been agreed yet. So far it has been discussion.";
    },
    closing: () => {
      const s = compact();
      const followUps: FollowUp[] = [];
      for (const e of effective()) {
        if (e.kind === "COMMITMENT" && e.stance === "COMMITMENT") {
          followUps.push({
            text: `${e.ownerName ?? "Owner to confirm"}: ${e.text}`,
            kind: "COMMITMENT",
            autoSend: false,
            ownerName: e.ownerName,
            dueText: e.dueText,
            sourceEventId: e.id,
          });
        }
      }
      for (const e of pendingApprovals()) {
        followUps.push({
          text: `Confirm in Capital Q: ${e.text} (needs the investor's explicit acceptance)`,
          kind: "APPROVAL",
          autoSend: false,
          ownerName: null,
          dueText: null,
          sourceEventId: e.id,
        });
      }
      for (const e of effective()) {
        if (
          e.stance === "SUGGESTION" &&
          (e.kind === "ACTION_ITEM" || e.kind === "PROPOSAL")
        ) {
          if (pendingApprovals().some((p) => p.refersTo === e.id)) continue;
          followUps.push({
            text: `Consider: ${e.text}`,
            kind: "SUGGESTION",
            autoSend: false,
            ownerName: null,
            dueText: null,
            sourceEventId: e.id,
          });
        }
      }
      for (const f of followUps) {
        append(null, {
          kind: "FOLLOW_UP",
          text: f.text,
          refersTo: f.sourceEventId,
          sourceRefs: [],
        });
      }
      return { summary: s, followUps };
    },
  };
}
