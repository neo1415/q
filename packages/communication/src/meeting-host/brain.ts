import type { MeetingEvent, MeetingMemory, SpeakerRef } from "./memory.js";
import {
  answerFromSnapshot,
  audienceOf,
  renderSnapshot,
  type MeetingContextSnapshot,
  type RoomMember,
} from "./snapshot.js";

/**
 * The meeting brain (founder ask P3): what Q does with a line addressed to
 * it. Cheap and certain things are done by CODE from prepared context and the
 * meeting memory (a hearing check, "where are we", a prepared company or
 * mandate or agenda answer, noting a commitment, a correction, being quiet,
 * resuming) so they read zero extra sources and spend no model call. Anything
 * open goes to the model with a context that holds ONLY the layers the room
 * may use, plus the working summary, plus meeting-eligible tools.
 *
 * Meeting-eligible tools (typed, each with an authorize step in the runtime):
 *   NOTE_ACTION   write a suggestion / action item into the meeting memory
 *   PROPOSE_TIME  record a PROPOSED time (never a booking)
 *   LOOK_UP       a fact from the permitted snapshot
 * No tool books, sends, shares, discloses or reaches a private layer.
 */

const norm = (text: string): string =>
  ` ${text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

/** Q's name at the start of a caption line, stripped for matching. */
const withoutName = (text: string): string =>
  text
    .replace(
      /^\s*(?:(?:hey|hi|hello|ok|okay|so|um|and)[,\s]+)*(?:q|cue|queue|kew)\b[,.:!?]*\s*/i,
      "",
    )
    .trim();

export function isHearingCheck(text: string): boolean {
  return /\b(?:can|could) (?:you|u) (?:hear|here) (?:me|us)\b|\bdo you (?:hear|here) (?:me|us)\b|\bare you (?:there|with us|listening|still (?:there|here|with us))\b|\bis (?:the )?(?:audio|sound) (?:ok|okay|working)\b|\btesting,? (?:one|1)/.test(
    norm(text),
  );
}

export function isOpinionAsk(text: string): boolean {
  return /\b(?:what do you think|whats your (?:take|view|read|opinion)|your (?:take|view|thoughts)|do you agree|how do you see (?:it|this)|any thoughts|what would you do)\b/.test(
    norm(text),
  );
}

/** "Q, hold on, that's not what I meant" -- a correction, not a wait. */
export function isCorrection(text: string): boolean {
  return /\b(?:thats not what i (?:meant|said)|not what i meant|i didnt (?:mean|say)|let me (?:correct|rephrase)|scratch that|i misspoke|what i meant (?:was|is)|no no|thats wrong|that is wrong|you got that wrong|thats not right)\b/.test(
    norm(text),
  );
}

export function isStayQuiet(text: string): boolean {
  return /\b(?:be quiet|stay quiet|stay silent|keep quiet|dont (?:speak|talk|say anything|interrupt|chip in)|not now|give us a (?:minute|moment|few minutes)|let us talk|just listen|listen only|take notes only|only take notes|mute yourself)\b/.test(
    norm(text),
  );
}

export function isResume(text: string): boolean {
  return /\b(?:you can (?:speak|talk|come back|chip in|join in)|carry on|resume|go ahead and (?:speak|join)|were done|we are done|you can talk again|back to you|come back in|join in again)\b/.test(
    norm(text),
  );
}

export function isWhereWeAre(text: string): boolean {
  return /\b(?:summari[sz]e|sum up|recap|where are we|what have we (?:agreed|covered|said|decided)|what(?:s| is) been agreed|what did we (?:agree|decide|cover)|catch (?:me|him|her|them) up|so far)\b/.test(
    norm(text),
  );
}

export function isRememberAsk(text: string): boolean {
  return /\b(?:remember (?:that|this|the)|hold (?:that|this|the) (?:commitment|action|point)|keep (?:that|this|the) (?:commitment|action)|note (?:that|this|down|the)|make a note|write (?:that|this) down|add (?:an? )?(?:action item|action|note)|log (?:that|this)|action item)\b/.test(
    norm(text),
  );
}

export type BrainRoute =
  | {
      readonly kind: "SAY";
      readonly why:
        | "HEARING_CHECK"
        | "PREPARED"
        | "WHERE_WE_ARE"
        | "REMEMBER"
        | "NOTE"
        | "CORRECTION";
      readonly line: string;
      readonly events: readonly MeetingEvent[];
      readonly sourceRefs: readonly string[];
    }
  | { readonly kind: "QUIET" }
  | { readonly kind: "RESUME"; readonly line: string }
  | {
      readonly kind: "MODEL";
      /** What the model is shown of the prepared context: the room's layers only. */
      readonly prepared: string;
      /** The working summary and the newest events. */
      readonly memory: string;
      readonly opinion: boolean;
    };

export type BrainInput = {
  readonly utterance: string;
  readonly speaker: SpeakerRef;
  readonly lineRef: string;
  readonly snapshot: MeetingContextSnapshot | null;
  /** Everyone present now, with the side Capital Q identified (null: unknown). */
  readonly room: readonly RoomMember[];
  readonly memory: MeetingMemory;
};

export function routeMeetingTurn(input: BrainInput): BrainRoute {
  const text = withoutName(input.utterance);
  const audience = audienceOf(input.room);
  const { memory, speaker } = input;

  // A correction first: "hold on, that's not what I meant" is not a wait.
  if (isCorrection(text)) {
    const done = memory.correct(speaker, input.lineRef);
    return {
      kind: "SAY",
      why: "CORRECTION",
      line: done.say,
      events: [done.event],
      sourceRefs: [input.lineRef],
    };
  }
  if (isHearingCheck(text)) {
    return {
      kind: "SAY",
      why: "HEARING_CHECK",
      line: "Yes, I can hear you.",
      events: [],
      sourceRefs: [],
    };
  }
  if (isStayQuiet(text)) return { kind: "QUIET" };
  if (isResume(text)) {
    return {
      kind: "RESUME",
      line: "Thanks. I'm here if you need me.",
    };
  }
  if (isRememberAsk(text)) {
    // "remember that commitment" holds what is on record; "note that I will
    // send the deck" records the statement with the stance its words carry.
    const refersToRecord =
      /\b(?:that|the|this) (?:commitment|action|point|agreement)\b/i.test(
        text,
      ) && !/\b(?:will|shall)\b|['’]ll\b/i.test(text);
    if (refersToRecord) {
      const held = memory.remember(speaker);
      return {
        kind: "SAY",
        why: "REMEMBER",
        line: held.say,
        events: held.event === null ? [] : [held.event],
        sourceRefs: held.event?.sourceRefs ?? [],
      };
    }
    const noted = memory.noteRequest({
      speaker,
      text: input.utterance,
      sourceRef: input.lineRef,
    });
    return {
      kind: "SAY",
      why: "NOTE",
      line: noted.say,
      events: noted.events,
      sourceRefs: [input.lineRef],
    };
  }
  // With nothing on the record the transcript may still hold what was
  // agreed (the code reader is narrow), so the model answers from it.
  if (
    isWhereWeAre(text) &&
    memory
      .effective()
      .some((e) => e.kind !== "QUESTION" && e.kind !== "SUMMARY")
  ) {
    return {
      kind: "SAY",
      why: "WHERE_WE_ARE",
      line: memory.sayWhereWeAre(),
      events: [],
      sourceRefs: [],
    };
  }
  if (input.snapshot !== null) {
    const prepared = answerFromSnapshot(input.snapshot, audience, text);
    if (prepared !== null) {
      return {
        kind: "SAY",
        why: "PREPARED",
        line: prepared.line,
        events: [],
        sourceRefs: prepared.sourceRefs,
      };
    }
  }
  return {
    kind: "MODEL",
    prepared:
      input.snapshot === null ? "" : renderSnapshot(input.snapshot, audience),
    memory: memory.contextForModel(),
    opinion: isOpinionAsk(text),
  };
}
