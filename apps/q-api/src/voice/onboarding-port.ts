import { randomUUID } from "node:crypto";

import {
  completeOnboardingSession,
  findTaxonomyCandidates,
  getOnboardingSession,
  getTaxonomyNode,
  resolveOnboardingSuggestion,
  submitOnboardingResponse,
  withdrawOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import type {
  OnboardingResponseValue,
  OnboardingSessionView,
} from "@capital-q/contracts";
import type {
  OnboardingQRecommendations,
  OnboardingStepManifest,
} from "@capital-q/onboarding";
import { quoteOccursIn } from "@capital-q/q-knowledge";
import type { UserId } from "@capital-q/security";
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
 * Q's recommendations live in the onboarding service as suggestions with a
 * Q_RECOMMENDATION source (P0-2): durable, owner-checked, the payload
 * immutable. Composed from packages/onboarding in production; a fake in
 * tests.
 */
export type RecommendationStore = Pick<
  OnboardingQRecommendations,
  "recommend" | "pending"
>;

export type BoundOnboardingPort = OnboardingToolPort & {
  /** The latest view this port saw, for the caller's outcome. */
  readonly view: () => OnboardingSessionView | null;
  /** Steps this port wrote, in order. */
  readonly recorded: () => readonly string[];
  /** Q's recommendations still waiting on the person, as Q would say them. */
  readonly pendingRecommendations: () => Promise<
    readonly {
      readonly stepKey: string;
      readonly value: string;
      readonly rationale: string | null;
    }[]
  >;
};

export function createOnboardingPort(input: {
  readonly session: ApiSession;
  readonly onboardingSessionId: string;
  readonly journeyType: "investor" | "founder";
  readonly ownerUserId: string;
  /**
   * What the person has said in this conversation, newest first: the only
   * text a write's quote may come from (P0-2). Never tool results, web
   * pages or documents.
   */
  readonly personTurns: readonly string[];
  readonly recommendations?: RecommendationStore | undefined;
  /** The Q run, for a recommendation's provenance. */
  readonly runId?: string | undefined;
}): BoundOnboardingPort {
  const steps = new Map(
    definitionFor(input.journeyType).steps.map(
      (step) => [step.stepKey, step] as const,
    ),
  );
  let latest: OnboardingSessionView | null = null;
  const written: string[] = [];
  const userId = input.ownerUserId as UserId;
  const store = input.recommendations;
  const pendingNow = async () =>
    store === undefined
      ? []
      : await store.pending({ userId, sessionId: input.onboardingSessionId });
  /**
   * What the person has heard: the recommendations pending when this turn
   * began. Only those may be accepted — one made in this very turn has
   * not been said to anybody yet.
   */
  const heard = pendingNow().catch(() => []);
  /** The person's own words carry this write, or it does not happen. */
  const said = (quote: string): boolean =>
    input.personTurns.some((turn) => quoteOccursIn(quote, turn));
  const unsaid = (stepKey: string): OnboardingRecordResult => ({
    stepKey: stepKey.slice(0, 80),
    outcome: "REJECTED",
    reason:
      "That quote is not in anything the person said here, so nothing was recorded. Only their own words can put an answer on the record.",
  });

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
    const pendingList = await pendingNow().catch(() => []);
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
        ...(await (async () => {
          const held = pendingList.find((r) => r.stepKey === step.stepKey);
          if (held === undefined) return {};
          const heardIt = (await heard).some((r) => r.id === held.id);
          return {
            pendingRecommendation:
              `${await spoken(step, held.value, view)}${held.rationale === null ? "" : ` (because ${held.rationale})`}${heardIt ? "" : " (not yet said to them)"}`.slice(
                0,
                600,
              ),
          };
        })()),
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

  const withdraw = async (stepKey: string): Promise<void> => {
    const view = await current();
    latest = await settle(
      await withdrawOnboardingResponse(
        input.session,
        input.onboardingSessionId,
        stepKey,
        { expectedSessionVersion: view.session.version },
        randomUUID(),
      ),
    );
  };

  /**
   * One concept, one exclusion list: the journey keeps a red flag in one of
   * the two and refuses a write that lists it in both. A never-show answer
   * moves the item off the softer list (withdrawing that list when it was
   * the last item); a softer answer leaves out what is already never shown.
   */
  const prepareSiblings = async (
    step: OnboardingStepManifest,
    resolvedValue: OnboardingResponseValue,
  ): Promise<
    | {
        readonly ok: true;
        readonly value: OnboardingResponseValue;
        readonly movedFrom?: OnboardingRecordResult["movedFrom"];
      }
    | { readonly ok: false; readonly result: OnboardingRecordResult }
  > => {
    const view = await current();
    const pair = EXCLUSION_SIBLINGS.get(step.stepKey);
    const sibling =
      pair === undefined
        ? undefined
        : view.responses.find((r) => r.stepKey === pair.sibling)?.value;
    if (
      pair === undefined ||
      resolvedValue.type !== "MULTI_SELECT" ||
      sibling?.type !== "MULTI_SELECT"
    ) {
      return { ok: true, value: resolvedValue };
    }
    const overlap = resolvedValue.optionKeys.filter((key) =>
      sibling.optionKeys.includes(key),
    );
    if (overlap.length === 0) return { ok: true, value: resolvedValue };
    if (!pair.hard) {
      const rest = resolvedValue.optionKeys.filter(
        (key) => !overlap.includes(key),
      );
      if (rest.length === 0) {
        return {
          ok: false,
          result: {
            stepKey: step.stepKey,
            outcome: "REJECTED",
            reason: `${describeValue(step, resolvedValue)} is already on the never-show list.`,
          },
        };
      }
      return { ok: true, value: { type: "MULTI_SELECT", optionKeys: rest } };
    }
    const kept = sibling.optionKeys.filter((key) => !overlap.includes(key));
    try {
      // Moving the last item empties the softer list: that is a
      // withdrawal, with its history kept.
      if (kept.length === 0) await withdraw(pair.sibling);
      else
        await submit(pair.sibling, { type: "MULTI_SELECT", optionKeys: kept });
    } catch (error: unknown) {
      return {
        ok: false,
        result: {
          stepKey: step.stepKey,
          outcome: "REJECTED",
          reason: (
            readRefusal(error).because ??
            "It could not be moved off the rank-lower list."
          ).slice(0, 400),
        },
      };
    }
    const siblingStep = steps.get(pair.sibling);
    return {
      ok: true,
      value: resolvedValue,
      ...(siblingStep === undefined
        ? {}
        : {
            movedFrom: {
              stepKey: pair.sibling,
              question: (
                SPOKEN_QUESTIONS[pair.sibling] ??
                siblingStep.configuration.prompt
              ).slice(0, 400),
              items: describeValue(siblingStep, {
                type: "MULTI_SELECT",
                optionKeys: overlap,
              }).slice(0, 600),
            },
          }),
    };
  };

  /** Where the service refuses, its own reason, and the step it needs first. */
  const refused = (stepKey: string, error: unknown): OnboardingRecordResult => {
    const refusal = readRefusal(error);
    const needs = stepNamed(refusal.needs);
    return needs !== undefined
      ? {
          stepKey,
          outcome: "NEEDS_FIRST",
          needsStepKey: needs,
          ...(refusal.because === null
            ? {}
            : { reason: refusal.because.slice(0, 400) }),
        }
      : {
          stepKey,
          outcome: "REJECTED",
          reason: (
            refusal.because ?? "The onboarding service did not accept it."
          ).slice(0, 400),
        };
  };

  /** Write a resolved value: one concept in one exclusion list, then submit. */
  const write = async (
    step: OnboardingStepManifest,
    resolvedValue: OnboardingResponseValue,
  ): Promise<OnboardingRecordResult> => {
    const prepared = await prepareSiblings(step, resolvedValue);
    if (!prepared.ok) return prepared.result;
    const value = prepared.value;
    try {
      await submit(step.stepKey, value);
      written.push(step.stepKey);
      const after = await current();
      return {
        stepKey: step.stepKey,
        outcome: "COMMITTED",
        question: (
          SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
        ).slice(0, 400),
        recorded: (await spoken(step, value, after)).slice(0, 600),
        ...(prepared.movedFrom === undefined
          ? {}
          : { movedFrom: prepared.movedFrom }),
      };
    } catch (error: unknown) {
      return refused(step.stepKey, error);
    }
  };

  const recordOne = async (answer: {
    readonly stepKey: string;
    readonly value: string | readonly string[] | number | boolean;
    readonly quote: string;
  }): Promise<OnboardingRecordResult> => {
    if (!said(answer.quote)) return unsaid(answer.stepKey);
    const resolved = await resolve(answer);
    return resolved.ok
      ? await write(resolved.step, resolved.value)
      : resolved.result;
  };

  return {
    ownerUserId: input.ownerUserId,
    state,
    recommend: async (items) => {
      const results: OnboardingRecommendResult[] = [];
      for (const item of items) {
        if (store === undefined) {
          results.push({
            stepKey: item.stepKey.slice(0, 80),
            outcome: "REJECTED",
            reason: "Recommendations cannot be kept right now.",
          });
          continue;
        }
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
        try {
          const kept = await store.recommend({
            userId,
            sessionId: input.onboardingSessionId,
            stepKey: resolved.step.stepKey,
            value: resolved.value,
            rationale: item.because,
            runId: input.runId ?? null,
          });
          results.push({
            stepKey: kept.stepKey,
            outcome: "RECOMMENDED",
            recommended: (
              await spoken(resolved.step, kept.value, await current())
            ).slice(0, 600),
          });
        } catch (error: unknown) {
          results.push({
            stepKey: resolved.step.stepKey,
            outcome: "REJECTED",
            reason: (
              readRefusal(error).because ??
              "That recommendation could not be kept."
            ).slice(0, 400),
          });
        }
      }
      return results;
    },
    accept: async (stepKeys) => {
      const results: OnboardingRecordResult[] = [];
      const heardList = await heard;
      const stillPending = await pendingNow();
      for (const stepKey of stepKeys) {
        const step = steps.get(stepKey);
        const held = stillPending.find((r) => r.stepKey === stepKey);
        if (step === undefined || held === undefined) {
          results.push({
            stepKey: stepKey.slice(0, 80),
            outcome: "REJECTED",
            reason: "There is no pending recommendation for that step.",
          });
          continue;
        }
        if (!heardList.some((r) => r.id === held.id)) {
          results.push({
            stepKey,
            outcome: "REJECTED",
            reason:
              "That recommendation has not been said to the person yet; tell them what it is and let them decide.",
          });
          continue;
        }
        // The approval binds to exactly what was recommended: if the
        // journey would need to change it, it is not accepted.
        const prepared = await prepareSiblings(step, held.value);
        if (!prepared.ok) {
          results.push(prepared.result);
          continue;
        }
        if (JSON.stringify(prepared.value) !== JSON.stringify(held.value)) {
          results.push({
            stepKey,
            outcome: "REJECTED",
            reason:
              "Part of that recommendation is already on the never-show list, so it cannot be accepted as it stands.",
          });
          continue;
        }
        try {
          const view = await current();
          latest = await settle(
            await resolveOnboardingSuggestion(
              input.session,
              input.onboardingSessionId,
              held.id,
              {
                resolution: "ACCEPT",
                expectedSessionVersion: view.session.version,
              },
              randomUUID(),
            ),
          );
          written.push(stepKey);
          results.push({
            stepKey,
            outcome: "COMMITTED",
            question: (
              SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
            ).slice(0, 400),
            recorded: (await spoken(step, held.value, await current())).slice(
              0,
              600,
            ),
            ...(prepared.movedFrom === undefined
              ? {}
              : { movedFrom: prepared.movedFrom }),
          });
        } catch (error: unknown) {
          results.push(refused(stepKey, error));
        }
      }
      return results;
    },
    correct: async (corrections) => {
      const results: OnboardingRecordResult[] = [];
      for (const correction of corrections) {
        if (!said(correction.quote)) {
          results.push(unsaid(correction.stepKey));
          continue;
        }
        const step = steps.get(correction.stepKey);
        if (correction.value !== null) {
          results.push(
            await recordOne({
              stepKey: correction.stepKey,
              value: correction.value,
              quote: correction.quote,
            }),
          );
          continue;
        }
        if (step === undefined) {
          results.push({
            stepKey: correction.stepKey.slice(0, 80),
            outcome: "REJECTED",
            reason: "There is no such step in this onboarding.",
          });
          continue;
        }
        try {
          await withdraw(step.stepKey);
          written.push(step.stepKey);
          results.push({
            stepKey: step.stepKey,
            outcome: "WITHDRAWN",
            question: (
              SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
            ).slice(0, 400),
          });
        } catch (error: unknown) {
          results.push(refused(step.stepKey, error));
        }
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
    pendingRecommendations: async () => {
      const view = await current();
      const list = await pendingNow().catch(() => []);
      const out: {
        stepKey: string;
        value: string;
        rationale: string | null;
      }[] = [];
      for (const item of list) {
        const step = steps.get(item.stepKey);
        if (step === undefined) continue;
        out.push({
          stepKey: item.stepKey,
          value: (await spoken(step, item.value, view)).slice(0, 600),
          rationale: item.rationale,
        });
      }
      return out;
    },
  };
}
