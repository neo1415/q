import type {
  OnboardingResponseValue,
  OnboardingSessionView,
} from "@capital-q/contracts";

import {
  OnboardingClientError,
  type OnboardingClient,
  type TaxonomyCandidateView,
} from "./client";
import type { SessionPresentation } from "./session";

/**
 * The onboarding runtime as the web needs it: the generic session API plus
 * the two taxonomy reads the category screens use. Implemented by the
 * server-action adapter (real API) and by the in-memory fixture. Ports throw
 * OnboardingClientError; nothing else crosses this line.
 */
export type RuntimePort = {
  readonly current: () => Promise<OnboardingSessionView | null>;
  readonly start: (idempotencyKey: string) => Promise<OnboardingSessionView>;
  readonly get: (sessionId: string) => Promise<OnboardingSessionView>;
  readonly submit: (input: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
    readonly expectedSessionVersion: number;
    readonly idempotencyKey: string;
  }) => Promise<OnboardingSessionView>;
  readonly skip: (input: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly expectedSessionVersion: number;
    readonly idempotencyKey: string;
  }) => Promise<OnboardingSessionView>;
  readonly navigate: (input: {
    readonly sessionId: string;
    readonly expectedSessionVersion: number;
    readonly targetStepKey?: string | undefined;
  }) => Promise<OnboardingSessionView>;
  readonly complete: (input: {
    readonly sessionId: string;
    readonly expectedSessionVersion: number;
  }) => Promise<OnboardingSessionView>;
  readonly candidates: (
    text: string,
  ) => Promise<readonly TaxonomyCandidateView[]>;
  readonly describeNodes: (
    nodeIds: readonly string[],
  ) => Promise<readonly TaxonomyCandidateView[]>;
  /** Root nodes of one small vocabulary (business models, customer types). */
  readonly listNodes: (
    vocabularyCode: string,
  ) => Promise<readonly TaxonomyCandidateView[]>;
};

/** A screen the user sees: one or more runtime steps in definition order. */
export type JourneyGroup = {
  readonly id: string;
  readonly kind: string;
  readonly section: string;
  readonly title: string;
  /** Runtime step keys in definition order; never empty. */
  readonly stepKeys: readonly [string, ...string[]];
};

export type Submission =
  | {
      readonly stepKey: string;
      readonly action: "submit";
      readonly value: OnboardingResponseValue;
    }
  | { readonly stepKey: string; readonly action: "skip" }
  /** Not asked on this screen yet (becomes eligible later); leave untouched. */
  | { readonly stepKey: string; readonly action: "leave" };

export class SubmissionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionPlanError";
  }
}

/**
 * What a journey supplies: its screens, how the runtime view becomes its
 * presentation, and how a composite answer becomes ordered runtime steps.
 * Pure, shared by the API adapter and the fixture.
 */
export type JourneyModel<
  TView extends SessionPresentation<unknown>,
  TResponse,
  TExtras = Record<string, never>,
> = {
  readonly groups: readonly JourneyGroup[];
  readonly groupById: (id: string) => JourneyGroup | undefined;
  readonly currentGroup: (view: OnboardingSessionView) => JourneyGroup;
  readonly isSupportedVersion: (view: OnboardingSessionView) => boolean;
  readonly planSubmissions: (
    group: JourneyGroup,
    response: TResponse,
  ) => readonly Submission[];
  readonly toPresentation: (
    view: OnboardingSessionView,
    source: { readonly adapter: string; readonly synthetic: boolean },
    extras: TExtras,
  ) => TView;
  /** Extra data a screen needs from the port (e.g. labels for selected taxonomy ids). */
  readonly enrich: (
    view: OnboardingSessionView,
    group: JourneyGroup,
    port: RuntimePort,
  ) => Promise<TExtras>;
};

const VISITED = new Set(["IN_PROGRESS", "COMPLETED", "SKIPPED"]);
const VISITED_DONE = new Set(["COMPLETED", "SKIPPED"]);

export function sameValue(
  a: OnboardingResponseValue | undefined,
  b: OnboardingResponseValue,
): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * One OnboardingClient over any RuntimePort and JourneyModel. Owns the
 * mapping from composite screens to runtime steps: a composite save becomes
 * ordered runtime submissions, each carrying the version the previous one
 * returned, skipping steps the live session says are not eligible and plain
 * answers that are unchanged (confirmations are always re-committed).
 * Version conflicts surface as CONFLICT after the cached session is dropped.
 */
export function createRuntimeClient<
  TView extends SessionPresentation<unknown>,
  TResponse,
  TExtras,
>(
  port: RuntimePort,
  model: JourneyModel<TView, TResponse, TExtras>,
  source: { readonly adapter: string; readonly synthetic: boolean },
): OnboardingClient<TView, TResponse> {
  let latest: OnboardingSessionView | null = null;

  const remember = (view: OnboardingSessionView) => {
    latest = view;
    return view;
  };

  const session = async (): Promise<OnboardingSessionView> => {
    if (latest !== null) {
      return latest;
    }
    const current = await port.current();
    return remember(current ?? (await port.start(crypto.randomUUID())));
  };

  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof OnboardingClientError && error.kind === "CONFLICT") {
        latest = null;
      }
      throw error;
    }
  };

  const present = async (view: OnboardingSessionView): Promise<TView> => {
    if (!model.isSupportedVersion(view)) {
      throw new OnboardingClientError(
        "UNAVAILABLE",
        "This version of Capital Q can't show your setup journey yet. Please refresh later.",
      );
    }
    const group = model.currentGroup(view);
    return model.toPresentation(
      view,
      source,
      await model.enrich(view, group, port),
    );
  };

  const eligibleStatus = (view: OnboardingSessionView, stepKey: string) =>
    view.progress.eligibleSteps.find((s) => s.stepKey === stepKey)?.status;

  const firstVisited = (view: OnboardingSessionView, group: JourneyGroup) =>
    group.stepKeys.find((key) => {
      const status = eligibleStatus(view, key);
      return status !== undefined && VISITED.has(status);
    });

  const groupIndex = (group: JourneyGroup) =>
    model.groups.findIndex((candidate) => candidate.id === group.id);

  const responsesOf = (view: OnboardingSessionView) =>
    new Map(view.responses.map((r) => [r.stepKey, r.value]));

  /** Move the runtime pointer out of `group` once its screen is done. */
  const advance = async (
    view: OnboardingSessionView,
    group: JourneyGroup,
  ): Promise<OnboardingSessionView> => {
    if (
      model.currentGroup(view).id !== group.id ||
      view.session.status !== "ACTIVE" ||
      groupIndex(group) === model.groups.length - 1
    ) {
      return view;
    }
    // A question on this screen became eligible during the save (a follow-up
    // to an answer): stay so the user sees it, never skip it silently.
    const unfinished = group.stepKeys.some((key) => {
      const status = eligibleStatus(view, key);
      return status !== undefined && !VISITED_DONE.has(status);
    });
    if (unfinished) {
      return view;
    }
    for (const next of model.groups.slice(groupIndex(group) + 1)) {
      const target = firstVisited(view, next);
      if (target !== undefined) {
        return remember(
          await port.navigate({
            sessionId: view.session.id,
            expectedSessionVersion: view.session.version,
            targetStepKey: target,
          }),
        );
      }
      if (
        next.stepKeys.some((key) => eligibleStatus(view, key) !== undefined)
      ) {
        break;
      }
    }
    const last = [...group.stepKeys]
      .reverse()
      .find((key) => eligibleStatus(view, key) !== undefined);
    if (last === undefined) {
      return view;
    }
    const existing = responsesOf(view).get(last);
    if (existing !== undefined && eligibleStatus(view, last) === "COMPLETED") {
      return remember(
        await port.submit({
          sessionId: view.session.id,
          stepKey: last,
          value: existing,
          expectedSessionVersion: view.session.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    }
    return remember(
      await port.skip({
        sessionId: view.session.id,
        stepKey: last,
        expectedSessionVersion: view.session.version,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
  };

  const requireGroup = (stepId: string): JourneyGroup => {
    const group = model.groupById(stepId);
    if (group === undefined) {
      throw new OnboardingClientError(
        "REJECTED",
        "That screen isn't part of this setup.",
      );
    }
    return group;
  };

  return {
    getSession: () => guarded(async () => present(await session())),

    saveResponse: ({ stepId, response }) =>
      guarded(async () => {
        const group = requireGroup(stepId);
        let plan: readonly Submission[];
        try {
          plan = model.planSubmissions(group, response);
        } catch (error) {
          throw new OnboardingClientError(
            "REJECTED",
            error instanceof SubmissionPlanError
              ? error.message
              : "That answer couldn't be saved.",
          );
        }
        let view = await session();
        for (const submission of plan) {
          const status = eligibleStatus(view, submission.stepKey);
          if (status === undefined || submission.action === "leave") {
            continue;
          }
          if (submission.action === "submit") {
            if (
              status === "COMPLETED" &&
              submission.value.type !== "CONFIRMATION" &&
              sameValue(
                responsesOf(view).get(submission.stepKey),
                submission.value,
              )
            ) {
              continue;
            }
            view = remember(
              await port.submit({
                sessionId: view.session.id,
                stepKey: submission.stepKey,
                value: submission.value,
                expectedSessionVersion: view.session.version,
                idempotencyKey: crypto.randomUUID(),
              }),
            );
          } else if (status !== "SKIPPED") {
            view = remember(
              await port.skip({
                sessionId: view.session.id,
                stepKey: submission.stepKey,
                expectedSessionVersion: view.session.version,
                idempotencyKey: crypto.randomUUID(),
              }),
            );
          }
        }
        return present(await advance(view, group));
      }),

    skipStep: ({ stepId }) =>
      guarded(async () => {
        const group = requireGroup(stepId);
        let view = await session();
        for (const stepKey of group.stepKeys) {
          const status = eligibleStatus(view, stepKey);
          if (status === undefined || status === "SKIPPED") {
            continue;
          }
          view = remember(
            await port.skip({
              sessionId: view.session.id,
              stepKey,
              expectedSessionVersion: view.session.version,
              idempotencyKey: crypto.randomUUID(),
            }),
          );
        }
        return present(await advance(view, group));
      }),

    goBack: () =>
      guarded(async () => {
        const view = await session();
        const current = model.currentGroup(view);
        for (const previous of model.groups
          .slice(0, groupIndex(current))
          .reverse()) {
          const target = firstVisited(view, previous);
          if (target !== undefined) {
            return present(
              remember(
                await port.navigate({
                  sessionId: view.session.id,
                  expectedSessionVersion: view.session.version,
                  targetStepKey: target,
                }),
              ),
            );
          }
        }
        throw new OnboardingClientError("REJECTED", "This is the first step.");
      }),

    openStep: ({ stepId }) =>
      guarded(async () => {
        const group = requireGroup(stepId);
        const view = await session();
        if (model.currentGroup(view).id === group.id) {
          return present(view);
        }
        const target = firstVisited(view, group);
        if (target === undefined) {
          throw new OnboardingClientError(
            "REJECTED",
            "That screen isn't available yet.",
          );
        }
        return present(
          remember(
            await port.navigate({
              sessionId: view.session.id,
              expectedSessionVersion: view.session.version,
              targetStepKey: target,
            }),
          ),
        );
      }),

    complete: () =>
      guarded(async () => {
        const view = await session();
        return present(
          remember(
            await port.complete({
              sessionId: view.session.id,
              expectedSessionVersion: view.session.version,
            }),
          ),
        );
      }),

    findTaxonomyCandidates: ({ text }) => port.candidates(text),
  };
}
