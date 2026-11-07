import { z } from "zod";

import {
  UpdateViewingPrivacyRequestSchema,
  VIEWING_PRIVACY_PATH,
  ViewingPrivacyDtoSchema,
  ViewingVisibilitySchema,
  type ViewingPrivacyDto,
  type ViewingVisibility,
} from "@capital-q/contracts";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";

/**
 * Viewing privacy (Q Workspace §8 A2; Product Specification §6.7.13): how
 * identifiable a person is when they view a company. Their own setting
 * only, declared once for the Settings control and for Q, and reversible;
 * the database enforces the level whatever any caller says, and a later
 * change never shows a past view more openly than allowed when it happened.
 */

const WORDS: Readonly<Record<ViewingVisibility, string>> = {
  FULL_IDENTITY: "their name and organisation",
  ORGANISATION_ONLY: "only their organisation",
  ANONYMOUS: "nothing identifying",
};

type Outcome = ViewingPrivacyDto | "NOT_ALLOWED";

const ToolInputSchema = z
  .object({
    visibility: ViewingVisibilitySchema.describe(
      'FULL_IDENTITY (founders see their name and organisation), ORGANISATION_ONLY ("someone from <firm>") or ANONYMOUS (nothing identifying).',
    ),
  })
  .strict();

export const SET_VIEWING_PRIVACY = defineAppAction<
  z.infer<typeof UpdateViewingPrivacyRequestSchema>,
  Outcome,
  z.infer<typeof ToolInputSchema>
>({
  name: "engagement.viewing_privacy.set",
  short: "set viewing visibility",
  // Their own visibility, beside company and investor visibility.
  area: "visibility",
  // Their own reversible setting, like Q's language: done at once on their
  // word (DECISIONS 71: approval is for what is outward or binding). The
  // database never shows a past view more openly than allowed then.
  classification: "INSTANT",
  does: "Sets what founders see when this person views their company: name, organisation only, or nothing identifying.",
  input: UpdateViewingPrivacyRequestSchema,
  output: z.custom<Outcome>(),
  // Their own row only: the input names nobody, and the platform's allowed
  // levels are checked by the service in the same statement as the write.
  authorize: (ports) =>
    Promise.resolve(
      ports.viewingPrivacy === undefined
        ? { ok: false, reason: "Viewing privacy isn't available here." }
        : { ok: true },
    ),
  run: (ports, context, input) =>
    (ports.viewingPrivacy ?? portMissing("viewingPrivacy")).setPrivacy(
      context.actor,
      input.visibility,
    ),
  targets: () => [],
  card: (input) => ({
    summary: `When you view a company, founders see ${WORDS[input.visibility]}`,
    preview:
      "Applies to your future views and to how founders see past ones; a past view is never shown more openly than you allowed then.",
  }),
  succeeded: (out) => out !== "NOT_ALLOWED",
  done: (out, input) =>
    out === "NOT_ALLOWED"
      ? "That level isn't offered on Capital Q right now; nothing changed."
      : `Done. When you view a company, founders now see ${WORDS[input.visibility]}.`,
  http: {
    method: "PUT",
    path: VIEWING_PRIVACY_PATH,
    fromRequest: (_params, body) => body,
    problem: (out) =>
      out === "NOT_ALLOWED"
        ? {
            code: "VALIDATION_FAILED",
            detail: "That visibility level is not offered on Capital Q.",
          }
        : null,
    respond: (out) =>
      ViewingPrivacyDtoSchema.parse(out === "NOT_ALLOWED" ? null : out),
  },
  tool: {
    name: "set_viewing_privacy",
    description:
      "Sets what founders see when the person views a company: their name and organisation, only their organisation, or nothing identifying. Their own setting only, done at once and reversible; it names nobody else.",
    input: ToolInputSchema,
    references: {},
    // Their own settings: offered unfocused on their own-context turns, and
    // by name on any turn.
    purposes: ["GENERAL_QUESTION"],
    eval: {
      say: [
        "Make me anonymous when I look at companies.",
        "Let founders see my firm when I view them.",
      ],
    },
    toCanonical: (input) => Promise.resolve({ visibility: input.visibility }),
  },
});

export const ENGAGEMENT_ACTIONS: readonly AnyAppAction[] = [
  SET_VIEWING_PRIVACY,
];
