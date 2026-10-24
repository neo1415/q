import { z } from "zod";

import {
  transitionProposal,
  type ProposalAction,
  type ProposalOutcome,
  type ProposalRecord,
  type ProposalRefusal,
  type ProposalSide,
} from "@capital-q/communication";
import {
  AcceptMeetingTimeRequestSchema,
  CounterMeetingTimeRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  MEETING_PROPOSAL_ACCEPT_PATH,
  MEETING_PROPOSAL_COUNTER_PATH,
  MEETING_PROPOSAL_DECLINE_PATH,
  MeetingTimeOptionSchema,
  MeetingTimeProposalDtoSchema,
  MeetingTimeProposalListSchema,
  ProposeMeetingTimeRequestSchema,
  RELATIONSHIP_MEETING_PROPOSALS_PATH,
  RELATIONSHIP_MEETING_PROPOSALS_REVIEW_PATH,
  type KnownErrorCode,
  type MeetingTimeProposalDto,
} from "@capital-q/contracts";

import {
  defineAppAction,
  readyToSendLine,
  portMissing,
  refusal,
  relationshipTarget,
  type AnyAppAction,
  type AppActionContext,
  type AppActionVerdict,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Meeting time proposals (D, 2026-10-11), declared once: the route and the Q
 * tool are generated from each declaration.
 *
 * A time is a PROPOSAL until the investor, or a party authorised for them,
 * explicitly accepts it. Silence never accepts; a time said in a call is a
 * proposal too (the meeting brain records it as PROPOSED and nothing more).
 * Only the founder proposes; only the investor accepts, declines or counters
 * a proposal (and only the founder answers a counter). Each action's
 * authorize step derives the actor's side from their active membership and
 * asks the proposal state machine whether that side may take that step; the
 * service then checks it again. Every call carries an idempotency key, and
 * Q's path to a consequential step is a card the person approves: Q never
 * accepts for the investor.
 */

const proposals = (ports: AppActionPorts) =>
  ports.proposals ?? portMissing("proposals");

const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

const REFUSALS: Readonly<
  Record<
    ProposalRefusal,
    { readonly code: KnownErrorCode; readonly detail: string }
  >
> = {
  NOT_A_PARTY: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_AUTHORISED: {
    code: "PERMISSION_DENIED",
    detail: "You can't speak for your side on this.",
  },
  ROLE_NOT_ALLOWED: {
    code: "PERMISSION_DENIED",
    detail: "That step belongs to the other side.",
  },
  INVALID_STATE: {
    code: "RESOURCE_CONFLICT",
    detail: "That proposal has moved on. Look at it again.",
  },
  INVALID_OPTIONS: {
    code: "VALIDATION_FAILED",
    detail: "Choose times in the future, each no longer than eight hours.",
  },
  INVALID_OPTION_INDEX: {
    code: "VALIDATION_FAILED",
    detail: "Choose one of the times offered.",
  },
  TOO_MANY_REVISIONS: {
    code: "RESOURCE_CONFLICT",
    detail: "This has been revised too many times. Start a new proposal.",
  },
  CONFLICT: {
    code: "RESOURCE_CONFLICT",
    detail: "Someone just changed this. Look at it again.",
  },
};

type Listed =
  | { readonly outcome: "OK"; readonly proposals: readonly ProposalRecord[] }
  | { readonly outcome: "REFUSED"; readonly reason: ProposalRefusal };

export function proposalProblem(
  out: ProposalOutcome | Listed,
): { readonly code: KnownErrorCode; readonly detail: string } | null {
  return out.outcome === "OK" ? null : REFUSALS[out.reason];
}

export function proposalDto(record: ProposalRecord): MeetingTimeProposalDto {
  return MeetingTimeProposalDtoSchema.parse({
    id: record.id,
    relationshipId: record.relationshipId,
    purpose: record.purpose,
    state: record.state,
    options: record.options,
    counterOptions: record.counterOptions,
    // Confirmed means exactly one thing: an authorised acceptance is recorded.
    confirmed: record.state === "CONFIRMED" && record.acceptedAt !== null,
    acceptedOption: record.acceptedOption,
    acceptedAt: record.acceptedAt?.toISOString() ?? null,
    meetingId: record.meetingId,
    revision: record.revision,
  });
}

const when = (option: { startsAt: string; timeZone: string }): string =>
  `${option.startsAt} (${option.timeZone})`;

/** The actor's side on this relationship, from membership; null: not a party. */
async function sideOf(
  ports: AppActionPorts,
  context: AppActionContext,
  relationshipId: string,
): Promise<{ side: ProposalSide; binds: boolean } | null> {
  const party = await proposals(ports).party({
    actorUserId: context.actor.userId,
    relationshipId,
  });
  return party === null ? null : { side: party.side, binds: party.binds };
}

const denied = (reason: string): AppActionVerdict => ({ ok: false, reason });

async function proposalFor(
  ports: AppActionPorts,
  context: AppActionContext,
  relationshipId: string,
  proposalId: string,
): Promise<ProposalRecord | null> {
  const listed = await proposals(ports)
    .forActor(context.actor, context.correlationId)
    .list({ actorUserId: context.actor.userId, relationshipId });
  return listed.outcome === "OK"
    ? (listed.proposals.find((p) => p.id === proposalId) ?? null)
    : null;
}

/** The step a side takes on a state, or null when the machine allows none. */
function stepFor(
  record: ProposalRecord,
  side: ProposalSide,
  step: "ACCEPT" | "DECLINE" | "COUNTER",
): ProposalAction | null {
  const action: ProposalAction =
    step === "COUNTER"
      ? "COUNTER"
      : record.state === "COUNTERPROPOSED"
        ? step === "ACCEPT"
          ? "ACCEPT_COUNTER"
          : "DECLINE_COUNTER"
        : step;
  return transitionProposal(record.state, side, action).ok ? action : null;
}

/** The authorize step of every response: a party, who may bind, whose turn it is. */
function authoriseStep(step: "ACCEPT" | "DECLINE" | "COUNTER") {
  return async (
    ports: AppActionPorts,
    context: AppActionContext,
    input: { relationshipId: string; proposalId: string },
  ): Promise<AppActionVerdict> => {
    const party = await sideOf(ports, context, input.relationshipId);
    if (party === null) return denied("That isn't one of your relationships.");
    if (!party.binds) {
      return denied("You can't speak for your side on this meeting time.");
    }
    const record = await proposalFor(
      ports,
      context,
      input.relationshipId,
      input.proposalId,
    );
    if (record === null) return denied("I can't find that proposal.");
    // On the screen the service's own answer decides, so a retry of a step
    // already recorded reaches its idempotent replay; Q never prepares a
    // card for a step that is not this person's to take.
    if (context.surface !== "Q") return { ok: true };
    return stepFor(record, party.side, step) === null
      ? denied(
          party.side === "FOUNDER" && record.state !== "COUNTERPROPOSED"
            ? "Only the investor accepts, declines or counters a proposed time."
            : "That proposal isn't waiting on you.",
        )
      : { ok: true };
  };
}

// ---------------------------------------------------------------------------
// propose
// ---------------------------------------------------------------------------

const Propose = z
  .object({
    relationshipId: z.string().max(64),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: ProposeMeetingTimeRequestSchema,
  })
  .strict();

const ProposeTool = z
  .object({
    relationship: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "Who the call is with: the investor, as the person named them.",
      ),
    purpose: z.string().min(1).max(500),
    options: z.array(MeetingTimeOptionSchema).min(1).max(5),
  })
  .strict();

const PROPOSE = defineAppAction<
  z.infer<typeof Propose>,
  ProposalOutcome,
  z.infer<typeof ProposeTool>
>({
  name: "schedule.proposal.propose",
  // ADR 0043: a call time binds both sides; never Q's alone, always an explicit yes.
  consequence: "COMMITMENT",
  short: "propose call times",
  area: "schedule",
  classification: "CONSEQUENTIAL",
  does: "Proposes one to five call times to the investor on a relationship. Nothing is booked: the time is confirmed only when the investor explicitly accepts one.",
  input: Propose,
  output: z.custom<ProposalOutcome>(),
  authorize: async (ports, context, input) => {
    const party = await sideOf(ports, context, input.relationshipId);
    if (party === null) return denied("That isn't one of your relationships.");
    if (party.side !== "FOUNDER") {
      return denied(
        "The company side proposes call times; the investor responds.",
      );
    }
    return party.binds
      ? { ok: true }
      : denied("You can't speak for your side on this meeting time.");
  },
  run: (ports, context, input) =>
    proposals(ports)
      .forActor(context.actor, context.correlationId)
      .propose({
        actorUserId: context.actor.userId,
        relationshipId: input.relationshipId,
        purpose: input.input.purpose,
        options: input.input.options,
        rescheduleOfMeetingId: input.input.rescheduleOfMeetingId ?? null,
        // Scoped to the person, so two people's keys never collide.
        idempotencyKey: `web:${context.actor.userId}:${input.idempotencyKey}`,
      }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input, names) => ({
    summary:
      names?.counterpart == null
        ? "Propose call times"
        : `Propose call times to ${names.counterpart}`,
    preview: `${input.input.purpose}\n${input.input.options.map(when).join("\n")}\nNothing is booked until they accept one.`,
  }),
  succeeded: (out) => out.outcome === "OK",
  done: (out) =>
    out.outcome === "OK"
      ? "Sent as a proposal. It's confirmed only when they accept one of the times."
      : REFUSALS[out.reason].detail,
  http: {
    method: "POST",
    path: RELATIONSHIP_MEETING_PROPOSALS_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    problem: proposalProblem,
    status: (out) => (out.outcome === "OK" && !out.recorded ? 200 : 201),
    respond: (out) =>
      out.outcome === "OK" ? proposalDto(out.proposal) : undefined,
  },
  tool: {
    name: "propose_meeting_time",
    description:
      'Use when the founder wants to suggest times for a call with an investor ("suggest Tuesday 3pm or Wednesday 10am to Khalid"). Prepares a proposal of one to five concrete times (ISO start and end, IANA time zone) for their approval. Nothing is booked: the investor must explicitly accept a time. Never use it to say a time is confirmed.',
    input: ProposeTool,
    references: { relationship: "RELATIONSHIP" },
    purposes: ["GENERAL_QUESTION"],
    eval: {
      say: [
        "Propose Tuesday 3pm London time to {name} for an intro call",
        "Offer {name} two times next week for a call",
      ],
      names: "RELATIONSHIP",
    },
    toCanonical: (tool, context) =>
      Promise.resolve({
        relationshipId: tool.relationship,
        idempotencyKey: context.idempotencyKey,
        input: { purpose: tool.purpose, options: tool.options },
      }),
  },
});

// ---------------------------------------------------------------------------
// review (a read by POST)
// ---------------------------------------------------------------------------

const Review = z.object({ relationshipId: z.string().max(64) }).strict();
const ReviewTool = z
  .object({ relationship: z.string().min(1).max(200) })
  .strict();

const REVIEW = defineAppAction<
  z.infer<typeof Review>,
  Listed,
  z.infer<typeof ReviewTool>
>({
  name: "schedule.proposal.review",
  short: "review call-time proposals",
  area: "schedule",
  classification: "READ",
  does: "Reads the call times proposed on a relationship, where each stands, and whether any is confirmed.",
  input: Review,
  output: z.custom<Listed>(),
  authorize: async (ports, context, input) =>
    (await sideOf(ports, context, input.relationshipId)) === null
      ? denied("That isn't one of your relationships.")
      : { ok: true },
  run: (ports, context, input) =>
    proposals(ports).forActor(context.actor, context.correlationId).list({
      actorUserId: context.actor.userId,
      relationshipId: input.relationshipId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: () => ({ summary: "Review proposed call times", preview: "" }),
  done: (out) => {
    if (out.outcome !== "OK") return REFUSALS[out.reason].detail;
    if (out.proposals.length === 0) return "No call times have been proposed.";
    return out.proposals
      .slice(0, 5)
      .map((p) => {
        const dto = proposalDto(p);
        const first = (dto.counterOptions ?? dto.options)[0];
        return `${dto.confirmed ? "Confirmed" : dto.state === "COUNTERPROPOSED" ? "Counter-proposed" : dto.state === "DECLINED" ? "Declined" : "Proposed, not confirmed"}: ${dto.purpose}${first === undefined ? "" : `, ${first.startsAt} (${first.timeZone})`} [${dto.id}]`;
      })
      .join("\n");
  },
  http: {
    method: "POST",
    path: RELATIONSHIP_MEETING_PROPOSALS_REVIEW_PATH,
    fromRequest: (params) => ({ relationshipId: params["relationshipId"] }),
    problem: proposalProblem,
    status: 200,
    respond: (out) =>
      out.outcome === "OK"
        ? MeetingTimeProposalListSchema.parse({
            proposals: out.proposals.map(proposalDto),
          })
        : undefined,
  },
  tool: {
    name: "review_meeting_proposals",
    description:
      'Reads the call times proposed on one relationship and where each stands: proposed, counter-proposed, declined or confirmed. A time is confirmed only when it says so; a proposed time is not a booking. Use for "did they accept Tuesday?" or "what times are on the table with Khalid?".',
    input: ReviewTool,
    references: { relationship: "RELATIONSHIP" },
    purposes: ["GENERAL_QUESTION", "RELATIONSHIP_QUESTION"],
    eval: {
      say: [
        "Did {name} accept a time for our call?",
        "What call times are proposed with {name}?",
      ],
      names: "RELATIONSHIP",
    },
    toCanonical: (tool) =>
      Promise.resolve({ relationshipId: tool.relationship }),
  },
});

// ---------------------------------------------------------------------------
// accept / decline / counter
// ---------------------------------------------------------------------------

const Respond = z.object({
  relationshipId: z.string().max(64),
  proposalId: z.string().max(64),
  idempotencyKey: IdempotencyKeyHeaderSchema,
});

const AcceptInput = Respond.extend({
  input: AcceptMeetingTimeRequestSchema,
}).strict();
const DeclineInput = Respond.strict();
const CounterInput = Respond.extend({
  input: CounterMeetingTimeRequestSchema,
}).strict();

const ProposalTool = z.object({
  relationship: z.string().min(1).max(200),
  proposalId: z
    .string()
    .min(1)
    .max(64)
    .describe("The id review_meeting_proposals gave."),
});

const respondKey = (context: AppActionContext, key: string) =>
  `web:${context.actor.userId}:${key}`;

const respondHttp = <In extends { relationshipId: string }>(
  path: string,
  fromBody: boolean,
) => ({
  method: "POST" as const,
  path,
  fromRequest: (
    params: Record<string, string>,
    body: unknown,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ) => ({
    relationshipId: params["relationshipId"],
    proposalId: params["proposalId"],
    idempotencyKey: keyOf(headers),
    ...(fromBody ? { input: body } : {}),
  }),
  problem: proposalProblem,
  status: 200 as const,
  respond: (out: ProposalOutcome, _input: In) =>
    out.outcome === "OK" ? proposalDto(out.proposal) : undefined,
});

const ACCEPT = defineAppAction<
  z.infer<typeof AcceptInput>,
  ProposalOutcome,
  z.infer<typeof ProposalTool> & { startsAt: string }
>({
  name: "schedule.proposal.accept",
  // ADR 0043: a call time binds both sides; never Q's alone, always an explicit yes.
  consequence: "COMMITMENT",
  short: "accept a call time",
  area: "schedule",
  classification: "CONSEQUENTIAL",
  does: "Accepts one of the proposed call times. Only this explicit acceptance, by the investor (or a party authorised for them), confirms the time; the call is then booked through the schedule.",
  input: AcceptInput,
  output: z.custom<ProposalOutcome>(),
  authorize: authoriseStep("ACCEPT"),
  run: async (ports, context, input) => {
    const service = proposals(ports).forActor(
      context.actor,
      context.correlationId,
    );
    const record = await proposalFor(
      ports,
      context,
      input.relationshipId,
      input.proposalId,
    );
    const party = await sideOf(ports, context, input.relationshipId);
    if (record === null || party === null) {
      return { outcome: "REFUSED", reason: "NOT_FOUND" } as const;
    }
    // No step now: let the service answer (a replay of a recorded key, or
    // its own refusal), never decide here that nothing happened.
    const action = stepFor(record, party.side, "ACCEPT") ?? "ACCEPT";
    return service.respond({
      actorUserId: context.actor.userId,
      proposalId: input.proposalId,
      action: action as Exclude<ProposalAction, "SEND_FOR_REVIEW">,
      optionIndex: input.input.optionIndex,
      idempotencyKey: respondKey(context, input.idempotencyKey),
    });
  },
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input, names) => ({
    summary:
      names?.counterpart == null
        ? "Accept this call time"
        : `Accept this call time with ${names.counterpart}`,
    preview: `Time ${String(input.input.optionIndex + 1)} of those proposed. Accepting confirms it for both sides.`,
  }),
  proposed: (_input, summary) => readyToSendLine(summary, null),
  succeeded: (out) => out.outcome === "OK",
  done: (out) =>
    out.outcome !== "OK"
      ? REFUSALS[out.reason].detail
      : out.booked
        ? "Accepted and booked. Both sides have the invite."
        : "Accepted. The call isn't booked yet; I'll say once it is.",
  http: respondHttp(MEETING_PROPOSAL_ACCEPT_PATH, true),
  tool: {
    name: "accept_meeting_time",
    description:
      "Use only when the person themselves says they accept a proposed call time. Prepares the acceptance for their approval; it confirms the time only once they approve. Never use it for anyone else, on silence, or on a guess. Give the exact start time of the option they accept, as review_meeting_proposals shows it.",
    input: ProposalTool.extend({
      startsAt: z
        .string()
        .min(1)
        .max(40)
        .describe("The accepted option's exact ISO start time."),
    }).strict(),
    references: { relationship: "RELATIONSHIP" },
    purposes: ["GENERAL_QUESTION"],
    eval: {
      say: [
        "Yes, accept the Tuesday time with {name}",
        "I accept the time {name} proposed",
      ],
      names: "RELATIONSHIP",
      orSays: "no call times|nothing proposed|can't find",
    },
    toCanonical: async (tool, context, ports) => {
      const record = await proposalFor(
        ports,
        context,
        tool.relationship,
        tool.proposalId,
      );
      if (record === null) return refusal("I can't find that proposal.");
      const pool =
        record.state === "COUNTERPROPOSED"
          ? (record.counterOptions ?? [])
          : record.options;
      const index = pool.findIndex(
        (option) => Date.parse(option.startsAt) === Date.parse(tool.startsAt),
      );
      return index < 0
        ? refusal("That time isn't one of those proposed.")
        : {
            relationshipId: tool.relationship,
            proposalId: tool.proposalId,
            idempotencyKey: context.idempotencyKey,
            input: { optionIndex: index },
          };
    },
  },
});

const DECLINE = defineAppAction<
  z.infer<typeof DeclineInput>,
  ProposalOutcome,
  z.infer<typeof ProposalTool>
>({
  name: "schedule.proposal.decline",
  short: "decline call times",
  area: "schedule",
  classification: "CONSEQUENTIAL",
  does: "Declines the proposed call times. Nothing is booked; the other side is told.",
  input: DeclineInput,
  output: z.custom<ProposalOutcome>(),
  authorize: authoriseStep("DECLINE"),
  run: async (ports, context, input) => {
    const record = await proposalFor(
      ports,
      context,
      input.relationshipId,
      input.proposalId,
    );
    const party = await sideOf(ports, context, input.relationshipId);
    if (record === null || party === null) {
      return { outcome: "REFUSED", reason: "NOT_FOUND" } as const;
    }
    const action = stepFor(record, party.side, "DECLINE") ?? "DECLINE";
    return proposals(ports)
      .forActor(context.actor, context.correlationId)
      .respond({
        actorUserId: context.actor.userId,
        proposalId: input.proposalId,
        action: action as Exclude<ProposalAction, "SEND_FOR_REVIEW">,
        idempotencyKey: respondKey(context, input.idempotencyKey),
      });
  },
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (_input, names) => ({
    summary:
      names?.counterpart == null
        ? "Decline these call times"
        : `Decline these call times from ${names.counterpart}`,
    preview: "Nothing is booked.",
  }),
  succeeded: (out) => out.outcome === "OK",
  done: (out) =>
    out.outcome === "OK"
      ? "Declined. Nothing is booked."
      : REFUSALS[out.reason].detail,
  http: respondHttp(MEETING_PROPOSAL_DECLINE_PATH, false),
  tool: {
    name: "decline_meeting_times",
    description:
      "Use when the person says no to the proposed call times. Prepares the decline for their approval; nothing is booked either way.",
    input: ProposalTool.strict(),
    references: { relationship: "RELATIONSHIP" },
    purposes: ["GENERAL_QUESTION"],
    eval: {
      say: [
        "Decline the times {name} proposed",
        "None of those times work, tell {name} no",
      ],
      names: "RELATIONSHIP",
      orSays: "no call times|nothing proposed|can't find",
    },
    toCanonical: (tool, context) =>
      Promise.resolve({
        relationshipId: tool.relationship,
        proposalId: tool.proposalId,
        idempotencyKey: context.idempotencyKey,
      }),
  },
});

const COUNTER = defineAppAction<
  z.infer<typeof CounterInput>,
  ProposalOutcome,
  z.infer<typeof ProposalTool> & {
    options: z.infer<typeof CounterMeetingTimeRequestSchema>["options"];
  }
>({
  name: "schedule.proposal.counter",
  // ADR 0043: a call time binds both sides; never Q's alone, always an explicit yes.
  consequence: "COMMITMENT",
  short: "counter-propose call times",
  area: "schedule",
  classification: "CONSEQUENTIAL",
  does: "Counter-proposes one to five other call times. Nothing is booked until the founder accepts one.",
  input: CounterInput,
  output: z.custom<ProposalOutcome>(),
  authorize: authoriseStep("COUNTER"),
  run: (ports, context, input) =>
    proposals(ports)
      .forActor(context.actor, context.correlationId)
      .respond({
        actorUserId: context.actor.userId,
        proposalId: input.proposalId,
        action: "COUNTER",
        options: input.input.options,
        idempotencyKey: respondKey(context, input.idempotencyKey),
      }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input, names) => ({
    summary:
      names?.counterpart == null
        ? "Counter-propose call times"
        : `Counter-propose call times to ${names.counterpart}`,
    preview: `${input.input.options.map(when).join("\n")}\nNothing is booked until they accept one.`,
  }),
  succeeded: (out) => out.outcome === "OK",
  done: (out) =>
    out.outcome === "OK"
      ? "Counter-proposal sent. Nothing is booked until they accept one."
      : REFUSALS[out.reason].detail,
  http: respondHttp(MEETING_PROPOSAL_COUNTER_PATH, true),
  tool: {
    name: "counter_meeting_times",
    description:
      "Use when the investor wants to offer other call times instead of the proposed ones. Prepares a counter-proposal of one to five concrete times (ISO start and end, IANA time zone) for their approval; nothing is booked until the founder accepts one.",
    input: ProposalTool.extend({
      options: z.array(MeetingTimeOptionSchema).min(1).max(5),
    }).strict(),
    references: { relationship: "RELATIONSHIP" },
    purposes: ["GENERAL_QUESTION"],
    eval: {
      say: [
        "Counter with Thursday 11am for {name}'s call",
        "Offer {name} other times: Friday morning instead",
      ],
      names: "RELATIONSHIP",
      orSays: "no call times|nothing proposed|can't find",
    },
    toCanonical: (tool, context) =>
      Promise.resolve({
        relationshipId: tool.relationship,
        proposalId: tool.proposalId,
        idempotencyKey: context.idempotencyKey,
        input: { options: tool.options },
      }),
  },
});

export const SCHEDULE_PROPOSAL_ACTIONS: readonly AnyAppAction[] = [
  PROPOSE,
  REVIEW,
  ACCEPT,
  DECLINE,
  COUNTER,
];
