import { z } from "zod";

import {
  Q_TASK_CLASSES,
  QLanguagePreferenceSchema,
  QPersonalitySchema,
  QSetLanguageIntentSchema,
  type PermittedContextPlan,
  type QLanguagePreference,
  type QPersonality,
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
 * Settings the person flips in Settings, by asking (action parity
 * 2026-10-02: "every mouse or keyboard action doable by telling Q"). Each
 * is the person's own reversible preference, set through the same store
 * the Settings switch writes, as the actor, at once -- like Q motion, voice
 * or The Q Daily's frequency. No input names a person.
 */

export const SET_NOTIFICATION_SETTINGS = "settings.notifications.set" as const;
export const SET_Q_PERSONALITY = "settings.q_personality.set" as const;
export const SET_Q_LANGUAGE = "settings.q_language.set" as const;

/** The person's own language for Q, the store Settings' Language writes. */
export type QLanguagePort = {
  readonly set: (
    actor: ActorContext,
    language: QLanguagePreference,
  ) => Promise<void>;
  /**
   * What they asked for ("fr", "French", "français", "الفرنسية") as an
   * offered language, or null when Capital Q cannot offer it. Composition
   * passes q-core's registry (Intl data); nothing here lists languages.
   */
  readonly resolve: (asked: string) => {
    readonly tag: string;
    readonly nativeName: string;
    readonly englishName: string;
  } | null;
};

export type NotificationSettingsPort = {
  readonly read: (
    actor: ActorContext,
  ) => Promise<{ readonly push: boolean; readonly email: boolean }>;
  readonly save: (
    actor: ActorContext,
    settings: { readonly push: boolean; readonly email: boolean },
  ) => Promise<void>;
};

export type QPersonalityPort = {
  readonly set: (
    actor: ActorContext,
    personality: QPersonality,
  ) => Promise<void>;
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
  supportedPurposes: [...Q_TASK_CLASSES],
  requiredScopeKinds: ["OWN_Q_CONVERSATION"],
  approval: "NONE",
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
  visibleStage: null,
  classification: "SIDE_EFFECT",
  riskClass: "LOW_RISK_INTERNAL",
} as const;

export const SetNotificationSettingsInputSchema = z
  .object({
    push: z
      .boolean()
      .optional()
      .describe(
        "false: no more push notifications to their devices; true: pushes again. Only when they asked about pushes.",
      ),
    email: z
      .boolean()
      .optional()
      .describe(
        "false: no more notification emails; true: emails again. Only when they asked about email.",
      ),
  })
  .strict()
  .refine((input) => input.push !== undefined || input.email !== undefined, {
    message: "say which channel: push, email or both",
  });

export const SetNotificationSettingsOutputSchema = z
  .object({
    push: z.boolean(),
    email: z.boolean(),
    meaning: z.string().max(240),
  })
  .strict();

export function createSetNotificationSettingsTool(
  port: NotificationSettingsPort,
): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof SetNotificationSettingsInputSchema>,
    z.infer<typeof SetNotificationSettingsOutputSchema>,
    ActorContext
  >({
    ...OWN,
    id: SET_NOTIFICATION_SETTINGS,
    providerName: "set_notification_settings",
    description:
      "Turns their notifications on or off by channel (push to their devices, email), at once and reversibly, exactly as the switches in Settings do. Call it only when they ask to stop or restart notifications.",
    input: SetNotificationSettingsInputSchema,
    output: SetNotificationSettingsOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<ActorContext>("INTERNAL", actor)
          : deny<ActorContext>("NOT_AVAILABLE"),
      ),
    execute: async (input, _context, actor) => {
      const current = await port.read(actor);
      const next = {
        push: input.push ?? current.push,
        email: input.email ?? current.email,
      };
      await port.save(actor, next);
      const on = [next.push ? "push" : null, next.email ? "email" : null]
        .filter((channel) => channel !== null)
        .join(" and ");
      return {
        ...next,
        meaning:
          on === ""
            ? "Notifications are off on both channels; they still appear in the notices panel."
            : `Notifications come by ${on}${next.push ? " (push reaches a device only once it is allowed in the browser)" : ""}.`,
      };
    },
  });
}

export const SetQPersonalityInputSchema = z
  .object({
    personality: QPersonalitySchema.describe(
      "AUTO (Q adapts), WARM, WITTY, SHARP or CALM: the one they chose.",
    ),
  })
  .strict();

export const SetQPersonalityOutputSchema = z
  .object({ personality: QPersonalitySchema, done: z.boolean() })
  .strict();

export function createSetQPersonalityTool(
  port: QPersonalityPort,
): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof SetQPersonalityInputSchema>,
    z.infer<typeof SetQPersonalityOutputSchema>,
    ActorContext
  >({
    ...OWN,
    id: SET_Q_PERSONALITY,
    providerName: "set_q_personality",
    description:
      "Sets which personality Q speaks with for them (AUTO, WARM, WITTY, SHARP or CALM), at once and reversibly, exactly as the choice in Settings does. Call it only when they name one of these.",
    input: SetQPersonalityInputSchema,
    output: SetQPersonalityOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<ActorContext>("INTERNAL", actor)
          : deny<ActorContext>("NOT_AVAILABLE"),
      ),
    execute: async (input, _context, actor) => {
      await port.set(actor, input.personality);
      return { personality: input.personality, done: true };
    },
  });
}

export const SetQLanguageInputSchema = z
  .object({
    language: z
      .string()
      .min(1)
      .max(60)
      .describe(
        "The language they asked for: its BCP 47 tag when you know it (fr, es, pt-BR, sw, ur, ja), else its name exactly as they said it (français, Kiswahili, الفرنسية), or AUTO to follow their device.",
      ),
  })
  .strict();

export const SetQLanguageOutputSchema = z
  .object({
    /** The saved choice (canonical tag or AUTO); null when nothing changed. */
    language: QLanguagePreferenceSchema.nullable(),
    done: z.boolean(),
    /** The screen switches language and direction at once (no reload). */
    clientAction: QSetLanguageIntentSchema.nullable(),
    /** What Q says back. */
    confirm: z.string().max(400),
  })
  .strict();

/**
 * Q's confirmation where a hand-written line exists (trusted product copy,
 * keyed by primary subtag); any other language gets the English line with
 * the instruction to say it in the new language, which Q's reply then is.
 */
export const LANGUAGE_CONFIRMATIONS: Readonly<Record<string, string>> = {
  ar: "تم. سأتحدث معك بالعربية من الآن، وتتحول الشاشات إلى العربية.",
  en: "Done. I'll speak English with you from now on, and your screens are in English.",
  AUTO: "Done. I'll follow your device's language from now on.",
};

/** Examples named in a refusal: an illustration, not the list (any offered language works). */
const REFUSAL_EXAMPLES = "French, Spanish, Portuguese, Arabic, Swahili, Hindi or Japanese";

export function createSetQLanguageTool(
  port: QLanguagePort,
): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof SetQLanguageInputSchema>,
    z.infer<typeof SetQLanguageOutputSchema>,
    ActorContext
  >({
    ...OWN,
    id: SET_Q_LANGUAGE,
    providerName: "set_q_language",
    description:
      'Sets the language Q and Capital Q use with them (any language, or automatic from their device), at once and reversibly, exactly as Language in Settings does: their screens, Q\'s replies and voice switch. Call it when they ask to change language or to be spoken to in a language, in any words and any language ("switch to French", "parle-moi en français", "تكلم فرنسي", "speak English please"). Their own setting only; it takes no person. After it, reply with its confirm line as your whole reply, in the language it names; if done is false, say the confirm line and change nothing.',
    input: SetQLanguageInputSchema,
    output: SetQLanguageOutputSchema,
    // Their own conversation and their own row: the input names nobody,
    // and an agent or a delegated run may not change a person's language.
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<ActorContext>("INTERNAL", actor)
          : deny<ActorContext>("NOT_AVAILABLE"),
      ),
    execute: async (input, _context, actor) => {
      const asked = input.language.trim();
      if (asked.toUpperCase() === "AUTO") {
        await port.set(actor, "AUTO");
        return {
          language: "AUTO",
          done: true,
          clientAction: { kind: "SET_LANGUAGE", language: "AUTO" },
          confirm: LANGUAGE_CONFIRMATIONS["AUTO"] ?? "Done.",
        };
      }
      const resolved = port.resolve(asked);
      if (resolved === null) {
        // Honest: nothing is saved, and the person hears what Q can do.
        return {
          language: null,
          done: false,
          clientAction: null,
          confirm: `I can't do ${asked.slice(0, 60)} yet: it isn't a language Capital Q can offer. I can use almost any other, for example ${REFUSAL_EXAMPLES}; you can also choose one in Settings, under Language.`,
        };
      }
      await port.set(actor, resolved.tag);
      const primary = resolved.tag.split("-")[0] ?? resolved.tag;
      const handWritten = LANGUAGE_CONFIRMATIONS[primary];
      return {
        language: resolved.tag,
        done: true,
        clientAction: { kind: "SET_LANGUAGE", language: resolved.tag },
        confirm:
          handWritten ??
          `Say this in ${resolved.englishName} (${resolved.nativeName}): "Done. I'll speak ${resolved.englishName} with you from now on, and your screens switch to ${resolved.englishName}; anything not yet translated stays in English for a moment."`,
      };
    },
  });
}

export function createOwnSettingsTools(ports: {
  readonly notificationSettings?: NotificationSettingsPort | undefined;
  readonly personality?: QPersonalityPort | undefined;
  readonly language?: QLanguagePort | undefined;
}): readonly AnyQToolDefinition[] {
  return [
    ...(ports.notificationSettings === undefined
      ? []
      : [createSetNotificationSettingsTool(ports.notificationSettings)]),
    ...(ports.personality === undefined
      ? []
      : [createSetQPersonalityTool(ports.personality)]),
    ...(ports.language === undefined
      ? []
      : [createSetQLanguageTool(ports.language)]),
  ];
}
