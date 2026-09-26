import { randomUUID } from "node:crypto";

import {
  completeOnboardingSession,
  findTaxonomyCandidates,
  skipOnboardingStep,
  getOnboardingSession,
  getTaxonomyNode,
  listTaxonomyNodes,
  resolveOnboardingSuggestion,
  submitOnboardingResponse,
  withdrawOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import type {
  OnboardingResponseValue,
  OnboardingSessionView,
  TaxonomyCandidateResponse,
} from "@capital-q/contracts";
import {
  INVESTOR_CONCEPT_FAMILIES,
  investorPlausibility,
} from "@capital-q/investor-onboarding";
import type {
  OnboardingQRecommendations,
  OnboardingStepManifest,
} from "@capital-q/onboarding";
import { quoteOccursIn } from "@capital-q/q-knowledge";

import {
  figureCountIn,
  figureStatedIn,
  textStatedIn,
} from "./value-support.js";
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

/**
 * One concept, one answer (G): an open optional step in a concept family
 * another member of which is answered or set aside is covered by it.
 * Journey data names the families; nothing here reads a sentence.
 */
export function settleFamilies(
  rows: readonly OnboardingStepState[],
  journeyType: "investor" | "founder",
): OnboardingStepState[] {
  const families = journeyType === "investor" ? INVESTOR_CONCEPT_FAMILIES : [];
  const coveredBy = new Map<string, string>();
  for (const family of families) {
    const settled = rows.find(
      (row) =>
        family.stepKeys.includes(row.stepKey) &&
        (row.status === "ANSWERED" || row.status === "SET_ASIDE"),
    );
    if (settled === undefined) continue;
    for (const row of rows) {
      if (
        row.stepKey !== settled.stepKey &&
        family.stepKeys.includes(row.stepKey) &&
        row.status === "OPEN" &&
        !row.required
      ) {
        coveredBy.set(row.stepKey, settled.stepKey);
      }
    }
  }
  return rows.map((row) => {
    const by = coveredBy.get(row.stepKey);
    return by === undefined ? row : { ...row, coveredBy: by };
  });
}

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
  /**
   * What Q said just before the person's latest words: a figure Q read
   * back there, which they then confirmed, is theirs to record.
   */
  readonly lastQTurn?: string | undefined;
  /**
   * What the person's latest words establish, read independently of the
   * acting model (DELEGATION_READER): the steps they state about
   * themselves, decline, hand to Q or approve, and whether they want to
   * finish. Null when it could not be read: then nothing is established
   * and nothing is written (fail closed). Absent only where no reader is
   * composed (legacy callers and tests of other properties).
   */
  readonly authority?:
    | (() => Promise<{
        readonly stated: ReadonlySet<string>;
        readonly declined: ReadonlySet<string>;
        readonly handed: ReadonlySet<string>;
        readonly approved: ReadonlySet<string>;
        readonly finishing: boolean;
      } | null>)
    | undefined;
  readonly recommendations?: RecommendationStore | undefined;
  /**
   * The checks already put to the person in this conversation, by id, so
   * each is raised once. Absent: none remembered.
   */
  readonly raisedChecks?: ReadonlySet<string> | undefined;
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

  /** The note that settles a check: prose, with the code's own check id. */
  const settledNote = (checkId: string) =>
    `They confirmed this is right as it stands when asked (check ${checkId}).`;

  /** Checks on what is on the record that the person has not settled. */
  const openChecks = (view: OnboardingSessionView) => {
    if (input.journeyType !== "investor") return [];
    const values = new Map(view.responses.map((r) => [r.stepKey, r.value]));
    return investorPlausibility(values).filter(
      (check) =>
        !check.stepKeys.some((key) =>
          (view.responses.find((r) => r.stepKey === key)?.note ?? "").includes(
            `(check ${check.id})`,
          ),
        ),
    );
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
      steps: settleFamilies(rows, input.journeyType),
      checks: openChecks(view)
        .slice(0, 8)
        .map((check) => ({
          checkId: check.id.slice(0, 200),
          fact: check.fact.slice(0, 400),
          stepKeys: [...check.stepKeys].slice(0, 4),
          raised: input.raisedChecks?.has(check.id) === true,
        })),
    };
  };

  const submit = async (
    stepKey: string,
    value: OnboardingResponseValue,
    note?: string,
  ): Promise<void> => {
    const view = await current();
    latest = await settle(
      await submitOnboardingResponse(
        input.session,
        input.onboardingSessionId,
        {
          stepKey,
          response: { value, ...(note === undefined ? {} : { note }) },
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

  /**
   * The categories a taxonomy step records, by name: each vocabulary's
   * top level. A category that cannot be read is left out, never guessed.
   */
  const categoriesOf = async (
    vocabularyCodes: readonly string[],
  ): Promise<string[]> => {
    const names: string[] = [];
    for (const code of vocabularyCodes.slice(0, 6)) {
      try {
        const page = await listTaxonomyNodes(input.session, code, {
          roots: true,
          limit: 40,
        });
        for (const node of page.items) {
          if (!names.includes(node.displayName)) {
            names.push(node.displayName.slice(0, 160));
          }
        }
      } catch {
        // A vocabulary that cannot be listed offers nothing.
      }
    }
    return names.slice(0, 40);
  };

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
      // typeof, not Array.isArray: the latter widens a readonly list to any[].
      const phrases = (
        typeof answer.value === "object" ? answer.value : [String(answer.value)]
      ).slice(0, 8);
      const ids: string[] = [];
      const unmatched: string[] = [];
      for (const phrase of phrases) {
        const found: TaxonomyCandidateResponse = await findTaxonomyCandidates(
          input.session,
          {
            text: phrase,
            vocabularyCodes: [...c.vocabularyCodes],
          },
        );
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
      if (unmatched.length > 0) {
        // Their words name no category: the categories Capital Q records
        // go back to the model, which reads which one means what they
        // said (ADR 0011). Nothing is recorded until it chooses one.
        return refuse({
          stepKey: step.stepKey,
          outcome: "UNMATCHED",
          reason: `No category is named in ${unmatched
            .map((p) => `"${p.slice(0, 80)}"`)
            .join(
              ", ",
            )}. Choose the category below that means what they said and record it by its name; say which you chose. If none fits, ask them.`.slice(
            0,
            400,
          ),
          candidates: await categoriesOf([...c.vocabularyCodes]),
        });
      }
      value = {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: ids.slice(0, c.maxItems),
      };
    } else if (
      c.stepType === "single_select" ||
      c.stepType === "multi_select"
    ) {
      // An option is named by its key or its label, exactly; nothing else
      // is guessed from a phrase (the legacy reader fell through to
      // "Something else" for any unmatched text, recording a fact nobody
      // stated). Meaning is the model's: UNMATCHED hands it the options.
      const options = optionsOf(step);
      const named = (text: string): string | undefined => {
        const wanted = text.trim().toLowerCase();
        return options.find(
          (o) =>
            o.key.toLowerCase() === wanted || o.label.toLowerCase() === wanted,
        )?.key;
      };
      const phrases =
        typeof answer.value === "object"
          ? answer.value
          : [String(answer.value)];
      const keys: string[] = [];
      for (const phrase of phrases) {
        const key = named(phrase);
        if (key !== undefined) keys.push(key);
      }
      const [only] = keys;
      value =
        keys.length !== phrases.length || only === undefined
          ? null
          : c.stepType === "single_select"
            ? keys.length === 1
              ? toResponseValue(step, only)
              : null
            : toResponseValue(step, keys);
    } else {
      const raw =
        typeof answer.value === "number" ? String(answer.value) : answer.value;
      value = toResponseValue(step, raw);
    }
    if (value === null) {
      const options = optionsOf(step);
      return refuse(
        options.length > 0
          ? {
              stepKey: step.stepKey,
              outcome: "UNMATCHED",
              reason:
                "That names none of this step's options. Choose the option below that means what they said and record it by its key; say which you chose. If none fits, ask them.",
              candidates: options
                .slice(0, 40)
                .map((o) => `${o.label} (${o.key})`.slice(0, 160)),
            }
          : {
              stepKey: step.stepKey,
              outcome: "REJECTED",
              reason: "That does not fit what this step records.",
            },
      );
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

  /**
   * A STATED value must be one its quote gives (unknown stays unknown):
   * a figure they stated, or read back to them and confirmed; free text
   * in their own words. Which option or category the words mean stays the
   * model's reading. A DELEGATED item's quote is the instruction, so its
   * value is Q's choice by their authority, not something they said.
   */
  const unsupported = (
    step: OnboardingStepManifest,
    value: OnboardingResponseValue,
    answer: { readonly quote: string; readonly basis?: string | undefined },
  ): OnboardingRecordResult | null => {
    if (answer.basis === "DELEGATED") return null;
    const refuse = (reason: string): OnboardingRecordResult => ({
      stepKey: step.stepKey,
      outcome: "REJECTED",
      question: (
        SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
      ).slice(0, 400),
      reason,
    });
    if (value.type === "RANGE") {
      const stated = figureStatedIn(value.value, answer.quote);
      if (stated === true) {
        // One stated figure answers one step: the same figure from the
        // same words already filled another step this turn.
        const key = `${answer.quote.trim().toLowerCase()}\u0000${value.value}`;
        const used = figuresUsed.get(key) ?? [];
        if (
          used.some((other) => other !== step.stepKey) &&
          used.filter((other) => other !== step.stepKey).length >=
            figureCountIn(value.value, answer.quote)
        ) {
          const other = steps.get(used[0] ?? "");
          return refuse(
            `That figure is what they gave for ${(other === undefined ? "another question" : (SPOKEN_QUESTIONS[other.stepKey] ?? other.configuration.prompt)).slice(0, 200)}; they have not said it for this one, so nothing was recorded.`,
          );
        }
        return null;
      }
      if (
        stated === null &&
        input.lastQTurn !== undefined &&
        figureStatedIn(value.value, input.lastQTurn) === true &&
        input.personTurns[0] !== undefined &&
        quoteOccursIn(answer.quote, input.personTurns[0])
      ) {
        return null;
      }
      return refuse(
        stated === false
          ? "That figure is not one they stated, so nothing was recorded. Record only a figure they gave; a range they gave is its two ends, never a point you work out inside it."
          : "They gave no figure in digits here, so nothing was recorded. Say the number back to them and record it when they confirm it.",
      );
    }
    // An address said aloud is rewritten into its written form by the
    // step itself ("bridge dot com"), so it is not the words verbatim.
    if (
      value.type === "TEXT" &&
      !step.stepKey.endsWith(".website") &&
      !textStatedIn(value.text, answer.quote)
    ) {
      return refuse(
        "That text is not in their words, so nothing was recorded. Free text is recorded in the person's own words, and only for the question it answers.",
      );
    }
    return null;
  };

  /**
   * The self-statement gate (ACC 2026-09-25): an answer is theirs only
   * when their latest words state it about themselves. A question, advice
   * or a mention of a place, sector or amount never is, however the
   * acting model labels it. Null: permitted.
   */
  const notStated = async (
    stepKey: string,
  ): Promise<OnboardingRecordResult | null> => {
    if (input.authority === undefined) return null;
    const authority = await input.authority();
    if (authority?.stated.has(stepKey) === true) return null;
    return {
      stepKey: stepKey.slice(0, 80),
      outcome: "REJECTED",
      reason:
        authority === null
          ? "What they just said could not be confirmed, so nothing was recorded. Ask them to say it again."
          : "Their latest words do not state this about themselves, so nothing was recorded. A question, advice or a mention is never their answer; ask them if you want to know.",
    };
  };

  /** Figures committed this turn, by the words and value that gave them. */
  const figuresUsed = new Map<string, string[]>();
  const noteFigure = (
    step: OnboardingStepManifest,
    value: OnboardingResponseValue,
    quote: string,
  ) => {
    if (value.type !== "RANGE") return;
    const key = `${quote.trim().toLowerCase()}\u0000${value.value}`;
    const used = figuresUsed.get(key) ?? [];
    if (!used.includes(step.stepKey)) used.push(step.stepKey);
    figuresUsed.set(key, used);
  };

  const recordOne = async (answer: {
    readonly stepKey: string;
    readonly value: string | readonly string[] | number | boolean;
    readonly quote: string;
    readonly basis?: "STATED" | "DELEGATED" | undefined;
  }): Promise<OnboardingRecordResult> => {
    if (!said(answer.quote)) return unsaid(answer.stepKey);
    // A delegation is an instruction given now, "in the same instruction"
    // (lead decision, 2026-09-25): an earlier question or remark is not
    // the person handing Q this choice.
    if (
      answer.basis === "DELEGATED" &&
      (input.personTurns[0] === undefined ||
        !quoteOccursIn(answer.quote, input.personTurns[0]))
    ) {
      return {
        stepKey: answer.stepKey.slice(0, 80),
        outcome: "REJECTED",
        reason:
          "A choice is delegated only by what they say now, handing it to you; that quote is not from their latest words, so nothing was recorded.",
      };
    }
    if (answer.basis !== "DELEGATED") {
      const refused = await notStated(answer.stepKey);
      if (refused !== null) return refused;
    }
    if (answer.basis === "DELEGATED") {
      const authority = (await input.authority?.()) ?? null;
      if (authority === null || !authority.handed.has(answer.stepKey)) {
        return {
          stepKey: answer.stepKey.slice(0, 80),
          outcome: "REJECTED",
          reason:
            "They have not handed you this choice, so nothing was recorded. Hold it with recommend, say what you suggest and why, and let them decide.",
        };
      }
    }
    // Confirming the journey's review activates what it set up: that is
    // finishing, and only confirm_and_finish does it, all the way to a
    // completed session (ACC 2026-09-25: a review confirmed on its own
    // left the mandate ACTIVE and the session open).
    const confirming = steps.get(answer.stepKey);
    if (confirming?.configuration.stepType === "confirmation") {
      return {
        stepKey: confirming.stepKey,
        outcome: "REJECTED",
        reason:
          "Confirming the review is finishing. When they confirm the record is right and want to finish, use confirm_and_finish; it completes their setup.",
      };
    }
    const resolved = await resolve(answer);
    if (!resolved.ok) return resolved.result;
    const refused = unsupported(resolved.step, resolved.value, answer);
    if (refused !== null) return refused;
    const written = await write(resolved.step, resolved.value);
    if (written.outcome === "COMMITTED") {
      noteFigure(resolved.step, resolved.value, answer.quote);
    }
    return written;
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
        // Approval is the person's, read from their latest words
        // independently of the acting model: another instruction is not
        // an approval of an earlier recommendation (ACC/E3 live,
        // 2026-09-25).
        const authority = (await input.authority?.()) ?? null;
        if (authority === null || !authority.approved.has(stepKey)) {
          results.push({
            stepKey,
            outcome: "REJECTED",
            reason:
              "They have not approved that recommendation in what they just said, so nothing was recorded. It stays pending for their decision.",
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
        const unstated = await notStated(step.stepKey);
        if (unstated !== null) {
          results.push(unstated);
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
    confirmAsStated: async ({ checkId, quote }) => {
      const view = await fresh();
      const check = openChecks(view).find((c) => c.id === checkId);
      if (check === undefined) {
        return [
          {
            stepKey: "-",
            outcome: "REJECTED",
            reason: "There is no such open check; nothing was changed.",
          },
        ];
      }
      const [stepKey = "-"] = check.stepKeys;
      if (!said(quote)) return [unsaid(stepKey)];
      // Their word about their own values, read independently: confirming
      // what Q just put to them states those steps.
      if (input.authority !== undefined) {
        const authority = await input.authority();
        if (!check.stepKeys.some((k) => authority?.stated.has(k) === true)) {
          return [
            {
              stepKey,
              outcome: "REJECTED",
              reason:
                "Their latest words do not confirm these values, so nothing was changed.",
            },
          ];
        }
      }
      const held = view.responses.find((r) => r.stepKey === stepKey);
      if (held === undefined) {
        return [
          {
            stepKey,
            outcome: "REJECTED",
            reason: "That value is no longer on the record.",
          },
        ];
      }
      try {
        // The same value, re-recorded with the note that settles the
        // check: history kept, nothing changed but the settlement.
        await submit(stepKey, held.value, settledNote(check.id));
        written.push(stepKey);
        return [{ stepKey, outcome: "CONFIRMED_AS_STATED" }];
      } catch (error: unknown) {
        return [refused(stepKey, error)];
      }
    },
    setAside: async (declined) => {
      const results: OnboardingRecordResult[] = [];
      for (const item of declined) {
        const step = steps.get(item.stepKey);
        if (step === undefined) {
          results.push({
            stepKey: item.stepKey.slice(0, 80),
            outcome: "REJECTED",
            reason: "There is no such step in this onboarding.",
          });
          continue;
        }
        const question = (
          SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
        ).slice(0, 400);
        if (step.required) {
          results.push({
            stepKey: step.stepKey,
            outcome: "REJECTED",
            question,
            reason:
              "This one is needed to set them up, so it cannot be set aside. Say briefly why it matters and ask it plainly.",
          });
          continue;
        }
        if (!said(item.quote)) {
          results.push(unsaid(step.stepKey));
          continue;
        }
        // A decline is theirs only when their latest words decline it.
        if (input.authority !== undefined) {
          const authority = await input.authority();
          if (authority?.declined.has(step.stepKey) !== true) {
            results.push({
              stepKey: step.stepKey,
              outcome: "REJECTED",
              question,
              reason:
                authority === null
                  ? "What they just said could not be confirmed, so nothing was set aside."
                  : "Their latest words do not decline this one, so nothing was set aside.",
            });
            continue;
          }
        }
        try {
          const view = await current();
          const answered = view.responses.some(
            (r) => r.stepKey === step.stepKey,
          );
          if (answered) {
            // Declining what they had answered takes it back, with its
            // history kept; the service sets the step aside.
            await withdraw(step.stepKey);
          } else {
            latest = await settle(
              await skipOnboardingStep(
                input.session,
                input.onboardingSessionId,
                step.stepKey,
                { expectedSessionVersion: view.session.version },
                randomUUID(),
              ),
            );
          }
          written.push(step.stepKey);
          results.push({
            stepKey: step.stepKey,
            outcome: "SET_ASIDE",
            question,
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
      // Confirming the review activates their mandate: it is their
      // decision, read from their latest words, never the acting model's.
      if (input.authority !== undefined) {
        const authority = await input.authority();
        if (authority?.finishing !== true) {
          return {
            completed: false,
            missing: [],
            reason:
              "They have not confirmed that the record is right and that they want to finish, so nothing was completed. Ask them.",
          };
        }
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
