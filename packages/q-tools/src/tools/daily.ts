import { z } from "zod";

import {
  Q_DAILY_OPTIONAL_SECTIONS,
  Q_TASK_CLASSES,
  type PermittedContextPlan,
  type QDailyRequestDto,
  type QDailyEdition,
  type QDailyPreferences,
  type SetQDailyPreferencesRequest,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * The Q Daily through Q (DAILY spec §7): "show me today's Q Daily", "make
 * it weekly", "stop emailing it". Both act on the caller's own edition and
 * preferences only; the port is keyed by the actor, and no input names a
 * person. Reading is a read; setting is the person's own reversible
 * preference at their word, like personality or setup reminders.
 */

export const GET_Q_DAILY = "daily.own.get" as const;
export const SET_Q_DAILY_PREFERENCES = "daily.preferences.set" as const;
export const REQUEST_Q_DAILY = "daily.edition.request" as const;

export type QDailyToolPort = {
  readonly latest: (actor: ActorContext) => Promise<{
    readonly edition: QDailyEdition | null;
    readonly preferences: QDailyPreferences;
  }>;
  readonly setPreferences: (
    actor: ActorContext,
    patch: SetQDailyPreferencesRequest,
  ) => Promise<QDailyPreferences>;
  /**
   * "Prepare my edition now": the reader's own button, with its own limit
   * (one per 20 hours). Absent: no request_q_daily tool.
   */
  readonly request?: (actor: ActorContext) => Promise<QDailyRequestDto>;
};

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

const OWN = {
  version: 1,
  status: "ACTIVE",
  requiredCapabilities: [],
  requiredScopeKinds: ["OWN_Q_CONVERSATION"],
  approval: "NONE",
  owner: "q-daily",
  visibleStage: null,
} as const;

export const GetQDailyInputSchema = z.object({}).strict();
export type GetQDailyInput = z.infer<typeof GetQDailyInputSchema>;

export const GetQDailyOutputSchema = z
  .object({
    status: z.enum(["READY", "NONE_YET", "OFF"]),
    editionDate: z.string().max(10).nullable(),
    number: z.number().int().nullable(),
    /** Where they read it in the app. */
    href: z.string().max(80),
    headlines: z
      .array(
        z
          .object({
            section: z.string().max(80),
            headline: z.string().max(200),
            publisher: z.string().max(120),
          })
          .strict(),
      )
      .max(10),
    /** Q's take, labelled: Q's inference, not reported fact. */
    qTake: z.string().max(1_000).nullable(),
    frequency: z.enum(["WEEKLY", "DAILY", "OFF"]),
    email: z.boolean(),
    sections: z.array(z.string().max(20)).max(5),
    nextDueAt: z.string().max(40).nullable(),
  })
  .strict();
export type GetQDailyOutput = z.infer<typeof GetQDailyOutputSchema>;

export function createGetQDailyTool(port: QDailyToolPort): AnyQToolDefinition {
  return defineQTool<GetQDailyInput, GetQDailyOutput, ActorContext>({
    ...OWN,
    id: GET_Q_DAILY,
    providerName: "get_q_daily",
    description:
      "Reads their latest edition of The Q Daily, their personal newspaper of news about their sectors, markets, deals and the people they know: its date, headlines with publishers, Q's take and where to read it (href). Call it when they ask for today's or this week's Q Daily, their news, or what is new in their markets. Say each headline is reported by its publisher; Q's take is Q's inference. NONE_YET: the first edition is still to come (nextDueAt); OFF: they turned it off.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    supportedPurposes: [
      "GENERAL_QUESTION",
      "OWN_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
    ],
    idempotency: "SAFE_TO_REPEAT",
    input: GetQDailyInputSchema,
    output: GetQDailyOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<ActorContext>("CONFIDENTIAL", actor)
          : deny<ActorContext>("NOT_AVAILABLE"),
      ),
    execute: async (_input, _context, actor) => {
      const { edition, preferences } = await port.latest(actor);
      const base = {
        frequency: preferences.frequency,
        email: preferences.email,
        sections: [...preferences.sections],
        nextDueAt: preferences.nextDueAt,
      };
      if (edition === null) {
        return {
          ...base,
          status: preferences.frequency === "OFF" ? "OFF" : "NONE_YET",
          editionDate: null,
          number: null,
          href: "/daily",
          headlines: [],
          qTake: null,
        };
      }
      const stories = [
        ...(edition.lead === null
          ? []
          : [{ section: "Lead", story: edition.lead }]),
        ...edition.sections.flatMap((section) =>
          section.stories.map((story) => ({ section: section.title, story })),
        ),
        ...edition.briefs.map((story) => ({ section: "In brief", story })),
      ];
      return {
        ...base,
        status: "READY",
        editionDate: edition.editionDate,
        number: edition.number,
        href: `/daily/${edition.id}`,
        headlines: stories.slice(0, 10).map(({ section, story }) => ({
          section: section.slice(0, 80),
          headline: story.headline.slice(0, 200),
          publisher: (story.sources[0]?.publisher ?? "").slice(0, 120),
        })),
        qTake:
          edition.qTake === null
            ? null
            : edition.qTake.paragraphs.join(" ").slice(0, 1_000),
      };
    },
  });
}

export const SetQDailyPreferencesInputSchema = z
  .object({
    frequency: z
      .enum(["WEEKLY", "DAILY", "OFF"])
      .optional()
      .describe(
        "WEEKLY (Mondays, the default), DAILY (every morning) or OFF (no more editions). Only when they asked to change how often.",
      ),
    email: z
      .boolean()
      .optional()
      .describe(
        "false when they ask not to have it emailed (it stays on their dashboard); true to email it again.",
      ),
    sections: z
      .array(z.enum(Q_DAILY_OPTIONAL_SECTIONS))
      .max(5)
      .optional()
      .describe(
        "The full list of sections to keep, when they ask to add or drop one: YOUR_SECTOR, YOUR_MARKET, DEALS, PEOPLE (people they know in the news), Q_TAKE. get_q_daily returns the current list; omit to leave unchanged.",
      ),
  })
  .strict();
export type SetQDailyPreferencesInput = z.infer<
  typeof SetQDailyPreferencesInputSchema
>;

export const SetQDailyPreferencesOutputSchema = z
  .object({
    frequency: z.enum(["WEEKLY", "DAILY", "OFF"]),
    email: z.boolean(),
    sections: z.array(z.string().max(20)).max(5),
    nextDueAt: z.string().max(40).nullable(),
    meaning: z.string().max(200),
  })
  .strict();
export type SetQDailyPreferencesOutput = z.infer<
  typeof SetQDailyPreferencesOutputSchema
>;

export function createSetQDailyPreferencesTool(
  port: QDailyToolPort,
): AnyQToolDefinition {
  return defineQTool<
    SetQDailyPreferencesInput,
    SetQDailyPreferencesOutput,
    ActorContext
  >({
    ...OWN,
    id: SET_Q_DAILY_PREFERENCES,
    providerName: "set_q_daily_preferences",
    description:
      "Changes how they receive The Q Daily, at once and reversibly (Settings shows the same choices): how often (WEEKLY, DAILY or OFF), whether it is emailed, and which sections it carries. Call it only when they ask to change The Q Daily, e.g. make it weekly, send it every day, stop it, stop emailing it, drop Q's take.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    supportedPurposes: ["GENERAL_QUESTION", "ACTION_PREPARATION"],
    // Setting the same preference twice sets the same thing.
    idempotency: "SAFE_TO_REPEAT",
    input: SetQDailyPreferencesInputSchema,
    output: SetQDailyPreferencesOutputSchema,
    authorize: (input, { actor, plan }) =>
      Promise.resolve(
        !ownConversation(actor, plan)
          ? deny<ActorContext>("NOT_AVAILABLE")
          : input.frequency === undefined &&
              input.email === undefined &&
              input.sections === undefined
            ? deny<ActorContext>("NOT_AVAILABLE")
            : allow<ActorContext>("INTERNAL", actor),
      ),
    execute: async (input, _context, actor) => {
      const saved = await port.setPreferences(actor, {
        ...(input.frequency === undefined
          ? {}
          : { frequency: input.frequency }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.sections === undefined ? {} : { sections: input.sections }),
      });
      return {
        frequency: saved.frequency,
        email: saved.email,
        sections: [...saved.sections],
        nextDueAt: saved.nextDueAt,
        meaning:
          saved.frequency === "OFF"
            ? "The Q Daily is off; nothing more will be prepared or emailed."
            : `The Q Daily comes ${saved.frequency === "DAILY" ? "every morning" : "every Monday morning"}${saved.email ? ", by email and on their dashboard" : ", on their dashboard only"}.`,
      };
    },
  });
}

export const RequestQDailyInputSchema = z.object({}).strict();
export const RequestQDailyOutputSchema = z
  .object({
    status: z.enum(["QUEUED", "ALREADY_QUEUED", "TOO_SOON", "OFF"]),
    meaning: z.string().max(200),
  })
  .strict();

/**
 * Action parity (2026-10-02): "prepare my Q Daily now" does what the
 * reader's Prepare my edition button does, through the same service and
 * under the same limit; the answer says when the next one can come.
 */
export function createRequestQDailyTool(
  request: NonNullable<QDailyToolPort["request"]>,
): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof RequestQDailyInputSchema>,
    z.infer<typeof RequestQDailyOutputSchema>,
    ActorContext
  >({
    ...OWN,
    id: REQUEST_Q_DAILY,
    providerName: "request_q_daily",
    description:
      "Asks for a new edition of The Q Daily now, exactly as Prepare my edition on The Q Daily does (at most one per 20 hours). Call it only when they ask for a fresh edition now.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    supportedPurposes: [...Q_TASK_CLASSES],
    // The service coalesces: a second ask while one is queued queues nothing.
    idempotency: "SAFE_TO_REPEAT",
    input: RequestQDailyInputSchema,
    output: RequestQDailyOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<ActorContext>("INTERNAL", actor)
          : deny<ActorContext>("NOT_AVAILABLE"),
      ),
    execute: async (_input, _context, actor) => {
      const asked = await request(actor);
      return {
        status: asked.status,
        meaning:
          asked.status === "QUEUED"
            ? "A new edition is being prepared; it appears on The Q Daily when ready."
            : asked.status === "ALREADY_QUEUED"
              ? "An edition is already being prepared."
              : asked.status === "OFF"
                ? "The Q Daily is off; turn it back on first (set_q_daily_preferences)."
                : `Too soon for another edition${asked.retryAfter === null ? "" : `; the next can be asked for after ${asked.retryAfter}`}.`,
      };
    },
  });
}

export function createQDailyTools(
  port: QDailyToolPort,
): readonly AnyQToolDefinition[] {
  return [
    createGetQDailyTool(port),
    createSetQDailyPreferencesTool(port),
    ...(port.request === undefined
      ? []
      : [createRequestQDailyTool(port.request)]),
  ];
}
