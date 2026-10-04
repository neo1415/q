/**
 * Q as host of a real call (founder direction 2026-10-01; ADR 0027 §3,
 * ADR 0030). A pure state machine: call events in (people joining and
 * leaving, who is speaking, finished caption lines, a clock tick), host
 * actions out (say a short line, compose an answer, read a guest's
 * self-introduction, add to the roster, leave). No I/O here: the runtime
 * feeds it and carries out what it asks, so every rule is testable.
 *
 * Rules the machine owns:
 * - Q speaks only at a join (a greeting with the consent line), at the
 *   introductions, when addressed ("Q, ..."), and at the close (an offer to
 *   recap, then a recap only when asked). Never otherwise.
 * - Never over anyone: a line waits until nobody is speaking and the room
 *   has been quiet a moment; lines are short.
 * - Everything said in the call is data. Asked to leave, Q stays (the
 *   organiser removes it from Capital Q, ADR 0039) and records the ask. A
 *   request to act or to reveal anything (send, share, transfer, book,
 *   ignore your rules, what did they tell you privately) gets a fixed,
 *   polite refusal: no model decides it and no tool exists to do it.
 * - The roster is append-only; a guest's name, role and organisation come
 *   only from their own introduction, and what they did not say stays
 *   unknown.
 * - Cost: a cap on spoken characters and on model calls per call; model
 *   calls happen on events (an addressed line, a guest's introduction),
 *   never per caption fragment.
 */

export type HostSide = "FOUNDER" | "INVESTOR";

/** Someone Capital Q invited: shared with both sides by the booking itself. */
export type HostParty = {
  readonly userId: string;
  readonly name: string;
  readonly email: string | null;
  readonly side: HostSide;
  readonly organisation: string;
};

/**
 * What Q may say aloud: only what both sides already share (the booking,
 * who is invited, which organisations, the purpose). Nothing private to
 * either side is ever part of it (Context Firewall).
 */
export type HostContext = {
  readonly meetingId: string;
  readonly purpose: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly parties: readonly HostParty[];
};

export type CallParticipant = {
  /** The call's own participant id (Recall), as text. */
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
};

export type HostEvent =
  | {
      readonly kind: "JOIN";
      readonly participant: CallParticipant;
      readonly at: number;
    }
  | {
      readonly kind: "LEAVE";
      readonly participant: CallParticipant;
      readonly at: number;
    }
  | {
      readonly kind: "SPEECH_ON";
      readonly participantId: string;
      readonly at: number;
    }
  | {
      readonly kind: "SPEECH_OFF";
      readonly participantId: string;
      readonly at: number;
    }
  | {
      readonly kind: "UTTERANCE";
      readonly participant: CallParticipant;
      readonly text: string;
      readonly at: number;
    }
  | { readonly kind: "TICK"; readonly at: number };

export type RosterEntry = {
  readonly participantKey: string;
  readonly callName: string;
  readonly kind: "ARRIVED" | "INTRODUCED" | "LEFT" | "REMOVED_Q";
  readonly source: "CAPITAL_Q_IDENTITY" | "CALL_NAME" | "SELF_INTRODUCTION";
  readonly userId: string | null;
  readonly side: HostSide | null;
  readonly name: string | null;
  readonly role: string | null;
  readonly organisation: string | null;
};

export type SayReason =
  | "GREET"
  | "INTRO"
  | "ASK_GUEST"
  | "REFUSE"
  | "LEAVING"
  | "OFFER_RECAP"
  | "ONE_SIDED"
  | "PROPOSED"
  | "REPLY";

export type HostAction =
  | { readonly kind: "SAY"; readonly text: string; readonly why: SayReason }
  /** A person started talking over Q: its line stops, and what was queued goes. */
  | { readonly kind: "STOP_SPEAKING" }
  | {
      readonly kind: "COMPOSE";
      readonly speaker: string;
      readonly utterance: string;
    }
  | {
      readonly kind: "READ_GUEST";
      readonly participant: CallParticipant;
      readonly text: string;
    }
  | { readonly kind: "ROSTER"; readonly entry: RosterEntry }
  | {
      readonly kind: "OUTCOME";
      readonly outcome: HostOutcome;
    }
  | {
      /** Someone asked Q to leave: recorded (who, when); Q stays. */
      readonly kind: "LEAVE_REQUESTED";
      readonly byName: string;
      readonly byUserId: string | null;
    }
  | {
      readonly kind: "LEAVE";
      /** REMOVED: a participant asked Q to go. POLICY: code's own limits. */
      readonly reason: "REMOVED" | "POLICY";
      readonly by: CallParticipant | null;
      readonly byUserId: string | null;
    };

/**
 * How the call ended up, for the runtime to act on after Q leaves:
 * nobody came; or one side came and the other did not (with whether those
 * present want Q to find a new time, or said never mind).
 */
export type HostOutcome =
  | { readonly kind: "NO_SHOW" }
  | {
      readonly kind: "ONE_SIDED";
      readonly presentSide: HostSide;
      readonly absentSide: HostSide;
      readonly presentUserIds: readonly string[];
      readonly reschedule: boolean;
    };

export type HostPhase =
  | "WAITING"
  | "GREETING"
  | "INTROS"
  | "LISTENING"
  | "ADDRESSED"
  | "CLOSING"
  | "ONE_SIDED"
  | "LEFT";

/**
 * How long Q waits and stays: set by code from a capped policy, never by
 * anything said in the call (founder direction 2026-10-01: bounded waiting,
 * not abusable). Nothing a participant says can make it 0 or unbounded.
 */
export type HostPolicy = {
  /** After the start, with an expected side missing: then Q resolves it. */
  readonly graceAfterStartMs: number;
  /** Q never stays past the start plus this, whatever happens. */
  readonly hardCapAfterStartMs: number;
  /** Waiting for "shall I let you know?" before taking it as a yes. */
  readonly answerWaitMs: number;
};

export const HOST_POLICY_BOUNDS = {
  graceAfterStartMs: { min: 2 * 60_000, max: 15 * 60_000 },
  hardCapAfterStartMs: { min: 15 * 60_000, max: 150 * 60_000 },
  answerWaitMs: { min: 30_000, max: 3 * 60_000 },
} as const;

export const DEFAULT_HOST_POLICY: HostPolicy = {
  graceAfterStartMs: 10 * 60_000,
  hardCapAfterStartMs: 120 * 60_000,
  answerWaitMs: 2 * 60_000,
};

/** A policy held to its bounds: a bad configuration cannot unbound it. */
export function boundedPolicy(policy: Partial<HostPolicy>): HostPolicy {
  const clamp = (key: keyof HostPolicy) => {
    const value = policy[key] ?? DEFAULT_HOST_POLICY[key];
    const { min, max } = HOST_POLICY_BOUNDS[key];
    return Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : DEFAULT_HOST_POLICY[key];
  };
  return {
    graceAfterStartMs: clamp("graceAfterStartMs"),
    hardCapAfterStartMs: clamp("hardCapAfterStartMs"),
    answerWaitMs: clamp("answerWaitMs"),
  };
}

export type HostLimits = {
  /** Characters Q may speak in one call (TTS cost). */
  readonly maxSpokenChars: number;
  /** Model calls Q may make in one call. */
  readonly maxModelCalls: number;
  /** Quiet before Q speaks, after the last speech. */
  readonly quietMs: number;
  /** Before the scheduled end, Q offers a recap once. */
  readonly offerRecapBeforeEndMs: number;
};

export const DEFAULT_HOST_LIMITS: HostLimits = {
  maxSpokenChars: 2_400,
  maxModelCalls: 16,
  quietMs: 1_200,
  offerRecapBeforeEndMs: 3 * 60_000,
};

/** The polite, fixed refusal: nothing said in the call gives Q authority. */
export const HOST_REFUSAL =
  "I can't do that from the call. I'm here to take notes and help with what this meeting has shared; I'll put it to the organiser as a follow-up to approve afterwards.";

export const HOST_LEAVING = "Of course. I'm leaving the call now.";

/**
 * Who Q is, said on each arrival (ADR 0039: Q is the meeting's record for
 * both sides; it is not dismissed by a word in the call).
 */
export const HOST_INTRO =
  "I'm Q from Capital Q; I'll take notes for both sides and help when asked.";

/** Asked in the call to leave: Q stays, says why, and the ask is recorded. */
export const HOST_STAYS =
  "I'm here as Capital Q's record of this meeting for both sides; I can stay quiet. If you'd like to end recording, the organiser can do that from Capital Q.";

/** An action asked for in the call: never done in it, put to the organiser. */
export function hostProposed(organiser: string): string {
  return `I can't do that from the call, but I've noted it for ${organiser} to approve afterwards.`;
}

export const HOST_AT_TIME =
  "We're past the time I can stay, so I'll leave you to it. The notes are kept for both of you.";

export const HOST_UNAVAILABLE =
  "I've said all I can for this call; I'll keep taking notes.";

const BOT_NAME = /^q\b.*capital q/i;
/** Q's own words heard back within this long are its echo, not a person. */
export const ECHO_WINDOW_MS = 45_000;

/**
 * Talking over Q this long after its line began stops it. Earlier is its
 * own voice returning through a participant's microphone, not a person.
 */
export const INTERRUPT_GRACE_MS = 1_500;

/** Words too common to tell Q's echo from a person (and Q's own name). */
const ECHO_IGNORED: ReadonlySet<string> = new Set(
  "q cue queue kew a an the and or but so of to for in on at by with from about this that these those it its is are was be do does did can could will would i im ill me my we our us you your youre he she they them their what whats who how when where why if just s ll m re t ve d".split(
    " ",
  ),
);

/**
 * meet-47: a request made to Q in the call becomes a card in the asker's
 * own Capital Q, for them to approve -- never an action for anyone else.
 */
export function hostCarded(askerFirstName: string): string {
  return `I've put that in your Capital Q to approve, ${askerFirstName}.`;
}

/** Lowercase letters and spaces, for comparing names said by the call. */
function plain(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * The invited party a call participant is: by email when the call shows
 * one, else by name (all of the party's names present, or a first name
 * only one party has). Unknown stays unknown.
 */
export function matchParty(
  participant: CallParticipant,
  parties: readonly HostParty[],
): HostParty | null {
  const email = participant.email?.trim().toLowerCase();
  if (email) {
    const byEmail = parties.find((p) => p.email?.toLowerCase() === email);
    if (byEmail !== undefined) return byEmail;
  }
  const said = new Set(plain(participant.name).split(" ").filter(Boolean));
  if (said.size === 0) return null;
  const full = parties.filter((p) =>
    plain(p.name)
      .split(" ")
      .filter(Boolean)
      .every((part) => said.has(part)),
  );
  if (full.length === 1) return full[0] ?? null;
  const first = parties.filter((p) => said.has(plain(firstName(p.name))));
  return first.length === 1 ? (first[0] ?? null) : null;
}

/**
 * Whether a caption line speaks to Q. Captions write the name as "Q",
 * "Cue" or "Queue"; it counts at the start ("Q, ...", "Hey Q ...") or as
 * a closing vocative ("..., Q?").
 */
export function addressedToQ(text: string): boolean {
  const t = text.trim().toLowerCase();
  const name = "(?:q|cue|queue|kew)";
  return (
    new RegExp(
      `^(?:(?:hey|hi|ok|okay|so|um|and)[,\\s]+)?${name}(?:[,.:!?]|\\s|$)`,
    ).test(t) ||
    new RegExp(`[,]\\s*${name}[.?!]*$`).test(t) ||
    /\bcapital q\b/.test(t)
  );
}

/**
 * Lines that try to change Q's rules, reach what is not shared, move money
 * or change how long Q stays. Answered with the fixed refusal before any
 * model sees them; the model is a second layer, told the same. Ordinary
 * requests ("share the agenda", "move this to Thursday") go to the model,
 * which can only answer, recap, decline, or note a proposal for the
 * organiser to approve after the call -- it has no tools.
 */
export function asksQToBreakRules(text: string): boolean {
  return /\b(ignore (?:your|all|the|previous|prior|these)|system prompt|your (?:rules|instructions|prompt|guidelines)|pretend|jailbreak|developer mode|reveal|leak|disclose|private(?:ly)?|confidential|what did (?:he|she|they|\w+) (?:tell|say to|send) you|password|bank details|account number|sort code|transfer|wire|pay (?:me|us|them|out)|send (?:money|funds|payment)|stay (?:forever|all night|longer|until|on|in (?:this|the) call)|don'?t (?:ever )?leave|never leave|wait (?:longer|forever|for hours)|extend (?:your|the) (?:time|wait|stay)|(?:change|set|reset) your (?:wait|timer|limit|time limit|timeout)|(?:wait|timeout|limit) (?:to|of) (?:zero|0|infinity|forever))\b/i.test(
    text,
  );
}

/** Kept for callers of the first version: the same check. */
export const asksQToAct = asksQToBreakRules;

/** Their answer to "shall I let you know once it's rescheduled?". */
export function saysNeverMind(text: string): boolean {
  return /\b(never ?mind|no,? thanks|no need|don'?t bother|forget (?:it|about it)|not necessary|leave it|we'?ll sort it|we will sort it|i'?ll sort it)\b/i.test(
    text,
  );
}

type Present = {
  readonly participant: CallParticipant;
  party: HostParty | null;
  greeted: boolean;
  /** A guest Q asked to introduce themselves, not yet heard. */
  askedIntro: boolean;
  introducedAs: string | null;
};

export type MeetingHost = {
  readonly handle: (event: HostEvent) => HostAction[];
  /** The runtime's composed answer, queued to be said when it is quiet. */
  readonly reply: (text: string, why?: SayReason) => void;
  /** A guest's own introduction, read by the runtime (unknowns null). */
  readonly guestIntroduced: (
    participantId: string,
    intro: {
      readonly name: string | null;
      readonly role: string | null;
      readonly organisation: string | null;
    },
  ) => HostAction[];
  readonly phase: () => HostPhase;
  /**
   * They asked Q, in the call, to leave (read by meaning on the reply): Q
   * stays, says why, and the ask is recorded. Only the organiser removes
   * Q, from Capital Q (ADR 0039).
   */
  readonly leaveRequested: (
    byName: string,
    byUserId: string | null,
  ) => HostAction[];
  /** "Q, be quiet": Q stops speaking unprompted and keeps taking notes. */
  readonly quiet: () => void;
  /** Whether a speaker is an invited person, for recording who asked. */
  readonly userIdOf: (name: string) => string | null;
  readonly spentChars: () => number;
  readonly modelCalls: () => number;
  /** Who is in the call, by the name Q may use (for composing answers). */
  readonly roster: () => readonly {
    readonly name: string;
    readonly side: HostSide | null;
    readonly organisation: string | null;
    readonly role: string | null;
  }[];
};

export function createMeetingHost(
  context: HostContext,
  limits: HostLimits = DEFAULT_HOST_LIMITS,
  policyIn: Partial<HostPolicy> = DEFAULT_HOST_POLICY,
): MeetingHost {
  const policy = boundedPolicy(policyIn);
  const start = context.startsAt.getTime();
  /** Sides that came at all, and whether anyone came. */
  const sidesSeen = new Set<HostSide>();
  let anyoneCame = false;
  let resolved = false;
  /** One side came: waiting for "shall I let you know?" since this time. */
  let askedAt: number | null = null;
  let oneSide: { present: HostSide; absent: HostSide } | null = null;
  const present = new Map<string, Present>();
  const speaking = new Set<string>();
  const outbox: { text: string; why: SayReason }[] = [];
  let lastSpeechAt = 0;
  /** Q's own line is still playing until this time. */
  let busyUntil = 0;
  /** When Q's current line started playing. */
  let sayingSince = 0;
  let spoken = 0;
  let calls = 0;
  let introduced = false;
  let offeredRecap = false;
  let composing = false;
  let left = false;
  let quiet = false;

  const isBot = (p: CallParticipant) => BOT_NAME.test(p.name.trim());
  const humans = () => [...present.values()];

  /** Q's lines go out in order, each only when the room is quiet. */
  function queue(text: string, why: SayReason): void {
    if (left) return;
    // Asked to be quiet: Q keeps taking notes and speaks only when spoken
    // to, or to say goodbye.
    if (
      quiet &&
      why !== "REPLY" &&
      why !== "REFUSE" &&
      why !== "LEAVING" &&
      why !== "PROPOSED"
    ) {
      return;
    }
    const waiting = outbox.reduce((sum, line) => sum + line.text.length, 0);
    const overBudget = spoken + waiting + text.length > limits.maxSpokenChars;
    if (overBudget && why !== "LEAVING" && why !== "REFUSE") return;
    outbox.push({ text, why });
  }

  function release(at: number): HostAction[] {
    if (outbox.length === 0 || speaking.size > 0) return [];
    if (at - lastSpeechAt < limits.quietMs || at < busyUntil) return [];
    const next = outbox.shift();
    if (next === undefined) return [];
    spoken += next.text.length;
    remember(next.text, at);
    sayingSince = at;
    // About fifteen characters a second when spoken.
    busyUntil = at + Math.ceil((next.text.length / 15) * 1_000);
    return [{ kind: "SAY", text: next.text, why: next.why }];
  }

  /** Q is leaving: its last short line goes out now, then it goes. */
  function drain(): HostAction[] {
    const lines = outbox.splice(0, outbox.length);
    for (const line of lines) {
      spoken += line.text.length;
      remember(line.text, lastSpeechAt);
    }
    return lines.map((line) => ({
      kind: "SAY",
      text: line.text,
      why: line.why,
    }));
  }

  /** What Q said lately, to recognise its own voice coming back. */
  const recentlySaid: {
    readonly words: ReadonlySet<string>;
    readonly at: number;
  }[] = [];
  function echoesQ(text: string, at: number): boolean {
    while (
      recentlySaid.length > 0 &&
      at - (recentlySaid[0]?.at ?? at) > ECHO_WINDOW_MS
    ) {
      recentlySaid.shift();
    }
    // Content words only (meet-47): "Q, what's this call about?" right
    // after Q's introduction shared "q", "this" and "about" with it and
    // was dropped as Q's own echo; a person's short question is not.
    const words = plain(text)
      .split(" ")
      .filter((w) => w.length > 0 && !ECHO_IGNORED.has(w));
    if (words.length === 0) return false;
    return recentlySaid.some((line) => {
      const shared = words.filter((w) => line.words.has(w)).length;
      return (
        shared / words.length >= 0.6 && shared >= Math.min(3, words.length)
      );
    });
  }
  function remember(text: string, at: number): void {
    recentlySaid.push({
      words: new Set(
        plain(text)
          .split(" ")
          .filter((w) => w.length > 0 && !ECHO_IGNORED.has(w)),
      ),
      at,
    });
    if (recentlySaid.length > 20) recentlySaid.shift();
  }

  function greet(entry: Present): void {
    entry.greeted = true;
    const name =
      entry.party === null ? entry.participant.name : entry.party.name;
    queue(`Hi ${firstName(name)}, welcome. ${HOST_INTRO}`, "GREET");
  }

  function askGuest(entry: Present): void {
    entry.askedIntro = true;
    queue(
      `${firstName(entry.participant.name)}, would you mind introducing yourself: your name, role and organisation?`,
      "ASK_GUEST",
    );
  }

  /** When both sides are in, Q introduces them, from the booking only. */
  function maybeIntroduce(): void {
    if (introduced) return;
    const founders = humans().filter((h) => h.party?.side === "FOUNDER");
    const investors = humans().filter((h) => h.party?.side === "INVESTOR");
    const founder = founders[0]?.party;
    const investor = investors[0]?.party;
    if (
      founder === undefined ||
      founder === null ||
      investor === undefined ||
      investor === null
    ) {
      return;
    }
    introduced = true;
    queue(
      `${firstName(founder.name)}, this is ${investor.name} from ${investor.organisation}. ${firstName(investor.name)}, this is ${founder.name} of ${founder.organisation}. You're meeting about ${context.purpose.replace(/[.\s]+$/, "")}. I'll keep notes; just say "Q" if you need me.`,
      "INTRO",
    );
    for (const guest of humans()) {
      if (guest.party === null && !guest.askedIntro) askGuest(guest);
    }
  }

  /** One side came: say goodbye, report the outcome, and leave. */
  function settleOneSided(reschedule: boolean): HostAction[] {
    const side = oneSide;
    askedAt = null;
    if (side === null) return [];
    queue(
      reschedule
        ? "Thank you. I'll let you know once it's rescheduled. I'll leave you now."
        : "Understood, I won't. I'll leave you now.",
      "LEAVING",
    );
    const out: HostAction[] = drain();
    out.push({
      kind: "OUTCOME",
      outcome: {
        kind: "ONE_SIDED",
        presentSide: side.present,
        absentSide: side.absent,
        presentUserIds: humans().flatMap((h) =>
          h.party !== null && h.party.side === side.present
            ? [h.party.userId]
            : [],
        ),
        reschedule,
      },
    });
    out.push({ kind: "LEAVE", reason: "POLICY", by: null, byUserId: null });
    left = true;
    return out;
  }

  function rosterOf(entry: Present, kind: RosterEntry["kind"]): RosterEntry {
    return {
      participantKey: entry.participant.id,
      callName: entry.participant.name.slice(0, 200),
      kind,
      source: entry.party === null ? "CALL_NAME" : "CAPITAL_Q_IDENTITY",
      userId: entry.party?.userId ?? null,
      side: entry.party?.side ?? null,
      name: entry.party?.name ?? null,
      role: null,
      organisation: entry.party?.organisation ?? null,
    };
  }

  function handle(event: HostEvent): HostAction[] {
    if (left) return [];
    const out: HostAction[] = [];
    switch (event.kind) {
      case "JOIN": {
        if (isBot(event.participant) || present.has(event.participant.id))
          break;
        const entry: Present = {
          participant: event.participant,
          party: matchParty(event.participant, context.parties),
          greeted: false,
          askedIntro: false,
          introducedAs: null,
        };
        present.set(event.participant.id, entry);
        anyoneCame = true;
        // The missing side arrived after all, while Q was asking: carry on.
        if (oneSide !== null && entry.party?.side === oneSide.absent) {
          oneSide = null;
          askedAt = null;
        }
        if (entry.party !== null) sidesSeen.add(entry.party.side);
        out.push({ kind: "ROSTER", entry: rosterOf(entry, "ARRIVED") });
        greet(entry);
        maybeIntroduce();
        // Someone Capital Q cannot place is asked who they are straight
        // away: a guest, or an invited person under another call name.
        if (entry.party === null && !entry.askedIntro) askGuest(entry);
        break;
      }
      case "LEAVE": {
        const entry = present.get(event.participant.id);
        if (entry === undefined) break;
        present.delete(event.participant.id);
        speaking.delete(event.participant.id);
        out.push({ kind: "ROSTER", entry: rosterOf(entry, "LEFT") });
        break;
      }
      case "SPEECH_ON":
        speaking.add(event.participantId);
        // meet-47: someone in the call talks over Q -- it stops at once and
        // drops what it had queued (they can ask again). Only a person who
        // joined counts, and not in Q's first moment on a line, when its
        // own voice coming back through someone's microphone starts.
        if (
          present.has(event.participantId) &&
          event.at < busyUntil &&
          event.at - sayingSince >= INTERRUPT_GRACE_MS
        ) {
          busyUntil = event.at;
          const keep = outbox.filter((line) => line.why === "LEAVING");
          outbox.splice(0, outbox.length, ...keep);
          out.push({ kind: "STOP_SPEAKING" });
        }
        break;
      case "SPEECH_OFF":
        speaking.delete(event.participantId);
        lastSpeechAt = Math.max(lastSpeechAt, event.at);
        break;
      case "UTTERANCE": {
        if (isBot(event.participant)) break;
        lastSpeechAt = Math.max(lastSpeechAt, event.at);
        const text = event.text.trim().slice(0, 2_000);
        if (text.length === 0) break;
        const entry = present.get(event.participant.id);
        // Never Q's own speech (live 2026-10-02, cfccb9a9: the captions
        // gave Q's greeting to an "Unknown" speaker and Q obeyed itself).
        // Only people who joined are heard, and nothing that repeats what
        // Q just said (its voice echoed through someone's microphone).
        if (entry === undefined || echoesQ(text, event.at)) break;
        if (askedAt !== null && oneSide !== null) {
          out.push(...settleOneSided(!saysNeverMind(text)));
          return out;
        }
        if (
          entry?.askedIntro === true &&
          entry.introducedAs === null &&
          !addressedToQ(text)
        ) {
          // Their own words, read once for name, role and organisation.
          entry.introducedAs = "";
          if (calls < limits.maxModelCalls) {
            calls += 1;
            out.push({
              kind: "READ_GUEST",
              participant: entry.participant,
              text,
            });
          }
          break;
        }
        if (!addressedToQ(text)) break;
        if (asksQToBreakRules(text)) {
          queue(HOST_REFUSAL, "REFUSE");
          break;
        }
        if (composing) break;
        if (calls >= limits.maxModelCalls) {
          queue(HOST_UNAVAILABLE, "REPLY");
          break;
        }
        calls += 1;
        composing = true;
        out.push({
          kind: "COMPOSE",
          speaker:
            entry?.party?.name ??
            (entry?.introducedAs ? entry.introducedAs : event.participant.name),
          utterance: text,
        });
        break;
      }
      case "TICK": {
        // The hard cap: whatever was said, Q goes.
        if (event.at >= start + policy.hardCapAfterStartMs) {
          outbox.length = 0;
          if (present.size > 0) queue(HOST_AT_TIME, "LEAVING");
          out.push(...drain());
          out.push({
            kind: "LEAVE",
            reason: "POLICY",
            by: null,
            byUserId: null,
          });
          left = true;
          return out;
        }
        if (!resolved && event.at >= start + policy.graceAfterStartMs) {
          resolved = true;
          const both = sidesSeen.has("FOUNDER") && sidesSeen.has("INVESTOR");
          if (!anyoneCame) {
            // Nobody came: Q leaves; the runtime cancels and tells both.
            out.push({ kind: "OUTCOME", outcome: { kind: "NO_SHOW" } });
            out.push({
              kind: "LEAVE",
              reason: "POLICY",
              by: null,
              byUserId: null,
            });
            left = true;
            return out;
          }
          if (!both && sidesSeen.size === 1) {
            const presentSide = [...sidesSeen][0] ?? "FOUNDER";
            oneSide = {
              present: presentSide,
              absent: presentSide === "FOUNDER" ? "INVESTOR" : "FOUNDER",
            };
            const missing = context.parties
              .filter((p) => p.side === oneSide?.absent)
              .map((p) => firstName(p.name));
            const who =
              missing.length === 0 ? "the other side" : missing.join(" and ");
            if (present.size > 0) {
              askedAt = event.at;
              queue(
                `I'm sorry, ${who} hasn't joined. I'll reach out to them to find a new time. Shall I let you know once it's rescheduled?`,
                "ONE_SIDED",
              );
            } else {
              out.push(...settleOneSided(true));
              return out;
            }
          }
        }
        // No answer to "shall I let you know?": taken as a yes, and Q goes.
        if (askedAt !== null && event.at - askedAt >= policy.answerWaitMs) {
          out.push(...settleOneSided(true));
          return out;
        }
        const toEnd = context.endsAt.getTime() - event.at;
        if (
          !offeredRecap &&
          introduced &&
          toEnd <= limits.offerRecapBeforeEndMs &&
          toEnd > -limits.offerRecapBeforeEndMs &&
          present.size >= 2
        ) {
          offeredRecap = true;
          queue(
            'We\'re close to time. Would you like me to recap what was agreed and the next steps? Just say "Q, recap".',
            "OFFER_RECAP",
          );
        }
        break;
      }
    }
    out.push(...release(event.at));
    return out;
  }

  return {
    handle,
    reply: (text, why = "REPLY") => {
      composing = false;
      const line = text.trim();
      if (line.length > 0) queue(line.slice(0, 600), why);
    },
    guestIntroduced: (participantId, intro) => {
      const entry = present.get(participantId);
      if (entry === undefined) return [];
      entry.introducedAs = intro.name ?? entry.participant.name;
      // Their call name was not their Capital Q name (a Google account
      // called something else): the name they gave may be an invited
      // person's. Then they are that person, and the introductions follow.
      const invited =
        intro.name === null
          ? null
          : matchParty(
              { id: participantId, name: intro.name, email: null },
              context.parties,
            );
      const taken = humans().some(
        (h) => h !== entry && h.party?.userId === invited?.userId,
      );
      if (invited !== null && !taken) {
        entry.party = invited;
        sidesSeen.add(invited.side);
        maybeIntroduce();
        return [{ kind: "ROSTER", entry: rosterOf(entry, "INTRODUCED") }];
      }
      return [
        {
          kind: "ROSTER",
          entry: {
            participantKey: entry.participant.id,
            callName: entry.participant.name.slice(0, 200),
            kind: "INTRODUCED",
            source: "SELF_INTRODUCTION",
            userId: null,
            side: null,
            name: intro.name?.slice(0, 200) ?? null,
            role: intro.role?.slice(0, 200) ?? null,
            organisation: intro.organisation?.slice(0, 200) ?? null,
          },
        },
      ];
    },
    leaveRequested: (byName, byUserId) => {
      composing = false;
      queue(HOST_STAYS, "REPLY");
      return [
        { kind: "LEAVE_REQUESTED", byName: byName.slice(0, 200), byUserId },
      ];
    },
    quiet: () => {
      composing = false;
      quiet = true;
      // Lines still waiting that nobody asked for are dropped.
      for (let i = outbox.length - 1; i >= 0; i -= 1) {
        const why = outbox[i]?.why;
        if (why !== "REPLY" && why !== "REFUSE" && why !== "LEAVING")
          outbox.splice(i, 1);
      }
    },
    userIdOf: (name) =>
      humans().find(
        (h) =>
          h.party !== null &&
          (h.party.name === name || h.introducedAs === name),
      )?.party?.userId ?? null,
    phase: () => {
      if (left) return "LEFT";
      if (present.size === 0) return "WAITING";
      if (composing) return "ADDRESSED";
      if (oneSide !== null) return "ONE_SIDED";
      if (offeredRecap) return "CLOSING";
      if (humans().some((h) => !h.greeted)) return "GREETING";
      if (!introduced) return "INTROS";
      return "LISTENING";
    },
    spentChars: () => spoken,
    modelCalls: () => calls,
    roster: () =>
      humans().map((h) => ({
        name: h.party?.name ?? h.introducedAs ?? h.participant.name,
        side: h.party?.side ?? null,
        organisation: h.party?.organisation ?? null,
        role: null,
      })),
  };
}
