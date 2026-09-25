import { randomUUID } from "node:crypto";

import {
  completeOnboardingSession,
  findTaxonomyCandidates,
  getOnboardingSession,
  getTaxonomyNode,
  submitOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import type {
  OnboardingResponseValue,
  OnboardingSessionView,
} from "@capital-q/contracts";
import type { OnboardingStepManifest } from "@capital-q/onboarding";
import type {
  FinishOnboardingOutput,
  OnboardingRecommendResult,
  OnboardingRecordResult,
  OnboardingState,
  OnboardingStepState,
  OnboardingToolPort,
} from "@capital-q/q-tools";

import {
  EXCLUSION_SIBLINGS,
  definitionFor,
  describeValue,
  optionsOf,
  readRefusal,
  recordedCurrency,
  toOpenStep,
  toResponseValue,
} from "./interviewer.js";
import { SPOKEN_QUESTIONS } from "./step-copy.js";

/**
 * The onboarding tools' port over the onboarding service's existing APIs,
 * bound to one person's own session for one turn (ADR 0016).
 *
 * General capabilities only: validation against the step's own kind and
 * options, taxonomy resolution through the platform's classifier, the
 * service's own refusals reported as they are, and one concept kept in
 * one exclusion list. Nothing here reads what a sentence meant; the model
 * did that when it chose what to record.
 */
/**
 * Q's pending recommendations, per onboarding session (ADR 0016).
 *
 * Held by the q-api process for the life of the conversation: the
 * onboarding service offers no client route to create a suggestion, so a
 * durable home for Q's own recommendations is an open lead-owned
 * decision. A recommendation is never an answer; only acceptance writes
 * it, and then exactly as recommended.
 */
type PendingRecommendation = {
  readonly value: OnboardingResponseValue;
  readonly spoken: string;
  readonly because: string;
};
const recommendationsBySession = new Map<
  string,
  Map<string, PendingRecommendation>
>();
function recommendations(
  sessionId: string,
): Map<string, PendingRecommendation> {
  let held = recommendationsBySession.get(sessionId);
  if (held === undefined) {
    held = new Map();
    recommendationsBySession.set(sessionId, held);
    // Bounded: the oldest sessions go first.
    if (recommendationsBySession.size > 5_000) {
      const oldest = recommendationsBySession.keys().next().value;
      if (oldest !== undefined) recommendationsBySession.delete(oldest);
    }
  }
  return held;
}

export type BoundOnboardingPort = OnboardingToolPort & {
  /** The latest view this port saw, for the caller's outcome. */
  readonly view: () => OnboardingSessionView | null;
  /** Steps this port wrote, in order. */
  readonly recorded: () => readonly string[];
};

export function createOnboardingPort(input: {
  readonly session: ApiSession;
  readonly onboardingSessionId: string;
  readonly journeyType: "investor" | "founder";
  readonly ownerUserId: string;
}): BoundOnboardingPort {
  const steps = new Map(
    definitionFor(input.journeyType).steps.map(
      (step) => [step.stepKey, step] as const,
    ),
  );
  let latest: OnboardingSessionView | null = null;
  const written: string[] = [];

  /**
   * The journey's own preselection, recorded (ADR 0016).
   *
   * A reference step whose view names `suggestedMandateId` has one draft
   * to choose and the journey says so: that is the platform's authority,
   * recorded through the ordinary submit under the person's own token,
   * and never a question about an internal concept.
   */
  const settle = async (
    view: OnboardingSessionView,
  ): Promise<OnboardingSessionView> => {
    const step = view.currentStep;
    if (step === null || step === undefined) return view;
    if (step.presentation.stepType !== "reference_select") return view;
    const resourceType = step.presentation.resourceType;
    if (resourceType === "TAXONOMY_NODE") return view;
    const suggested = step.context?.["suggestedMandateId"];
    if (typeof suggested !== "string" || suggested.length === 0) return view;
    try {
      return await submitOnboardingResponse(
        input.session,
        input.onboardingSessionId,
        {
          stepKey: step.stepKey,
          response: {
            value: {
              type: "RESOURCE_REFERENCE",
              resourceType,
              resourceIds: [suggested],
            },
          },
          expectedSessionVersion: view.session.version,
        },
        randomUUID(),
      );
    } catch {
      return view;
    }
  };

  const fresh = async (): Promise<OnboardingSessionView> => {
    latest = await settle(
      await getOnboardingSession(input.session, input.onboardingSessionId),
    );
    return latest;
  };
  const current = async (): Promise<OnboardingSessionView> =>
    latest ?? (await fresh());

  const spoken = async (
    step: OnboardingStepManifest,
    value: OnboardingResponseValue,
    view: OnboardingSessionView,
  ): Promise<string> => {
    if (
      value.type === "RESOURCE_REFERENCE" &&
      value.resourceType === "TAXONOMY_NODE"
    ) {
      const names: string[] = [];
      for (const id of value.resourceIds.slice(0, 8)) {
        try {
          names.push((await getTaxonomyNode(input.session, id)).displayName);
        } catch {
          // A name that cannot be read is left out, never guessed.
        }
      }
      return names.join(", ");
    }
    return describeValue(step, value, recordedCurrency(view, steps)).trim();
  };

  const state = async (): Promise<OnboardingState> => {
    const view = await fresh();
    const rows: OnboardingStepState[] = [];
    for (const eligible of view.progress.eligibleSteps) {
      const step = steps.get(eligible.stepKey);
      if (step === undefined) continue;
      // A reference to a platform record (the mandate being defined),
      // once resolved, is not something to discuss with the person.
      const config = step.configuration;
      if (
        eligible.status === "COMPLETED" &&
        config.stepType === "reference_select" &&
        config.resourceType !== "TAXONOMY_NODE"
      ) {
        continue;
      }
      const open = toOpenStep(step, view);
      const stored = view.responses.find((r) => r.stepKey === step.stepKey);
      const kind =
        open === null
          ? "TEXT"
          : open.kind === "SHORT_TEXT" || open.kind === "LONG_TEXT"
            ? "TEXT"
            : open.kind;
      rows.push({
        stepKey: step.stepKey,
        question: (
          SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
        ).slice(0, 400),
        kind,
        required: step.required,
        status:
          eligible.status === "COMPLETED"
            ? "ANSWERED"
            : eligible.status === "SKIPPED"
              ? "SET_ASIDE"
              : "OPEN",
        value:
          stored === undefined
            ? null
            : (await spoken(step, stored.value, view)).slice(0, 600) || null,
        ...(open?.options === undefined || open.options.length === 0
          ? {}
          : {
              options: open.options
                .slice(0, 50)
                .map((o) => ({ key: o.key, label: o.label })),
            }),
        ...(open?.maxChoices === undefined
          ? {}
          : { maxChoices: open.maxChoices }),
        ...(recommendations(input.onboardingSessionId).get(step.stepKey) ===
        undefined
          ? {}
          : {
              pendingRecommendation:
                `${recommendations(input.onboardingSessionId).get(step.stepKey)?.spoken ?? ""} (because ${recommendations(input.onboardingSessionId).get(step.stepKey)?.because ?? ""})`.slice(
                  0,
                  600,
                ),
            }),
      });
    }
    return {
      journey: input.journeyType,
      currentStepKey: view.currentStep?.stepKey ?? null,
      canComplete: view.progress.canComplete,
      completed: view.session.status === "COMPLETED",
      steps: rows,
    };
  };

  const submit = async (
    stepKey: string,
    value: OnboardingResponseValue,
  ): Promise<void> => {
    const view = await current();
    latest = await settle(
      await submitOnboardingResponse(
        input.session,
        input.onboardingSessionId,
        {
          stepKey,
          response: { value },
          expectedSessionVersion: view.session.version,
        },
        randomUUID(),
      ),
    );
  };

  /** Where a refusal names a prerequisite by its field, the step that holds it. */
  const stepNamed = (suffix: string | null): string | undefined =>
    suffix === null
      ? undefined
      : [...steps.keys()].find((key) => key.endsWith(`.${suffix}`));

  type Resolved =
    | {
        readonly ok: true;
        readonly step: OnboardingStepManifest;
        readonly value: OnboardingResponseValue;
      }
    | { readonly ok: false; readonly result: OnboardingRecordResult };

  /** What the words resolve to for this step, validated; nothing written. */
  const resolve = async (answer: {
    readonly stepKey: string;
    readonly value: string | readonly string[] | number | boolean;
  }): Promise<Resolved> => {
    const refuse = (result: OnboardingRecordResult): Resolved => ({
      ok: false,
      result,
    });
    const step = steps.get(answer.stepKey);
    if (step === undefined) {
      return refuse({
        stepKey: answer.stepKey.slice(0, 80),
        outcome: "REJECTED",
        reason: "There is no such step in this onboarding.",
      });
    }
    let value: OnboardingResponseValue | null;
    const c = step.configuration;
    if (
      c.stepType === "reference_select" &&
      c.resourceType === "TAXONOMY_NODE"
    ) {
      const phrases = (
        Array.isArray(answer.value) ? answer.value : [String(answer.value)]
      ).slice(0, 8);
      const ids: string[] = [];
      const unmatched: string[] = [];
      for (const phrase of phrases) {
        const found = await findTaxonomyCandidates(input.session, {
          text: phrase,
          vocabularyCodes: [...c.vocabularyCodes],
        });
        const best = found.candidates[0];
        if (best === undefined) {
          unmatched.push(phrase);
          continue;
        }
        if (found.resolution !== "EXACT" && found.candidates.length > 1) {
          return refuse({
            stepKey: step.stepKey,
            outcome: "AMBIGUOUS",
            reason: `"${phrase.slice(0, 80)}" could be more than one category.`,
            candidates: found.candidates
              .slice(0, 6)
              .map((candidate) => candidate.displayName.slice(0, 160)),
          });
        }
        if (!ids.includes(best.nodeId)) ids.push(best.nodeId);
      }
      if (ids.length === 0) {
        return refuse({
          stepKey: step.stepKey,
          outcome: "REJECTED",
          reason: `No category Capital Q records matches ${unmatched
            .map((p) => `"${p.slice(0, 80)}"`)
            .join(", ")}.`,
        });
      }
      value = {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: ids.slice(0, c.maxItems),
      };
    } else {
      const raw =
        typeof answer.value === "number"
          ? String(answer.value)
          : (answer.value as string | readonly string[] | boolean);
      value = toResponseValue(step, raw);
    }
    if (value === null) {
      const options = optionsOf(step).map((o) => o.label);
      return refuse({
        stepKey: step.stepKey,
        outcome: "REJECTED",
        reason:
          options.length > 0
            ? `That is not one of this step's options (${options.slice(0, 10).join(", ")}).`
            : "That does not fit what this step records.",
      });
    }
    return { ok: true, step, value };
  };

  /** Write a resolved value: one concept in one exclusion list, then submit. */
  const write = async (
    step: OnboardingStepManifest,
    resolvedValue: OnboardingResponseValue,
  ): Promise<OnboardingRecordResult> => {
    const view = await current();
    let value = resolvedValue;

    // One concept, one exclusion list: the journey keeps a red flag in
    // one of the two and refuses a write that lists it in both.
    const pair = EXCLUSION_SIBLINGS.get(step.stepKey);
    const sibling =
      pair === undefined
        ? undefined
        : view.responses.find((r) => r.stepKey === pair.sibling)?.value;
    if (
      pair !== undefined &&
      value.type === "MULTI_SELECT" &&
      sibling?.type === "MULTI_SELECT"
    ) {
      const overlap = value.optionKeys.filter((key) =>
        sibling.optionKeys.includes(key),
      );
      if (overlap.length > 0 && !pair.hard) {
        // Already never shown: nothing softer to add for those.
        const rest = value.optionKeys.filter((key) => !overlap.includes(key));
        if (rest.length === 0) {
          return {
            stepKey: step.stepKey,
            outcome: "REJECTED",
            reason: `${describeValue(step, value)} is already on the never-show list.`,
          };
        }
        value = { type: "MULTI_SELECT", optionKeys: rest };
      } else if (overlap.length > 0) {
        const kept = sibling.optionKeys.filter((key) => !overlap.includes(key));
        if (kept.length === 0) {
          return {
            stepKey: step.stepKey,
            outcome: "REJECTED",
            reason: `${describeValue(step, { type: "MULTI_SELECT", optionKeys: overlap })} is the only thing on the rank-lower list, and a list cannot be emptied from here, so it cannot move to never-show.`,
          };
        }
        try {
          await submit(pair.sibling, {
            type: "MULTI_SELECT",
            optionKeys: kept,
          });
        } catch (error: unknown) {
          return {
            stepKey: step.stepKey,
            outcome: "REJECTED",
            reason:
              readRefusal(error).because ??
              "It could not be moved off the rank-lower list.",
          };
        }
      }
    }

    try {
      await submit(step.stepKey, value);
      written.push(step.stepKey);
      const after = await current();
      return {
        stepKey: step.stepKey,
        outcome: "COMMITTED",
        recorded: (await spoken(step, value, after)).slice(0, 600),
      };
    } catch (error: unknown) {
      const refusal = readRefusal(error);
      const needs = stepNamed(refusal.needs);
      return needs !== undefined
        ? {
            stepKey: step.stepKey,
            outcome: "NEEDS_FIRST",
            needsStepKey: needs,
            ...(refusal.because === null
              ? {}
              : { reason: refusal.because.slice(0, 400) }),
          }
        : {
            stepKey: step.stepKey,
            outcome: "REJECTED",
            reason: (
              refusal.because ?? "The onboarding service did not accept it."
            ).slice(0, 400),
          };
    }
  };

  const recordOne = async (answer: {
    readonly stepKey: string;
    readonly value: string | readonly string[] | number | boolean;
  }): Promise<OnboardingRecordResult> => {
    const resolved = await resolve(answer);
    return resolved.ok
      ? await write(resolved.step, resolved.value)
      : resolved.result;
  };

  const pending = recommendations(input.onboardingSessionId);

  return {
    ownerUserId: input.ownerUserId,
    state,
    recommend: async (items) => {
      const results: OnboardingRecommendResult[] = [];
      for (const item of items) {
        const resolved = await resolve(item);
        if (!resolved.ok) {
          results.push({
            stepKey: resolved.result.stepKey,
            outcome: "REJECTED",
            ...(resolved.result.reason === undefined
              ? {}
              : { reason: resolved.result.reason }),
            ...(resolved.result.candidates === undefined
              ? {}
              : { candidates: resolved.result.candidates }),
          });
          continue;
        }
        const said = await spoken(
          resolved.step,
          resolved.value,
          await current(),
        );
        pending.set(resolved.step.stepKey, {
          value: resolved.value,
          spoken: said,
          because: item.because.slice(0, 300),
        });
        results.push({
          stepKey: resolved.step.stepKey,
          outcome: "RECOMMENDED",
          recommended: said.slice(0, 600),
        });
      }
      return results;
    },
    accept: async (stepKeys) => {
      const results: OnboardingRecordResult[] = [];
      for (const stepKey of stepKeys) {
        const held = pending.get(stepKey);
        const step = steps.get(stepKey);
        if (held === undefined || step === undefined) {
          results.push({
            stepKey: stepKey.slice(0, 80),
            outcome: "REJECTED",
            reason: "There is no pending recommendation for that step.",
          });
          continue;
        }
        // The approval binds to exactly what was recommended.
        const result = await write(step, held.value);
        if (result.outcome === "COMMITTED") pending.delete(stepKey);
        results.push(result);
      }
      return results;
    },
    finish: async (): Promise<FinishOnboardingOutput> => {
      const missing = (view: OnboardingSessionView) =>
        view.progress.eligibleSteps
          .filter((e) => e.required && e.status !== "COMPLETED")
          .map((e) => steps.get(e.stepKey))
          .filter(
            (step): step is OnboardingStepManifest =>
              step !== undefined &&
              step.configuration.stepType !== "confirmation",
          )
          .map((step) => ({
            stepKey: step.stepKey,
            question: (
              SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
            ).slice(0, 400),
          }));
      let view = await fresh();
      if (view.session.status === "COMPLETED") {
        return { completed: true, missing: [] };
      }
      const gaps = missing(view);
      if (gaps.length > 0) return { completed: false, missing: gaps };
      // The journey's own review steps, confirmed on the person's word —
      // one after another, since the next becomes eligible after the last.
      for (let guard = 0; guard < 4; guard += 1) {
        const open = view.progress.eligibleSteps.find(
          (e) =>
            e.status !== "COMPLETED" &&
            steps.get(e.stepKey)?.configuration.stepType === "confirmation",
        );
        if (open === undefined) break;
        try {
          await submit(open.stepKey, { type: "CONFIRMATION", confirmed: true });
          written.push(open.stepKey);
        } catch (error: unknown) {
          return {
            completed: false,
            missing: missing(await fresh()),
            reason: (
              readRefusal(error).because ?? "The review could not be confirmed."
            ).slice(0, 400),
          };
        }
        view = await current();
      }
      if (!view.progress.canComplete) {
        return { completed: false, missing: missing(view) };
      }
      try {
        latest = await completeOnboardingSession(
          input.session,
          input.onboardingSessionId,
          { expectedSessionVersion: view.session.version },
        );
        return { completed: true, missing: [] };
      } catch (error: unknown) {
        return {
          completed: false,
          missing: missing(await fresh()),
          reason: (
            readRefusal(error).because ??
            "The onboarding could not be completed."
          ).slice(0, 400),
        };
      }
    },
    record: async (answers) => {
      const results: OnboardingRecordResult[] = [];
      // In order: a prerequisite said in the same breath lands first.
      for (const answer of answers) results.push(await recordOne(answer));
      // A refused step whose prerequisite landed later in the batch gets
      // one more try, so the order they spoke in does not matter.
      for (const [index, result] of results.entries()) {
        const answer = answers[index];
        if (
          result.outcome === "NEEDS_FIRST" &&
          answer !== undefined &&
          result.needsStepKey !== undefined &&
          written.includes(result.needsStepKey)
        ) {
          results[index] = await recordOne(answer);
        }
      }
      return results;
    },
    view: () => latest,
    recorded: () => [...written],
  };
}
