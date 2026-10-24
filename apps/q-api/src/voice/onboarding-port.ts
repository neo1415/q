import { randomUUID } from "node:crypto";

import {
  completeOnboardingSession,
  findTaxonomyCandidates,
  skipOnboardingStep,
  getOnboardingSession,
  getTaxonomyNode,
  resolveOnboardingSuggestion,
  submitOnboardingResponse,
  submitOnboardingResponses,
  withdrawOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import {
  OnboardingResponseValueSchema,
  type OnboardingResponseValue,
  type OnboardingSessionView,
  type TaxonomyCandidateResponse,
} from "@capital-q/contracts";
import {
  FOUNDER_COVERAGE_PROFILE,
  FOUNDER_UTTERANCE_ALIASES,
} from "@capital-q/founder-onboarding";
import {
  INVESTOR_CONCEPT_FAMILIES,
  INVESTOR_COVERAGE_PROFILE,
  INVESTOR_UTTERANCE_ALIASES,
  investorPlausibility,
} from "@capital-q/investor-onboarding";
import {
  deriveOnboardingCoverage,
  isTransientOnboardingFailure,
  waitsForContext,
  clausesOf,
  negatedMention,
  pendingReplayKey,
  type DrainResult,
  type PendingWrite,
  type OnboardingCoverageProfile,
  type OnboardingKnownFact,
  type OnboardingQRecommendations,
  type OnboardingStepManifest,
  type QRecommendationPublicSourceType,
} from "@capital-q/onboarding";
import { quoteOccursIn } from "@capital-q/q-knowledge";
import { turnIsEnglish } from "./reply-language.js";

import {
  figureCountIn,
  figureStatedIn,
  scaleDroppedIn,
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
  asciiDigits,
  definitionFor,
  describeValue,
  optionsOf,
  readRefusal,
  recordedCurrency,
  SCALE_WORDS,
  spokenFiguresIn,
  toOpenStep,
  toResponseValue,
  MONEY_STEP,
} from "./interview-steps.js";
import { SPOKEN_QUESTIONS } from "./step-copy.js";
import {
  heardBack,
  isParaphraseRationale,
  paraphraseRationale,
  readBackReplyOf,
} from "./paraphrase-confirmation.js";

/**
 * QA F-52: what Q is told about an answer held until the firm or company
 * exists ("firm context isn't active yet" was said to a new investor).
 */
const HELD_FOR_FIRM_REASON =
  "Kept, and saved automatically as soon as their firm or company is set up (for an investor: the firm's name and how they invest; for a founder: the company's name). Nothing is lost and it need not be asked again. Say it is kept, never mention 'context' or a record not being active, and ask for whichever of those is still missing.";

/**
 * What the loop is told when it tries to fill an upload step with words.
 * It answers the loop's real question (what now?) so it stops retrying:
 * nothing is wrong, nothing more is needed this turn.
 */
export const UPLOAD_ONLY_REASON =
  "Nothing to record here, and nothing went wrong: this step is filled only by an upload. What they said they have is noted for this conversation. Do not record this step again; say once that they can add it with the upload button whenever they like (for a founder with no deck, offer to make one), then move on.";

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
/** The durable hold for confirmed changes a temporary failure kept from saving. */
export type HeldOnboardingWrites = {
  readonly hold: (
    stepKey: string,
    response: {
      readonly value: OnboardingResponseValue;
      readonly note?: string;
    },
  ) => Promise<void>;
  /** Step keys with a held change, not yet saved. */
  readonly pendingSteps: () => Promise<ReadonlySet<string>>;
  readonly drain?:
    | ((ports: {
        readonly currentValue: (stepKey: string) => Promise<unknown>;
        readonly answeredAt?: (stepKey: string) => Promise<Date | null>;
        readonly submit: (write: PendingWrite) => Promise<void>;
      }) => Promise<DrainResult>)
    | undefined;
};

export function coverageProfileFor(
  journeyType: "investor" | "founder",
): OnboardingCoverageProfile {
  return journeyType === "founder"
    ? FOUNDER_COVERAGE_PROFILE
    : INVESTOR_COVERAGE_PROFILE;
}

export type RecommendationStore = Pick<
  OnboardingQRecommendations,
  "recommend" | "pending"
>;

/**
 * What Q read in a public source, offered as a recommendation (BIZ-009).
 * Code composes these from a validated research reading; no model calls
 * this, and nothing here is ever an answer.
 */
export type FoundRecommendation = {
  readonly stepKey: string;
  readonly value: string | readonly string[] | number;
  /** Said to the person with it: where it was found, in a few words. */
  readonly because: string;
  readonly sources: readonly {
    readonly sourceType: QRecommendationPublicSourceType;
    readonly url: string;
  }[];
};

export type FoundRecommendationOutcome =
  /** Held for the person's decision, nothing on the record for the step. */
  | "RECOMMENDED"
  /** Held beside a different answer they gave: both stand until they decide. */
  | "DIFFERS_FROM_ANSWER"
  /** What they already said: nothing to offer. */
  | "SAME_AS_ANSWER"
  /** A recommendation is already waiting on that step. */
  | "ALREADY_PENDING"
  /** They set the step aside; Q does not bring it back unasked. */
  | "SET_ASIDE"
  /** The reading names none of the step's choices: left unknown. */
  | "UNRESOLVED"
  | "REJECTED";

export type FoundRecommendationPort = {
  readonly recommendFound: (items: readonly FoundRecommendation[]) => Promise<
    readonly {
      readonly stepKey: string;
      readonly outcome: FoundRecommendationOutcome;
    }[]
  >;
  /** The session as it stands, for which findings are ready to offer. */
  readonly answeredSteps: () => Promise<ReadonlySet<string>>;
};

/** One value, whatever order a list was given in. */
function sameValue(
  a: OnboardingResponseValue,
  b: OnboardingResponseValue,
): boolean {
  const norm = (value: OnboardingResponseValue): string => {
    if (value.type === "MULTI_SELECT") {
      return JSON.stringify({
        ...value,
        optionKeys: [...value.optionKeys].sort(),
      });
    }
    if (value.type === "RESOURCE_REFERENCE") {
      return JSON.stringify({
        ...value,
        resourceIds: [...value.resourceIds].sort(),
      });
    }
    if (value.type === "RANGE") {
      return JSON.stringify({ type: "RANGE", value: Number(value.value) });
    }
    if (value.type === "TEXT") {
      return JSON.stringify({
        type: "TEXT",
        text: value.text.trim().toLowerCase().replace(/\s+/g, " "),
      });
    }
    return JSON.stringify(value);
  };
  return norm(a) === norm(b);
}

export type BoundOnboardingPort = OnboardingToolPort &
  FoundRecommendationPort & {
    /** The latest view this port saw, for the caller's outcome. */
    readonly view: () => OnboardingSessionView | null;
    /** Steps this port wrote, in order. */
    readonly recorded: () => readonly string[];
    /**
     * What the person typed at sign-up, recorded as their answer (the
     * company or firm name): their own words, from their own form.
     * Nothing when that step already has an answer.
     */
    readonly recordFromSignup: (
      stepKey: string,
      text: string,
    ) => Promise<boolean>;
    /**
     * An answer the platform already holds as canonical data (the journey
     * the person chose answers F0.intent; onboarding-conductor names
     * which). Recorded through the ordinary validated submit under the
     * person's own token; nothing when the step already has an answer.
     */
    readonly recordKnown: (stepKey: string, raw: string) => Promise<boolean>;
    /**
     * The currency they named beside a figure ("500 thousand dollars"),
     * recorded by code when the currency question is open and their words
     * name exactly one currency (owner 2026-10-16: never ask for a currency
     * already stated). Null when nothing was recorded.
     */
    /**
     * A step their latest words state that is not on their path (revenue
     * for a pre-seed company): its part of their words kept with their
     * notes, never lost (live AI 2026-10-16: "first revenue only, from two
     * co-ops" was stated and nothing kept it). Null when no clause of their
     * words carries the step's own words.
     */
    readonly keepStated: (
      stepKey: string,
      said: string,
    ) => Promise<OnboardingRecordResult | null>;
    readonly recordStatedCurrency: (options?: {
      /** Only their earlier words: the latest are the acting model's first. */
      readonly earlierOnly?: boolean;
    }) => Promise<{
      readonly stepKey: string;
      readonly optionKey: string;
      readonly quote: string;
    } | null>;
    /**
     * Replays held changes (lane ob1) through the ordinary submit, before
     * the turn reads its state. Null when nothing can be held here.
     */
    readonly replayHeld: () => Promise<DrainResult | null>;
    /** Q's recommendations still waiting on the person, as Q would say them. */
    readonly pendingRecommendations: () => Promise<
      readonly {
        readonly stepKey: string;
        readonly value: string;
        readonly rationale: string | null;
      }[]
    >;
    /**
     * Q's held summaries the person just agreed to: pending since before
     * this turn, said back in Q's last turn, and affirmed by their latest
     * words. Code accepts these without waiting on a model.
     */
    readonly affirmedParaphrases: () => Promise<ReadonlySet<string>>;
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
  /**
   * Steps whose pending recommendation was held between turns (research
   * found it) and has not been said yet: not heard, so not approvable.
   */
  readonly unheardSteps?: ReadonlySet<string> | undefined;
  /**
   * Whether an earlier utterance of theirs in this conversation, read
   * independently when it was said, stated this step, and the quote is
   * from it (live 2026-09-30: a founder's opening monologue stated six
   * answers that could not be saved yet, and later turns refused them
   * because only the latest words counted).
   */
  readonly statedEarlier?:
    ((stepKey: string, quote: string) => boolean) | undefined;
  /**
   * Held changes (lane ob1): where a confirmed write fails because the
   * onboarding service is temporarily down, it is held durably here and
   * retried, never dropped and never claimed as saved. Absent: such a
   * failure is reported as not accepted, as before.
   */
  readonly held?: HeldOnboardingWrites | undefined;
  /** Facts the platform holds already (registration): never asked again. */
  readonly knownFacts?: readonly OnboardingKnownFact[] | undefined;
}): BoundOnboardingPort {
  const steps = new Map(
    definitionFor(input.journeyType).steps.map(
      (step) => [step.stepKey, step] as const,
    ),
  );
  let latest: OnboardingSessionView | null = null;
  /**
   * Whether `latest` is the view this port's own write just committed, so
   * a state read right after it needs no second round trip (owner
   * 2026-10-16). Any other mutation, or one that failed or timed out,
   * leaves it false: the next read goes back to the service.
   */
  let trusted = false;
  /**
   * When `latest` is a plain read with no write of this port's since: a
   * state read within READ_REUSE_MS uses it rather than reading the same
   * view again (onboarding speed 2026-10-20: every turn read the session
   * twice, a few hundred milliseconds apart, before the first round).
   */
  let readAt: number | null = null;
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
  const heard = pendingNow()
    .then((list) =>
      list.filter((r) => input.unheardSteps?.has(r.stepKey) !== true),
    )
    .catch(() => []);
  /** The person's own words carry this write, or it does not happen. */
  const said = (quote: string): boolean =>
    input.personTurns.some(
      (turn) => quoteOccursIn(quote, turn) || shortWordIn(quote, turn),
    );
  const unsaid = (stepKey: string): OnboardingRecordResult => ({
    stepKey: stepKey.slice(0, 80),
    outcome: "REJECTED",
    reason: UNSAID_REASON,
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
            channel: "CONVERSATION",
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
    const view = await getOnboardingSession(
      input.session,
      input.onboardingSessionId,
    );
    const settled = await settle(view);
    latest = settled;
    // A view the preselection just wrote is not a plain read.
    readAt = settled === view ? Date.now() : null;
    return latest;
  };
  const current = async (): Promise<OnboardingSessionView> =>
    latest ?? (await fresh());

  /** Category names the classifier gave this turn, by node id. */
  const nodeNames = new Map<string, string>();
  const spoken = async (
    step: OnboardingStepManifest,
    value: OnboardingResponseValue,
    view: OnboardingSessionView,
  ): Promise<string> => {
    if (
      value.type === "RESOURCE_REFERENCE" &&
      value.resourceType === "TAXONOMY_NODE"
    ) {
      // Names the classifier already gave this turn, then the rest read
      // together (live AO: eight node reads one after another, ~0.4 s).
      const names = await Promise.all(
        value.resourceIds.slice(0, 8).map(async (id) => {
          const known = nodeNames.get(id);
          if (known !== undefined) return known;
          try {
            // Kept for the rest of the turn: the state is read several
            // times a turn, and each read named every node again.
            const name = (await getTaxonomyNode(input.session, id)).displayName;
            nodeNames.set(id, name);
            return name;
          } catch {
            // A name that cannot be read is left out, never guessed.
            return null;
          }
        }),
      );
      return names.filter((name): name is string => name !== null).join(", ");
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
    // Three independent reads, together rather than one after another
    // (onboarding speed 2026-10-20): this runs several times a turn.
    const [view, pendingList, heldSteps] = await Promise.all([
      latest !== null &&
      (trusted || (readAt !== null && Date.now() - readAt < READ_REUSE_MS))
        ? latest
        : fresh(),
      pendingNow().catch(() => []),
      input.held === undefined
        ? new Set<string>()
        : input.held.pendingSteps().catch(() => new Set<string>()),
    ]);
    // The canonical coverage picture (lane ob1): the same projection the
    // form reads, so Q never re-asks what is known, saved or held.
    const coverage = deriveOnboardingCoverage({
      profile: coverageProfileFor(input.journeyType),
      definition: definitionFor(input.journeyType),
      view,
      known: input.knownFacts,
      checks: openChecks(view).map((check) => ({
        stepKeys: [...check.stepKeys],
        fact: check.fact,
      })),
      pendingSaves: [...heldSteps],
      now: new Date(),
    });
    const coverageOf = new Map(coverage.fields.map((f) => [f.fieldKey, f]));
    // Every row at once (onboarding speed 2026-10-20): a row naming
    // categories reads their names, and the rows used to wait on each other.
    const built = await Promise.all(
      view.progress.eligibleSteps.map(
        async (eligible): Promise<OnboardingStepState | null> => {
          const step = steps.get(eligible.stepKey);
          if (step === undefined) return null;
          // A reference to a platform record (the mandate being defined) is
          // the journey's to settle, never something to discuss with the
          // person, resolved or not (live 2026-10-16: "your main investment
          // strategy, or a different one?" asked, and unrecordable).
          if (isPlatformReference(step)) {
            return null;
          }
          const open = toOpenStep(step, view);
          const stored = view.responses.find((r) => r.stepKey === step.stepKey);
          const kind =
            open === null
              ? "TEXT"
              : open.kind === "SHORT_TEXT" || open.kind === "LONG_TEXT"
                ? "TEXT"
                : open.kind;
          return {
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
                : // Their own words where the options could not hold them.
                  (stored.value.type === "SINGLE_SELECT" &&
                  stored.value.optionKey === "other" &&
                  stored.note !== null &&
                  stored.note.length > 0
                    ? `${stored.note} (in their words)`
                    : await spoken(step, stored.value, view)
                  ).slice(0, 600) || null,
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
            ...(() => {
              const field = coverageOf.get(step.stepKey);
              if (field === undefined) return {};
              const offer = field.proposals.find(
                (p) =>
                  p.source === "DOCUMENT" || p.source === "PUBLIC_RESEARCH",
              );
              return {
                coverage: field.state,
                priority: field.priority,
                ...(field.savePending ? { savePending: true } : {}),
                ...(offer === undefined
                  ? {}
                  : {
                      offered: `${offer.display} (${
                        offer.source === "DOCUMENT"
                          ? "from their document"
                          : "from a public page, not verified"
                      })`.slice(0, 600),
                    }),
              };
            })(),
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
          };
        },
      ),
    );
    const rows = built.filter(
      (row): row is OnboardingStepState => row !== null,
    );
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
      next: (() => {
        // A proposal waiting on a question not yet answered (a deck's "4
        // pilots" while "what early signal do you have?" is open, live
        // 2026-10-16): that question comes first, so their answer lets the
        // proposal be put to them and confirmed.
        const eligibleKeys = new Set(
          view.progress.eligibleSteps.map((e) => e.stepKey),
        );
        const answeredKeys = new Set(view.responses.map((r) => r.stepKey));
        const unlocking = proposalPrerequisites({
          pending: pendingList.map((r) => r.stepKey),
          eligible: eligibleKeys,
          answered: answeredKeys,
          stepOf: (key) => steps.get(key),
        }).filter((key) => {
          const step = steps.get(key);
          return step !== undefined && !isPlatformReference(step);
        });
        return [
          // Asked as the question it is, not as a value on offer.
          ...unlocking.map((stepKey) => ({
            stepKey,
            reason:
              steps.get(stepKey)?.required === true
                ? ("ESSENTIAL_MISSING" as const)
                : ("IMPORTANT_MISSING" as const),
          })),
          ...coverage.next
            .filter((n) => !unlocking.includes(n.fieldKey))
            .map((n) => ({ stepKey: n.fieldKey, reason: n.reason })),
        ].slice(0, 12);
      })(),
      minutesLeft: coverage.summary.minutesLeft,
    };
  };

  /**
   * The session moved under this turn (a document reading or the form
   * added a proposal, which bumps its version): the write is made again
   * against the fresh version at once, never held as a "temporary fault"
   * (live 2026-10-16: "monthly revenue 180k AED" held three times).
   */
  const onFreshVersion = async <T>(
    attempt: (version: number) => Promise<T>,
  ): Promise<T> => {
    const view = await current();
    try {
      return await attempt(view.session.version);
    } catch (error: unknown) {
      const failed = error as {
        readonly status?: unknown;
        readonly code?: unknown;
      };
      if (failed.status !== 409 || failed.code !== "VERSION_CONFLICT") {
        throw error;
      }
      const again = await fresh();
      return attempt(again.session.version);
    }
  };

  const submit = async (
    stepKey: string,
    value: OnboardingResponseValue,
    note?: string,
  ): Promise<void> => {
    trusted = false;
    readAt = null;
    latest = await settle(
      await onFreshVersion((version) =>
        submitOnboardingResponse(
          input.session,
          input.onboardingSessionId,
          {
            stepKey,
            response: {
              value,
              ...(note === undefined ? {} : { note }),
              // Given in the conversation with Q, not the form (lane ob1).
              channel: "CONVERSATION",
            },
            expectedSessionVersion: version,
          },
          randomUUID(),
        ),
      ),
    );
    trusted = true;
  };

  /** A step that points at a platform record (a mandate), not a vocabulary. */
  const isPlatformReference = (step: OnboardingStepManifest): boolean =>
    step.configuration.stepType === "reference_select" &&
    step.configuration.resourceType !== "TAXONOMY_NODE";

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
        /** Their own words where the options could not hold them. */
        readonly note?: string | undefined;
      }
    | { readonly ok: false; readonly result: OnboardingRecordResult };

  /**
   * The part of their words about one field: the clauses of the quote that
   * carry the field's words, or of the turn of theirs the quote came from
   * when the quote was cut short before them; else the quote's best part.
   */
  const fieldWordsOf = (quote: string, reading: string): string => {
    // A long quote is read in its whole turn: its clauses, not a cut one.
    const inTurn =
      quote.trim().length <= 80
        ? undefined
        : input.personTurns
            .filter((said) => quoteOccursIn(quote, said))
            .map((said) => fieldClausesOf(said, reading))
            .find((part) => part !== null);
    return (
      inTurn ?? fieldClausesOf(quote, reading) ?? fieldPartOf(quote, reading)
    );
  };

  /** What the words resolve to for this step, validated; nothing written. */
  const resolve = async (answer: {
    readonly stepKey: string;
    readonly value: string | readonly string[] | number | boolean;
    readonly ownWords?: boolean | undefined;
    /** Their own words for it, kept when no option or number holds them. */
    readonly quote?: string | undefined;
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
    let otherWords: string | undefined;
    // Their own words where they hold the answer; the model's reading of
    // them otherwise. Bounded as the runtime keeps them.
    const ownWordsFor = (reading: string): string => {
      const quote = answer.quote?.trim() ?? "";
      // Only this field's part of their words (live AG 2026-10-16: a quote
      // of the whole opening statement became the excluded sectors).
      return (
        quote.length > 0 ? fieldWordsOf(quote, reading) : reading.trim()
      ).slice(0, 500);
    };
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
          // Their own words, kept beside the categories that did match,
          // when Q marks them so (live 2026-09-30: "AI infrastructure"
          // came back as ambiguous three times running).
          // More than one category could be meant: their words are kept
          // as they said them, never dropped and never forced into one
          // (owner 2026-10-16).
          unmatched.push(phrase);
          continue;
        }
        if (!ids.includes(best.nodeId)) ids.push(best.nodeId);
        nodeNames.set(best.nodeId, best.displayName);
      }
      if (unmatched.length > 0 && ids.length > 0) {
        // The categories that matched, with their other words beside them:
        // the model's phrase where it is theirs, else the part of their
        // quote it stands for; a phrase in neither is left out and the
        // categories still save (live AO 2026-10-17: "port technology"
        // for "anything that makes ports less painful" lost all sectors).
        const quote = answer.quote ?? "";
        const kept = unmatched
          .map((phrase) =>
            textStatedIn(phrase, quote)
              ? phrase
              : quote.trim().length > 0
                ? fieldClausesOf(quote, phrase)
                : null,
          )
          .filter((words): words is string => words !== null);
        otherWords =
          kept.length === 0
            ? undefined
            : [...new Set(kept)].join("; ").slice(0, 200);
      } else if (unmatched.length > 0) {
        // No category holds their words: kept as they said them, like
        // ticking "Other" and typing (owner 2026-10-16).
        return {
          ok: true,
          step,
          value: { type: "TEXT", text: ownWordsFor(unmatched.join(", ")) },
        };
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
        const exact = options.find(
          (o) =>
            o.key.toLowerCase() === wanted || o.label.toLowerCase() === wanted,
        )?.key;
        if (exact !== undefined) return exact;
        // The model's short name for one option ("deck" for "Pitch deck",
        // live 2026-09-30): the one option whose label holds all its
        // words. Only when exactly one does; this reads the model's value
        // against the journey's own labels, never the person's words.
        // Singular and plural are the same word ("US dollars" names "US
        // dollar"; live 2026-10-16).
        const words = (s: string) =>
          s
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length > 0)
            .map((w) => (w.length > 3 ? w.replace(/(?:es|s)$/u, "") : w));
        const value = words(wanted);
        if (value.length === 0) return undefined;
        const holding = options.filter((o) => {
          const label = new Set(words(o.label));
          return value.every((w) => label.has(w));
        });
        return holding.length === 1 ? holding[0]?.key : undefined;
      };
      const phrases =
        typeof answer.value === "object"
          ? answer.value
          : [String(answer.value)];
      const keys: string[] = [];
      const unnamed: string[] = [];
      for (const phrase of phrases) {
        const key = named(phrase);
        if (key !== undefined) keys.push(key);
        else if (phrase.trim().length > 0) unnamed.push(phrase.trim());
      }
      // Founder direction 2026-09-30: an answer outside the options is
      // kept in their words ("Uzbekistan", "Founder"), on the step's own
      // catch-all, never lost or forced into a near option. Only where the
      // step has one; the words are checked as theirs before writing.
      const catchAll = options.find((o) => o.key === "other")?.key;
      if (unnamed.length > 0 && catchAll !== undefined) {
        keys.push(catchAll);
        otherWords = unnamed.join(", ").slice(0, 200);
      } else if (
        unnamed.length > 0 &&
        keys.length > 0 &&
        c.stepType === "multi_select"
      ) {
        // The options they named, with their other words beside them.
        otherWords = unnamed.join(", ").slice(0, 200);
      } else if (unnamed.length > 0 && keys.length === 0) {
        // None of the options: their words are the answer ("Other: ...").
        return {
          ok: true,
          step,
          value: { type: "TEXT", text: ownWordsFor(unnamed.join(", ")) },
        };
      }
      // "Other" with nothing beside it would lose what they said (live
      // 2026-10-16: "Based in Uganda" saved as a bare "Somewhere else").
      if (
        catchAll !== undefined &&
        keys.includes(catchAll) &&
        otherWords === undefined
      ) {
        otherWords = ownWordsFor(phrases.join(", ")).slice(0, 200);
      }
      const [only] = keys;
      value =
        only === undefined
          ? null
          : c.stepType === "single_select"
            ? keys.length === 1
              ? toResponseValue(step, only)
              : null
            : toResponseValue(step, [...new Set(keys)]);
    } else {
      const raw =
        typeof answer.value === "number" ? String(answer.value) : answer.value;
      value = toResponseValue(step, raw);
      // A number question answered in words no figure can be read from
      // ("a dozen or so", "about half the team"): kept as they said it,
      // unless the figure is impossible, which is asked about instead.
      if (value === null && c.stepType === "range" && !impossibleFigure(raw)) {
        return {
          ok: true,
          step,
          value: { type: "TEXT", text: ownWordsFor(String(raw)) },
        };
      }
    }
    if (
      value === null &&
      (c.stepType === "single_select" || c.stepType === "multi_select")
    ) {
      // More than one option named for a one-choice question: their words,
      // as said, rather than a guess between them.
      const said =
        typeof answer.value === "object"
          ? answer.value.join(", ")
          : String(answer.value);
      return {
        ok: true,
        step,
        value: { type: "TEXT", text: ownWordsFor(said) },
      };
    }
    if (value === null) {
      const options = optionsOf(step);
      return refuse(
        options.length > 0
          ? {
              stepKey: step.stepKey,
              outcome: "UNMATCHED",
              reason: options.some((o) => o.key === "other")
                ? "That names none of this step's options. Choose the option below that means what they said and record it by its key. If none fits and their words are a real answer, record their own words with ownWords true; they are kept as they said them. If their words are unclear, ask them."
                : // No catch-all to keep their words in (live 2026-10-01:
                  // "a few paying customers" asked for six turns running).
                  "That names none of this step's options, and this step cannot keep other words. If one option plainly means what they said, record it by its key. Otherwise say so once in a few words, recommend the closest option with recommend and ask if it will do; never put the same choice to them again after that.",
              candidates: options
                .slice(0, 40)
                .map((o) => `${o.label} (${o.key})`.slice(0, 160)),
            }
          : {
              stepKey: step.stepKey,
              outcome: "REJECTED",
              // Never answered by asking the person for set words (live
              // 2026-09-30: "Please say explicitly: 'Yes, save it.'").
              reason:
                step.configuration.stepType === "confirmation"
                  ? "A confirmation is recorded as true or false, never as their sentence. If their words confirm it, record it again now with true; do not ask them to repeat themselves in particular words."
                  : step.configuration.stepType === "document_upload"
                    ? // Words never fill an upload step (live 2026-10-01: "a
                      // deck and audited financials" was retried on eight
                      // turns, one model round each, refused every time).
                      UPLOAD_ONLY_REASON
                    : "That does not fit what this step records.",
            },
      );
    }
    return {
      ok: true,
      step,
      value,
      ...(otherWords === undefined ? {} : { note: otherWords }),
    };
  };

  const withdraw = async (stepKey: string): Promise<void> => {
    const view = await current();
    trusted = false;
    readAt = null;
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
          reason: (refusal.because?.includes("(STEP_NOT_ELIGIBLE)") === true
            ? // Live 2026-10-16: refused as not on their path, then narrated
              // as "I've matched your description to first revenue only".
              "That question is not on their path (it applies at another stage or after another answer), so nothing was recorded. Do not mention it or say you matched anything to it."
            : (refusal.because ?? "The onboarding service did not accept it.")
          ).slice(0, 400),
        };
  };

  /** Write a resolved value: one concept in one exclusion list, then submit. */
  /**
   * A fact for a question not on their path (revenue for a pre-seed
   * company): never refused, kept in their words with the journey's own
   * notes, under the question's label (owner 2026-10-16).
   */
  const OFF_PATH_NOTES =
    input.journeyType === "founder" ? "F7.follow_up" : "I11.additional_context";
  const keepOffPath = async (
    step: OnboardingStepManifest,
    words: string,
  ): Promise<OnboardingRecordResult | null> => {
    const notes = steps.get(OFF_PATH_NOTES);
    if (notes === undefined || step.stepKey === OFF_PATH_NOTES) return null;
    const label =
      coverageProfileFor(input.journeyType).fields[step.stepKey]?.label ??
      (SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt).replace(
        /\?$/u,
        "",
      );
    const line = `${label}: ${words.trim()}`.slice(0, 600);
    const view = await current();
    const before = view.responses.find((r) => r.stepKey === OFF_PATH_NOTES);
    const existing =
      before?.value.type === "TEXT" ? before.value.text.trim() : "";
    if (existing.includes(line)) {
      written.push(step.stepKey);
      return {
        stepKey: step.stepKey,
        outcome: "COMMITTED",
        recorded: `${line} (kept with their notes: already there)`.slice(
          0,
          600,
        ),
      };
    }
    const text = (existing.length > 0 ? `${existing}\n${line}` : line).slice(
      -2000,
    );
    try {
      await submit(OFF_PATH_NOTES, { type: "TEXT", text });
      // Reported against the question they answered, so it is seen as
      // done and never re-sent (live 2026-10-16: a fact kept under the
      // notes' key was retried for four rounds).
      written.push(OFF_PATH_NOTES, step.stepKey);
      return {
        stepKey: step.stepKey,
        outcome: "COMMITTED",
        question: (
          SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
        ).slice(0, 400),
        recorded:
          `${line} (kept with their notes: that question is not on their path)`.slice(
            0,
            600,
          ),
      };
    } catch {
      return null;
    }
  };
  const offPath = (error: unknown): boolean =>
    readRefusal(error).because?.includes("(STEP_NOT_ELIGIBLE)") === true;

  /**
   * QA QO-26: an answer for a step not on their path YET ("$1.5m on a
   * SAFE" before they said they are raising) is kept in their notes AND
   * held, so it lands in its own field the turn the step opens, and Q
   * neither loses it nor asks for it again. Quietly: the notes are what
   * Q says; a step that never opens stops being tried.
   */
  const holdUntilOpen = async (
    stepKey: string,
    value: OnboardingResponseValue,
    note: string | undefined,
  ): Promise<void> => {
    await input.held
      ?.hold(stepKey, { value, ...(note === undefined ? {} : { note }) })
      .catch(() => undefined);
  };

  const write = async (
    step: OnboardingStepManifest,
    resolvedValue: OnboardingResponseValue,
    note?: string,
    words?: string,
  ): Promise<OnboardingRecordResult> => {
    const prepared = await prepareSiblings(step, resolvedValue);
    if (!prepared.ok) return prepared.result;
    const value = prepared.value;
    try {
      await submit(step.stepKey, value, note);
      written.push(step.stepKey);
      const after = await current();
      return {
        stepKey: step.stepKey,
        outcome: "COMMITTED",
        question: (
          SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
        ).slice(0, 400),
        recorded: (note === undefined
          ? await spoken(step, value, after)
          : `${note} (in their words)`
        ).slice(0, 600),
        ...(prepared.movedFrom === undefined
          ? {}
          : { movedFrom: prepared.movedFrom }),
      };
    } catch (error: unknown) {
      if (offPath(error)) {
        await holdUntilOpen(step.stepKey, value, note);
        const reading = await spoken(step, value, await current());
        const kept = await keepOffPath(
          step,
          words === undefined
            ? (note ?? reading)
            : fieldWordsOf(words, reading),
        );
        if (kept !== null) return kept;
      }
      if (input.held !== undefined && isTransientOnboardingFailure(error)) {
        try {
          await input.held.hold(step.stepKey, {
            value,
            ...(note === undefined ? {} : { note }),
          });
          return {
            stepKey: step.stepKey,
            outcome: "HELD_FOR_RETRY",
            question: (
              SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
            ).slice(0, 400),
            reason: waitsForContext(error)
              ? HELD_FOR_FIRM_REASON
              : "Not saved yet: the service is briefly unavailable. Their answer is held and will be saved automatically; nothing is lost. Tell them plainly it is not saved yet, do not ask it again, and carry on.",
          };
        } catch {
          // The hold itself failed: report the original failure honestly.
        }
      }
      return refused(step.stepKey, error);
    }
  };

  /**
   * Whether free text is theirs: in their words (the quote, or the turn of
   * theirs it is cut from), or read back to them in Q's last turn and
   * agreed to in their latest words ("Nixo, right?" "Yes."). A reply that
   * changes what was read back agrees to none of it.
   */
  const textInTheirWords = (text: string, quote: string): boolean => {
    const latest = input.personTurns[0];
    const readBack =
      input.lastQTurn !== undefined &&
      textStatedIn(text, input.lastQTurn) &&
      latest !== undefined &&
      quoteOccursIn(quote, latest) &&
      readBackReplyOf(latest) !== "CORRECT";
    return (
      readBack ||
      textStatedIn(text, quote) ||
      // Or the field's part of the same turn of theirs the quote is from
      // (a quote cut short before the words about this field).
      input.personTurns.some(
        (said) => quoteOccursIn(quote, said) && textStatedIn(text, said),
      )
    );
  };

  /** Whether every sentence of theirs that holds the quote only asks. */
  const askedOnly = (quote: string): boolean => {
    const words = quote.trim().toLowerCase().slice(0, 40);
    const holding = input.personTurns
      .filter((said) => quoteOccursIn(quote, said))
      .flatMap((said) => said.match(/[^.?!]+[.?!]*/gu) ?? [said])
      .filter((sentence) => sentence.toLowerCase().includes(words));
    return (
      holding.length > 0 &&
      holding.every((sentence) => ASKING.test(sentence.trim()))
    );
  };

  /**
   * A narrative answer (what the company does, the problem, the solution,
   * the business model, the opportunity, the vision) in Q's words rather
   * than theirs is held as Q's summary for their yes, never written and
   * never refused (owner live 2026-10-17): Q says it back in one line and
   * their agreement saves exactly that text through accept.
   */
  const holdParaphrase = async (
    step: OnboardingStepManifest,
    value: Extract<OnboardingResponseValue, { type: "TEXT" }>,
    quote: string,
  ): Promise<OnboardingRecordResult> => {
    const question = (
      SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
    ).slice(0, 400);
    if (askedOnly(quote)) {
      return {
        stepKey: step.stepKey,
        outcome: "REJECTED",
        question,
        reason:
          "Their words there only ask a question, so nothing was held or recorded. A question is never their answer; ask them if you want to know.",
      };
    }
    if (store !== undefined) {
      try {
        await store.recommend({
          userId,
          sessionId: input.onboardingSessionId,
          stepKey: step.stepKey,
          value,
          rationale: paraphraseRationale(quote),
          runId: input.runId ?? null,
        });
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "reason" in error &&
          error.reason === "SUGGESTION_REJECTED_BEFORE"
        ) {
          return {
            stepKey: step.stepKey,
            outcome: "REJECTED",
            question,
            reason:
              "They turned that exact summary down before. Offer a different one-line summary of what they said and ask if it is right.",
          };
        }
        // Not kept: their yes to the read-back still records it, as text
        // Q read back to them.
      }
    }
    return {
      stepKey: step.stepKey,
      outcome: "REJECTED",
      question,
      reason:
        'Held for their confirmation, not saved yet: this is your summary of what they said. Say it back now in one line, word for word ("So ... - shall I save that?"); their yes saves it. Never say you could not save it, never ask for their own or exact words.',
    };
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
    readerStated = false,
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
      // "400 mille euros" is 400,000: a figure recorded without the scale
      // its words carry is refused (live AJ 2026-10-16: saved as 400).
      if (scaleDroppedIn(value.value, answer.quote)) {
        return refuse(
          "Their figure carries a scale word (thousand, million, mille, mil…) that this value leaves out, so nothing was recorded. Record the full figure.",
        );
      }
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
      // No figure in their words at all ("it's just me" for the number
      // of founders): the independent reading found these words give
      // this answer, so the count is theirs. A figure their words do
      // contradict (stated === false) is still refused.
      // Only for a small count (founders, team size), never an amount of
      // money: an invented cheque size stays refused whatever the reading.
      const config = step.configuration;
      const smallCount =
        config.stepType === "range" &&
        Number.parseFloat(config.max) <= 100_000 &&
        !MONEY_STEP.test(step.stepKey) &&
        Number.isInteger(Number(value.value));
      if (stated === null && readerStated && smallCount) return null;
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
          : 'No figure could be read from their words here, so nothing was recorded. Say back the number you understood, in words ("four and a half million, right?"), and record it when they agree. Never ask them to repeat it in digits or in another form.',
      );
    }
    // An address said aloud is rewritten into its written form by the
    // step itself ("bridge dot com"), so it is not the words verbatim.
    // Text Q read back to them ("Nixo, right?") and they agreed to in
    // their latest words is theirs, as a read-back figure is.
    if (
      value.type === "TEXT" &&
      !step.stepKey.endsWith(".website") &&
      !textInTheirWords(value.text, answer.quote)
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
  /**
   * Whether the reading found this step stated, or another step of the
   * same concept (journey data): "never gambling, that's a hard no" read
   * as sector exclusions is also the hard-exclusions step whose option it
   * names (bench 2026-09-30).
   */
  const statedIn = (stated: ReadonlySet<string>, stepKey: string): boolean => {
    if (stated.has(stepKey)) return true;
    const families =
      input.journeyType === "investor" ? INVESTOR_CONCEPT_FAMILIES : [];
    return families.some(
      (family) =>
        family.stepKeys.includes(stepKey) &&
        family.stepKeys.some((other) => stated.has(other)),
    );
  };

  /**
   * Whether their latest words assert this quote: it is in what they just
   * said, in a sentence that is not a question, and not something they
   * said they are not ("we are not raising"). Code, not a reading.
   */
  const assertedNow = (quote: string): boolean => {
    const latest = input.personTurns[0];
    if (
      latest === undefined ||
      !(quoteOccursIn(quote, latest) || shortWordIn(quote, latest))
    ) {
      return false;
    }
    const sentences = latest.match(/[^.?!]+[.?!]*/gu) ?? [latest];
    const words = quote.trim().toLowerCase();
    const holding = sentences.filter((sentence) =>
      sentence.toLowerCase().includes(words.slice(0, 40)),
    );
    // A question, however it is punctuated ("what are angels backing these
    // days", "tell me about...", "هل ..."), asks; it states nothing.
    if (
      holding.length > 0 &&
      holding.every((sentence) => ASKING.test(sentence.trim()))
    ) {
      return false;
    }
    // What they said they are not ("not raising"), judged on the quote's
    // own opening clause: a later "no outside money" does not negate
    // "bootstrapped so far".
    const opening = clausesOf(quote)[0] ?? quote;
    return !negatedMention(latest, opening);
  };
  const notStated = async (
    stepKey: string,
    quote?: string,
  ): Promise<OnboardingRecordResult | null> => {
    if (input.authority === undefined) return null;
    const authority = await input.authority();
    if (authority !== null && statedIn(authority.stated, stepKey)) return null;
    if (quote !== undefined && input.statedEarlier?.(stepKey, quote) === true) {
      return null;
    }
    // Their own words, now, asserting it: saved whether or not the
    // reading noticed (owner 2026-10-16: "US dollars.", "Partner.",
    // "1200000" were refused because a model missed them).
    if (quote !== undefined && assertedNow(quote)) return null;
    return {
      stepKey: stepKey.slice(0, 80),
      outcome: "REJECTED",
      reason: authority === null ? UNCONFIRMED_REASON : NOT_STATED_REASON,
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

  /**
   * A confirmation step they agreed to, on their word as read
   * independently of the acting model (the reader's "stated" or
   * "finishing"). Live 2026-09-30, "Yes. Go ahead. That's exactly what it
   * is." for the capital objective was refused four times because only
   * confirm_and_finish could confirm anything, and it wanted the whole
   * setup finished. A mid-journey confirmation is its own answer; the
   * last one finishes the setup, as confirm_and_finish would.
   */
  const confirmStep = async (
    step: OnboardingStepManifest,
    value: string | readonly string[] | number | boolean,
  ): Promise<OnboardingRecordResult> => {
    const question = (
      SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
    ).slice(0, 400);
    if (value === false || value === "false") {
      return {
        stepKey: step.stepKey,
        outcome: "REJECTED",
        question,
        reason:
          "They did not confirm it. Ask what should change, correct it, then read it back.",
      };
    }
    if (input.authority !== undefined) {
      const authority = await input.authority();
      if (
        authority === null ||
        (!authority.finishing && !authority.stated.has(step.stepKey))
      ) {
        return {
          stepKey: step.stepKey,
          outcome: "REJECTED",
          question,
          reason:
            "Their latest words do not agree to this yet, so nothing was confirmed. Read it back in one sentence and ask if it is right.",
        };
      }
    }
    try {
      await submit(step.stepKey, { type: "CONFIRMATION", confirmed: true });
      written.push(step.stepKey);
      let view = await current();
      // Once every required answer is in, what remains are read-backs of
      // what they just agreed to: confirming one is finishing, so the rest
      // are confirmed in order and the setup completes, rather than the
      // same yes being asked for once per review step.
      const answersLeft = view.progress.eligibleSteps.some(
        (e) =>
          e.status !== "COMPLETED" &&
          e.required &&
          steps.get(e.stepKey)?.configuration.stepType !== "confirmation",
      );
      if (!answersLeft) {
        for (let guard = 0; guard < 4; guard += 1) {
          const open = view.progress.eligibleSteps.find(
            (e) =>
              e.status !== "COMPLETED" &&
              steps.get(e.stepKey)?.configuration.stepType === "confirmation",
          );
          if (open === undefined) break;
          await submit(open.stepKey, { type: "CONFIRMATION", confirmed: true });
          written.push(open.stepKey);
          view = await current();
        }
        if (view.progress.canComplete) {
          trusted = false;
          readAt = null;
          latest = await completeOnboardingSession(
            input.session,
            input.onboardingSessionId,
            { expectedSessionVersion: view.session.version },
          );
          view = latest;
        }
      }
      return {
        stepKey: step.stepKey,
        outcome: "COMMITTED",
        question,
        recorded:
          view.session.status === "COMPLETED"
            ? "Confirmed, and their setup is complete. Close warmly in a sentence or two and ask nothing more."
            : "Confirmed.",
      };
    } catch (error: unknown) {
      return refused(step.stepKey, error);
    }
  };

  type Answer = {
    readonly stepKey: string;
    readonly value: string | readonly string[] | number | boolean;
    readonly quote: string;
    readonly basis?: "STATED" | "DELEGATED" | undefined;
    readonly ownWords?: boolean | undefined;
  };
  /**
   * What one answer comes to before anything is written: a result already
   * decided (refused, held for their yes), a confirmation (which finishes,
   * so it is done on its own), or a write the checks allowed. Planning only
   * reads, so a batch plans every answer at once and writes them together.
   */
  type Planned =
    | { readonly kind: "DONE"; readonly result: OnboardingRecordResult }
    | {
        readonly kind: "CONFIRM";
        readonly step: OnboardingStepManifest;
        readonly value: Answer["value"];
      }
    | {
        readonly kind: "WRITE";
        readonly step: OnboardingStepManifest;
        readonly value: OnboardingResponseValue;
        readonly note?: string | undefined;
        readonly quote: string;
      };
  const done = (result: OnboardingRecordResult): Planned => ({
    kind: "DONE",
    result,
  });
  const recordOne = async (answer: Answer): Promise<OnboardingRecordResult> => {
    const plan = await planOne(answer);
    if (plan.kind === "DONE") return plan.result;
    if (plan.kind === "CONFIRM") return confirmStep(plan.step, plan.value);
    const result = await write(plan.step, plan.value, plan.note, plan.quote);
    if (result.outcome === "COMMITTED") {
      noteFigure(plan.step, plan.value, plan.quote);
    }
    return result;
  };
  /**
   * Each answer's resolution, started for a whole batch at once: the only
   * planning that waits on the network (vocabulary look-ups), so it runs
   * concurrently while the checks themselves stay in order.
   */
  const warmed = new Map<Answer, ReturnType<typeof resolve>>();
  const planOne = async (answer: Answer): Promise<Planned> => {
    if (!said(answer.quote)) return done(unsaid(answer.stepKey));
    // A delegation is an instruction given now, "in the same instruction"
    // (lead decision, 2026-09-25): an earlier question or remark is not
    // the person handing Q this choice.
    if (
      answer.basis === "DELEGATED" &&
      (input.personTurns[0] === undefined ||
        !quoteOccursIn(answer.quote, input.personTurns[0]))
    ) {
      return done({
        stepKey: answer.stepKey.slice(0, 80),
        outcome: "REJECTED",
        reason:
          "A choice is delegated only by what they say now, handing it to you; that quote is not from their latest words, so nothing was recorded.",
      });
    }
    // A narrative answer in Q's words: held for their yes, never refused
    // for not being their exact words (owner live 2026-10-17). Holding
    // writes nothing, so it does not wait on the self-statement gate: "go
    // ahead and paraphrase it" states nothing, and still gets the summary
    // of what they said before read back to them.
    const narrative = steps.get(answer.stepKey);
    if (
      answer.basis !== "DELEGATED" &&
      narrative !== undefined &&
      PARAPHRASABLE.has(narrative.configuration.stepType) &&
      typeof answer.value === "string" &&
      answer.value.trim().length > 0 &&
      !textInTheirWords(answer.value.trim(), answer.quote)
    ) {
      const resolvedText = await (warmed.get(answer) ?? resolve(answer));
      if (!resolvedText.ok) return done(resolvedText.result);
      if (resolvedText.value.type === "TEXT") {
        return done(
          await holdParaphrase(
            resolvedText.step,
            resolvedText.value,
            answer.quote,
          ),
        );
      }
    }
    // Their latest words name one choice by its own label, verbatim ("first
    // revenue only"): that is their answer, decided by code, not a reading
    // (live 2026-10-16: the reader missed it, the choice was held, and Q
    // said it had "matched your description to first revenue only").
    const verbatim =
      answer.basis !== "DELEGATED" &&
      input.personTurns[0] !== undefined &&
      quoteOccursIn(answer.quote, input.personTurns[0])
        ? verbatimOptionIn(steps.get(answer.stepKey), answer.quote)
        : null;
    if (answer.basis !== "DELEGATED" && verbatim === null) {
      const refused = await notStated(answer.stepKey, answer.quote);
      if (refused !== null) return done(refused);
    }
    if (answer.basis === "DELEGATED") {
      const authority = (await input.authority?.()) ?? null;
      if (authority === null || !authority.handed.has(answer.stepKey)) {
        return done({
          stepKey: answer.stepKey.slice(0, 80),
          outcome: "REJECTED",
          reason:
            "They have not handed you this choice, so nothing was recorded. Hold it with recommend, say what you suggest and why, and let them decide.",
        });
      }
    }
    // Confirming the journey's review activates what it set up: that is
    // finishing, and only confirm_and_finish does it, all the way to a
    // completed session (ACC 2026-09-25: a review confirmed on its own
    // left the mandate ACTIVE and the session open).
    const confirming = steps.get(answer.stepKey);
    if (confirming?.configuration.stepType === "confirmation") {
      return { kind: "CONFIRM", step: confirming, value: answer.value };
    }
    const resolved = await (warmed.get(answer) ?? resolve(answer));
    if (!resolved.ok) return done(resolved.result);
    const verbatimMatch =
      verbatim !== null &&
      resolved.value.type === "SINGLE_SELECT" &&
      resolved.value.optionKey === verbatim;
    if (verbatim !== null && !verbatimMatch) {
      // Recorded as something other than the choice they named: the
      // ordinary check decides.
      const refused = await notStated(answer.stepKey, answer.quote);
      if (refused !== null) return done(refused);
    }
    const reading = (await input.authority?.()) ?? null;
    const latestStated =
      verbatimMatch ||
      assertedNow(answer.quote) ||
      (reading !== null && statedIn(reading.stated, resolved.step.stepKey));
    const readerStated =
      latestStated ||
      input.statedEarlier?.(resolved.step.stepKey, answer.quote) === true;
    // From earlier words only, a choice is Q's reading of what they meant:
    // it is said back and agreed, never recorded silently (live
    // 2026-09-30: "we did YC summer 25" became "pilots running"). A figure
    // or their own text is checked against their words below.
    // A choice they named themselves, unambiguously, in the words the
    // reader says stated this step ("110 million US dollars" for the
    // currency) is their answer, not Q's reading: recorded once the step
    // is open, never held and asked again (QA 2026-10-03, 345a7155: the
    // currency was re-asked for several turns).
    const namedByThem =
      readerStated &&
      ((resolved.value.type === "SINGLE_SELECT" &&
        onlyOptionNamedIn(
          input.journeyType,
          resolved.step,
          resolved.value.optionKey,
          answer.quote,
        )) ||
        // Categories they named in their own words ("Europe and North
        // Africa", "climate, logistics"): each phrase is in the quote, so
        // it is their statement, not Q's inference; committed, never held
        // as a proposal (live AG 2026-10-16).
        (resolved.value.type === "RESOURCE_REFERENCE" &&
          resolved.value.resourceType === "TAXONOMY_NODE" &&
          phrasesNamedIn(answer.value, answer.quote)));
    if (
      input.authority !== undefined &&
      !latestStated &&
      !namedByThem &&
      answer.basis !== "DELEGATED" &&
      (resolved.value.type === "SINGLE_SELECT" ||
        resolved.value.type === "MULTI_SELECT" ||
        resolved.value.type === "RESOURCE_REFERENCE")
    ) {
      // Held for their yes, the way research findings are: read back with
      // any others in one line, accepted on their agreement (bench
      // 2026-09-30: a bare "yes" to a read-back of several choices never
      // stated them, and the interview stalled).
      if (store !== undefined) {
        try {
          await store.recommend({
            userId,
            sessionId: input.onboardingSessionId,
            stepKey: resolved.step.stepKey,
            value: resolved.value,
            // Shown to them as it is (QA F-53): it speaks to them.
            rationale: `From what you said earlier: "${answer.quote.slice(0, 120)}"`,
            runId: input.runId ?? null,
          });
          return done({
            stepKey: resolved.step.stepKey,
            outcome: "REJECTED",
            reason:
              "Held for their confirmation, not recorded yet: it is your reading of something they said earlier. Read it back with any others in one short line; when they agree, accept_recommendation records it.",
          });
        } catch {
          // Falls through to asking them.
        }
      }
      return done({
        stepKey: resolved.step.stepKey,
        outcome: "REJECTED",
        reason:
          "That comes from something they said earlier, and which choice it is was your reading. Say back what you understood in a few words and record it when they agree.",
      });
    }
    // A choice their English words never name, on a step the independent
    // reading did not find stated, is the model's inference, not their
    // statement (live AL 2026-10-16: "co-invest alongside a lead" saved
    // for a partner at a small VC fund who never said how they take part).
    // Words in another language are the reading's and the model's, as
    // before: their names for the choices are not listed here.
    if (
      answer.basis !== "DELEGATED" &&
      !verbatimMatch &&
      (resolved.value.type === "SINGLE_SELECT" ||
        resolved.value.type === "MULTI_SELECT") &&
      // "Other" with their own words is their statement, checked below.
      resolved.note === undefined &&
      reading !== null &&
      !statedIn(reading.stated, resolved.step.stepKey) &&
      turnIsEnglish(answer.quote)
    ) {
      // Named in the quote, or in the turn of theirs it is cut from.
      const named = new Set([
        ...optionsNamedIn(input.journeyType, resolved.step, answer.quote),
        ...input.personTurns
          .filter((said) => quoteOccursIn(answer.quote, said))
          .flatMap((said) => [
            ...optionsNamedIn(input.journeyType, resolved.step, said),
          ]),
      ]);
      const chosen =
        resolved.value.type === "SINGLE_SELECT"
          ? [resolved.value.optionKey]
          : resolved.value.optionKeys;
      if (chosen.some((key) => !named.has(key))) {
        return done({
          stepKey: resolved.step.stepKey,
          outcome: "REJECTED",
          reason:
            "Their words do not name this choice and nothing else says they stated it, so nothing was recorded: it would be your inference. Ask them if you want to know.",
        });
      }
    }
    const refused = unsupported(
      resolved.step,
      resolved.value,
      answer,
      readerStated,
    );
    if (refused !== null) return done(refused);
    if (
      resolved.note !== undefined &&
      answer.basis !== "DELEGATED" &&
      // Each piece of their other words is theirs (pieces need not sit
      // side by side in the quote).
      !resolved.note
        .split(/\s*;\s*/u)
        .every((piece) => textStatedIn(piece, answer.quote)) &&
      !(
        input.lastQTurn !== undefined &&
        textStatedIn(resolved.note, input.lastQTurn)
      )
    ) {
      return done({
        stepKey: resolved.step.stepKey,
        outcome: "REJECTED",
        reason:
          "That is none of this step's options and not in their words, so nothing was recorded. Record their own words for it, or the option that means what they said.",
      });
    }
    // The same answer already on the record, with nothing new beside it:
    // nothing to write (live AP: the same early signal saved three times
    // in one turn, each a revision and a round trip).
    const onRecord = latest?.responses.find(
      (r) => r.stepKey === resolved.step.stepKey,
    );
    if (
      onRecord !== undefined &&
      resolved.note === undefined &&
      sameValue(onRecord.value, resolved.value)
    ) {
      return done({
        stepKey: resolved.step.stepKey,
        outcome: "COMMITTED",
        question: (
          SPOKEN_QUESTIONS[resolved.step.stepKey] ??
          resolved.step.configuration.prompt
        ).slice(0, 400),
        recorded: (
          await spoken(
            resolved.step,
            resolved.value,
            latest ?? (await current()),
          )
        ).slice(0, 600),
      });
    }
    return {
      kind: "WRITE",
      step: resolved.step,
      value: resolved.value,
      note: resolved.note,
      quote: answer.quote,
    };
  };

  /**
   * Several allowed writes in one transaction (owner 2026-10-16). Each is
   * checked by the journey exactly as a single submission is; one it
   * refuses is reported with its reason and the others still commit. What
   * is COMMITTED is said only after the commit returned. Where the service
   * is briefly down, every one is held for retry, never claimed as saved.
   * Null: this service cannot take a batch (an older release); the caller
   * writes them one by one as before.
   */
  const writeMany = async (
    plans: readonly Extract<Planned, { kind: "WRITE" }>[],
  ): Promise<OnboardingRecordResult[] | null> => {
    const ready: {
      readonly plan: Extract<Planned, { kind: "WRITE" }>;
      readonly value: OnboardingResponseValue;
      readonly movedFrom?: OnboardingRecordResult["movedFrom"];
    }[] = [];
    const early = new Map<number, OnboardingRecordResult>();
    // In order, one at a time: settling a sibling list may itself write.
    for (const [index, plan] of plans.entries()) {
      const prepared = await prepareSiblings(plan.step, plan.value);
      if (!prepared.ok) {
        early.set(index, prepared.result);
        continue;
      }
      ready.push({
        plan,
        value: prepared.value,
        ...(prepared.movedFrom === undefined
          ? {}
          : { movedFrom: prepared.movedFrom }),
      });
    }
    const questionOf = (step: OnboardingStepManifest) =>
      (SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt).slice(
        0,
        400,
      );
    const settled: OnboardingRecordResult[] = [];
    if (ready.length > 0) {
      trusted = false;
      readAt = null;
      try {
        const out = await onFreshVersion((version) =>
          submitOnboardingResponses(
            input.session,
            input.onboardingSessionId,
            {
              responses: ready.map((item) => ({
                stepKey: item.plan.step.stepKey,
                response: {
                  value: item.value,
                  ...(item.plan.note === undefined
                    ? {}
                    : { note: item.plan.note }),
                  channel: "CONVERSATION" as const,
                },
              })),
              expectedSessionVersion: version,
            },
            randomUUID(),
          ),
        );
        latest = await settle(out.view);
        trusted = true;
        const after = latest;
        // In order: a fact kept with their notes appends to one answer.
        const settleOne = async (
          item: (typeof ready)[number],
          index: number,
        ): Promise<OnboardingRecordResult> => {
          const outcome = out.results[index];
          const stepKey = item.plan.step.stepKey;
          if (outcome?.outcome !== "COMMITTED") {
            const problem = outcome?.refusal ?? {
              detail: null,
              errors: [],
            };
            // QA F-52: a fact that waits for the firm or company to be set
            // up is held and saved as soon as it is, never refused.
            if (input.held !== undefined && waitsForContext({ problem })) {
              try {
                await input.held.hold(stepKey, {
                  value: item.value,
                  ...(item.plan.note === undefined
                    ? {}
                    : { note: item.plan.note }),
                });
                return {
                  stepKey,
                  outcome: "HELD_FOR_RETRY",
                  question: questionOf(item.plan.step),
                  reason: HELD_FOR_FIRM_REASON,
                };
              } catch {
                // The hold itself failed: refused below, honestly.
              }
            }
            if (offPath({ problem })) {
              await holdUntilOpen(stepKey, item.value, item.plan.note);
              const kept = await keepOffPath(
                item.plan.step,
                fieldWordsOf(
                  item.plan.quote,
                  await spoken(item.plan.step, item.value, await current()),
                ),
              );
              if (kept !== null) return kept;
            }
            return refused(stepKey, { problem });
          }
          written.push(stepKey);
          noteFigure(item.plan.step, item.value, item.plan.quote);
          return {
            stepKey,
            outcome: "COMMITTED",
            question: questionOf(item.plan.step),
            recorded: (item.plan.note === undefined
              ? await spoken(item.plan.step, item.value, after)
              : `${item.plan.note} (in their words)`
            ).slice(0, 600),
            ...(item.movedFrom === undefined
              ? {}
              : { movedFrom: item.movedFrom }),
          };
        };
        for (const [index, item] of ready.entries()) {
          settled.push(await settleOne(item, index));
        }
      } catch (error: unknown) {
        const status = (error as { readonly status?: unknown }).status;
        if (status === 404 || status === 405) return null;
        for (const item of ready) {
          const stepKey = item.plan.step.stepKey;
          if (input.held !== undefined && isTransientOnboardingFailure(error)) {
            try {
              await input.held.hold(stepKey, {
                value: item.value,
                ...(item.plan.note === undefined
                  ? {}
                  : { note: item.plan.note }),
              });
              settled.push({
                stepKey,
                outcome: "HELD_FOR_RETRY",
                question: questionOf(item.plan.step),
                reason:
                  "Not saved yet: the service is briefly unavailable. Their answer is held and will be saved automatically; nothing is lost. Tell them plainly it is not saved yet, do not ask it again, and carry on.",
              });
              continue;
            } catch {
              // The hold itself failed: report the original failure.
            }
          }
          settled.push(refused(stepKey, error));
        }
      }
    }
    // Back in the order the plans came in.
    const out: OnboardingRecordResult[] = [];
    let next = 0;
    for (const index of plans.keys()) {
      const result = early.get(index) ?? settled[next++];
      if (result !== undefined) out.push(result);
    }
    return out.length === plans.length ? out : null;
  };

  /**
   * An answer that does not come from a model's reading of a sentence:
   * what they typed at sign-up, or what their journey choice already says.
   */
  const recordPlatformHeld = async (
    stepKey: string,
    text: string,
  ): Promise<boolean> => {
    const step = steps.get(stepKey);
    const words = text.trim();
    if (step === undefined || words.length === 0) return false;
    const view = await current();
    if (view.responses.some((r) => r.stepKey === stepKey)) return false;
    // A step the journey can only save after another (the firm's name sets
    // up the investor profile with how they invest): not tried before it,
    // so no turn opens with a refused request (live AJ: a 422 every turn).
    const before = SAVED_AFTER[stepKey] ?? [];
    if (
      before.some((needed) => !view.responses.some((r) => r.stepKey === needed))
    ) {
      return false;
    }
    const value = toResponseValue(step, words);
    if (value === null) return false;
    try {
      await submit(stepKey, value);
      written.push(stepKey);
      return true;
    } catch {
      // Not recordable yet (another step first): Q asks as before.
      return false;
    }
  };

  /** Replays held changes (lane ob1) through the ordinary submit. */
  const replayHeldWrites = async (): Promise<DrainResult | null> => {
    const drain = input.held?.drain;
    if (drain === undefined) return null;
    return drain({
      currentValue: async (stepKey) => {
        const view = await fresh();
        return view.responses.find((r) => r.stepKey === stepKey)?.value ?? null;
      },
      answeredAt: async (stepKey) => {
        const at = (await current()).responses.find(
          (r) => r.stepKey === stepKey,
        )?.createdAt;
        return at === undefined ? null : new Date(at);
      },
      submit: async (write) => {
        // Validated again: the held row is data, not a trusted value.
        const value = OnboardingResponseValueSchema.parse(write.response.value);
        const response = {
          value,
          ...(write.response.note === undefined
            ? {}
            : { note: write.response.note }),
          channel: "CONVERSATION" as const,
        };
        trusted = false;
        readAt = null;
        latest = await settle(
          await onFreshVersion((version) =>
            submitOnboardingResponse(
              input.session,
              input.onboardingSessionId,
              {
                stepKey: write.stepKey,
                response,
                expectedSessionVersion: version,
              },
              // Derived from the held row and the version it targets: a
              // retried replay of the same version replays, not repeats.
              pendingReplayKey(write.id, version),
            ),
          ),
        );
        written.push(write.stepKey);
      },
    });
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
    recommendFound: async (items) => {
      const results: {
        stepKey: string;
        outcome: FoundRecommendationOutcome;
      }[] = [];
      if (store === undefined) {
        return items.map((item) => ({
          stepKey: item.stepKey,
          outcome: "REJECTED" as const,
        }));
      }
      const view = await current();
      const waiting = await pendingNow().catch(() => []);
      const setAside = new Set(
        view.progress.eligibleSteps
          .filter((row) => row.status === "SKIPPED")
          .map((row) => row.stepKey),
      );
      for (const item of items) {
        const step = steps.get(item.stepKey);
        if (step === undefined) {
          results.push({ stepKey: item.stepKey, outcome: "REJECTED" });
          continue;
        }
        if (waiting.some((held) => held.stepKey === step.stepKey)) {
          results.push({ stepKey: step.stepKey, outcome: "ALREADY_PENDING" });
          continue;
        }
        if (setAside.has(step.stepKey)) {
          results.push({ stepKey: step.stepKey, outcome: "SET_ASIDE" });
          continue;
        }
        let resolved = await resolve(item);
        const c = step.configuration;
        if (
          !resolved.ok &&
          typeof item.value === "object" &&
          c.stepType === "reference_select" &&
          c.resourceType === "TAXONOMY_NODE"
        ) {
          // Each phrase alone: what a page names clearly is offered, and
          // what it does not stays unknown rather than sinking the rest.
          const ids: string[] = [];
          for (const phrase of item.value.slice(0, 8)) {
            const one = await resolve({
              stepKey: step.stepKey,
              value: [phrase],
            });
            if (one.ok && one.value.type === "RESOURCE_REFERENCE") {
              for (const id of one.value.resourceIds) {
                if (!ids.includes(id)) ids.push(id);
              }
            }
          }
          if (ids.length > 0) {
            resolved = {
              ok: true,
              step,
              value: {
                type: "RESOURCE_REFERENCE",
                resourceType: "TAXONOMY_NODE",
                resourceIds: ids.slice(0, c.maxItems),
              },
            };
          }
        }
        // A finding is offered only as a value the step holds: page words
        // are not the person's own words (those are kept only when they
        // say them).
        if (
          !resolved.ok ||
          (resolved.value.type === "TEXT" &&
            step.configuration.stepType !== "short_text" &&
            step.configuration.stepType !== "long_text")
        ) {
          results.push({ stepKey: step.stepKey, outcome: "UNRESOLVED" });
          continue;
        }
        const answered = view.responses.find(
          (r) => r.stepKey === step.stepKey,
        )?.value;
        if (answered !== undefined && sameValue(answered, resolved.value)) {
          results.push({ stepKey: step.stepKey, outcome: "SAME_AS_ANSWER" });
          continue;
        }
        try {
          await store.recommend({
            userId,
            sessionId: input.onboardingSessionId,
            stepKey: step.stepKey,
            value: resolved.value,
            rationale: item.because,
            runId: input.runId ?? null,
            sources: item.sources,
          });
          results.push({
            stepKey: step.stepKey,
            outcome:
              answered === undefined ? "RECOMMENDED" : "DIFFERS_FROM_ANSWER",
          });
        } catch {
          results.push({ stepKey: step.stepKey, outcome: "REJECTED" });
        }
      }
      return results;
    },
    answeredSteps: async () =>
      new Set((await current()).responses.map((r) => r.stepKey)),
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
        // Q's summary of their words binds to exactly the words they heard:
        // one Q never said back to them is not theirs to approve.
        const paraphrase = isParaphraseRationale(held.rationale);
        if (
          paraphrase &&
          (held.value.type !== "TEXT" ||
            !heardBack(held.value.text, input.lastQTurn))
        ) {
          results.push({
            stepKey,
            outcome: "REJECTED",
            reason:
              "Held for their confirmation: your summary was not said back to them word for word, so nothing was recorded. Say it back in one line exactly as held and ask if you should save it.",
          });
          continue;
        }
        // A plain yes (or "go ahead and save it") to the summary they just
        // heard is decided by code; anything else is the reader's.
        const affirmed =
          paraphrase &&
          readBackReplyOf(input.personTurns[0] ?? "") === "AFFIRM";
        const authority = affirmed
          ? null
          : ((await input.authority?.()) ?? null);
        if (
          !affirmed &&
          (authority === null || !authority.approved.has(stepKey))
        ) {
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
          trusted = false;
          readAt = null;
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
            trusted = false;
            readAt = null;
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
              step.configuration.stepType !== "confirmation" &&
              // The journey settles these itself; never a question.
              !isPlatformReference(step),
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
        // Agreeing to the review Q just put to them is finishing too.
        const agreedToReview = view.progress.eligibleSteps.some(
          (e) =>
            e.status !== "COMPLETED" &&
            steps.get(e.stepKey)?.configuration.stepType === "confirmation" &&
            authority?.stated.has(e.stepKey) === true,
        );
        if (authority?.finishing !== true && !agreedToReview) {
          return {
            completed: false,
            missing: [],
            reason:
              "They have not confirmed that the record is right and that they want to finish, so nothing was completed. Ask them.",
          };
        }
      }
      // They asked to finish: an optional question the journey is waiting
      // on is set aside (theirs to answer later), so the journey reaches
      // and settles its own platform steps (live 2026-10-16: an unsaved
      // optional title held the mandate step back and finishing stalled).
      for (let guard = 0; guard < 4; guard += 1) {
        const gapsNow = view.progress.eligibleSteps.filter(
          (e) => e.required && e.status !== "COMPLETED",
        );
        const onlyPlatform =
          gapsNow.length > 0 &&
          gapsNow.every((e) => {
            const step = steps.get(e.stepKey);
            return (
              step !== undefined &&
              (isPlatformReference(step) ||
                step.configuration.stepType === "confirmation")
            );
          }) &&
          gapsNow.some((e) => {
            const step = steps.get(e.stepKey);
            return step !== undefined && isPlatformReference(step);
          });
        const waitingOn = view.currentStep;
        const waitingStep =
          waitingOn === null || waitingOn === undefined
            ? undefined
            : steps.get(waitingOn.stepKey);
        if (
          !onlyPlatform ||
          waitingStep === undefined ||
          waitingStep.required ||
          view.responses.some((r) => r.stepKey === waitingStep.stepKey)
        ) {
          break;
        }
        try {
          trusted = false;
          readAt = null;
          latest = await settle(
            await skipOnboardingStep(
              input.session,
              input.onboardingSessionId,
              waitingStep.stepKey,
              { expectedSessionVersion: view.session.version },
              randomUUID(),
            ),
          );
          view = latest;
        } catch {
          break;
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
        const left = missing(view);
        return {
          completed: false,
          missing: left,
          ...(left.length === 0
            ? {
                reason:
                  "The setup is still settling its own steps, so it was not completed yet. Tell them plainly and ask them to confirm again in a moment.",
              }
            : {}),
        };
      }
      try {
        trusted = false;
        readAt = null;
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
      // One answer that cannot be processed never loses the others (bench
      // 2026-09-30: a category lookup's 400 threw out an investor's whole
      // ten-answer monologue as "the profile save didn't complete").
      const safely = async (
        answer: (typeof answers)[number],
      ): Promise<OnboardingRecordResult> => {
        try {
          return await recordOne(answer);
        } catch (error: unknown) {
          return refused(answer.stepKey, error);
        }
      };
      // Planned together (reads only: their words, the reading, the
      // vocabularies), then every allowed write committed in ONE
      // transaction (owner 2026-10-16: a round trip per answer made a
      // typed turn 6-18 s). A confirmation finishes, so it goes last and
      // on its own; a sibling exclusion list is settled before the batch.
      for (const answer of answers) {
        const resolving = resolve(answer);
        // Settled here or by the plan that awaits it; never unhandled.
        resolving.catch(() => undefined);
        warmed.set(answer, resolving);
      }
      const plans: Planned[] = [];
      // Answers whose planning failed on a service call (a category lookup
      // refused before this turn's first answers set up their profile).
      const failedToPlan = new Set<number>();
      const writtenBefore = written.length;
      for (const [index, answer] of answers.entries()) {
        const plan = await planOne(answer).catch((error: unknown): Planned => {
          failedToPlan.add(index);
          return done(refused(answer.stepKey, error));
        });
        // A figure planned for one step is not also another's in the same
        // breath (one stated figure answers one step), as if each had
        // committed in turn.
        if (plan.kind === "WRITE")
          noteFigure(plan.step, plan.value, plan.quote);
        plans.push(plan);
      }
      warmed.clear();
      const writes = plans.flatMap((plan, index) =>
        plan.kind === "WRITE" ? [{ plan, index }] : [],
      );
      // At most ONBOARDING_RESPONSES_BATCH_MAX a transaction; a longer
      // answer is saved in consecutive batches, in order.
      const committedBatch =
        writes.length > 1
          ? await (async () => {
              const all: OnboardingRecordResult[] = [];
              for (let at = 0; at < writes.length; at += BATCH_MAX) {
                const chunk = await writeMany(
                  writes.slice(at, at + BATCH_MAX).map((w) => w.plan),
                );
                if (chunk === null) return null;
                all.push(...chunk);
              }
              return all;
            })()
          : null;
      for (const [index, plan] of plans.entries()) {
        const answer = answers[index];
        if (answer === undefined) continue;
        if (plan.kind === "DONE") {
          results.push(plan.result);
          continue;
        }
        if (plan.kind === "WRITE" && committedBatch !== null) {
          const at = writes.findIndex((w) => w.index === index);
          const result = committedBatch[at];
          if (result !== undefined) {
            results.push(result);
            continue;
          }
        }
        // One write, a confirmation, or a batch the service could not
        // take as one: the single path, in the order they spoke.
        results.push(await safely(answer));
      }
      // Live AI 2026-10-16: a new investor's first answer set up their
      // profile in this batch, and the category look-ups planned before it
      // were refused (no organisation context yet), so geography and
      // sectors were lost. Once anything committed, they are planned again.
      if (written.length > writtenBefore) {
        for (const index of failedToPlan) {
          const answer = answers[index];
          if (answer !== undefined && results[index]?.outcome !== "COMMITTED") {
            results[index] = await safely(answer);
          }
        }
      }
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
          results[index] = await safely(answer);
        }
      }
      // QA F-52: what was kept until the firm or company existed is saved
      // the turn it comes to exist, not one turn later. Held rows older
      // than an answer this turn saved directly are settled, never written
      // over it (the drain compares when each was given).
      if (input.held !== undefined && written.length > writtenBefore) {
        await replayHeldWrites().catch(() => null);
      }
      return results;
    },
    view: () => latest,
    recorded: () => [...written],
    recordFromSignup: (stepKey, text) => recordPlatformHeld(stepKey, text),
    recordKnown: (stepKey, raw) => recordPlatformHeld(stepKey, raw),
    keepStated: async (stepKey, said) => {
      const step = steps.get(stepKey);
      if (step === undefined || written.includes(stepKey)) return null;
      const view = await current();
      if (view.responses.some((r) => r.stepKey === stepKey)) return null;
      const configuration: unknown = step.configuration;
      const optionLabels =
        typeof configuration === "object" &&
        configuration !== null &&
        "options" in configuration &&
        Array.isArray(configuration.options)
          ? (
              configuration.options as readonly { readonly label?: unknown }[]
            ).map((o) => (typeof o.label === "string" ? o.label : ""))
          : [];
      const about = [
        coverageProfileFor(input.journeyType).fields[stepKey]?.label ?? "",
        SPOKEN_QUESTIONS[stepKey] ?? step.configuration.prompt,
        ...optionLabels,
      ].join(" ");
      const words = fieldClausesOf(said, about);
      if (words === null) return null;
      return keepOffPath(step, words);
    },
    recordStatedCurrency: async (options) => {
      const stepKey =
        input.journeyType === "founder" ? "F6.currency" : "I2.currency";
      const step = steps.get(stepKey);
      if (step === undefined || written.includes(stepKey)) return null;
      const view = await current();
      if (view.responses.some((r) => r.stepKey === stepKey)) return null;
      const open = view.progress.eligibleSteps.some(
        (e) =>
          e.stepKey === stepKey &&
          e.status !== "COMPLETED" &&
          e.status !== "SKIPPED",
      );
      if (!open) return null;
      // Latest words first: a later currency is their correction.
      const turns =
        options?.earlierOnly === true
          ? input.personTurns.slice(1)
          : input.personTurns;
      for (const text of turns) {
        // A question names a currency without stating theirs.
        if (ASKING.test(text.trim())) continue;
        const named = currencyNamedIn(input.journeyType, step, text);
        if (named === "SEVERAL") return null;
        if (named === null) continue;
        try {
          await submit(stepKey, {
            type: "SINGLE_SELECT",
            optionKey: named.optionKey,
          });
          written.push(stepKey);
          return { stepKey, optionKey: named.optionKey, quote: named.quote };
        } catch {
          return null;
        }
      }
      return null;
    },
    replayHeld: () => replayHeldWrites(),
    affirmedParaphrases: async () => {
      const latest = input.personTurns[0];
      if (latest === undefined || readBackReplyOf(latest) !== "AFFIRM") {
        return new Set<string>();
      }
      return new Set(
        (await heard)
          .filter(
            (held) =>
              isParaphraseRationale(held.rationale) &&
              held.value.type === "TEXT" &&
              heardBack(held.value.text, input.lastQTurn),
          )
          .map((held) => held.stepKey),
      );
    },
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

function normalisedWords(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[’']/gu, "'")
    .replace(/[^\p{L}\p{N}'$£€₦ ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()} `;
}

/**
 * Whether their own words name exactly one of a single-select step's
 * choices -- by its label, its key or the journey's own aliases for it --
 * and that one is the choice given. Several named ("dollars ... no, naira")
 * is not unambiguous.
 */
/**
 * The open questions that stand between a waiting proposal and the
 * person: steps its branching reads that are on their path and unanswered.
 */
export function proposalPrerequisites(input: {
  readonly pending: readonly string[];
  readonly eligible: ReadonlySet<string>;
  readonly answered: ReadonlySet<string>;
  readonly stepOf: (
    stepKey: string,
  ) => { readonly branching?: unknown } | undefined;
}): string[] {
  const out: string[] = [];
  for (const waiting of input.pending) {
    if (input.eligible.has(waiting)) continue;
    for (const key of branchStepKeys(input.stepOf(waiting)?.branching)) {
      if (
        input.eligible.has(key) &&
        !input.answered.has(key) &&
        !out.includes(key)
      ) {
        out.push(key);
      }
    }
  }
  return out;
}

/**
 * A one- or two-character answer ("GP", "UK", "5") as a whole word of what
 * they said: too short for the quote check's minimum, still their words.
 */
export function shortWordIn(quote: string, said: string): boolean {
  const word = quote.trim().toLowerCase();
  if (word.length === 0 || word.length > 2 || !/^[\p{L}\p{N}]+$/u.test(word)) {
    return false;
  }
  return said
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .includes(word);
}

/** A sentence that asks rather than states: by its mark or how it opens. */
/** Steps whose answer is a narrative Q may summarise for their yes. */
/** How long a plain read of the session stands in for another (see readAt). */
const READ_REUSE_MS = 1_500;
/** Why a write is refused when its quote is not in their words. */
const UNSAID_REASON =
  "That quote is not in anything the person said here, so nothing was recorded. Only their own words can put an answer on the record.";
const UNCONFIRMED_REASON =
  "What they just said could not be confirmed, so nothing was recorded. Ask them to say it again.";
const NOT_STATED_REASON =
  "Their latest words do not state this about themselves, so nothing was recorded. A question, advice or a mention is never their answer; ask them if you want to know.";

const PARAPHRASABLE: ReadonlySet<string> = new Set(["long_text", "voice_text"]);

const ASKING =
  /[?؟]\s*$|^(?:what|which|who|whom|whose|when|where|why|how|is|are|do|does|did|can|could|should|would|will|shall|tell me|curious|i wonder|any idea|هل|ما|ماذا|كيف|لماذا|متى|أين|من)\b/iu;

/** The most answers one transactional save carries (the API's own bound). */
const BATCH_MAX = 24;

/** A figure no answer can have (a negative count or amount). */
export function impossibleFigure(raw: unknown): boolean {
  const text = String(raw).replace(/[,\s]/gu, "");
  return /^-\d/u.test(text);
}

/** Every step a branching expression reads, in order, once each. */
export function branchStepKeys(expression: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const { stepKey, expressions } = node as {
      readonly stepKey?: unknown;
      readonly expressions?: unknown;
    };
    if (typeof stepKey === "string" && !out.includes(stepKey)) {
      out.push(stepKey);
    }
    if (Array.isArray(expressions))
      for (const child of expressions) visit(child);
  };
  visit(expression);
  return out;
}

/**
 * The one option of a single-choice step whose own label (two words or
 * more, so never a bare "yes" or "seed") appears verbatim in their words;
 * null when none does or more than one does.
 */
export function verbatimOptionIn(
  step: { readonly configuration: unknown } | undefined,
  quote: string,
): string | null {
  const configuration = step?.configuration as
    | {
        readonly stepType?: string;
        readonly options?: readonly {
          readonly optionKey?: string;
          readonly label?: string;
        }[];
      }
    | undefined;
  if (configuration?.stepType !== "single_select") return null;
  const said = normalisedWords(quote);
  const named = (configuration.options ?? []).filter((option) => {
    const label = normalisedWords(option.label ?? "");
    return label.trim().split(" ").length >= 2 && said.includes(label);
  });
  return named.length === 1 ? (named[0]?.optionKey ?? null) : null;
}

export function onlyOptionNamedIn(
  journeyType: "founder" | "investor",
  step: { readonly stepKey: string; readonly configuration: unknown },
  optionKey: string,
  quote: string,
): boolean {
  const configuration = step.configuration as {
    readonly options?: readonly {
      readonly key?: string;
      readonly optionKey?: string;
      readonly label?: string;
    }[];
  };
  const aliases = (
    journeyType === "founder"
      ? FOUNDER_UTTERANCE_ALIASES
      : INVESTOR_UTTERANCE_ALIASES
  )[step.stepKey];
  const said = normalisedWords(quote);
  const named = (configuration.options ?? []).filter((option) => {
    const key = option.optionKey ?? option.key ?? "";
    const names = [
      option.label ?? "",
      ...(key.length >= 3 ? [key.replace(/_/gu, " ")] : []),
      ...(aliases?.[key] ?? []),
    ].filter((name) => name.trim().length > 0);
    return names.some((name) => said.includes(normalisedWords(name)));
  });
  return (
    named.length === 1 && (named[0]?.optionKey ?? named[0]?.key) === optionKey
  );
}

/**
 * Whether every phrase of a value is in their quote, word for word (case
 * and plural aside): "Europe, North Africa" in "Europe and North Africa".
 */
export function phrasesNamedIn(
  value: string | readonly string[] | number | boolean,
  quote: string,
): boolean {
  const phrases = (typeof value === "object" ? [...value] : [String(value)])
    .flatMap((phrase) => phrase.split(/\s*[,;]\s*/u))
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);
  if (phrases.length === 0) return false;
  const said = normalisedWords(quote);
  return phrases.every((phrase) => {
    const words = normalisedWords(phrase).trim();
    if (words.length === 0) return false;
    return (
      said.includes(` ${words} `) ||
      said.includes(` ${words.replace(/s$/u, "")} `) ||
      said.includes(` ${words}s `)
    );
  });
}

const FIELD_STOP_WORDS = new Set(
  "the and or but with from that this they them their our your for into about over just only also very".split(
    " ",
  ),
);

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length >= 3 && !FIELD_STOP_WORDS.has(word))
    .map((word) => (word.length > 4 ? word.replace(/(?:es|s)$/u, "") : word));
}

/**
 * The part of their quote that is about one field (live AG 2026-10-16: the
 * model quoted a whole opening statement for the excluded sectors, and the
 * whole statement was saved as them). A short quote is the field's already;
 * a long one keeps only the clauses that carry the field's own words (the
 * value as read), still in their words. When no clause carries them, the
 * value as read stands if it is short, else the quote as it was.
 */
export function fieldPartOf(quote: string, reading: string): string {
  const said = quote.trim();
  if (said.length <= 80) return said;
  const part = fieldClausesOf(said, reading);
  if (part !== null) return part;
  const read = reading.trim();
  return read.length > 0 && read.length <= 200 ? read : said.slice(0, 300);
}

/** The clauses of their words that carry the field's own words, or null. */
export function fieldClausesOf(quote: string, reading: string): string | null {
  const said = quote.trim();
  if (said.length <= 80) return said.length > 0 ? said : null;
  const wanted = new Set(contentWords(reading));
  if (wanted.size === 0) return null;
  const carries = (text: string) =>
    contentWords(text).some((word) => wanted.has(word));
  const sentences = said.match(/[^.!?;]+[.!?;]*/gu) ?? [said];
  const parts: string[] = [];
  for (const sentence of sentences) {
    if (!carries(sentence)) continue;
    const clauses = sentence.split(/,\s+/u);
    const kept = clauses.filter(carries);
    parts.push(
      (kept.length > 0 ? kept.join(", ") : sentence)
        .trim()
        .replace(/^(?:and|but|so|also|plus|honestly)\b[\s,]*/iu, "")
        .replace(/[,;:\s]+$/u, ""),
    );
  }
  return parts.length > 0 ? parts.join("; ").slice(0, 300) : null;
}

/** Dollars of a country other than the US: never read as US dollars. */
const OTHER_DOLLARS =
  /\b(?:canadian|australian|hong kong|new zealand|singapore|taiwan(?:ese)?|jamaican|namibian|liberian|zimbabwe(?:an)?|fiji(?:an)?|east caribbean|brunei|bahamian|barbadian|belize|bermudian|cayman|guyanese|trinidad|surinamese|solomon)\s+dollars?\b|\b(?:c|a|s|hk|nz|nt)\$|\b(?:cad|aud|hkd|nzd|twd|jmd)\b/iu;

/** A figure in their words: digits or a spoken amount. */
const MONEY_FIGURE =
  /\d|\b(?:thousand|million|billion|hundred|grand|mil|mn|bn)\b/iu;

/**
 * The one currency their words name beside a figure, by the step's labels,
 * keys and the journey's aliases ("dollars", "$" for the US dollar);
 * "SEVERAL" when they name more than one; null when none, no figure, or a
 * dollar of another country the step does not offer.
 */
export function currencyNamedIn(
  journeyType: "founder" | "investor",
  step: { readonly stepKey: string; readonly configuration: unknown },
  text: string,
): { readonly optionKey: string; readonly quote: string } | "SEVERAL" | null {
  if (!MONEY_FIGURE.test(text)) return null;
  const only = optionNamedIn(journeyType, step, text);
  if (only === null || only === "SEVERAL") return only;
  // A dollar the journey does not offer by name is not the US dollar.
  if (only.optionKey === "usd" && OTHER_DOLLARS.test(text)) return null;
  return only;
}

/**
 * The one choice of a single-select step their words name, by its label,
 * key or the journey's aliases, longest names first ("singapore dollars"
 * is not also "dollars"); "SEVERAL" when they name more than one.
 */
export function optionNamedIn(
  journeyType: "founder" | "investor",
  step: { readonly stepKey: string; readonly configuration: unknown },
  text: string,
): { readonly optionKey: string; readonly quote: string } | "SEVERAL" | null {
  const configuration = step.configuration as {
    readonly options?: readonly {
      readonly optionKey?: string;
      readonly label?: string;
    }[];
  };
  const aliases = (
    journeyType === "founder"
      ? FOUNDER_UTTERANCE_ALIASES
      : INVESTOR_UTTERANCE_ALIASES
  )[step.stepKey];
  const names = (configuration.options ?? []).flatMap((option) => {
    const key = option.optionKey ?? "";
    return [
      option.label ?? "",
      ...(key.length >= 3 ? [key] : []),
      ...(aliases?.[key] ?? []),
    ]
      .map((name) => normalisedWords(name).trim())
      .filter((name) => name.length > 0)
      .map((name) => ({ name, key }));
  });
  // Longest names first, each taken out once found: "singapore dollars"
  // is not also "dollars".
  names.sort((a, b) => b.name.length - a.name.length);
  let said = normalisedWords(text);
  const found = new Map<string, string>();
  for (const { name, key } of names) {
    for (const form of [name, `${name}s`]) {
      if (!said.includes(` ${form} `)) continue;
      if (!found.has(key)) found.set(key, form);
      said = said.split(` ${form} `).join(" ");
    }
  }
  if (found.size > 1) return "SEVERAL";
  const [only] = [...found];
  if (only === undefined) return null;
  return { optionKey: only[0], quote: only[1] };
}

/** The scale a figure's word or letter multiplies it by, in any language spoken. */
const FIGURE_SCALES: Readonly<Record<string, number>> = {
  ...SCALE_WORDS,
  grand: 1_000,
};

/**
 * Every figure their words give, in digits ("750 thousand", "$1.5m",
 * "2,000,000", "14") or in words ("five million"), each with the words
 * that give it. For deciding only when a turn holds exactly one figure;
 * the write check still reads the figure from the quote.
 */
export function moneyFiguresIn(
  text: string,
): readonly { readonly value: number; readonly text: string }[] {
  const out: { value: number; text: string }[] = [];
  const digits = asciiDigits(text);
  const pattern = /(?:[$€£₦]\s*)?(\d+(?:[.,]\d+)*)(?:\s*([\p{L}]+))?/giu;
  for (const match of digits.matchAll(pattern)) {
    const raw = match[1] ?? "";
    // "1,500,000" and "1.5": a comma before three digits groups thousands.
    const number = Number(
      /^\d{1,3}(?:,\d{3})+$/u.test(raw)
        ? raw.replace(/,/gu, "")
        : raw.replace(/,/gu, "."),
    );
    if (!Number.isFinite(number)) continue;
    const word = (match[2] ?? "").toLowerCase();
    const scale = FIGURE_SCALES[word];
    out.push({
      value: Math.round(number * (scale ?? 1)),
      // Only the figure and its scale: a following word is not part of it.
      text: (scale === undefined
        ? match[0].slice(0, match[0].length - word.length)
        : match[0]
      ).trim(),
    });
  }
  if (out.length === 0) {
    for (const value of spokenFiguresIn(text)) {
      out.push({ value, text: text.trim().slice(0, 300) });
    }
  } else if (spokenFiguresIn(text).length > 0) {
    // Figures in digits and in words: more than one, so none is decided.
    out.push(...spokenFiguresIn(text).map((value) => ({ value, text: "" })));
  }
  return out;
}

/** Steps code fills from the platform that the journey saves only after others. */
const SAVED_AFTER: Readonly<Record<string, readonly string[]>> = {
  "I0.organisation_name": ["I0.investor_type"],
};

/**
 * Every choice of a single- or multi-select step their words name, by its
 * label, key or the journey's aliases (case and plural aside).
 */
export function optionsNamedIn(
  journeyType: "founder" | "investor",
  step: { readonly stepKey: string; readonly configuration: unknown },
  quote: string,
): ReadonlySet<string> {
  const configuration = step.configuration as {
    readonly options?: readonly {
      readonly optionKey?: string;
      readonly key?: string;
      readonly label?: string;
    }[];
  };
  const aliases = (
    journeyType === "founder"
      ? FOUNDER_UTTERANCE_ALIASES
      : INVESTOR_UTTERANCE_ALIASES
  )[step.stepKey];
  const said = normalisedWords(quote);
  const named = new Set<string>();
  for (const option of configuration.options ?? []) {
    const key = option.optionKey ?? option.key ?? "";
    const names = [
      option.label ?? "",
      ...(key.length >= 3 ? [key.replace(/_/gu, " ")] : []),
      ...(aliases?.[key] ?? []),
    ]
      .map((name) => normalisedWords(name).trim())
      .filter((name) => name.length > 0);
    const forms = names.flatMap((name) => [
      name,
      `${name}s`,
      name.replace(/s$/u, ""),
    ]);
    if (forms.some((form) => form.length > 0 && said.includes(` ${form} `))) {
      named.add(key);
    }
  }
  return named;
}
