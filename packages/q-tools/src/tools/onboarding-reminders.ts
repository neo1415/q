import { z } from "zod";

import {
  Q_TASK_CLASSES,
  QClientActionToolResultSchema,
  type PermittedContextPlan,
  type QClientActionToolResult,
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
 * Setup reminders (founder directive 2026-09-27), by text or by voice:
 * "remind me later", "stop reminding me", and "let's finish my setup".
 * The model decides that the person asked; these steps decide the rest.
 *
 * Both act on the caller's own record only. The port is keyed by the
 * actor's own user id; no input names a person, a session or a journey.
 * `set_onboarding_reminders` is the one write lane (LOW_RISK_INTERNAL /
 * SIDE_EFFECT): their own reminder preference, at their word, reversible
 * by the same word. `continue_onboarding` is a client action: the screen
 * takes them to their own unfinished setup, found on the server.
 */

export const SET_ONBOARDING_REMINDERS = "onboarding.reminders.set" as const;
export const CONTINUE_ONBOARDING = "client.setup.open" as const;

export type OnboardingRemindersPort = {
  /** "LATER" puts reminders off for a few days; "STOP" until they return. */
  readonly choose: (
    actor: ActorContext,
    choice: "LATER" | "STOP",
  ) => Promise<void>;
  /** Their own unfinished setup, if there is one. */
  readonly unfinished: (
    actor: ActorContext,
  ) => Promise<"founder" | "investor" | null>;
};

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

export const SetOnboardingRemindersInputSchema = z
  .object({
    choice: z
      .enum(["LATER", "STOP"])
      .describe(
        "LATER: they want reminding later, not now. STOP: they do not want reminders about finishing their setup at all.",
      ),
  })
  .strict();
export type SetOnboardingRemindersInput = z.infer<
  typeof SetOnboardingRemindersInputSchema
>;

export const SetOnboardingRemindersOutputSchema = z
  .object({
    recorded: z.enum(["LATER", "STOP"]),
    /** Plain words for the model to relay; never a promise beyond them. */
    meaning: z.string().max(200),
  })
  .strict();
export type SetOnboardingRemindersOutput = z.infer<
  typeof SetOnboardingRemindersOutputSchema
>;

type ReminderGrant = { readonly actor: ActorContext };

export function createSetOnboardingRemindersTool(
  port: OnboardingRemindersPort,
): AnyQToolDefinition {
  return defineQTool<
    SetOnboardingRemindersInput,
    SetOnboardingRemindersOutput,
    ReminderGrant
  >({
    id: SET_ONBOARDING_REMINDERS,
    version: 1,
    status: "ACTIVE",
    providerName: "set_onboarding_reminders",
    description:
      "Records how they want to be reminded to finish their Capital Q setup: LATER when they say remind me later / not now, STOP when they say stop reminding me / don't remind me. Call it only when they asked about the setup reminders. It happens at once.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    core: true,
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    // Setting the same preference twice sets the same thing.
    idempotency: "SAFE_TO_REPEAT",
    owner: "onboarding",
    visibleStage: null,
    input: SetOnboardingRemindersInputSchema,
    output: SetOnboardingRemindersOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<ReminderGrant>("INTERNAL", { actor })
          : deny<ReminderGrant>("NOT_AVAILABLE"),
      ),
    execute: async (input, _context, grant) => {
      await port.choose(grant.actor, input.choice);
      return {
        recorded: input.choice,
        meaning:
          input.choice === "LATER"
            ? "No setup reminders for the next few days."
            : "No more setup reminders unless they go back to their setup themselves.",
      };
    },
  });
}

export const ContinueOnboardingInputSchema = z.object({}).strict();
export type ContinueOnboardingInput = z.infer<
  typeof ContinueOnboardingInputSchema
>;

export function createContinueOnboardingTool(
  port: OnboardingRemindersPort,
): AnyQToolDefinition {
  return defineQTool<
    ContinueOnboardingInput,
    QClientActionToolResult,
    QClientActionToolResult
  >({
    id: CONTINUE_ONBOARDING,
    version: 1,
    status: "ACTIVE",
    providerName: "continue_onboarding",
    description:
      "Takes them to their own unfinished Capital Q setup, where they left off. Call it when they ask to continue, finish or go back to their setup or onboarding. NOT_AVAILABLE means there is no unfinished setup: say their setup is complete.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    core: true,
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: null,
    input: ContinueOnboardingInputSchema,
    output: QClientActionToolResultSchema,
    authorize: async (_input, { actor, plan }) => {
      if (!ownConversation(actor, plan)) {
        return deny<QClientActionToolResult>("NOT_AVAILABLE");
      }
      const journey = await port.unfinished(actor).catch(() => null);
      return journey === null
        ? deny<QClientActionToolResult>("NOT_AVAILABLE")
        : allow<QClientActionToolResult>("INTERNAL", {
            status: "SCREEN_WILL_DO_IT",
            clientAction: { kind: "OPEN_SETUP", journey },
          });
    },
    execute: (_input, _context, grant) => Promise.resolve(grant),
  });
}

export function createOnboardingReminderTools(
  port: OnboardingRemindersPort,
): readonly AnyQToolDefinition[] {
  return [
    createSetOnboardingRemindersTool(port),
    createContinueOnboardingTool(port),
  ];
}
