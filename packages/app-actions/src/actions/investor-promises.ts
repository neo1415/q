import { z } from "zod";

import {
  ApplyThesisSuggestionRequestSchema,
  ASSUMPTION_QUESTION_MAX_LENGTH,
  ASSUMPTION_QUESTIONS_SEND_MAX,
  DILIGENCE_QUESTIONS_PATH,
  diligenceQuestionsText,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  InvestorMandateDtoSchema,
  MANDATE_SUGGESTION_APPLY_PATH,
  SendDiligenceQuestionsRequestSchema,
  SendDiligenceQuestionsResultSchema,
  ThesisSuggestionIdSchema,
  type KnownErrorCode,
  type SendDiligenceQuestionsResult,
} from "@capital-q/contracts";
import { thesisSuggestionPatch } from "@capital-q/discovery";
import {
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  toInvestorMandateDto,
  type InvestorMandate,
} from "@capital-q/investors";

import {
  defineAppAction,
  portMissing,
  refusal,
  relationshipTarget,
  type AnyAppAction,
  type AppActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Investor promises (2026-10-07), the two consequential steps:
 *
 * - Q.07: the investor sends the questions they picked from "Assumptions
 *   to test" to the company, in their exact approved wording: a diligence
 *   request while the relationship is in diligence, else one message in
 *   the connected relationship's chat. The existing services decide who
 *   is a party and whether diligence is open; this adds no new authority.
 *   One idempotency key covers the whole send, so a retry sends once.
 *
 * - Q.02: the investor approves one of Q's thesis suggestions. It becomes
 *   the ordinary mandate update at the version they read; a mandate that
 *   changed since is a conflict, and a suggestion that no longer applies
 *   changes nothing. Observed behaviour never edits the mandate by itself.
 */

const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

// --- Q.07: send the picked questions ----------------------------------------

const Send = z
  .object({
    relationshipId: z.string().max(64),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: SendDiligenceQuestionsRequestSchema,
  })
  .strict();
type SendInput = z.infer<typeof Send>;

type SendOut =
  | { readonly outcome: "OK"; readonly value: SendDiligenceQuestionsResult }
  | {
      readonly outcome: "REFUSED";
      readonly code: "NOT_FOUND" | "NOT_CONNECTED" | "INVESTOR_ONLY";
    };

const SEND_REFUSALS: Readonly<
  Record<
    Extract<SendOut, { outcome: "REFUSED" }>["code"],
    { readonly code: KnownErrorCode; readonly detail: string }
  >
> = {
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_CONNECTED: {
    code: "RESOURCE_CONFLICT",
    detail:
      "You aren't connected with this company yet. Questions go once you are.",
  },
  INVESTOR_ONLY: {
    code: "PERMISSION_DENIED",
    detail: "Only the investor's side sends diligence questions.",
  },
};

const SendTool = z
  .object({
    relationship: z
      .string()
      .min(1)
      .max(200)
      .describe("The company they want to ask, as they named it."),
    questions: z
      .array(z.string().trim().min(3).max(ASSUMPTION_QUESTION_MAX_LENGTH))
      .min(1)
      .max(ASSUMPTION_QUESTIONS_SEND_MAX)
      .describe(
        "The questions, word for word as they picked or approved them (from company_assumptions, or their own).",
      ),
    about: z
      .array(
        z
          .string()
          .regex(/^[A-Z_]{3,24}:(\d{1,2}|unknown)$/)
          .nullable(),
      )
      .max(ASSUMPTION_QUESTIONS_SEND_MAX)
      .optional()
      .describe(
        "For each question in order, the company_assumptions id it came from (null for their own question).",
      ),
  })
  .strict();

/** "TRACTION:1" -> "Traction": what a question is about, in words. */
const aboutWords = (assumptionId: string) => {
  const section = assumptionId.split(":")[0] ?? "";
  const words = section.toLowerCase().replaceAll("_", " ");
  return words.length === 0
    ? "Assumption"
    : words.charAt(0).toUpperCase() + words.slice(1);
};

/** The send itself: a diligence request while in diligence, else one chat message. */
async function sendQuestions(
  ports: AppActionPorts,
  context: AppActionContext,
  input: SendInput,
): Promise<SendOut> {
  const { title, body } = diligenceQuestionsText(input.input.questions);
  const diligence = ports.diligence ?? portMissing("diligence");
  const asked = await diligence.request({
    actor: context.actor,
    relationshipId: input.relationshipId,
    title,
    note: body,
    idempotencyKey: input.idempotencyKey,
    correlationId: context.correlationId,
  });
  if (asked.outcome === "OK") {
    return {
      outcome: "OK",
      value: { via: "DILIGENCE_REQUEST", id: asked.value.requestId },
    };
  }
  if (asked.code === "NOT_FOUND") {
    return { outcome: "REFUSED", code: "NOT_FOUND" };
  }
  if (asked.code === "INVESTOR_ONLY") {
    return { outcome: "REFUSED", code: "INVESTOR_ONLY" };
  }
  if (asked.code !== "NOT_OPEN") {
    return { outcome: "REFUSED", code: "NOT_CONNECTED" };
  }
  // Not in diligence: one chat message, under the same key, on a
  // connected relationship only (the chat service refuses otherwise).
  const chat = ports.chat ?? portMissing("chat");
  try {
    const sent = await chat.send({
      actor: context.actor,
      relationshipId: input.relationshipId,
      request: {
        kind: "TEXT",
        body: `${input.input.questions.length === 1 ? "A question" : "A few questions"} for you:\n${body}`,
      },
      idempotencyKey: `${input.idempotencyKey}:chat`,
    });
    return {
      outcome: "OK",
      value: { via: "CHAT_MESSAGE", id: sent.message.messageId },
    };
  } catch {
    return { outcome: "REFUSED", code: "NOT_CONNECTED" };
  }
}

const SEND_QUESTIONS = defineAppAction<
  SendInput,
  SendOut,
  z.infer<typeof SendTool>
>({
  name: "diligence.questions.send",
  short: "send questions to a company",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Sends an investor's chosen questions to a company: a diligence request while in diligence, otherwise one message in their connected chat.",
  input: Send,
  output: z.custom<SendOut>(),
  authorize: () => Promise.resolve({ ok: true as const }),
  run: async (ports, context, input) => {
    const out = await sendQuestions(ports, context, input);
    if (out.outcome === "OK") {
      // 2026-10-08: each question is recorded for the founder to answer
      // (their inbox) and for this investor to see answered. Best-effort:
      // the questions were sent either way.
      await ports.founderRequests
        ?.recordQuestions({
          actor: context.actor,
          relationshipId: input.relationshipId,
          sentVia: out.value.via,
          sentRef: out.value.id,
          idempotencyKey: input.idempotencyKey,
          questions: input.input.questions.map((question, index) => ({
            question: question.trim(),
            assumptionId: input.input.about?.[index]?.assumptionId ?? null,
            assumptionLabel: input.input.about?.[index]?.label ?? null,
          })),
          correlationId: context.correlationId,
        })
        .catch(() => undefined);
    }
    return out;
  },
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input, names) => {
    const { body } = diligenceQuestionsText(input.input.questions);
    const count = input.input.questions.length;
    const what =
      count === 1 ? "this question" : `these ${String(count)} questions`;
    return {
      summary:
        names?.counterpart == null
          ? `Send ${what}`
          : `Send ${names.counterpart} ${what}`,
      preview: body,
    };
  },
  done: (out) =>
    out.outcome === "OK"
      ? out.value.via === "DILIGENCE_REQUEST"
        ? "Sent. They'll see it on their diligence checklist."
        : "Sent in your chat with them."
      : SEND_REFUSALS[out.code].detail,
  succeeded: (out) => out.outcome === "OK",
  http: {
    method: "POST",
    path: DILIGENCE_QUESTIONS_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    status: 201,
    problem: (out) => (out.outcome === "OK" ? null : SEND_REFUSALS[out.code]),
    notFound: (out) => out.outcome === "REFUSED" && out.code === "NOT_FOUND",
    respond: (out) =>
      out.outcome === "OK"
        ? SendDiligenceQuestionsResultSchema.parse(out.value)
        : undefined,
  },
  tool: {
    name: "send_questions_to_founder",
    description:
      "Prepares, for the investor's approval, sending the questions they chose to a company they are connected with: a diligence request while in diligence, otherwise one chat message. Use the exact wording they picked (company_assumptions gives Q's suggested questions). Nothing is sent until they approve exactly it.",
    input: SendTool,
    references: { relationship: "RELATIONSHIP" },
    purposes: ["RELATIONSHIP_QUESTION", "COUNTERPARTY_COMPANY_QUESTION"],
    eval: {
      say: [
        "Send {name} those three questions.",
        "Ask {name} about their burn and runway.",
      ],
      names: "RELATIONSHIP",
    },
    toCanonical: (tool, context) =>
      Promise.resolve({
        relationshipId: tool.relationship,
        idempotencyKey: context.idempotencyKey,
        input: {
          questions: tool.questions,
          ...(tool.about === undefined
            ? {}
            : {
                about: tool.questions.map((_question, index) => {
                  const id = tool.about?.[index] ?? null;
                  return id === null
                    ? null
                    : { assumptionId: id, label: aboutWords(id) };
                }),
              }),
        },
      }),
  },
});

// --- Q.02: approve one of Q's thesis suggestions -------------------------

const Apply = z
  .object({
    investorOrganisationId: InvestorOrganisationIdSchema,
    mandateId: InvestorMandateIdSchema,
    suggestionId: ThesisSuggestionIdSchema,
    input: ApplyThesisSuggestionRequestSchema,
  })
  .strict();
type ApplyInput = z.infer<typeof Apply>;
type ApplyOut = InvestorMandate | null;

const ApplyTool = z
  .object({
    suggestion: ThesisSuggestionIdSchema.describe(
      "The suggestion's id from thesis_reading (ADD_COUNTRY:GH, DROP_STAGE:pre_seed).",
    ),
  })
  .strict();

const SUGGESTION_WORDS = (id: string): string => {
  const [kind, value = ""] = id.split(":");
  return kind === "ADD_COUNTRY"
    ? `Add ${value.toUpperCase()} to your countries`
    : `Start your stages after ${value.replace(/_/g, "-")}`;
};

const APPLY_SUGGESTION = defineAppAction<
  ApplyInput,
  ApplyOut,
  z.infer<typeof ApplyTool>
>({
  name: "investor.mandate.suggestion.apply",
  consequence: "COMMITMENT",
  short: "apply a thesis suggestion",
  area: "mandate",
  classification: "CONSEQUENTIAL",
  does: "Applies one of Q's suggestions from 'How Q reads your thesis' to their mandate, as the ordinary mandate update, only when they approve it.",
  input: Apply,
  output: z.custom<ApplyOut>(),
  authorize: () => Promise.resolve({ ok: true as const }),
  run: async (ports, context, input) => {
    const investors = ports.investors ?? portMissing("investors");
    // The investor service authorises the read and the update (their own
    // organisation's mandate only); the version they read is enforced.
    const mandate = InvestorMandateDtoSchema.parse(
      toInvestorMandateDto(
        await investors.getInvestorMandate({
          actor: context.actor,
          investorOrganisationId: input.investorOrganisationId,
          mandateId: input.mandateId,
        }),
      ),
    );
    const patch = thesisSuggestionPatch(
      mandate,
      input.suggestionId,
      input.input.expectedVersion,
    );
    if (patch === null) return null;
    return investors.updateInvestorMandate({
      actor: context.actor,
      investorOrganisationId: input.investorOrganisationId,
      mandateId: input.mandateId,
      input: patch,
      correlationId: context.correlationId,
    });
  },
  targets: (input) => [
    {
      kind: "INVESTOR_ORGANISATION",
      investorOrganisationId: input.investorOrganisationId,
    },
  ],
  card: (input) => ({
    summary: "Change your mandate",
    preview: `${SUGGESTION_WORDS(input.suggestionId)}. Q suggested it from what you saved and passed; nothing else changes.`,
  }),
  done: (out) =>
    out === null
      ? "That suggestion no longer fits your mandate, so nothing changed."
      : "Done. Your mandate is updated, and your feed follows it.",
  succeeded: (out) => out !== null,
  http: {
    method: "POST",
    path: MANDATE_SUGGESTION_APPLY_PATH,
    fromRequest: (params, body) => ({
      investorOrganisationId: params["investorOrganisationId"],
      mandateId: params["mandateId"],
      suggestionId: params["suggestionId"],
      input: body,
    }),
    problem: (out) =>
      out === null
        ? {
            code: "RESOURCE_CONFLICT",
            detail: "That suggestion no longer fits your mandate.",
          }
        : null,
    respond: (out) =>
      out === null
        ? undefined
        : InvestorMandateDtoSchema.parse(toInvestorMandateDto(out)),
  },
  tool: {
    name: "apply_thesis_suggestion",
    description:
      "Prepares, for the investor's approval, applying one suggestion from thesis_reading to their own active mandate (add a country they keep saving, or drop the earliest stage they keep passing). Nothing changes until they approve exactly it.",
    input: ApplyTool,
    references: {},
    purposes: ["INVESTOR_QUESTION", "ACTION_PREPARATION"],
    eval: {
      say: [
        "Yes, add Ghana to my countries like you suggested.",
        "Apply your suggestion to drop pre-seed.",
      ],
      orSays: "no longer fits|no active mandate",
    },
    toCanonical: async (tool, context, ports) => {
      const own = await ports.ownInvestorOrganisationId?.(context.actor);
      if (own === null || own === undefined) {
        return refusal("Thesis suggestions are for an investor's own mandate.");
      }
      const organisation = InvestorOrganisationIdSchema.parse(own);
      const page = await ports.investors
        ?.listInvestorMandates({
          actor: context.actor,
          investorOrganisationId: organisation,
          limit: 20,
        })
        .catch(() => null);
      const active = page?.items.find((item) => item.status === "ACTIVE");
      if (active === undefined) {
        return refusal("You have no active mandate to change yet.");
      }
      return {
        investorOrganisationId: organisation,
        mandateId: active.id,
        suggestionId: tool.suggestion,
        input: { expectedVersion: active.version },
      };
    },
  },
});

export const INVESTOR_PROMISE_ACTIONS: readonly AnyAppAction[] = [
  SEND_QUESTIONS,
  APPLY_SUGGESTION,
];
