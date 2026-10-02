import { z } from "zod";

import {
  COMPANY_EDITABLE_FIELDS,
  OnboardingResponseValueSchema,
  QActionTypeSchema,
  UpdateCompanyRequestSchema,
  UuidSchema,
  type CompanyEditableField,
  type OnboardingResponseValue,
  type QSubjectRef,
} from "@capital-q/contracts";
import {
  CompanyIdSchema,
  type CompanyQueryPort,
  type CompanyService,
} from "@capital-q/companies";
import { FOUNDER_STEPS, normaliseWebsite } from "@capital-q/founder-onboarding";
import type { Logger } from "@capital-q/observability";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import {
  RESEARCHABLE_FOUNDER_ANSWERS,
  type ProfileGapsPort,
  type ResearchableFounderAnswer,
} from "@capital-q/q-tools";
import { capability, type AuthorizationService } from "@capital-q/security";
import { REFERENCE_TAXONOMY } from "@capital-q/taxonomy";

import {
  CompanyProfileUpdatePayloadSchema,
  describeCompanyProfileChanges,
  refusalReason,
} from "./company-profile-action.js";
import {
  PROFILE_ANSWER_STEPS,
  resolveProfileAnswer,
  type ProfileAnswersPort,
} from "./profile-answer-action.js";
import { savedReadsLine } from "./saved-line.js";
import { definitionFor, optionsOf } from "../voice/interview-steps.js";

/**
 * Filling the gaps in a founder's profile from public sources, as ONE
 * approval (HARDEN P0, live 2026-10-02, Nixo).
 *
 * The company's declared fields and the setup answers public research can
 * fill (categories, number of founders, team size, team functions) go on
 * one card, with the sources named, saved as the founder's stated details.
 * On approval each part goes through its own owner's path: the companies
 * context's update for the fields, the onboarding runtime's revision of
 * their own completed session for each answer (ADR 0024), exactly as the
 * profile page and the setup review would.
 */

export const PROFILE_GAPS_FILL = QActionTypeSchema.parse("profile.gaps.fill");

const AnswerSchema = z
  .object({
    stepKey: z.string().min(1).max(120),
    value: OnboardingResponseValueSchema,
    preview: z.string().min(1).max(2000),
  })
  .strict();

export const ProfileGapsPayloadSchema = z
  .object({
    companyId: UuidSchema,
    /** The company fields, or null when only answers are filled. */
    changes: CompanyProfileUpdatePayloadSchema.shape.changes.nullable(),
    /** Their own completed founder session, when answers are filled. */
    sessionId: UuidSchema.nullable(),
    answers: z.array(AnswerSchema).max(8),
    /** Where it was found: shown on the card, never a claim of verification. */
    sources: z.array(z.string().min(1).max(253)).max(5),
  })
  .strict()
  .refine((value) => value.changes !== null || value.answers.length > 0, {
    message: "expected something to fill",
  })
  .refine((value) => value.answers.length === 0 || value.sessionId !== null, {
    message: "answers need their session",
  });
export type ProfileGapsPayload = z.infer<typeof ProfileGapsPayloadSchema>;

const Done = z
  .object({
    companyVersion: z.number().int().nullable(),
    answers: z.number().int(),
  })
  .strict();

function describe(payload: ProfileGapsPayload): {
  readonly summary: string;
  readonly preview: string;
} {
  const lines = [
    ...(payload.changes === null
      ? []
      : describeCompanyProfileChanges(payload.changes).preview.split("\n")),
    ...payload.answers.map((answer) => answer.preview),
  ].filter((line) => line.length > 0);
  const from =
    payload.sources.length === 0
      ? "From public sources"
      : `From public sources (${payload.sources.join(", ")})`;
  return {
    summary: `Fill the gaps in your profile. ${lines.join("; ")}`.slice(
      0,
      1000,
    ),
    preview: [
      ...lines,
      `${from}; saved as your stated details, not as verified.`,
    ]
      .join("\n")
      .slice(0, 4000),
  };
}

export function createProfileGapsFillAction(deps: {
  readonly profiles: CompanyQueryPort;
  readonly service: CompanyService;
  readonly authorization: AuthorizationService;
  readonly answers: ProfileAnswersPort;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  return defineQAction<ProfileGapsPayload, z.infer<typeof Done>>({
    actionType: PROFILE_GAPS_FILL,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Fills open fields of the approver's own company profile and setup answers from public sources, exactly as approved, as their stated details.",
    payload: ProfileGapsPayloadSchema,
    result: Done,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "COMPANY", companyId: payload.companyId },
    ],
    describe,
    confirm: (payload) =>
      savedReadsLine(
        "Your profile",
        describe(payload).preview.split("\n").slice(0, -1).join("\n"),
      ),
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      const profile = await deps.profiles.findCanonicalCompanyProfile(
        CompanyIdSchema.parse(payload.companyId),
      );
      if (
        profile === null ||
        profile.tenantId !== actor.tenantId ||
        actor.organisationId === undefined ||
        profile.organisationId !== actor.organisationId
      ) {
        return { outcome: "DENY", code: "NOT_AVAILABLE" };
      }
      const decision = await deps.authorization.authorize({
        actor,
        capability: capability("company.edit"),
        resource: {
          kind: "RESOURCE",
          tenantId: profile.tenantId,
          organisationId: profile.organisationId,
          resourceType: "company",
          resourceId: profile.id,
        },
      });
      if (decision.outcome !== "ALLOW") {
        return { outcome: "DENY", code: "NOT_PERMITTED" };
      }
      if (payload.answers.length > 0) {
        const own = await deps.answers
          .completedSession(actor, "founder")
          .catch(() => null);
        if (own === null || own.sessionId !== payload.sessionId) {
          return { outcome: "DENY", code: "NOT_AVAILABLE" };
        }
      }
      return { outcome: "ALLOW" };
    },
    executor: {
      execute: async (action, context) => {
        const actor = context.approver;
        const { payload } = action;
        try {
          let companyVersion: number | null = null;
          if (payload.changes !== null) {
            const companyId = CompanyIdSchema.parse(payload.companyId);
            const current = await deps.service.getCompany({ actor, companyId });
            const updated = await deps.service.updateCompany({
              actor,
              companyId,
              input: UpdateCompanyRequestSchema.parse({
                expectedVersion: current.version,
                ...payload.changes,
              }),
              correlationId: context.correlationId,
            });
            companyVersion = updated.version;
          }
          let revised = 0;
          for (const answer of payload.answers) {
            // Each revision reads the session's version afresh: the one
            // before it moved it on.
            const own = await deps.answers.completedSession(actor, "founder");
            if (own === null || own.sessionId !== payload.sessionId) break;
            await deps.answers.revise({
              actor,
              sessionId: own.sessionId,
              stepKey: answer.stepKey,
              value: answer.value,
              expectedSessionVersion: own.version,
              idempotencyKey: `q-action:${action.actionId}:${answer.stepKey}`,
              correlationId: context.correlationId,
            });
            revised += 1;
          }
          return {
            outcome: "EXECUTED",
            result: { companyVersion, answers: revised },
          };
        } catch (error: unknown) {
          deps.logger?.warn(
            { err: error, actionId: action.actionId },
            "profile gaps were not filled",
          );
          return {
            outcome: "FAILED",
            failureCode: "PROFILE_GAPS_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}

// --- the board: which answers are open, and the one card ----------------

const READING_TTL_MS = 10 * 60 * 1000;

const STEP_OF: Readonly<Record<ResearchableFounderAnswer, string>> = {
  categories: FOUNDER_STEPS.categories,
  founder_count: FOUNDER_STEPS.founderCount,
  team_size: FOUNDER_STEPS.teamSize,
  functions: FOUNDER_STEPS.functions,
};

/** An answer that holds nothing is as open as one never given. */
function holds(value: OnboardingResponseValue): boolean {
  switch (value.type) {
    case "MULTI_SELECT":
      return value.optionKeys.length > 0;
    case "RESOURCE_REFERENCE":
      return value.resourceIds.length > 0;
    case "TEXT":
      return value.text.trim().length > 0;
    case "SINGLE_SELECT":
    case "RANGE":
    case "CONFIRMATION":
      return true;
  }
}

function categoryNames(): string {
  const step = definitionFor("founder").steps.find(
    (candidate) => candidate.stepKey === FOUNDER_STEPS.categories,
  );
  const c = step?.configuration;
  const vocabularies = new Set(
    c?.stepType === "reference_select" ? c.vocabularyCodes : [],
  );
  return REFERENCE_TAXONOMY.nodes
    .filter(
      (node) =>
        vocabularies.has(node.vocabularyCode) && node.status === "ACTIVE",
    )
    .map((node) => node.displayName)
    .join(", ");
}

function optionLabels(stepKey: string): string {
  const step = definitionFor("founder").steps.find(
    (candidate) => candidate.stepKey === stepKey,
  );
  return step === undefined
    ? ""
    : optionsOf(step)
        .map((option) => option.label)
        .join(", ");
}

const FORMS: Readonly<Record<ResearchableFounderAnswer, string>> = {
  categories: `the company's sector and categories, as a comma-separated list of names from this list only: ${categoryNames()}`,
  founder_count: "the number of founders, as digits",
  team_size: "the number of people on the team, as digits",
  functions: `the functions the founding team covers, as a comma-separated list from: ${optionLabels(FOUNDER_STEPS.functions)}`,
};

type Prepared = {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly payload: ProfileGapsPayload;
  readonly at: number;
};

export type ProfileGapsBoard = ProfileGapsPort & {
  readonly proposer: QActionProposer;
};

export function createProfileGapsBoard(deps: {
  /** Late-bound: composed after the tools that call this. */
  readonly answers: () => ProfileAnswersPort;
  /** Their own completed founder session's answers, as given. */
  readonly responses: (
    actor: Parameters<ProfileAnswersPort["completedSession"]>[0],
  ) => Promise<
    | readonly {
        readonly stepKey: string;
        readonly value: OnboardingResponseValue;
      }[]
    | null
  >;
  readonly now?: (() => number) | undefined;
  readonly logger?: Logger | undefined;
}): ProfileGapsBoard {
  const now = deps.now ?? (() => Date.now());
  const prepared = new Map<string, Prepared>();
  const sweep = () => {
    const cutoff = now() - READING_TTL_MS;
    for (const [runId, entry] of prepared) {
      if (entry.at < cutoff) prepared.delete(runId);
    }
  };

  return {
    answerForms: () => FORMS,
    openAnswers: async (actor) => {
      const own = await deps.answers().completedSession(actor, "founder");
      if (own === null) return null;
      const given = (await deps.responses(actor)) ?? [];
      return RESEARCHABLE_FOUNDER_ANSWERS.filter(
        (field) =>
          !given.some(
            (response) =>
              response.stepKey === STEP_OF[field] && holds(response.value),
          ),
      );
    },
    prepare: async (entry) => {
      sweep();
      const dropped: { field: string; reason: string }[] = [];
      // Company fields, each checked alone so one misfit drops one field.
      const changes: Record<string, string> = {};
      for (const change of entry.companyChanges) {
        if (
          !(COMPANY_EDITABLE_FIELDS as readonly string[]).includes(change.field)
        ) {
          continue;
        }
        let value = change.value;
        if (change.field === "websiteUrl") {
          try {
            value = normaliseWebsite(value);
          } catch {
            dropped.push({ field: change.field, reason: "not a web address" });
            continue;
          }
        }
        const alone = CompanyProfileUpdatePayloadSchema.shape.changes.safeParse(
          { [change.field]: value },
        );
        if (!alone.success) {
          dropped.push({
            field: change.field,
            reason: refusalReason([change.field as CompanyEditableField]),
          });
          continue;
        }
        changes[change.field] = value;
      }
      // Answers, resolved against their own steps. Category names Capital
      // Q does not know are left out, never guessed.
      const answers: z.infer<typeof AnswerSchema>[] = [];
      for (const answer of entry.answers) {
        let words: string | string[] = answer.value;
        if (answer.field === "categories" || answer.field === "functions") {
          const names = answer.value
            .split(/,|;/)
            .map((name) => name.trim())
            .filter((name) => name.length > 0);
          words =
            answer.field === "categories"
              ? names.filter(
                  (name) =>
                    !("reason" in resolveProfileAnswer("categories", name)),
                )
              : names;
          if (words.length === 0) {
            dropped.push({
              field: answer.field,
              reason: "no category Capital Q knows",
            });
            continue;
          }
        }
        const resolved = resolveProfileAnswer(answer.field, words);
        if ("reason" in resolved) {
          dropped.push({ field: answer.field, reason: resolved.reason });
          continue;
        }
        if (resolved.stepKey !== PROFILE_ANSWER_STEPS[answer.field].step) {
          continue;
        }
        answers.push({
          stepKey: resolved.stepKey,
          value: resolved.value,
          preview: resolved.preview,
        });
      }
      const own =
        answers.length === 0
          ? null
          : await deps
              .answers()
              .completedSession(entry.actor, "founder")
              .catch(() => null);
      if (answers.length > 0 && own === null) {
        for (const answer of entry.answers) {
          dropped.push({
            field: answer.field,
            reason: "your setup isn't finished",
          });
        }
        answers.length = 0;
      }
      const parsed = ProfileGapsPayloadSchema.safeParse({
        companyId: entry.companyId,
        changes: Object.keys(changes).length === 0 ? null : changes,
        sessionId: own?.sessionId ?? null,
        answers,
        sources: [...entry.sources].slice(0, 5),
      });
      deps.logger?.info(
        {
          qRunId: entry.runId,
          fields: Object.keys(changes),
          answers: answers.map((answer) => answer.stepKey),
          dropped: dropped.map((d) => `${d.field}: ${d.reason.slice(0, 80)}`),
        },
        "profile gaps card",
      );
      if (!parsed.success) {
        return {
          status: "REFUSED",
          reason: "nothing found fits your profile",
          dropped,
        };
      }
      const existing = prepared.get(entry.runId);
      if (existing !== undefined) {
        const same =
          JSON.stringify(existing.payload) === JSON.stringify(parsed.data);
        return {
          status: same ? "PREPARED" : "ONE_PER_TURN",
          reason: null,
          dropped,
        };
      }
      prepared.set(entry.runId, {
        tenantId: entry.actor.tenantId,
        actorUserId: entry.actor.userId,
        payload: parsed.data,
        at: now(),
      });
      return { status: "PREPARED", reason: null, dropped };
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.actorUserId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          actionType: PROFILE_GAPS_FILL,
          payload: entry.payload,
        });
      },
    },
  };
}
