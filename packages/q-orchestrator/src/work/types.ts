import { z } from "zod";

/**
 * Q's delegated work (ADR 0029): the Capital Q types the engine speaks.
 *
 * The engine is a deterministic state machine. It decides nothing about
 * authority: every port that acts re-resolves the person's own actor
 * context and runs the command their own button runs. Models write words
 * behind the ports; code decides what happens next.
 */

/** When the person takes calls, in their own calendar zone. */
export const CallWindowSchema = z
  .object({
    /** ISO weekdays, 1 = Monday … 7 = Sunday. */
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .strict()
  .refine((window) => window.endHour > window.startHour, {
    message: "a window ends after it starts",
  });
export type CallWindow = z.infer<typeof CallWindowSchema>;

/** The investor's approved outreach plan: the grant, exactly as approved. */
export const OutreachGrantSchema = z
  .object({
    maxCompanies: z.number().int().min(1).max(10),
    /** Posted, marked as from Q, once a founder accepts. */
    openingMessage: z.string().trim().min(10).max(1_200),
    /** Everything Q may tell founders. Null: Q answers nothing itself. */
    brief: z.string().trim().min(20).max(2_000).nullable(),
    /** What Q should learn from each founder for the investor. */
    topics: z.array(z.string().trim().min(3).max(200)).max(6),
    /** A first-stage interview in the chat, question by question. */
    interview: z
      .object({
        questions: z.array(z.string().trim().min(5).max(400)).min(1).max(8),
      })
      .strict()
      .nullable(),
    call: z
      .object({
        purpose: z.string().trim().min(3).max(200),
        durationMinutes: z.number().int().min(15).max(120),
        windows: z.array(CallWindowSchema).min(1).max(7),
        /** Q may book the first free time inside a window without asking. */
        mayBookInWindows: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type OutreachGrant = z.infer<typeof OutreachGrantSchema>;

/** The founder's approved stand-in: the brief is the Context Firewall. */
export const StandInGrantSchema = z
  .object({
    brief: z.string().trim().min(20).max(3_000),
    /** Q steps in after this long without the founder on Capital Q. */
    awayAfterMinutes: z.number().int().min(10).max(1_440),
  })
  .strict();
export type StandInGrant = z.infer<typeof StandInGrantSchema>;

export type DelegationRef = {
  readonly delegationId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly principalName: string;
  readonly threadId: string;
};

/** Q-to-Q protocol envelope (cq.q2q/1). */
export const Q2Q_INTENTS = [
  "ASK",
  "ANSWER",
  "DEFER",
  "INFO",
  "HANDBACK",
] as const;
export type Q2QIntent = (typeof Q2Q_INTENTS)[number];
export const QEnvelopeSchema = z
  .object({
    protocol: z.literal("cq.q2q/1"),
    side: z.enum(["INVESTOR", "COMPANY"]),
    intent: z.enum(Q2Q_INTENTS),
  })
  .strict();
export type QEnvelope = z.infer<typeof QEnvelopeSchema>;

/** At most this many Q-to-Q messages per relationship per day. */
export const Q2Q_DAILY_CAP = 6;

export type ObservedMessage = {
  readonly id: string;
  readonly at: string;
  readonly from: "OTHER_SIDE" | "OWN_SIDE";
  readonly senderName: string;
  readonly text: string | null;
  /** Set when the message was sent by a Q (either side's). */
  readonly envelope: QEnvelope | null;
  readonly viaQ: boolean;
};

/** What the person said about a lane: chosen in the panel or to any Q. */
export const PersonAnswerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("BOOK_AT"),
      id: z.string().min(8).max(100),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({ kind: z.literal("PASS"), id: z.string().min(8).max(100) })
    .strict(),
]);
export type PersonAnswer = z.infer<typeof PersonAnswerSchema>;

export type LaneObservation = {
  readonly now: string;
  /** The delegation (and this lane) may still act. */
  readonly status: "ACTIVE" | "STOPPED" | "EXPIRED";
  /** LOST: the person's access changed; BLOCKED: messaging is blocked. */
  readonly access: "OK" | "LOST" | "BLOCKED";
  readonly relationshipId: string | null;
  /** The person's own chat page for this relationship. */
  readonly chatPath: string | null;
  readonly connected: boolean;
  readonly declined: boolean;
  /** The latest messages, oldest first. */
  readonly messages: readonly ObservedMessage[];
  /** Q-to-Q messages on this relationship in the last 24 hours. */
  readonly q2qLastDay: number;
  readonly answer: PersonAnswer | null;
};

export type StandInThread = {
  readonly relationshipId: string;
  readonly counterpartName: string;
  readonly chatPath: string;
  readonly messages: readonly ObservedMessage[];
  readonly q2qLastDay: number;
};

export type StandInObservation = {
  readonly now: string;
  readonly status: "ACTIVE" | "STOPPED" | "EXPIRED";
  readonly access: "OK" | "LOST";
  /** The founder is away (no heartbeat for the threshold, or Away on). */
  readonly away: boolean;
  readonly threads: readonly StandInThread[];
};

export type Candidate = {
  readonly companyId: string;
  readonly name: string;
  /** What the investor may see, labelled by source, bounded. */
  readonly material: string;
};

export type ShortlistPick = {
  readonly companyId: string;
  readonly name: string;
  readonly reasons: readonly {
    readonly reason: string;
    readonly quote: string;
  }[];
};

export type Slot = { readonly start: string; readonly label: string };

export type LanePatch = {
  readonly stage?: LaneStage;
  readonly relationshipId?: string;
  readonly lastStep?: string;
  readonly learned?: readonly { topic: string; words: string }[];
  readonly interview?: readonly { question: string; answer: string }[];
  readonly needs?: { kind: "TIMES"; offered: readonly Slot[] } | null;
  readonly meetingId?: string;
  readonly repliesSent?: number;
};

export const LANE_STAGES = [
  "SHORTLISTED",
  "WAITING_ACCEPTANCE",
  "CHATTING",
  "INTERVIEWING",
  "REPORT_READY",
  "NEEDS_TIMES",
  "CALL_BOOKED",
  "STANDING_IN",
  "DECLINED",
  "DONE",
  "STOPPED",
  "FAILED",
] as const;
export type LaneStage = (typeof LANE_STAGES)[number];

export type Notice = {
  readonly key: string;
  readonly title: string;
  readonly body: string | null;
  readonly link: string | null;
  readonly priority: "NEEDS_YOU" | "UPDATE";
};

export type ConverseInput = {
  readonly principalName: string;
  readonly counterpartName: string;
  readonly brief: string | null;
  readonly topicsOpen: readonly string[];
  readonly thread: string;
  readonly otherSideIsQ: boolean;
};
export type ConverseResult = {
  readonly reply: string | null;
  readonly learned: readonly { topic: string; words: string }[];
  readonly forPerson: readonly string[];
  /** They asked for a call, or nothing is left to learn. */
  readonly ready: boolean;
};

export type InterviewTurnInput = {
  readonly principalName: string;
  readonly counterpartName: string;
  readonly question: string;
  readonly answerSoFar: string;
  readonly followUpAllowed: boolean;
};
export type InterviewTurnResult = {
  readonly answered: boolean;
  /** Their answer, in their own words, condensed. */
  readonly answer: string | null;
  readonly followUp: string | null;
};

export type StandInReplyInput = {
  readonly principalName: string;
  readonly counterpartName: string;
  readonly brief: string;
  readonly thread: string;
  readonly otherSideIsQ: boolean;
};
export type StandInReplyResult = {
  readonly reply: string | null;
  readonly deferred: boolean;
  readonly forPerson: readonly string[];
};

/**
 * Everything the engine may do in the world, behind Capital Q ports. Each
 * acting port resolves the person's actor context afresh and is idempotent
 * on the key it is given.
 */
export type QWorkPorts = {
  readonly step: (
    ref: DelegationRef,
    laneId: string | null,
    key: string,
    words: string,
  ) => Promise<void>;
  readonly notify: (ref: DelegationRef, notice: Notice) => Promise<void>;
  readonly finishDelegation: (
    ref: DelegationRef,
    status: "DONE" | "STOPPED" | "FAILED" | "EXPIRED",
    summary: string,
  ) => Promise<void>;
  readonly summarise: (ref: DelegationRef, summary: string) => Promise<void>;
  readonly updateLane: (laneId: string, patch: LanePatch) => Promise<void>;

  // Outreach
  readonly source: (ref: DelegationRef) => Promise<readonly Candidate[]>;
  readonly shortlist: (
    ref: DelegationRef,
    grant: OutreachGrant,
    candidates: readonly Candidate[],
  ) => Promise<readonly ShortlistPick[] | null>;
  readonly expressInterest: (
    ref: DelegationRef,
    companyId: string,
  ) => Promise<
    | { readonly outcome: "OK"; readonly relationshipId: string }
    | { readonly outcome: "REFUSED"; readonly code: string }
  >;
  readonly openLane: (
    ref: DelegationRef,
    lane: {
      readonly companyId: string | null;
      readonly relationshipId: string | null;
      readonly counterpartName: string;
      readonly stage: LaneStage;
      readonly reasons: ShortlistPick["reasons"];
    },
  ) => Promise<string>;
  readonly post: (
    ref: DelegationRef,
    relationshipId: string,
    key: string,
    body: string,
    envelope: QEnvelope | null,
  ) => Promise<boolean>;
  readonly converse: (
    ref: DelegationRef,
    input: ConverseInput,
  ) => Promise<ConverseResult | null>;
  readonly interviewTurn: (
    ref: DelegationRef,
    input: InterviewTurnInput,
  ) => Promise<InterviewTurnResult | null>;
  readonly report: (
    ref: DelegationRef,
    input: {
      readonly laneId: string;
      readonly counterpartName: string;
      readonly reasons: ShortlistPick["reasons"];
      readonly learned: readonly { topic: string; words: string }[];
      readonly interview: readonly { question: string; answer: string }[];
      readonly transcript: string;
    },
  ) => Promise<{
    readonly recommendation: "PROCEED" | "MAYBE" | "PASS";
    readonly headline: string;
    /** Where the person reads it (same-origin; the PDF is one tap on). */
    readonly path: string;
  } | null>;
  readonly slots: (
    ref: DelegationRef,
    relationshipId: string,
    call: NonNullable<OutreachGrant["call"]>,
  ) => Promise<
    | { readonly outcome: "OK"; readonly slots: readonly Slot[] }
    | { readonly outcome: "REFUSED"; readonly code: string }
  >;
  readonly book: (
    ref: DelegationRef,
    relationshipId: string,
    input: {
      readonly key: string;
      readonly at: string;
      readonly purpose: string;
      readonly durationMinutes: number;
    },
  ) => Promise<
    | {
        readonly outcome: "OK";
        readonly meetingId: string;
        readonly when: string;
        readonly meetLink: string | null;
      }
    | { readonly outcome: "REFUSED"; readonly code: string }
  >;

  // Stand-in
  readonly standInReply: (
    ref: DelegationRef,
    input: StandInReplyInput,
  ) => Promise<StandInReplyResult | null>;
  readonly standInLane: (
    ref: DelegationRef,
    relationshipId: string,
    counterpartName: string,
  ) => Promise<string>;
};

/** Where the person follows the work. Same-origin, never external. */
export const workPath = (delegationId: string) => `/work/${delegationId}`;
