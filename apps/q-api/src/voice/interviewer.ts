import { randomUUID } from "node:crypto";

import {
  findTaxonomyCandidates,
  getOnboardingSession,
  resolveOnboardingSuggestion,
  skipOnboardingStep,
  submitOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import type {
  OnboardingResponseValue,
  OnboardingSessionView,
} from "@capital-q/contracts";
import { FOUNDER_DEFINITION_V2 } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { OnboardingStepManifest } from "@capital-q/onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  InterviewConductorResultSchema,
  type InterviewConductorResult,
  type InterviewConductorVariables,
  type InterviewOpenStep,
  type PromptRegistry,
  personalityOf,
  type InterviewDestination,
  type QPersonalityCode,
} from "@capital-q/q-core";

/**
 * Q conducting the interview (CQ-Q-VOICE-001 rework).
 *
 * One turn: read the session as Capital Q's records hold it, hand the model
 * the open steps with their real options, what is known, what is pending,
 * and what the person said; get back what Q says next and a structured
 * reading of the words. Then the deterministic part: every proposed
 * answer is checked against the step's own kind and options, material
 * values are held for the person's confirmation instead of recorded,
 * categories are mapped through the platform's classifier and read back,
 * and everything that survives is committed through the onboarding
 * runtime's normal validated submit under the person's own token.
 *
 * The model never records anything. It proposes; the runtime disposes.
 */

/** The gateway seam, narrowed to what this needs: one dialogue task, structured output. */
export type InterviewGateway = Pick<ModelGateway, "execute">;

export type InterviewerDependencies = {
  readonly gateway: InterviewGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly logger: Logger;
  /** The manner Q carries itself in; UPBEAT when unset. */
  readonly personality?: QPersonalityCode | undefined;
  /** True when the speech model renders inline audio tags ([laughs]). */
  readonly expressive?: boolean | undefined;
};

export type InterviewTurnInput = {
  readonly session: ApiSession;
  readonly onboardingSessionId: string;
  readonly journeyType: "founder" | "investor";
  readonly channel: "voice" | "text";
  readonly attribution: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
  };
  /** Empty for the opening line. */
  readonly utterance: string;
  readonly recentTurns: readonly {
    readonly role: "person" | "q";
    readonly text: string;
  }[];
  readonly signal?: AbortSignal | undefined;
};

export type InterviewOption = {
  readonly key: string;
  readonly label: string;
  readonly description?: string | undefined;
};

export type InterviewTurnOutcome = {
  /** What Q says. */
  readonly reply: string;
  readonly intent: InterviewConductorResult["intent"];
  /** The step Q is asking, and its options when they should be shown. */
  readonly asking: {
    readonly stepKey: string;
    readonly kind: InterviewOpenStep["kind"];
    readonly options: readonly InterviewOption[];
    readonly maxChoices: number | undefined;
  } | null;
  /** Steps recorded this turn. */
  readonly recorded: readonly string[];
  /** Steps set aside this turn. */
  readonly skipped: readonly string[];
  /** A question for Q, when the person asked one (a lookup becomes one). */
  readonly questionForQ: string | null;
  /** Where the person asked to be taken, validated against the fixed list. */
  readonly navigate: InterviewDestination | null;
  /** Set when Q has stopped conducting and leaves the person with the form. */
  readonly handoff: "FORM" | null;
  /** Warnings issued so far in this session about derailing the interview. */
  readonly warnings: number;
  /** The session after this turn. */
  readonly view: OnboardingSessionView;
  /** True when the model could not be reached and Q spoke a fallback line. */
  readonly degraded: boolean;
};

/** Pending confirmations per onboarding session; conversational, in memory. */
type Pending = {
  readonly stepKey: string;
  readonly question: string;
  readonly value: OnboardingResponseValue;
  readonly spoken: string;
};

const DIALOGUE_BUDGET = {
  maxAttempts: 4,
  maxEstimatedCostUsd: 0.1,
  maxOutputTokens: 2_048,
  attemptTimeoutMs: 45_000,
} as const;

/** Steps whose values are always read back before they are recorded (A §13). */
const MATERIAL_STEP_PATTERNS = [
  /target_amount|cheque|revenue|mrr|arr|customers|valuation|round_size/i,
  /hard_exclusions|sector_exclusions/i,
];

const MAX_OPEN_STEPS = 40;
/** Open steps beyond the current few carry a shortened options list. */
const FULL_OPTIONS_STEPS = 3;
const SHORT_OPTIONS = 10;
/** Warnings before Q leaves the person with the form. */
const WARNINGS_BEFORE_HANDOFF = 2;
const MAX_RECENT_TURNS = 12;
const RECENT_TURN_MAX_CHARS = 600;

/**
 * What Q asks its own research tools when the person names a website,
 * company or person. The query is the person's words, bounded; the tools
 * decide what may leave the platform (CQ-Q-RESEARCH-001).
 */
function lookupQuestion(
  kind: "WEBSITE" | "COMPANY" | "PERSON",
  query: string,
): string {
  const subject = query.trim().slice(0, 200);
  switch (kind) {
    case "WEBSITE":
      return `Look at the public website ${subject}: what the company does, who it serves, its products and anything recent. Summarise it in a few spoken sentences as unverified public context for this interview.`;
    case "COMPANY":
      return `Research the company "${subject}" on the public web: what it does, who it serves, stage, funding and anything recent. Summarise in a few spoken sentences as unverified public context for this interview.`;
    case "PERSON":
      return `Research the person "${subject}" on the public web: role, company, public posts and interests. Summarise in a few spoken sentences as unverified public context for this interview.`;
  }
}

function definitionFor(journey: "founder" | "investor") {
  return journey === "founder" ? FOUNDER_DEFINITION_V2 : INVESTOR_DEFINITION_V1;
}

function stepsByKey(journey: "founder" | "investor") {
  return new Map(
    definitionFor(journey).steps.map((step) => [step.stepKey, step]),
  );
}

function optionsOf(step: OnboardingStepManifest): readonly InterviewOption[] {
  const configuration = step.configuration;
  if (
    configuration.stepType === "single_select" ||
    configuration.stepType === "multi_select"
  ) {
    return configuration.options.map((option) => ({
      key: option.optionKey,
      label: option.label,
      description: option.description,
    }));
  }
  return [];
}

function describeValue(
  step: OnboardingStepManifest | undefined,
  value: OnboardingResponseValue,
): string {
  const options = step === undefined ? [] : optionsOf(step);
  const label = (key: string) =>
    options.find((option) => option.key === key)?.label ?? key;
  switch (value.type) {
    case "SINGLE_SELECT":
      return label(value.optionKey);
    case "MULTI_SELECT":
      return value.optionKeys.map(label).join(", ");
    case "RANGE":
      return value.value;
    case "TEXT":
      return value.text.slice(0, 300);
    case "CONFIRMATION":
      return value.confirmed ? "confirmed" : "not confirmed";
    case "RESOURCE_REFERENCE":
      return `${String(value.resourceIds.length)} recorded`;
  }
}

function toOpenStep(
  step: OnboardingStepManifest,
  view: OnboardingSessionView,
): InterviewOpenStep | null {
  const c = step.configuration;
  const base = {
    stepKey: step.stepKey,
    question: c.prompt,
    required: step.required,
    ...(c.whyQAsks === undefined ? {} : { note: c.whyQAsks }),
  };
  switch (c.stepType) {
    case "single_select":
      return { ...base, kind: "ONE_OF", options: [...optionsOf(step)] };
    case "multi_select":
      return {
        ...base,
        kind: "MANY_OF",
        options: [...optionsOf(step)],
        maxChoices: c.maxSelections,
      };
    case "range":
      return {
        ...base,
        kind: "NUMBER",
        min: c.min,
        max: c.max,
        ...(c.unit === undefined ? {} : { unit: c.unit }),
      };
    case "short_text":
      return { ...base, kind: "SHORT_TEXT" };
    case "long_text":
    case "voice_text":
      return { ...base, kind: "LONG_TEXT" };
    case "confirmation":
      // A review of what has been gathered: Q reads it back in speech
      // before it asks, rather than asking for a "confirmation".
      return {
        ...base,
        kind: "YES_NO",
        note: [
          base.note,
          "This is a review of what has been gathered so far: before asking, read the key KNOWN ANSWERS back in one or two natural spoken sentences (name, what the company does, stage, where it is based, the round), then ask whether that is right.",
        ]
          .filter((n): n is string => n !== undefined)
          .join(" "),
      };
    case "document_upload":
      return { ...base, kind: "DOCUMENT" };
    case "reference_select": {
      if (c.resourceType === "TAXONOMY_NODE") {
        return { ...base, kind: "CATEGORIES", maxChoices: c.maxItems };
      }
      // A reference step with server-listed candidates (an investor's
      // mandates) is a choice among them when the view carries them.
      const current = view.currentStep;
      const context =
        current !== null && current.stepKey === step.stepKey
          ? current.context
          : undefined;
      const list = context?.["candidates"];
      if (Array.isArray(list)) {
        const options: InterviewOption[] = [];
        for (const item of list) {
          if (typeof item !== "object" || item === null) continue;
          const record = item as Record<string, unknown>;
          const id = record["mandateId"] ?? record["id"];
          const name = record["name"] ?? record["label"];
          if (typeof id === "string" && typeof name === "string") {
            options.push({ key: id, label: name });
          }
        }
        if (options.length > 0) {
          return { ...base, kind: "ONE_OF", options };
        }
      }
      return null;
    }
  }
}

/** A reading as a list of strings, whatever shape the model used. */
function asList(raw: string | readonly string[] | boolean): readonly string[] {
  if (typeof raw === "string") return [raw];
  if (typeof raw === "boolean") return [];
  return raw;
}

function isMaterial(stepKey: string): boolean {
  return MATERIAL_STEP_PATTERNS.some((pattern) => pattern.test(stepKey));
}

function asNumberString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/[,\s$€£₦]/g, "").toLowerCase();
  const scaled = /^(-?\d+(?:\.\d+)?)([kmb])?$/.exec(cleaned);
  if (scaled === null) {
    return null;
  }
  const factor = { k: 1e3, m: 1e6, b: 1e9 }[scaled[2] ?? ""] ?? 1;
  const number = Number.parseFloat(scaled[1] ?? "") * factor;
  return Number.isFinite(number) ? String(number) : null;
}

/** A model reading → the step's own value, or null when it does not fit. */
function toResponseValue(
  step: OnboardingStepManifest,
  raw: string | readonly string[] | boolean,
): OnboardingResponseValue | null {
  const c = step.configuration;
  const options = optionsOf(step);
  const keyOf = (text: string): string | null => {
    const wanted = text.trim().toLowerCase();
    const hit = options.find(
      (option) =>
        option.key.toLowerCase() === wanted ||
        option.label.toLowerCase() === wanted,
    );
    return hit?.key ?? null;
  };
  switch (c.stepType) {
    case "single_select": {
      const key = typeof raw === "string" ? keyOf(raw) : null;
      return key === null ? null : { type: "SINGLE_SELECT", optionKey: key };
    }
    case "multi_select": {
      const list = asList(raw);
      const keys = [
        ...new Set(list.map(keyOf).filter((k): k is string => k !== null)),
      ];
      if (keys.length === 0) return null;
      const exclusive = new Set(c.exclusiveOptionKeys);
      const chosen = keys.some((k) => exclusive.has(k))
        ? keys.filter((k) => exclusive.has(k)).slice(0, 1)
        : keys.slice(0, c.maxSelections);
      return { type: "MULTI_SELECT", optionKeys: chosen };
    }
    case "range": {
      const number = asNumberString(raw);
      if (number === null) return null;
      const n = Number.parseFloat(number);
      if (n < Number.parseFloat(c.min) || n > Number.parseFloat(c.max)) {
        return null;
      }
      return { type: "RANGE", value: number };
    }
    case "short_text":
    case "long_text":
    case "voice_text": {
      const text =
        typeof raw === "string"
          ? raw.trim()
          : Array.isArray(raw)
            ? raw.join(", ")
            : "";
      const max = c.stepType === "short_text" ? c.maxLength : c.maxLength;
      if (text.length === 0 || text.length > max) return null;
      return { type: "TEXT", text };
    }
    case "confirmation":
      if (typeof raw === "boolean") {
        return { type: "CONFIRMATION", confirmed: raw };
      }
      if (
        typeof raw === "string" &&
        /^(?:yes|true|confirmed?|right)$/i.test(raw.trim())
      ) {
        return { type: "CONFIRMATION", confirmed: true };
      }
      return null;
    case "reference_select": {
      if (c.resourceType === "TAXONOMY_NODE") return null;
      const list = asList(raw);
      const ids = list
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        .slice(0, c.maxItems);
      return ids.length === 0
        ? null
        : {
            type: "RESOURCE_REFERENCE",
            resourceType: c.resourceType,
            resourceIds: ids,
          };
    }
    case "document_upload":
      return null;
  }
}

export function createInterviewer(dependencies: InterviewerDependencies) {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const pendingBySession = new Map<string, Pending[]>();

  const pendingFor = (sessionId: string) =>
    pendingBySession.get(sessionId) ?? [];
  const warningsBySession = new Map<string, number>();
  const personality = personalityOf(dependencies.personality);
  const expressive = dependencies.expressive ?? false;

  return {
    /** Forget conversational state for a session (it ended). */
    forget: (sessionId: string) => {
      pendingBySession.delete(sessionId);
      warningsBySession.delete(sessionId);
    },

    turn: async (input: InterviewTurnInput): Promise<InterviewTurnOutcome> => {
      const steps = stepsByKey(input.journeyType);
      let view = await getOnboardingSession(
        input.session,
        input.onboardingSessionId,
      );
      const statuses = new Map(
        view.progress.eligibleSteps.map((s) => [s.stepKey, s.status]),
      );
      const openSteps: InterviewOpenStep[] = [];
      const compact = (open: InterviewOpenStep): InterviewOpenStep => {
        if (openSteps.length < FULL_OPTIONS_STEPS) return open;
        const { note: _note, ...rest } = open;
        if (
          rest.options === undefined ||
          rest.options.length <= SHORT_OPTIONS
        ) {
          return rest;
        }
        return {
          ...rest,
          options: rest.options
            .slice(0, SHORT_OPTIONS)
            .map(({ key, label }) => ({ key, label })),
          moreOptions: rest.options.length - SHORT_OPTIONS,
        };
      };
      for (const step of definitionFor(input.journeyType).steps) {
        const status = statuses.get(step.stepKey);
        if (
          status === undefined ||
          status === "COMPLETED" ||
          status === "SKIPPED"
        ) {
          continue;
        }
        const open = toOpenStep(step, view);
        if (open !== null) openSteps.push(compact(open));
        if (openSteps.length >= MAX_OPEN_STEPS) break;
      }
      const knownAnswers = view.responses.map((r) => {
        const step = steps.get(r.stepKey);
        return {
          stepKey: r.stepKey,
          question: step?.configuration.prompt ?? r.stepKey,
          value: describeValue(step, r.value),
        };
      });
      const pending = pendingFor(input.onboardingSessionId);
      // Proposals lifted from the person's documents, still unconfirmed and
      // not already held by Q: Q reads them back like its own readings.
      const proposals = view.pendingSuggestions.filter(
        (p) =>
          p.status === "PENDING" &&
          !pending.some((held) => held.stepKey === p.stepKey),
      );

      const variables: Omit<
        InterviewConductorVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        journey: input.journeyType,
        channel: input.channel,
        personality: personality.manner,
        expressive,
        opening: input.utterance.trim().length === 0,
        warnings: warningsBySession.get(input.onboardingSessionId) ?? 0,
        knownAnswers,
        openSteps,
        currentStepKey: view.currentStep?.stepKey ?? null,
        pendingConfirmations: pending.map((p) => ({
          stepKey: p.stepKey,
          question: p.question,
          value: p.spoken,
        })),
        documentProposals: proposals.map((p) => ({
          stepKey: p.stepKey,
          question: steps.get(p.stepKey)?.configuration.prompt ?? p.stepKey,
          value: describeValue(steps.get(p.stepKey), p.suggestedValue),
        })),
        notes: [],
        recentTurns: input.recentTurns.slice(-MAX_RECENT_TURNS).map((t) => ({
          role: t.role,
          text: t.text.slice(0, RECENT_TURN_MAX_CHARS),
        })),
        utterance: input.utterance.slice(0, 2_000),
      };
      const rendered = renderPrompt<InterviewConductorVariables>(registry, {
        task: "INTERVIEW_CONDUCTOR",
        charter: "Q_SYSTEM_VOICE",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You cannot record, verify or send anything yourself; Capital Q validates and records what you read, and holds material values until the person confirms them.",
        variables,
      });

      logger.debug(
        {
          promptChars: rendered.messages.reduce(
            (n, m) => n + m.content.length,
            0,
          ),
          openSteps: openSteps.length,
          knownAnswers: knownAnswers.length,
        },
        "interview prompt rendered",
      );

      let result: InterviewConductorResult | undefined;
      try {
        const response = await gateway.execute<InterviewConductorResult>(
          {
            taskClass: "NORMAL_DIALOGUE",
            sensitivity: "CONFIDENTIAL",
            budget: DIALOGUE_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          {
            schema: InterviewConductorResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind === "STRUCTURED") {
          result = (
            response.output as { readonly value: InterviewConductorResult }
          ).value;
        }
      } catch (error: unknown) {
        logger.warn(
          { err: error, journey: input.journeyType },
          "interview conductor model call failed",
        );
      }
      if (result === undefined) {
        const current = view.currentStep;
        return {
          reply:
            current === null
              ? "I'm having trouble thinking just now. Give me a moment and try again."
              : `I'm having trouble thinking just now. Let's keep going: ${current.prompt}`,
          intent: "UNCLEAR",
          asking: null,
          recorded: [],
          skipped: [],
          questionForQ: null,
          navigate: null,
          handoff: null,
          warnings: warningsBySession.get(input.onboardingSessionId) ?? 0,
          view,
          degraded: true,
        };
      }

      const recorded: string[] = [];
      const skipped: string[] = [];
      const nextPending: Pending[] = [];
      const commit = async (
        stepKey: string,
        value: OnboardingResponseValue,
      ) => {
        try {
          view = await submitOnboardingResponse(
            input.session,
            input.onboardingSessionId,
            {
              stepKey,
              response: { value },
              expectedSessionVersion: view.session.version,
            },
            randomUUID(),
          );
          recorded.push(stepKey);
          return true;
        } catch (error: unknown) {
          logger.warn(
            { err: error, stepKey },
            "interview answer was not accepted",
          );
          return false;
        }
      };

      // 1. Decisions on what Q read back last time, and on document proposals.
      for (const decision of result.confirmations) {
        const held = pending.find((p) => p.stepKey === decision.stepKey);
        if (held === undefined) {
          const proposal = proposals.find(
            (p) => p.stepKey === decision.stepKey,
          );
          if (proposal === undefined) continue;
          const step = steps.get(proposal.stepKey);
          const revised =
            decision.decision === "REVISED" &&
            decision.value !== undefined &&
            step !== undefined
              ? toResponseValue(step, decision.value)
              : null;
          try {
            view = await resolveOnboardingSuggestion(
              input.session,
              input.onboardingSessionId,
              proposal.id,
              revised !== null
                ? {
                    resolution: "EDIT",
                    response: { value: revised },
                    expectedSessionVersion: view.session.version,
                  }
                : {
                    resolution:
                      decision.decision === "CONFIRMED" ? "ACCEPT" : "REJECT",
                    expectedSessionVersion: view.session.version,
                  },
              randomUUID(),
            );
            if (decision.decision !== "REJECTED")
              recorded.push(proposal.stepKey);
          } catch (error: unknown) {
            logger.warn(
              { err: error, stepKey: proposal.stepKey },
              "document proposal was not resolved",
            );
          }
          continue;
        }
        if (decision.decision === "CONFIRMED") {
          await commit(held.stepKey, held.value);
        } else if (
          decision.decision === "REVISED" &&
          decision.value !== undefined
        ) {
          const step = steps.get(held.stepKey);
          const value =
            step === undefined ? null : toResponseValue(step, decision.value);
          if (value !== null) {
            nextPending.push({
              ...held,
              value,
              spoken: describeValue(step, value),
            });
          }
        }
        // REJECTED: dropped; Q asks again in its own words.
      }
      const decided = new Set(result.confirmations.map((d) => d.stepKey));
      for (const held of pending) {
        if (!decided.has(held.stepKey)) nextPending.push(held);
      }

      // 2. Answers in the person's words, validated against the step.
      for (const answer of result.answers) {
        const step = steps.get(answer.stepKey);
        const status = statuses.get(answer.stepKey);
        if (
          step === undefined ||
          status === undefined ||
          status === "COMPLETED"
        )
          continue;
        const value = toResponseValue(step, answer.value);
        if (value === null) continue;
        if (isMaterial(step.stepKey) || answer.confidence === "MEDIUM") {
          nextPending.push({
            stepKey: step.stepKey,
            question: step.configuration.prompt,
            value,
            spoken: describeValue(step, value),
          });
          continue;
        }
        await commit(step.stepKey, value);
      }

      // 3. Categories: phrases → the platform's own candidates, read back.
      for (const item of result.categoryPhrases) {
        const step = steps.get(item.stepKey);
        if (
          step === undefined ||
          step.configuration.stepType !== "reference_select"
        )
          continue;
        const c = step.configuration;
        const ids: string[] = [];
        const labels: string[] = [];
        for (const phrase of item.phrases.slice(0, 6)) {
          try {
            const found = await findTaxonomyCandidates(input.session, {
              text: phrase,
              vocabularyCodes: [...c.vocabularyCodes],
            });
            const best = found.candidates[0];
            if (best !== undefined && !ids.includes(best.nodeId)) {
              ids.push(best.nodeId);
              labels.push(best.displayName);
            }
          } catch {
            // The classifier is optional here; nothing is invented in its place.
          }
        }
        if (ids.length > 0) {
          const existing = view.pendingSuggestions.find(
            (s) =>
              s.stepKey === step.stepKey &&
              s.suggestedValue.type === "RESOURCE_REFERENCE",
          );
          const value: OnboardingResponseValue = {
            type: "RESOURCE_REFERENCE",
            resourceType: "TAXONOMY_NODE",
            resourceIds: ids.slice(0, c.maxItems),
          };
          if (existing !== undefined) {
            // The runtime's own proposal path already holds a set: accept it if it is the same.
            try {
              view = await resolveOnboardingSuggestion(
                input.session,
                input.onboardingSessionId,
                existing.id,
                {
                  resolution: "EDIT",
                  response: { value },
                  expectedSessionVersion: view.session.version,
                },
                randomUUID(),
              );
              recorded.push(step.stepKey);
              continue;
            } catch {
              // Fall through to holding it for confirmation.
            }
          }
          nextPending.push({
            stepKey: step.stepKey,
            question: c.prompt,
            value,
            spoken: labels.join(", "),
          });
        }
      }

      // 4. Skips, optional steps only.
      for (const stepKey of result.skips) {
        const step = steps.get(stepKey);
        const status = statuses.get(stepKey);
        if (
          step === undefined ||
          step.required ||
          status === undefined ||
          status === "COMPLETED"
        )
          continue;
        try {
          view = await skipOnboardingStep(
            input.session,
            input.onboardingSessionId,
            stepKey,
            { expectedSessionVersion: view.session.version },
            randomUUID(),
          );
          skipped.push(stepKey);
        } catch (error: unknown) {
          logger.warn(
            { err: error, stepKey },
            "interview skip was not accepted",
          );
        }
      }

      pendingBySession.set(input.onboardingSessionId, nextPending.slice(-8));

      // 5. Conduct: a warning is counted here, never by the model; the
      // third strike hands the person to the form and ends Q's part.
      let warnings = warningsBySession.get(input.onboardingSessionId) ?? 0;
      let handoff: "FORM" | null = null;
      if (result.intent === "SABOTAGE") {
        warnings += 1;
        warningsBySession.set(input.onboardingSessionId, warnings);
        if (warnings > WARNINGS_BEFORE_HANDOFF) handoff = "FORM";
      }
      const navigate = result.intent === "NAVIGATE" ? result.navigate : null;
      if (navigate === "FORM") handoff = "FORM";
      // A lookup is a question for Q: the research tools, under the
      // person's own authority, with the answer spoken back.
      const lookup =
        result.intent === "LOOKUP" && result.lookup !== null
          ? result.lookup
          : null;
      const questionForQ =
        result.intent === "QUESTION_FOR_Q"
          ? result.questionForQ
          : lookup !== null
            ? lookupQuestion(lookup.kind, lookup.query)
            : null;

      const askStep =
        result.askNext === null ? undefined : steps.get(result.askNext);
      const askOpen = askStep === undefined ? null : toOpenStep(askStep, view);
      return {
        reply: result.reply,
        intent: result.intent,
        asking:
          askOpen === null
            ? null
            : {
                stepKey: askOpen.stepKey,
                kind: askOpen.kind,
                options: result.showOptions ? (askOpen.options ?? []) : [],
                maxChoices: askOpen.maxChoices,
              },
        recorded,
        skipped,
        questionForQ,
        navigate,
        handoff,
        warnings,
        view,
        degraded: false,
      };
    },
  };
}

export type Interviewer = ReturnType<typeof createInterviewer>;
