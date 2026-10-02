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
  type QKnowledgeScopeKind,
  type QTaskClass,
} from "@capital-q/contracts";
import type { OutcomeRefusal, OutcomeResult } from "@capital-q/network";

import { defineAppAction, type AnyAppAction } from "../define.js";
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

/** The investor's side of a conversation; never a founder's. */
const INVESTOR_SCOPES: readonly QKnowledgeScopeKind[] = ["INVESTOR_PROFILE"];
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

const PassTool = Named.extend({
  reason: RelationshipPassReasonCodeSchema.optional().describe(
    "Only if they gave one: STAGE, SECTOR, GEOGRAPHY, TRACTION, TEAM, VALUATION, BUSINESS_MODEL, MARKET, TIMING, ROUND or OTHER.",
  ),
  note: z
    .string()
    .min(1)
    .max(1000)
    .optional()
    .describe("Their own words about why, only if they said any."),
  shareWithFounder: z
    .boolean()
    .optional()
    .describe(
      "True only if they explicitly asked for the founder to be told the reason. Default: the reason stays private.",
    ),
}).strict();

const PASS = defineAppAction<
  z.infer<typeof Pass>,
  OutcomeResult,
  z.infer<typeof PassTool>
>({
  name: "relationship.outcome.pass",
  short: "decide not to proceed",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Tells a connected company the investor has decided not to proceed for now, as the relationship page's Pass does; the reason stays private unless they share it.",
  input: Pass,
  output: z.custom<OutcomeResult>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    outcomes(ports).pass({
      actor: context.actor,
      relationshipId: input.relationshipId,
      reasonCode: input.input.reasonCode ?? null,
      note: input.input.note ?? null,
      shareWithFounder: input.input.shareWithFounder,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: () => [],
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
  tool: {
    name: "decline_to_proceed",
    description:
      "Prepares telling a company the investor is connected with (usually after a meeting) that they have decided not to proceed for now. Not Discover's pass. A reason is optional and stays private to the investor unless they explicitly ask to share it with the founder. Nothing is sent until they approve exactly it.",
    input: PassTool,
    references: { relationship: "RELATIONSHIP" },
    scopes: INVESTOR_SCOPES,
    purposes: PURPOSES,
    eval: {
      say: [
        "We've decided not to proceed with {name}.",
        "Tell {name} we're passing for now, it's too early for us.",
      ],
      names: "RELATIONSHIP",
    },
    toCanonical: (tool, context) =>
      Promise.resolve({
        relationshipId: tool.relationship,
        idempotencyKey: context.idempotencyKey,
        input: {
          reasonCode: tool.reason ?? null,
          note: tool.note ?? null,
          shareWithFounder: tool.shareWithFounder ?? false,
        },
      }),
  },
});

const Simple = z
  .object({
    relationshipId: z.string().max(64),
  })
  .strict();

function pauseOrResume(kind: "PAUSE" | "RESUME"): AnyAppAction {
  const pause = kind === "PAUSE";
  return defineAppAction<
    z.infer<typeof Simple>,
    OutcomeResult,
    z.infer<typeof Named>
  >({
    name: pause ? "relationship.outcome.pause" : "relationship.outcome.resume",
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
    targets: () => [],
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
    tool: {
      name: pause ? "pause_relationship" : "resume_relationship",
      description: pause
        ? "Prepares pausing a relationship the investor is connected with, for now: not a pass. Nothing changes until they approve."
        : "Prepares resuming a paused relationship, or undoing the investor's own decision not to proceed. Nothing changes until they approve.",
      input: Named,
      references: { relationship: "RELATIONSHIP" },
      scopes: INVESTOR_SCOPES,
      purposes: PURPOSES,
      eval: {
        say: pause
          ? ["Pause things with {name} for now.", "Put {name} on hold."]
          : [
              "Resume things with {name}.",
              "Actually, let's pick {name} back up.",
            ],
        names: "RELATIONSHIP",
      },
      toCanonical: (tool) =>
        Promise.resolve({ relationshipId: tool.relationship }),
    },
  });
}

const Outcome = z
  .object({
    relationshipId: z.string().max(64),
    input: RecordMeetingOutcomeRequestSchema,
  })
  .strict();

const OutcomeTool = Named.extend({
  outcome: RecordMeetingOutcomeRequestSchema.shape.outcome.describe(
    "What the meeting led to, as they confirmed it.",
  ),
}).strict();

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
  OutcomeResult,
  z.infer<typeof OutcomeTool>
>({
  name: "relationship.outcome.meeting",
  short: "record how a meeting went",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Records what a meeting led to (diligence, a follow-up meeting, materials, introductions) on a connected relationship, once the person confirms it.",
  input: Outcome,
  output: z.custom<OutcomeResult>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    outcomes(ports).recordMeetingOutcome({
      actor: context.actor,
      relationshipId: input.relationshipId,
      outcome:
        input.input.outcome === "DILIGENCE"
          ? { kind: "DILIGENCE" }
          : { kind: "PROGRESSED", step: input.input.outcome },
      meetingId: input.input.meetingId,
      correlationId: context.correlationId,
    }),
  targets: () => [],
  card: (input) => ({
    summary: "Record how the meeting went",
    preview: `On the relationship, both sides see that ${OUTCOME_WORDS[input.input.outcome]}.`,
  }),
  done: (out, input) =>
    out.outcome === "OK"
      ? `Recorded: ${OUTCOME_WORDS[input.input.outcome]}.`
      : (outcomeProblem(out)?.detail ?? "That couldn't be recorded."),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_RELATIONSHIP_MEETING_OUTCOME_PATH,
    fromRequest: (params, body) => ({
      relationshipId: params["relationshipId"],
      input: body,
    }),
    ...http,
  },
  tool: {
    name: "record_meeting_outcome",
    description:
      "Prepares recording what a meeting with a connected company or investor led to, once the person confirms it: diligence, a follow-up meeting, materials requested, introductions. Never inferred without their yes.",
    input: OutcomeTool,
    references: { relationship: "RELATIONSHIP" },
    purposes: PURPOSES,
    eval: {
      say: [
        "We're starting diligence with {name}.",
        "The call with {name} went well, we'll meet again.",
      ],
      names: "RELATIONSHIP",
    },
    toCanonical: (tool) =>
      Promise.resolve({
        relationshipId: tool.relationship,
        input: { outcome: tool.outcome },
      }),
  },
});

export const OUTCOME_ACTIONS: readonly AnyAppAction[] = [
  PASS,
  pauseOrResume("PAUSE"),
  pauseOrResume("RESUME"),
  MEETING_OUTCOME,
];
