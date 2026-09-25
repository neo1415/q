import { z } from "zod";

import {
  QChallengeLevelSchema,
  QExplanationStyleSchema,
  QQuestionStyleSchema,
  QResponseDepthSchema,
  QToneSchema,
} from "@capital-q/contracts";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * NOTE_PREFERENCE — `memory.preference.note` v1 (CQ-QX-007 P0-5; ADR 0012).
 *
 * The person said how they want Q to talk — "just give me the result",
 * "you're talking too much", "be tougher on me" — and it should hold from
 * the next turn, not only after the run's learner. The MODEL decides that
 * a preference was expressed and reads it into one closed aspect of the
 * communication profile; nothing here matches words.
 *
 * It never writes a memory itself. It proposes to the ADR 0012 memory
 * Write Gate through a port, which verifies the quote against the
 * person's own recorded words, refuses anything else, and supersedes an
 * earlier value for the same aspect. A preference changes how Q speaks
 * and never what anybody may see or do.
 */
export const NOTE_PREFERENCE = "memory.preference.note" as const;

const persistence = z
  .enum(["SESSION", "LONG_TERM"])
  .describe(
    "SESSION: for the rest of this conversation. LONG_TERM: from now on, in every conversation. Use LONG_TERM only when they said it as a general rule.",
  );
const quote = z
  .string()
  .trim()
  .min(3)
  .max(400)
  .describe("Their exact words that express the preference, verbatim.");

export const NotePreferenceInputSchema = z.discriminatedUnion("aspect", [
  z
    .object({
      aspect: z.literal("responseDepth"),
      value: QResponseDepthSchema,
      persistence,
      quote,
    })
    .strict(),
  z
    .object({
      aspect: z.literal("tone"),
      value: QToneSchema,
      persistence,
      quote,
    })
    .strict(),
  z
    .object({
      aspect: z.literal("challengeLevel"),
      value: QChallengeLevelSchema,
      persistence,
      quote,
    })
    .strict(),
  z
    .object({
      aspect: z.literal("questionStyle"),
      value: QQuestionStyleSchema,
      persistence,
      quote,
    })
    .strict(),
  z
    .object({
      aspect: z.literal("explanationStyle"),
      value: QExplanationStyleSchema,
      persistence,
      quote,
    })
    .strict(),
]);
export type NotePreferenceInput = z.infer<typeof NotePreferenceInputSchema>;

export const NotePreferenceOutputSchema = z
  .object({
    outcome: z.enum(["REMEMBERED", "UNCHANGED", "REFUSED"]),
    /** The gate's own reason code; never a stored value or a quote. */
    reason: z.string().max(64),
  })
  .strict();
export type NotePreferenceOutput = z.infer<typeof NotePreferenceOutputSchema>;

/**
 * The person's own memory, bound for one conversation by the app that
 * holds it. Implemented over the ADR 0012 memory service
 * (`createPreferenceNotebook` in q-knowledge).
 */
export type PreferenceNotePort = {
  /** The user whose memory this is. Authorisation compares, never trusts. */
  readonly ownerUserId: string;
  readonly note: (
    input: NotePreferenceInput & {
      /** What the person said this turn, for quote verification. */
      readonly latestUserText: string | null;
    },
  ) => Promise<NotePreferenceOutput>;
};

type Grant = { readonly userId: string };

export function createNotePreferenceTool(
  port: PreferenceNotePort,
): AnyQToolDefinition {
  return defineQTool<NotePreferenceInput, NotePreferenceOutput, Grant>({
    id: NOTE_PREFERENCE,
    version: 1,
    status: "ACTIVE",
    providerName: "note_preference",
    description:
      "Records how the person has just asked you to communicate — shorter or fuller answers, tone, how hard to challenge, how many questions to ask, summary or analysis first — so it holds from the next turn. Call it only when they expressed such a preference, with their exact words as quote. It changes how you speak, never what you know or do. Result: REMEMBERED, UNCHANGED (already so) or REFUSED (with a reason).",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    supportedPurposes: [
      "GENERAL_QUESTION",
      "OWN_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "RELATIONSHIP_QUESTION",
      "COMPARISON",
    ],
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    // The gate dedupes by content hash and supersedes by key.
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-knowledge",
    visibleStage: null,
    input: NotePreferenceInputSchema,
    output: NotePreferenceOutputSchema,
    authorize: (_input, context) => {
      // The actor-wide own-conversation scope, filtered to this very
      // person, and a memory port bound to them: all three required.
      const scope = actorWideScope(context.plan, "OWN_Q_CONVERSATION");
      if (
        scope === undefined ||
        scope.filter.userId !== context.actor.userId ||
        context.actor.userId !== port.ownerUserId
      ) {
        return Promise.resolve(deny<Grant>("NOT_AVAILABLE"));
      }
      return Promise.resolve(
        allow<Grant>("CONFIDENTIAL", { userId: context.actor.userId }),
      );
    },
    execute: (input, context) =>
      port.note({
        ...input,
        latestUserText: context.conversation?.latestUserText ?? null,
      }),
  });
}
