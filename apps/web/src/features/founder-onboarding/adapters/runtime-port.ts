import type {
  OnboardingResponseValue,
  OnboardingSessionView,
} from "@capital-q/contracts";

import {
  currentGroup,
  GROUPS,
  groupById,
  isSupportedVersion,
  planSubmissions,
  runtimeState,
  sameValue,
  SubmissionPlanError,
  toPresentation,
  type Group,
} from "../models/journey";
import type {
  FounderOnboardingSessionView,
  TaxonomyCandidateView,
} from "../models/presentation";
import {
  type FounderOnboardingClient,
  FounderOnboardingClientError,
} from "./client";

/**
 * The onboarding runtime as the web needs it: the generic session API plus
 * the two taxonomy reads the categories screen uses. Implemented by the
 * server-action adapter (real API) and by the in-memory fixture. Ports throw
 * FounderOnboardingClientError; nothing else crosses this line.
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
};

const VISITED = new Set(["IN_PROGRESS", "COMPLETED", "SKIPPED"]);
const VISITED_DONE = new Set(["COMPLETED", "SKIPPED"]);

/**
 * One FounderOnboardingClient over any RuntimePort. Owns the mapping from
 * composite screens to runtime steps: a "team" save becomes five ordered
 * runtime submissions, each carrying the version the previous one returned,
 * skipping steps the live session says are not eligible and steps whose
 * answer is unchanged. Version conflicts surface as CONFLICT after the
 * cached session is dropped, so the next read is fresh.
 */
export function createRuntimeFounderClient(
  port: RuntimePort,
  source: { readonly adapter: string; readonly synthetic: boolean },
): FounderOnboardingClient {
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
      if (
        error instanceof FounderOnboardingClientError &&
        error.kind === "CONFLICT"
      ) {
        latest = null;
      }
      throw error;
    }
  };

  const present = async (
    view: OnboardingSessionView,
  ): Promise<FounderOnboardingSessionView> => {
    if (!isSupportedVersion(view)) {
      throw new FounderOnboardingClientError(
        "UNAVAILABLE",
        "This version of Capital Q can't show your setup journey yet. Please refresh later.",
      );
    }
    const group = currentGroup(view);
    if (group.id === "categories") {
      const response = view.responses.find(
        (r) => r.stepKey === group.stepKeys[0],
      );
      const ids =
        response?.value.type === "RESOURCE_REFERENCE"
          ? response.value.resourceIds
          : [];
      const selectedTaxonomy =
        ids.length === 0 ? [] : await port.describeNodes(ids);
      return toPresentation(view, source, { selectedTaxonomy });
    }
    return toPresentation(view, source);
  };

  const eligibleStatus = (view: OnboardingSessionView, stepKey: string) =>
    view.progress.eligibleSteps.find((s) => s.stepKey === stepKey)?.status;

  const firstVisited = (view: OnboardingSessionView, group: Group) =>
    group.stepKeys.find((key) => {
      const status = eligibleStatus(view, key);
      return status !== undefined && VISITED.has(status);
    });

  const groupIndex = (group: Group) =>
    GROUPS.findIndex((candidate) => candidate.id === group.id);

  /** Move the runtime pointer out of `group` once its screen is done. */
  const advance = async (
    view: OnboardingSessionView,
    group: Group,
  ): Promise<OnboardingSessionView> => {
    if (
      currentGroup(view).id !== group.id ||
      view.session.status !== "ACTIVE" ||
      groupIndex(group) === GROUPS.length - 1
    ) {
      return view;
    }
    // A question on this screen became eligible during the save (a follow-up
    // to an answer): stay so the founder sees it, never skip it silently.
    const unfinished = group.stepKeys.some((key) => {
      const status = eligibleStatus(view, key);
      return status !== undefined && !VISITED_DONE.has(status);
    });
    if (unfinished) {
      return view;
    }
    // A later screen already visited: jump straight to it.
    for (const next of GROUPS.slice(groupIndex(group) + 1)) {
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
    // Otherwise the runtime moves on when the group's last answered step is
    // re-committed with its own value (an idempotent revision).
    const last = [...group.stepKeys]
      .reverse()
      .find((key) => eligibleStatus(view, key) !== undefined);
    if (last === undefined) {
      return view;
    }
    const state = runtimeState(view);
    const existing = state.responses.get(last);
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

  const requireGroup = (stepId: string): Group => {
    const group = groupById(stepId);
    if (group === undefined) {
      throw new FounderOnboardingClientError(
        "REJECTED",
        "That screen isn't part of founder setup.",
      );
    }
    return group;
  };

  return {
    getSession: () => guarded(async () => present(await session())),

    saveResponse: ({ stepId, response }) =>
      guarded(async () => {
        const group = requireGroup(stepId);
        let plan: ReturnType<typeof planSubmissions>;
        try {
          plan = planSubmissions(group, response);
        } catch (error) {
          throw new FounderOnboardingClientError(
            "REJECTED",
            error instanceof SubmissionPlanError
              ? error.message
              : "That answer couldn't be saved.",
          );
        }
        let view = await session();
        for (const submission of plan) {
          const status = eligibleStatus(view, submission.stepKey);
          if (status === undefined) {
            continue;
          }
          const state = runtimeState(view);
          if (submission.action === "leave") {
            continue;
          }
          if (submission.action === "submit") {
            // A confirmation is an action (save the raise), always re-committed
            // so its canonical write sees the revised answers; a plain answer
            // that has not changed is not re-sent.
            if (
              status === "COMPLETED" &&
              submission.value.type !== "CONFIRMATION" &&
              sameValue(
                state.responses.get(submission.stepKey),
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
        const current = currentGroup(view);
        for (const previous of GROUPS.slice(0, groupIndex(current)).reverse()) {
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
        throw new FounderOnboardingClientError(
          "REJECTED",
          "This is the first step.",
        );
      }),

    openStep: ({ stepId }) =>
      guarded(async () => {
        const group = requireGroup(stepId);
        const view = await session();
        if (currentGroup(view).id === group.id) {
          return present(view);
        }
        const target = firstVisited(view, group);
        if (target === undefined) {
          throw new FounderOnboardingClientError(
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
