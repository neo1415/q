import { z } from "zod";

import {
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
};

const port = (ports: AppActionPorts) => ports.qWork ?? portMissing("qWork");

/** The port's own predicates are the person's; nothing else to decide. */
const ownRows = () => Promise.resolve({ ok: true as const });

const ById = z.object({ delegationId: UuidSchema }).strict();
const Acted = z.object({ acted: z.boolean() }).strict();

const PAUSE = defineAppAction<
  z.infer<typeof ById>,
  z.infer<typeof Acted>
>({
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

const RESUME = defineAppAction<
  z.infer<typeof ById>,
  z.infer<typeof Acted>
>({
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

export const WORK_ACTIONS: readonly AnyAppAction[] = [PAUSE, RESUME, DISMISS];
