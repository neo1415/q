import { z } from "zod";

import {
  InstructionDelegationRequestSchema,
  Q_WORK_DELEGATION_PATH,
  Q_WORK_PAUSE_PATH,
  Q_WORK_RESUME_PATH,
  Q_WORK_SUGGESTION_DISMISSALS_PATH,
  QWorkAcceptedDtoSchema,
  QWorkSuggestionKeySchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Q's work page (WORK-58, ADR 0040): pausing and resuming the person's own
 * standing instruction, and setting a suggestion aside ("Not now"). Each
 * is the person's own word, done at once (INSTANT), declared once with its
 * generated route. Q pauses and resumes through its own tool
 * (`stop_q_work`); setting a card aside is the page's alone, so Q offers
 * the Work screen for it.
 */

/** What the routes reach: the person's own rows, every predicate theirs. */
export type QWorkPagePort = {
  /** Their own ACTIVE instruction; false: not theirs or not running. */
  readonly pause: (actor: ActorContext, id: string) => Promise<boolean>;
  /** Only what they paused themselves, while its grant is live. */
  readonly resume: (actor: ActorContext, id: string) => Promise<boolean>;
  /** Additive and idempotent per person and suggestion. */
  readonly dismiss: (actor: ActorContext, key: string) => Promise<void>;
  /**
   * Scoped delegation: switch routine relationship moves on or off for
   * their own live instruction, audited. Switching off is at once;
   * switching on again is a new delegation. False: not theirs, not live,
   * or already as asked.
   */
  readonly setDelegation?:
    | ((actor: ActorContext, id: string, enabled: boolean) => Promise<boolean>)
    | undefined;
};

const port = (ports: AppActionPorts) => ports.qWork ?? portMissing("qWork");

/** The port's own predicates are the person's; nothing else to decide. */
const ownRows = () => Promise.resolve({ ok: true as const });

const ById = z.object({ delegationId: UuidSchema }).strict();
const Acted = z.object({ acted: z.boolean() }).strict();

const PAUSE = defineAppAction<z.infer<typeof ById>, z.infer<typeof Acted>>({
  name: "q.work.pause",
  short: "pause a standing instruction",
  area: "work",
  classification: "INSTANT",
  does: "Pauses one of their standing instructions: Q does nothing on it until they resume, as Work's Pause does.",
  input: ById,
  output: Acted,
  authorize: ownRows,
  run: async (ports, context, input) => ({
    acted: await port(ports).pause(context.actor, input.delegationId),
  }),
  targets: () => [],
  card: () => ({ summary: "Pause Q's work", preview: "" }),
  done: (out) => (out.acted ? "Paused." : "Nothing running there to pause."),
  succeeded: (out) => out.acted,
  http: {
    method: "POST",
    path: Q_WORK_PAUSE_PATH,
    fromRequest: (params) => ({ delegationId: params["delegationId"] }),
    notFound: (out) => !out.acted,
    respond: () => QWorkAcceptedDtoSchema.parse({ accepted: true }),
  },
  legacyTool: "stop_q_work",
});

const RESUME = defineAppAction<z.infer<typeof ById>, z.infer<typeof Acted>>({
  name: "q.work.resume",
  short: "resume a standing instruction",
  area: "work",
  classification: "INSTANT",
  does: "Resumes a standing instruction they paused themselves, as Work's Resume does.",
  input: ById,
  output: Acted,
  authorize: ownRows,
  run: async (ports, context, input) => ({
    acted: await port(ports).resume(context.actor, input.delegationId),
  }),
  targets: () => [],
  card: () => ({ summary: "Resume Q's work", preview: "" }),
  done: (out) => (out.acted ? "Resumed." : "Nothing you paused there."),
  succeeded: (out) => out.acted,
  http: {
    method: "POST",
    path: Q_WORK_RESUME_PATH,
    fromRequest: (params) => ({ delegationId: params["delegationId"] }),
    notFound: (out) => !out.acted,
    respond: () => QWorkAcceptedDtoSchema.parse({ accepted: true }),
  },
  legacyTool: "stop_q_work",
});

const DelegationSwitch = z
  .object({
    delegationId: UuidSchema,
    enabled: InstructionDelegationRequestSchema.shape.enabled,
  })
  .strict();

/**
 * Scoped delegation (founder 2026-10-07, CLAUDE.md Authority "unless
 * explicit scoped delegation exists"): the person's own switch on their own
 * instruction. It is the person's act, offered as Work's toggle, never one
 * Q takes for them (`offer.work_delegation`): Q never grants itself
 * authority.
 */
const DELEGATION = defineAppAction<
  z.infer<typeof DelegationSwitch>,
  z.infer<typeof Acted>
>({
  name: "q.work.delegation.set",
  short: "let Q handle routine replies",
  area: "work",
  classification: "INSTANT",
  does: "Switches, on one of their own standing instructions, whether Q may reply, follow up and set meetings without asking (it still asks first for money, terms and anything new), as Work's toggle does.",
  input: DelegationSwitch,
  output: Acted,
  authorize: ownRows,
  run: async (ports, context, input) => {
    const set = port(ports).setDelegation;
    if (set === undefined) return portMissing("qWork");
    return {
      acted: await set(context.actor, input.delegationId, input.enabled),
    };
  },
  targets: () => [],
  card: () => ({ summary: "Q handles routine replies", preview: "" }),
  done: (out, input) =>
    !out.acted
      ? "Nothing to change there."
      : input.enabled
        ? "Q now handles routine replies, follow-ups and meetings there."
        : "Q asks you first again there.",
  succeeded: (out) => out.acted,
  http: {
    method: "POST",
    path: Q_WORK_DELEGATION_PATH,
    fromRequest: (params, body) => ({
      delegationId: params["delegationId"],
      enabled:
        typeof body === "object" && body !== null && "enabled" in body
          ? body.enabled
          : undefined,
    }),
    notFound: (out) => !out.acted,
    respond: () => QWorkAcceptedDtoSchema.parse({ accepted: true }),
  },
  qCapability: "offer.work_delegation",
});

const Dismiss = z.object({ key: QWorkSuggestionKeySchema }).strict();

const DISMISS = defineAppAction<z.infer<typeof Dismiss>, null>({
  name: "q.work.suggestion.dismiss",
  short: "set a suggestion aside",
  area: "work",
  classification: "INSTANT",
  does: "Sets one of Q's suggestions on Work aside so it does not come back.",
  input: Dismiss,
  output: z.null(),
  authorize: ownRows,
  run: async (ports, context, input) => {
    await port(ports).dismiss(context.actor, input.key);
    return null;
  },
  targets: () => [],
  card: () => ({ summary: "Not now", preview: "" }),
  done: () => "Set aside.",
  http: {
    method: "POST",
    path: Q_WORK_SUGGESTION_DISMISSALS_PATH,
    fromRequest: (_params, body) =>
      typeof body === "object" && body !== null ? body : {},
    respond: () => QWorkAcceptedDtoSchema.parse({ accepted: true }),
  },
  qCapability: "offer.work_suggestions",
});

/**
 * Recovery D6: one of Q's jobs the person approved, stopped. The durable
 * work row ends CANCELLED ("Stopped by you.") and its job STOPPED; a worker
 * running it starts no further step. The person's own jobs only.
 */
export type WorkforceJobPort = {
  /** False: not theirs, or no longer running. */
  readonly stop: (actor: ActorContext, jobId: string) => Promise<boolean>;
};

/** Until the lead moves it to contracts, the route is declared here. */
export const Q_WORKFORCE_JOB_STOP_PATH =
  "/v1/q/workforce/jobs/:jobId/stop" as const;
export const qWorkforceJobStopPath = (jobId: string) =>
  Q_WORKFORCE_JOB_STOP_PATH.replace(":jobId", encodeURIComponent(jobId));

const jobs = (ports: AppActionPorts) =>
  ports.workforceJobs ?? portMissing("workforceJobs");

const ByJob = z.object({ jobId: UuidSchema }).strict();

const JOB_STOP = defineAppAction<z.infer<typeof ByJob>, z.infer<typeof Acted>>({
  name: "q.work.job.stop",
  short: "stop one of Q's jobs",
  area: "work",
  classification: "INSTANT",
  does: "Stops one of Q's jobs they approved: no further step starts, and the job shows it was stopped by them, as Work's Stop this job does.",
  input: ByJob,
  output: Acted,
  authorize: ownRows,
  run: async (ports, context, input) => ({
    acted: await jobs(ports).stop(context.actor, input.jobId),
  }),
  targets: () => [],
  card: () => ({ summary: "Stop this job", preview: "" }),
  done: (out) => (out.acted ? "Stopped." : "That job isn't running."),
  succeeded: (out) => out.acted,
  http: {
    method: "POST",
    path: Q_WORKFORCE_JOB_STOP_PATH,
    fromRequest: (params) => ({ jobId: params["jobId"] }),
    notFound: (out) => !out.acted,
    respond: () => QWorkAcceptedDtoSchema.parse({ accepted: true }),
  },
  // Q and the screen share it: the same port, the same rows.
  tool: {
    name: "stop_q_job",
    purposes: ["GENERAL_QUESTION", "ACTION_PREPARATION"],
    description:
      "Stops one of Q's jobs the person approved (by its job id from their Work page), at once, exactly as Work's Stop this job does. Call it only when they ask to stop that job.",
    input: ByJob,
    references: {},
    eval: {
      say: ["Stop that job.", "Cancel the research job you're running."],
    },
    toCanonical: (input) => Promise.resolve(input),
  },
});

export const WORK_ACTIONS: readonly AnyAppAction[] = [
  PAUSE,
  RESUME,
  DISMISS,
  DELEGATION,
  JOB_STOP,
];
