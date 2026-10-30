import type {
  OnboardingResponseChannel,
  OnboardingResponseValue,
  OnboardingSessionView,
  SayOnboardingResponse,
} from "@capital-q/contracts";

import {
  OnboardingClientError,
  type MaterialUploadOutcome,
  type OnboardingClient,
  type TaxonomyCandidateView,
} from "./client";
import type { MaterialFileView } from "./materials";
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
    /**
     * Which surface the answer was given in (lane ob1's response channel):
     * provenance so coverage can say "from the form" or "from your
     * conversation with Q". Absent when re-sending an answer already held.
     */
    readonly channel?: OnboardingResponseChannel | undefined;
  }) => Promise<OnboardingSessionView>;
  readonly skip: (input: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly expectedSessionVersion: number;
    readonly idempotencyKey: string;
  }) => Promise<OnboardingSessionView>;
  /**
   * Accept, correct or decline one of Q's proposals. Absent on a port with
   * no suggestion path, so a screen can tell the difference between "the
   * founder declined" and "this build cannot record a decision".
   */
  readonly resolveSuggestion?:
    | ((input: {
        readonly sessionId: string;
        readonly suggestionId: string;
        readonly resolution: "ACCEPT" | "EDIT" | "REJECT";
        readonly response?: OnboardingResponseValue | undefined;
        readonly expectedSessionVersion: number;
        readonly idempotencyKey: string;
      }) => Promise<OnboardingSessionView>)
    | undefined;
  /**
   * Answer or set aside one of Q's persisted questions (CQ-PRE-REC-001).
   * Answering commits a normal validated response to the step the question
   * (or one of its options) names. Absent on a port without the path.
   */
  readonly answerQuestion?:
    | ((input: {
        readonly sessionId: string;
        readonly questionId: string;
        readonly stepKey: string;
        readonly value: OnboardingResponseValue;
        readonly expectedSessionVersion: number;
        readonly idempotencyKey: string;
      }) => Promise<OnboardingSessionView>)
    | undefined;
  readonly dismissQuestion?:
    | ((input: {
        readonly sessionId: string;
        readonly questionId: string;
        readonly expectedSessionVersion: number;
        readonly idempotencyKey: string;
      }) => Promise<OnboardingSessionView>)
    | undefined;
  /**
   * One turn of the conversational interview (CQ-PRE-REC-001 §16-§21):
   * what the person said about the current step, placed by the runtime or
   * recorded for Q's reading. Absent on a port without the path.
   */
  readonly say?:
    | ((input: {
        readonly sessionId: string;
        readonly text: string;
        readonly expectedSessionVersion: number;
        readonly idempotencyKey: string;
        /** The exchange so far, oldest first: same context typed as aloud. */
        readonly recentTurns: readonly {
          readonly role: "person" | "q";
          readonly text: string;
        }[];
        /** The founder profile section they came to fill (Overview link). */
        readonly focus?: string | undefined;
        /** The review whose confirm button they tapped (sweep D1). */
        readonly confirmReview?: string | undefined;
        /** Turn latency L9: each finished sentence of Q's reply, as it is written. */
        readonly onSentence?: ((text: string) => void) | undefined;
        /** What Q is doing now, from real events in the turn. */
        readonly onStage?:
          | ((stage: {
              readonly stage: string;
              readonly label: string;
            }) => void)
          | undefined;
      }) => Promise<SayOnboardingResponse>)
    | undefined;
  /**
   * Upload one document for a document-gathering step. Absent on a port
   * with no upload path, so a screen says so rather than reporting a
   * success nothing performed.
   */
  readonly uploadMaterial?:
    | ((input: {
        readonly companyId: string;
        readonly file: File;
        readonly documentType: string;
      }) => Promise<MaterialUploadOutcome>)
    | undefined;
  /** The company's documents with their real processing state. */
  readonly listMaterials?:
    ((companyId: string) => Promise<readonly MaterialFileView[]>) | undefined;
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
    view: OnboardingSessionView,
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
 * A reference list added to a step, merged with what the step holds on
 * `view` (live recheck 2026-10-30: a rebased upload answer reused the
 * browser's cached list and could drop a document that landed meanwhile).
 * Held ids first, then the new ones; the newest `max` are kept.
 */
export function mergedOnto(
  view: Pick<OnboardingSessionView, "responses">,
  stepKey: string,
  value: OnboardingResponseValue,
  max: number,
): OnboardingResponseValue {
  if (value.type !== "RESOURCE_REFERENCE") return value;
  const held = view.responses.find((r) => r.stepKey === stepKey)?.value;
  const before =
    held?.type === "RESOURCE_REFERENCE" &&
    held.resourceType === value.resourceType
      ? held.resourceIds
      : [];
  return {
    ...value,
    resourceIds: [...new Set([...before, ...value.resourceIds])].slice(-max),
  };
}

/** How many times one step's answer is made again after a conflict. */
const REBASE_ATTEMPTS = 2;

/**
 * One OnboardingClient over any RuntimePort and JourneyModel. Owns the
 * mapping from composite screens to runtime steps: a composite save becomes
 * ordered runtime submissions, each carrying the version the previous one
 * returned, skipping steps the live session says are not eligible and plain
 * answers that are unchanged (confirmations are always re-committed).
 * Writes go one at a time, in order. A version conflict surfaces as
 * CONFLICT after the cached session is dropped, except for one step's
 * whole answer, which is made again on the fresh version (bounded).
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

  const unqueued = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof OnboardingClientError && error.kind === "CONFLICT") {
        latest = null;
      }
      throw error;
    }
  };

  /**
   * One write of this session's at a time, in the order they were made
   * (live recheck 2026-10-30: an upload's answer and a tapped chip went out
   * against the same session version; the second came back a conflict).
   * Each write reads the version the one before it returned.
   */
  let queue: Promise<unknown> = Promise.resolve();
  const guarded = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(
      () => unqueued(work),
      () => unqueued(work),
    );
    queue = next.catch(() => undefined);
    return next;
  };

  /**
   * One step's whole answer, made again on the version the session moved
   * to when something else saved first (live recheck 2026-10-30: Q's
   * reading saved the company's categories at 03:21:23; the upload's
   * answer, sent at 03:21:27 on the version before, came back 409 and was
   * dropped). The answer does not depend on the other steps, so it stands
   * on the fresh version; the API still validates it there. Bounded.
   */
  const rebased = async <T>(
    attempt: (view: OnboardingSessionView) => Promise<T>,
  ): Promise<T> => {
    for (let tries = 0; ; tries += 1) {
      const view = await session();
      try {
        return await attempt(view);
      } catch (error) {
        const conflict =
          error instanceof OnboardingClientError && error.kind === "CONFLICT";
        if (!conflict || tries >= REBASE_ATTEMPTS) throw error;
        latest = null;
      }
    }
  };

  const present = async (view: OnboardingSessionView): Promise<TView> => {
    if (!model.isSupportedVersion(view)) {
      throw new OnboardingClientError(
        "UNAVAILABLE",
        "This version of Capital Q can't show your setup journey yet. Reload the page later.",
      );
    }
    const group = model.currentGroup(view);
    const presentation = model.toPresentation(
      view,
      source,
      await model.enrich(view, group, port),
    );
    // The runtime view itself travels with the presentation: the
    // conversational interview asks one runtime step at a time and needs
    // its prompt, options and reasons, not the composite screen.
    return { ...presentation, raw: view };
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
    getSession: () => unqueued(async () => present(await session())),

    ...(port.uploadMaterial === undefined
      ? {}
      : {
          uploadMaterial: async (input: {
            readonly file: File;
            readonly documentType: string;
          }): Promise<MaterialUploadOutcome> => {
            const upload = port.uploadMaterial;
            if (upload === undefined) {
              return {
                ok: false,
                message: "Uploading isn't available here right now.",
              };
            }
            const view = await session();
            const companyId =
              view.session.subject?.type === "COMPANY"
                ? view.session.subject.id
                : undefined;
            if (companyId === undefined) {
              // A document belongs to a company. Until the journey has
              // established one there is nothing to attach it to, and
              // saying so beats inventing an owner.
              return {
                ok: false,
                message:
                  "Add your company name first, then Q can read your documents.",
              };
            }
            return upload({ companyId, ...input });
          },
        }),

    ...(port.resolveSuggestion === undefined
      ? {}
      : {
          resolveSuggestion: (input: {
            readonly suggestionId: string;
            readonly resolution: "ACCEPT" | "EDIT" | "REJECT";
            readonly response?: OnboardingResponseValue | undefined;
          }) =>
            guarded(async () => {
              const resolve = port.resolveSuggestion;
              if (resolve === undefined) {
                throw new OnboardingClientError(
                  "UNAVAILABLE",
                  "Capital Q can't record that decision yet. Use the form for this step.",
                );
              }
              const view = await session();
              // The API validates an accepted or corrected proposal against
              // the pinned step exactly as it validates a typed answer, and
              // returns the session the decision produced.
              return present(
                remember(
                  await resolve({
                    sessionId: view.session.id,
                    suggestionId: input.suggestionId,
                    resolution: input.resolution,
                    ...(input.response === undefined
                      ? {}
                      : { response: input.response }),
                    expectedSessionVersion: view.session.version,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                ),
              );
            }),
        }),

    ...(port.answerQuestion === undefined
      ? {}
      : {
          answerQuestion: (input: {
            readonly questionId: string;
            readonly stepKey: string;
            readonly value: OnboardingResponseValue;
          }) =>
            guarded(async () => {
              const answer = port.answerQuestion;
              if (answer === undefined) {
                throw new OnboardingClientError(
                  "UNAVAILABLE",
                  "Capital Q can't record that answer yet. Use the form for this step.",
                );
              }
              return present(
                remember(
                  await rebased((view) =>
                    answer({
                      sessionId: view.session.id,
                      questionId: input.questionId,
                      stepKey: input.stepKey,
                      value: input.value,
                      expectedSessionVersion: view.session.version,
                      idempotencyKey: crypto.randomUUID(),
                    }),
                  ),
                ),
              );
            }),
        }),

    reload: () =>
      unqueued(async () => {
        latest = null;
        return present(await session());
      }),

    // A tapped option is the same submission the form makes for that step:
    // one validated response, the version the session is at, no text
    // round trip through interpretation.
    submitValue: (input: {
      readonly stepKey: string;
      readonly value: OnboardingResponseValue;
      readonly adds?: { readonly max: number } | undefined;
    }) =>
      guarded(async () =>
        present(
          remember(
            await rebased((view) =>
              port.submit({
                sessionId: view.session.id,
                stepKey: input.stepKey,
                // An addition is merged with what the step holds on the
                // version it lands on, never with the browser's cached list.
                value:
                  input.adds === undefined
                    ? input.value
                    : mergedOnto(
                        view,
                        input.stepKey,
                        input.value,
                        input.adds.max,
                      ),
                expectedSessionVersion: view.session.version,
                idempotencyKey: crypto.randomUUID(),
                // A tapped option in the conversation with Q.
                channel: "CONVERSATION",
              }),
            ),
          ),
        ),
      ),

    ...(port.say === undefined
      ? {}
      : {
          say: (input: {
            readonly text: string;
            readonly recentTurns: readonly {
              readonly role: "person" | "q";
              readonly text: string;
            }[];
            readonly focus?: string | undefined;
            readonly confirmReview?: string | undefined;
            readonly onSentence?: ((text: string) => void) | undefined;
            readonly onStage?:
              | ((stage: {
                  readonly stage: string;
                  readonly label: string;
                }) => void)
              | undefined;
          }) =>
            guarded(async () => {
              const say = port.say;
              if (say === undefined) {
                throw new OnboardingClientError(
                  "UNAVAILABLE",
                  "Capital Q can't take that yet. Use the form for this step.",
                );
              }
              const view = await session();
              const outcome = await say({
                sessionId: view.session.id,
                text: input.text,
                expectedSessionVersion: view.session.version,
                idempotencyKey: crypto.randomUUID(),
                recentTurns: input.recentTurns,
                ...(input.focus === undefined ? {} : { focus: input.focus }),
                ...(input.confirmReview === undefined
                  ? {}
                  : { confirmReview: input.confirmReview }),
                ...(input.onSentence === undefined
                  ? {}
                  : { onSentence: input.onSentence }),
                ...(input.onStage === undefined
                  ? {}
                  : { onStage: input.onStage }),
              });
              return {
                view: await present(remember(outcome.view)),
                understood: outcome.understood,
                reply: outcome.reply,
                navigate: outcome.navigate,
                researching: outcome.researching,
                askingAbout: outcome.askingAbout,
                askedStep: outcome.view.askedStep,
                conduct: outcome.conduct,
                gestures: outcome.gestures,
              };
            }),
        }),

    ...(port.dismissQuestion === undefined
      ? {}
      : {
          dismissQuestion: (input: { readonly questionId: string }) =>
            guarded(async () => {
              const dismiss = port.dismissQuestion;
              if (dismiss === undefined) {
                throw new OnboardingClientError(
                  "UNAVAILABLE",
                  "Capital Q can't record that yet. Use the form for this step.",
                );
              }
              const view = await session();
              return present(
                remember(
                  await dismiss({
                    sessionId: view.session.id,
                    questionId: input.questionId,
                    expectedSessionVersion: view.session.version,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                ),
              );
            }),
        }),

    saveResponse: ({ stepId, response }) =>
      guarded(async () => {
        const group = requireGroup(stepId);
        let view = await session();
        let plan: readonly Submission[];
        try {
          plan = model.planSubmissions(group, response, view);
        } catch (error) {
          throw new OnboardingClientError(
            "REJECTED",
            error instanceof SubmissionPlanError
              ? error.message
              : "That answer couldn't be saved.",
          );
        }
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
                channel: "FORM",
              }),
            );
          } else if (status !== "SKIPPED" && status !== "COMPLETED") {
            // An answer on record is not set aside by a blank or "not
            // sure": the runtime refuses that skip (STEP_NOT_ELIGIBLE,
            // sweep D3 "That step isn't open yet"), and the answer stays.
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

    skipStep: ({ stepId, stepKey: shown }) =>
      guarded(async () => {
        if (shown !== undefined) {
          // The one question on screen, wherever the pointer is: skipping
          // the pointer's screen instead set aside the wrong step, and a
          // required one (the review) was refused every time.
          const view = await session();
          const status = eligibleStatus(view, shown);
          if (status === "SKIPPED" || status === "COMPLETED") {
            return present(view);
          }
          if (status === undefined) {
            throw new OnboardingClientError(
              "REJECTED",
              "That question isn't open any more.",
            );
          }
          const skipped = remember(
            await port.skip({
              sessionId: view.session.id,
              stepKey: shown,
              expectedSessionVersion: view.session.version,
              idempotencyKey: crypto.randomUUID(),
            }),
          );
          const owner = model.groups.find((g) => g.stepKeys.includes(shown));
          return present(
            owner === undefined ? skipped : await advance(skipped, owner),
          );
        }
        const group = requireGroup(stepId);
        let view = await session();
        for (const stepKey of group.stepKeys) {
          const status = eligibleStatus(view, stepKey);
          // Answered steps keep their answer; the runtime refuses to skip
          // them, which failed the whole screen.
          if (
            status === undefined ||
            status === "SKIPPED" ||
            status === "COMPLETED"
          ) {
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
