import { z } from "zod";

import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  NETWORK_RELATIONSHIP_MEETING_OUTCOME_PATH,
  NETWORK_RELATIONSHIP_PASS_PATH,
  NETWORK_RELATIONSHIP_PAUSE_PATH,
  NETWORK_RELATIONSHIP_RESUME_PATH,
  PassRelationshipRequestSchema,
  RecordMeetingOutcomeRequestSchema,
  RelationshipOutcomeResultDtoSchema,
  RelationshipPassReasonCodeSchema,
  type KnownErrorCode,
  type QTaskClass,
} from "@capital-q/contracts";
import type { OutcomeRefusal, OutcomeResult } from "@capital-q/network";

import { meetingTimeLabel } from "@capital-q/communication";

import {
  defineAppAction,
  defineAppActionFamily,
  refusal,
  type AnyAppAction,
  type AppActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Post-meeting outcomes (founder request 2026-10-02; ADR 0040). The
 * investor's Pass, Pause and Resume on a matched relationship, and either
 * side's confirmed meeting outcome: each declared once, its route and its Q
 * tool generated, through Network's outcome service.
 *
 * Pass is consequential (spec 6.6.13): on the screen it is a button with a
 * confirm, and when Q prepares it the person approves exactly the card.
 * The reason is the investor's private note unless they tick "share this
 * reason with the founder" (founder decision (a)); the card says which.
 * Named apart from Discover's Pass (pass_company), which is a feed
 * decision the company is never told of.
 */

const missing = (port: string): never => {
  throw new Error(`APP_ACTION_PORT_MISSING:${port}`);
};

/** Network's outcome service decides the party, the side and the state. */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const outcomes = (ports: AppActionPorts) =>
  ports.outcomes ?? missing("outcomes");

const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

const REFUSALS: Readonly<
  Record<
    OutcomeRefusal,
    { readonly code: KnownErrorCode; readonly detail: string }
  >
> = {
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_ALLOWED: {
    code: "PERMISSION_DENIED",
    detail: "Only the investor's side can do that.",
  },
  NOT_IN_STATE: {
    code: "RESOURCE_CONFLICT",
    detail: "That isn't possible where this relationship is now.",
  },
  INVALID_REASON: {
    code: "VALIDATION_FAILED",
    detail: "Choose one of the listed reasons.",
  },
};

function outcomeProblem(
  out: OutcomeResult,
): { readonly code: KnownErrorCode; readonly detail: string } | null {
  return out.outcome === "OK" ? null : REFUSALS[out.code];
}

function meetingOutcomeProblem(
  out: MeetingOutcomeResult,
): { readonly code: KnownErrorCode; readonly detail: string } | null {
  if (out.outcome === "OK") return null;
  return out.code === "MEETING_NOT_ENDED"
    ? MEETING_NOT_ENDED
    : REFUSALS[out.code];
}

const http = {
  status: (out: OutcomeResult) =>
    out.outcome === "OK" && out.deduplicated ? (200 as const) : (201 as const),
  problem: outcomeProblem,
  notFound: (out: OutcomeResult) =>
    out.outcome === "REFUSED" && out.code === "NOT_FOUND",
  respond: (out: OutcomeResult) =>
    out.outcome === "OK"
      ? RelationshipOutcomeResultDtoSchema.parse({
          relationshipId: out.relationshipId,
          deduplicated: out.deduplicated,
        })
      : undefined,
};

const succeeded = (out: OutcomeResult) => out.outcome === "OK";

/** A stage report filed with a decision; never fails the decision. */
async function fileReport(
  ports: AppActionPorts,
  context: AppActionContext,
  relationshipId: string,
  kind: "PASS" | "MEETING_SUMMARY",
  key: string,
): Promise<void> {
  if (ports.deal === undefined) return;
  await ports.deal
    .generateReport({
      actor: context.actor,
      relationshipId,
      kind,
      idempotencyKey: `${key}:${kind.toLowerCase()}`.slice(0, 200),
      correlationId: context.correlationId,
    })
    .catch(() => undefined);
}

const PURPOSES: readonly QTaskClass[] = [
  "RELATIONSHIP_QUESTION",
  "ACTION_PREPARATION",
];

/** A relationship named as they said it: the company, or the investor. */
const Named = z
  .object({
    relationship: z
      .string()
      .min(1)
      .max(200)
      .describe("The company (or investor) as the person named it."),
  })
  .strict();

const Pass = z
  .object({
    relationshipId: z.string().max(64),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: PassRelationshipRequestSchema,
  })
  .strict();

const PASS = defineAppAction<z.infer<typeof Pass>, OutcomeResult>({
  name: "relationship.outcome.pass",
  consequence: "COMMITMENT",
  supersedes: true,
  short: "decide not to proceed",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Tells a connected company the investor has decided not to proceed for now, as the relationship page's Pass does; the reason stays private unless they share it.",
  input: Pass,
  output: z.custom<OutcomeResult>(),
  authorize: servicesDecide,
  run: async (ports, context, input) => {
    const out = await outcomes(ports).pass({
      actor: context.actor,
      relationshipId: input.relationshipId,
      reasonCode: input.input.reasonCode ?? null,
      note: input.input.note ?? null,
      shareWithFounder: input.input.shareWithFounder,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    });
    // Deal close (2026-10-08): the investor's private pass report is filed
    // at the pass. Best effort: it never undoes the pass, and can be filed
    // again from the relationship page.
    if (out.outcome === "OK" && !out.deduplicated) {
      await fileReport(
        ports,
        context,
        input.relationshipId,
        "PASS",
        input.idempotencyKey,
      );
    }
    return out;
  },
  targets: (input) => [
    { kind: "RELATIONSHIP", relationshipId: input.relationshipId },
  ],
  card: (input) => {
    const shared =
      input.input.shareWithFounder &&
      (input.input.reasonCode != null || input.input.note != null);
    return {
      summary: "Decide not to proceed for now",
      preview: shared
        ? `They are told you've decided not to proceed for now, with your reason${
            input.input.reasonCode == null
              ? ""
              : ` (${input.input.reasonCode.toLowerCase().replaceAll("_", " ")})`
          }${input.input.note == null ? "" : `: "${input.input.note}"`}.`
        : "They are told you've decided not to proceed for now. Your reason stays private to your organisation.",
    };
  },
  done: (out, _input, names) =>
    out.outcome === "OK"
      ? `Done. ${names["relationship"] ?? "They"} ${
          names["relationship"] === undefined ? "are" : "is"
        } told you've decided not to proceed for now.`
      : (outcomeProblem(out)?.detail ?? "That couldn't be done."),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_RELATIONSHIP_PASS_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body ?? {},
    }),
    ...http,
  },
});

const Simple = z
  .object({
    relationshipId: z.string().max(64),
  })
  .strict();

function pauseOrResume(kind: "PAUSE" | "RESUME"): AnyAppAction {
  const pause = kind === "PAUSE";
  return defineAppAction<z.infer<typeof Simple>, OutcomeResult>({
    name: pause ? "relationship.outcome.pause" : "relationship.outcome.resume",
    consequence: "COMMITMENT",
    supersedes: true,
    short: pause ? "pause a relationship" : "resume a relationship",
    area: "relationships",
    classification: "CONSEQUENTIAL",
    does: pause
      ? "Pauses a connected relationship for now, as the relationship page's Pause does; the company sees it is paused."
      : "Resumes a paused relationship, or resets the investor's own pass, as the relationship page does: it goes back to where it was.",
    input: Simple,
    output: z.custom<OutcomeResult>(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      pause
        ? outcomes(ports).pause({
            actor: context.actor,
            relationshipId: input.relationshipId,
            correlationId: context.correlationId,
          })
        : outcomes(ports).resume({
            actor: context.actor,
            relationshipId: input.relationshipId,
            correlationId: context.correlationId,
          }),
    targets: (input) => [
      { kind: "RELATIONSHIP", relationshipId: input.relationshipId },
    ],
    card: () =>
      pause
        ? {
            summary: "Pause for now",
            preview:
              "They see the relationship is paused. Nothing else changes, and you can resume any time.",
          }
        : {
            summary: "Resume",
            preview:
              "The relationship goes back to where it was before the pause or pass, and they can see that.",
          },
    done: (out, _input, names) =>
      out.outcome === "OK"
        ? pause
          ? `Done. ${names["relationship"] ?? "It"} is paused.`
          : `Done. ${names["relationship"] ?? "It"} is back where it was.`
        : (outcomeProblem(out)?.detail ?? "That couldn't be done."),
    succeeded,
    http: {
      method: "POST",
      path: pause
        ? NETWORK_RELATIONSHIP_PAUSE_PATH
        : NETWORK_RELATIONSHIP_RESUME_PATH,
      fromRequest: (params) => ({ relationshipId: params["relationshipId"] }),
      ...http,
    },
  });
}

const Outcome = z
  .object({
    relationshipId: z.string().max(64),
    input: RecordMeetingOutcomeRequestSchema,
  })
  .strict();

/**
 * A meeting outcome refused because the call it is about has not ended
 * (live 15 Nov 2026, D-Q2): never recorded for a call still to come.
 */
type MeetingOutcomeResult =
  | OutcomeResult
  | { readonly outcome: "REFUSED"; readonly code: "MEETING_NOT_ENDED" };

const MEETING_NOT_ENDED = {
  code: "RESOURCE_CONFLICT" as const,
  detail:
    "That call hasn't happened yet. Record how it went once it has ended.",
};

/**
 * Which Capital Q call an outcome is about. Named: that one. Unnamed: the
 * latest booked call on the relationship that has ended; when only calls
 * still to come are booked, none may be bound and the outcome waits
 * (NOT_ENDED). No call on record at all: a meeting held elsewhere, bound
 * to nothing (NONE). Read as the person, through the schedule service.
 */
export async function meetingToBind(
  ports: AppActionPorts,
  context: AppActionContext,
  relationshipId: string,
  named: string | undefined,
  now: Date = new Date(),
): Promise<
  | { readonly kind: "BOUND"; readonly meetingId: string }
  | { readonly kind: "NONE" }
  | {
      readonly kind: "NOT_ENDED";
      readonly startsAt: string;
      readonly timeZone: string;
    }
> {
  const listed =
    ports.schedule?.listMeetings === undefined
      ? null
      : await ports.schedule
          .listMeetings(context.actor, relationshipId)
          .catch(() => null);
  const booked = (listed ?? []).filter(
    (meeting) => meeting.status === "SCHEDULED",
  );
  const ended = (meeting: { readonly endsAt: string }) =>
    Date.parse(meeting.endsAt) <= now.getTime();
  if (named !== undefined) {
    const meeting = booked.find((one) => one.id === named);
    return meeting !== undefined && !ended(meeting)
      ? {
          kind: "NOT_ENDED",
          startsAt: meeting.startsAt,
          timeZone: meeting.timeZone,
        }
      : { kind: "BOUND", meetingId: named };
  }
  const latestEnded = booked
    .filter(ended)
    .toSorted((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))[0];
  if (latestEnded !== undefined) {
    return { kind: "BOUND", meetingId: latestEnded.id };
  }
  const next = booked.toSorted(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  )[0];
  return next === undefined
    ? { kind: "NONE" }
    : { kind: "NOT_ENDED", startsAt: next.startsAt, timeZone: next.timeZone };
}

const OUTCOME_WORDS: Readonly<
  Record<z.infer<typeof RecordMeetingOutcomeRequestSchema>["outcome"], string>
> = {
  DILIGENCE: "diligence has started",
  FOLLOW_UP_MEETING: "a follow-up meeting is next",
  MATERIALS_REQUESTED: "materials were requested",
  INTRODUCTIONS: "introductions are next",
  OTHER: "things are moving forward",
};

const MEETING_OUTCOME = defineAppAction<
  z.infer<typeof Outcome>,
  MeetingOutcomeResult
>({
  name: "relationship.outcome.meeting",
  consequence: "COMMITMENT",
  supersedes: true,
  short: "record how a meeting went",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Records what a meeting led to (diligence, a follow-up meeting, materials, introductions) on a connected relationship, once the person confirms it.",
  input: Outcome,
  output: z.custom<MeetingOutcomeResult>(),
  authorize: servicesDecide,
  run: async (ports, context, input) => {
    // D-Q2 (live 15 Nov 2026): enforced here whatever the input says.
    // Unnamed, the outcome binds the relationship's latest ended call;
    // while the only booked call is still to come, nothing is recorded.
    const bound = await meetingToBind(
      ports,
      context,
      input.relationshipId,
      input.input.meetingId,
    );
    if (bound.kind === "NOT_ENDED") {
      return { outcome: "REFUSED", code: "MEETING_NOT_ENDED" } as const;
    }
    const meetingId = bound.kind === "BOUND" ? bound.meetingId : undefined;
    // An outcome that names the call says the call happened: the
    // schedule service (the call's owner) marks it held first, so a call
    // without the meeting bot still reaches MEETING_HELD (2026-10-03).
    if (meetingId !== undefined && ports.schedule?.confirmHeld !== undefined) {
      const held = await ports.schedule.confirmHeld({
        actor: context.actor,
        relationshipId: input.relationshipId,
        meetingId,
        correlationId: context.correlationId,
      });
      if (held.outcome !== "OK") {
        return held.outcome === "REFUSED" && held.code === "INVALID_TIME"
          ? ({ outcome: "REFUSED", code: "MEETING_NOT_ENDED" } as const)
          : ({ outcome: "REFUSED", code: "NOT_FOUND" } as const);
      }
    }
    const out = await outcomes(ports).recordMeetingOutcome({
      actor: context.actor,
      relationshipId: input.relationshipId,
      outcome:
        input.input.outcome === "DILIGENCE"
          ? { kind: "DILIGENCE" }
          : { kind: "PROGRESSED", step: input.input.outcome },
      meetingId,
      correlationId: context.correlationId,
    });
    // Deal close (2026-10-08): the shared meeting summary is filed with
    // the outcome, keyed by the correlation so a retry files it once.
    if (out.outcome === "OK" && !out.deduplicated) {
      await fileReport(
        ports,
        context,
        input.relationshipId,
        "MEETING_SUMMARY",
        `meeting-summary:${context.correlationId}`,
      );
    }
    return out;
  },
  targets: (input) => [
    { kind: "RELATIONSHIP", relationshipId: input.relationshipId },
  ],
  card: (input) => ({
    summary: "Record how the meeting went",
    preview: `${input.input.meetingId === undefined ? "" : "The call is marked as held. "}On the relationship, both sides see that ${OUTCOME_WORDS[input.input.outcome]}.`,
  }),
  done: (out, input) =>
    out.outcome === "OK"
      ? `Recorded: ${OUTCOME_WORDS[input.input.outcome]}.`
      : (meetingOutcomeProblem(out)?.detail ?? "That couldn't be recorded."),
  succeeded: (out) => out.outcome === "OK",
  http: {
    method: "POST",
    path: NETWORK_RELATIONSHIP_MEETING_OUTCOME_PATH,
    fromRequest: (params, body) => ({
      relationshipId: params["relationshipId"],
      input: body,
    }),
    status: (out) =>
      out.outcome === "OK" && out.deduplicated
        ? (200 as const)
        : (201 as const),
    problem: meetingOutcomeProblem,
    notFound: (out) => out.outcome === "REFUSED" && out.code === "NOT_FOUND",
    respond: (out) =>
      out.outcome === "OK"
        ? RelationshipOutcomeResultDtoSchema.parse({
            relationshipId: out.relationshipId,
            deduplicated: out.deduplicated,
          })
        : undefined,
  },
});

/**
 * One Q tool for the four (ADR 0040 family): a run offers at most
 * MODEL_TOOLS_MAX tools, and to the person these are one thing -- where
 * this relationship goes after a meeting. Each operation is still its own
 * declaration, route, authorize step and service call.
 */
const OutcomeTool = Named.extend({
  operation: z
    .enum(["NOT_PROCEED", "PAUSE", "RESUME", "MEETING_OUTCOME"])
    .describe(
      "NOT_PROCEED: the investor decided not to proceed for now (not Discover's pass). PAUSE / RESUME: the investor pauses, or resumes (also undoes their own decision not to proceed). MEETING_OUTCOME: either side confirms what a meeting led to.",
    ),
  reason: RelationshipPassReasonCodeSchema.optional().describe(
    "NOT_PROCEED only, and only if they gave one: STAGE, SECTOR, GEOGRAPHY, TRACTION, TEAM, VALUATION, BUSINESS_MODEL, MARKET, TIMING, ROUND or OTHER.",
  ),
  note: z
    .string()
    .min(1)
    .max(1000)
    .optional()
    .describe("NOT_PROCEED only: their own words about why, if they said any."),
  shareWithFounder: z
    .boolean()
    .optional()
    .describe(
      "NOT_PROCEED only: true only if they explicitly asked for the founder to be told the reason. Default: the reason stays private.",
    ),
  meetingOutcome: RecordMeetingOutcomeRequestSchema.shape.outcome
    .optional()
    .describe(
      "MEETING_OUTCOME only: what the meeting led to, as they confirmed it.",
    ),
}).strict();

/**
 * D-Q2 (live 15 Nov 2026): "Mark the call as held" prepared an outcome
 * card with no meeting, for a call two days away. Q's card binds the call
 * it is about, and a call still to come is refused before any card, in
 * the person's words with its time.
 */
async function meetingOutcomeCanonical(
  relationshipId: string,
  outcome:
    z.infer<typeof RecordMeetingOutcomeRequestSchema>["outcome"] | undefined,
  context: AppActionContext,
  ports: AppActionPorts,
) {
  if (outcome === undefined) return null;
  const bound = await meetingToBind(ports, context, relationshipId, undefined);
  if (bound.kind === "NOT_ENDED") {
    return refusal(
      `That call hasn't happened yet: it is booked for ${meetingTimeLabel(bound.startsAt, bound.timeZone)}. You can record how it went once it has ended; nothing was prepared.`,
    );
  }
  return {
    operation: "MEETING_OUTCOME" as const,
    input: {
      relationshipId,
      input: {
        outcome,
        ...(bound.kind === "BOUND" ? { meetingId: bound.meetingId } : {}),
      },
    },
  };
}

export const OUTCOME_ACTIONS: readonly AnyAppAction[] = defineAppActionFamily<
  z.infer<typeof OutcomeTool>
>({
  name: "relationship.outcome.change",
  consequence: "COMMITMENT",
  supersedes: true,
  // The reader's list shows `short` (QA runs a6b19977 / 06289687: a label
  // about meetings let "we've decided not to proceed" name no action).
  short: "relationship decisions and meeting outcomes",
  area: "relationships",
  does: "Records a decision on a connected relationship: the investor not proceeding for now, pausing or resuming, or what a meeting led to (diligence, a follow-up, materials, introductions), as the relationship page does.",
  members: {
    NOT_PROCEED: PASS,
    PAUSE: pauseOrResume("PAUSE"),
    RESUME: pauseOrResume("RESUME"),
    MEETING_OUTCOME,
  },
  tool: {
    name: "relationship_outcome",
    description:
      'Use when the person states a decision about one of their own relationships, even as news ("we\'ve decided not to proceed with Ledgerfold for now", "let\'s pause things with Ledgerfold", "we\'re starting diligence"); never for an opinion or a doubt ("I\'m not sure about Ledgerfold"). Prepares, for the person\'s approval, where a relationship they are connected with goes after a meeting: an investor deciding not to proceed for now (the reason stays private unless they ask to share it), pausing or resuming, or recording what a meeting led to (diligence, a follow-up meeting, materials, introductions). Name the company or investor as they said it. Nothing changes until they approve exactly it.',
    input: OutcomeTool,
    references: { relationship: "RELATIONSHIP" },
    purposes: PURPOSES,
    eval: {
      say: [
        "We've decided not to proceed with {name} for now.",
        "We're starting diligence with {name}.",
      ],
      names: "RELATIONSHIP",
    },
    toCanonical: (tool, context, ports) => {
      const relationshipId = tool.relationship;
      switch (tool.operation) {
        case "NOT_PROCEED":
          return Promise.resolve({
            operation: "NOT_PROCEED",
            input: {
              relationshipId,
              idempotencyKey: context.idempotencyKey,
              input: {
                reasonCode: tool.reason ?? null,
                note: tool.note ?? null,
                shareWithFounder: tool.shareWithFounder ?? false,
              },
            },
          });
        case "PAUSE":
        case "RESUME":
          return Promise.resolve({
            operation: tool.operation,
            input: { relationshipId },
          });
        case "MEETING_OUTCOME":
          return meetingOutcomeCanonical(
            relationshipId,
            tool.meetingOutcome,
            context,
            ports,
          );
      }
    },
  },
});
