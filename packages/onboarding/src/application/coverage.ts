import {
  OnboardingCoverageSchema,
  type OnboardingCoverage,
  type OnboardingCoverageField,
  type OnboardingCoveragePriority,
  type OnboardingCoverageProposal,
  type OnboardingCoverageSource,
  type OnboardingCoverageState,
  type OnboardingNextField,
  type OnboardingResponseValue,
  type OnboardingSessionView,
  type OnboardingSourceModality,
} from "@capital-q/contracts";

import type {
  BranchExpression,
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "../definitions/schema.js";

/**
 * The canonical onboarding coverage model (lane ob1, directive 2026-10-16).
 *
 * A pure projection: definition + session view + what the platform already
 * holds -> one state per field. Nothing here is stored, nothing calls a
 * model, nothing decides truth. The field list is the definition's own
 * steps; the journey's coverage profile only annotates them (priority,
 * deferrable, evidence wanted), so the questionnaire is never duplicated.
 *
 * Form and conversation read the same coverage, so either one recognises
 * what the other recorded.
 */

/** Per-field annotation a journey owns. Keyed by the definition's step key. */
export type OnboardingCoverageFieldProfile = {
  /** Stable concept name ("company.name"); joins founder and investor views. */
  readonly concept: string;
  readonly priority: OnboardingCoveragePriority;
  /** Short label for the progress view; the step prompt is the fallback. */
  readonly label?: string | undefined;
  /** Defaults to: not required and not ESSENTIAL. A required step is never deferrable. */
  readonly deferrable?: boolean | undefined;
  /** Document types that would support the claim once it is answered. */
  readonly evidenceWanted?: readonly string[] | undefined;
  /** Option keys whose answer needs no evidence (e.g. "pre_revenue"). */
  readonly evidenceNotFor?: readonly string[] | undefined;
  /**
   * For an upload step: held documents of these types settle it, so a
   * deck uploaded in the conversation is not listed as still to do.
   */
  readonly satisfiedByDocuments?: readonly string[] | undefined;
  /** What to ask first within a priority (lower first). Absent: definition order. */
  readonly rank?: number | undefined;
  /** False: never asked as a gap (owner: a profile's Closing); still confirmable. */
  readonly askable?: boolean | undefined;
  /** Rough seconds to answer it in conversation; for the time estimate. */
  readonly seconds?: number | undefined;
  /**
   * True: the value is a judgement about the person's current state
   * (whether they are deploying or raising now, how open they are), so it
   * is theirs only when they give it in answer to Q's own question about
   * it, or confirm a suggestion of it. A reading of other words never
   * writes it, whatever the reading calls its source (live re-check
   * 2026-10-31: "we write cheques of EUR 750k to 3 million" was saved as
   * "actively investing", never asked).
   */
  readonly askOnly?: boolean | undefined;
};

export type OnboardingCoverageProfile = {
  readonly journeyType: "founder" | "investor";
  /** Versioned like any reference data; bumps when priorities change. */
  readonly version: string;
  readonly fields: Readonly<Record<string, OnboardingCoverageFieldProfile>>;
  /** Which field a registration fact answers, so it is never asked again. */
  readonly registrationSeeds?:
    { readonly organisationName?: string | undefined } | undefined;
  /**
   * Coverage satisfied by an upload rather than an answer, where the
   * definition has no step for it (lane ob1: an investor's fund deck,
   * thesis or LP letter). Keyed by a synthetic field key; settled
   * (CONFIRMED_SAVED, source DOCUMENT) when a document of one of the
   * listed types is held, DEFERRABLE otherwise. Never required. What a
   * readable upload says about other fields arrives as suggestions on
   * those fields (`informs`), confirmed by the person like any other.
   */
  readonly documentFields?:
    | Readonly<
        Record<
          string,
          {
            readonly concept: string;
            readonly label: string;
            readonly priority: OnboardingCoveragePriority;
            readonly documentTypes: readonly string[];
            /** Field keys a readable upload of this kind may propose values for. */
            readonly informs: readonly string[];
          }
        >
      >
    | undefined;
};

/** What the person gave at registration (auth metadata). Their own words. */
export type OnboardingRegistrationFacts = {
  readonly displayName?: string | null | undefined;
  readonly organisationName?: string | null | undefined;
};

/** Registration facts as known coverage facts. Blank values are not facts. */
export function knownFactsFromRegistration(
  profile: OnboardingCoverageProfile,
  registration: OnboardingRegistrationFacts | null | undefined,
): OnboardingKnownFact[] {
  const out: OnboardingKnownFact[] = [];
  const organisation = registration?.organisationName?.trim() ?? "";
  const field = profile.registrationSeeds?.organisationName;
  if (field !== undefined && organisation.length > 0) {
    out.push({
      fieldKey: field,
      display: organisation.slice(0, 120),
      source: "REGISTRATION",
    });
  }
  return out;
}

/** A fact the platform holds before the journey asks (registration, journey choice, a canonical record). */
export type OnboardingKnownFact = {
  readonly fieldKey: string;
  readonly display: string;
  readonly source: Extract<
    OnboardingCoverageSource,
    "REGISTRATION" | "JOURNEY_CHOICE" | "CANONICAL_RECORD"
  >;
};

/** A code-computed inconsistency over what is on the record (never a model's opinion). */
export type OnboardingCoverageCheck = {
  readonly stepKeys: readonly string[];
  readonly fact: string;
};

export type DeriveOnboardingCoverageInput = {
  readonly profile: OnboardingCoverageProfile;
  readonly definition: Pick<OnboardingDefinitionManifest, "steps">;
  readonly view: OnboardingSessionView;
  readonly known?: readonly OnboardingKnownFact[] | undefined;
  /** Metadata only (types) of documents the session's subject holds. Never contents. */
  readonly documents?: readonly { readonly documentType: string }[] | undefined;
  readonly checks?: readonly OnboardingCoverageCheck[] | undefined;
  /** Field keys whose confirmed change is held for retry, not yet saved. */
  readonly pendingSaves?: readonly string[] | undefined;
  /**
   * The provenance of each step's most recently accepted suggestion (ob2
   * 2026-10-16), so an answer the person accepted is credited to what the
   * suggestion rested on: a fund deck they shared is "from your document",
   * not "Q's suggestion". References only, never contents.
   */
  readonly acceptedSuggestions?:
    | readonly {
        readonly stepKey: string;
        readonly sourceRefs: readonly { readonly sourceType: string }[];
      }[]
    | undefined;
  readonly locale?: string | undefined;
  readonly now: Date;
  /** Labels a value the step's options cannot (e.g. taxonomy ids). */
  readonly labelFor?:
    | ((stepKey: string, value: OnboardingResponseValue) => string | null)
    | undefined;
};

const SETTLED: ReadonlySet<OnboardingCoverageState> = new Set([
  "KNOWN",
  "CONFIRMED_SAVED",
  "EVIDENCE_NEEDED",
]);

const DEFAULT_SECONDS: Record<OnboardingCoveragePriority, number> = {
  ESSENTIAL: 30,
  IMPORTANT: 25,
  OPTIONAL: 20,
};

/** Every step key a branch expression reads. */
export function branchDependencies(
  expression: BranchExpression | null,
): readonly string[] {
  if (expression === null) return [];
  const keys = new Set<string>();
  const walk = (e: BranchExpression): void => {
    switch (e.op) {
      case "EXISTS":
      case "EQUALS":
      case "IN":
      case "CONTAINS":
        keys.add(e.stepKey);
        return;
      case "ALL":
      case "ANY":
        e.expressions.forEach(walk);
        return;
      case "NOT":
        walk(e.expression);
        return;
    }
  };
  walk(expression);
  return [...keys];
}

function optionLabel(
  step: Pick<OnboardingStepManifest, "stepKey" | "configuration">,
  key: string,
): string | undefined {
  const config = step.configuration;
  if ("options" in config) {
    return config.options.find((o) => o.optionKey === key)?.label;
  }
  return undefined;
}

/** A value as a person would read it. Deterministic; no model. */
export function displayOnboardingValue(
  step: Pick<OnboardingStepManifest, "stepKey" | "configuration">,
  value: OnboardingResponseValue,
  labelFor?: DeriveOnboardingCoverageInput["labelFor"],
): string {
  const custom = labelFor?.(step.stepKey, value);
  if (custom !== undefined && custom !== null) return custom.slice(0, 600);
  switch (value.type) {
    case "SINGLE_SELECT":
      return optionLabel(step, value.optionKey) ?? value.optionKey;
    case "MULTI_SELECT":
      return value.optionKeys
        .map((k) => optionLabel(step, k) ?? k)
        .join(", ")
        .slice(0, 600);
    case "RANGE": {
      const unit =
        step.configuration.stepType === "range"
          ? step.configuration.unit
          : undefined;
      return unit === undefined ? value.value : `${value.value} ${unit}`;
    }
    case "TEXT":
      return value.text.length > 600
        ? `${value.text.slice(0, 597)}...`
        : value.text;
    case "CONFIRMATION":
      return value.confirmed ? "Confirmed" : "Not confirmed";
    case "RESOURCE_REFERENCE":
      return `${value.resourceIds.length} selected`;
  }
}

function sourceOfModality(
  modality: OnboardingSourceModality,
): OnboardingCoverageSource {
  switch (modality) {
    case "SELECTION":
    case "TYPED_TEXT":
      return "FORM";
    case "VOICE_TRANSCRIPT":
      return "CONVERSATION";
    case "DOCUMENT_REFERENCE":
      return "DOCUMENT";
    case "SUGGESTION_ACCEPT":
    case "SUGGESTION_EDIT":
      return "Q_RECOMMENDATION";
  }
}

/**
 * Where an answer on the record was given: the channel the client declared
 * (form or conversation) first; the modality only for older answers that
 * carry no channel. Accepted suggestions are Q's recommendation.
 */
function sourceOfResponse(
  response: {
    readonly sourceModality: OnboardingSourceModality;
    readonly channel?: "FORM" | "CONVERSATION" | null | undefined;
  },
  accepted?: readonly { readonly sourceType: string }[],
): OnboardingCoverageSource {
  // An accepted proposal read from the person's own document is credited
  // to that document. An edited one is the person's own value, still
  // reached through Q's suggestion, so it keeps that label.
  if (
    response.sourceModality === "SUGGESTION_ACCEPT" &&
    accepted !== undefined &&
    proposalSource(accepted) === "DOCUMENT"
  ) {
    return "DOCUMENT";
  }
  if (
    response.sourceModality === "SUGGESTION_ACCEPT" ||
    response.sourceModality === "SUGGESTION_EDIT"
  ) {
    return "Q_RECOMMENDATION";
  }
  if (response.channel === "CONVERSATION") return "CONVERSATION";
  if (response.channel === "FORM") return "FORM";
  return sourceOfModality(response.sourceModality);
}

const PUBLIC_SOURCE_TYPES = new Set([
  "PUBLIC_WEBSITE",
  "PUBLIC_PROFILE",
  "PUBLIC_REGISTRY",
  "PUBLIC_WEB",
]);

/**
 * A figure read by code out of the founder's highly confidential financial
 * document (owner decision 2026-10-28). Until the founder confirms it, it is
 * that document's content: shown to the founder only, and never put to a
 * model (a voice or Q conversation does not read it back or accept it).
 */
export const LOCAL_FIGURE_SOURCE = "LOCAL_FIGURE" as const;

export function isLocalFigureProposal(
  refs: readonly { readonly sourceType: string }[],
): boolean {
  return refs.some((r) => r.sourceType === LOCAL_FIGURE_SOURCE);
}

/**
 * Owner 2026-10-28: whether a proposal may be made, or settled, on a
 * session the person already completed. Only a figure read from their own
 * financial document, and only on a step the journey declares revisable
 * (ADR 0024); every other offer still needs an open session, and nobody is
 * sent back into setup to confirm a figure.
 */
export function settledAfterSetup(input: {
  readonly status: string;
  readonly stepKey: string;
  readonly sourceRefs: readonly { readonly sourceType: string }[];
  readonly revisable: ReadonlySet<string> | undefined;
}): boolean {
  return (
    input.status === "COMPLETED" &&
    isLocalFigureProposal(input.sourceRefs) &&
    input.revisable?.has(input.stepKey) === true
  );
}

/** Where a pending suggestion came from, by the references it carries. */
export function proposalSource(
  refs: readonly { readonly sourceType: string }[],
): OnboardingCoverageSource {
  if (refs.some((r) => PUBLIC_SOURCE_TYPES.has(r.sourceType))) {
    return "PUBLIC_RESEARCH";
  }
  // Their deck, or their own pitch video's transcript: their material.
  if (
    refs.some(
      (r) =>
        r.sourceType === "EVIDENCE_DOCUMENT" ||
        r.sourceType === "PITCH_TRANSCRIPT",
    )
  ) {
    return "DOCUMENT";
  }
  if (refs.some((r) => r.sourceType === "Q_RECOMMENDATION")) {
    return "Q_RECOMMENDATION";
  }
  return "CONVERSATION";
}

function evidenceApplies(
  profile: OnboardingCoverageFieldProfile,
  value: OnboardingResponseValue,
): boolean {
  if ((profile.evidenceWanted ?? []).length === 0) return false;
  const exempt = new Set(profile.evidenceNotFor ?? []);
  if (value.type === "SINGLE_SELECT") return !exempt.has(value.optionKey);
  if (value.type === "CONFIRMATION") return value.confirmed;
  return true;
}

/** Derive the coverage of one session. Pure and deterministic. */
export function deriveOnboardingCoverage(
  input: DeriveOnboardingCoverageInput,
): OnboardingCoverage {
  const { profile, view } = input;
  const steps = new Map(input.definition.steps.map((s) => [s.stepKey, s]));
  const eligible = new Map(
    view.progress.eligibleSteps.map((s) => [s.stepKey, s]),
  );
  const responses = new Map(view.responses.map((r) => [r.stepKey, r]));
  const known = new Map((input.known ?? []).map((k) => [k.fieldKey, k]));
  const heldDocTypes = new Set(
    (input.documents ?? []).map((d) => d.documentType),
  );
  const pendingSaves = new Set(input.pendingSaves ?? []);
  const acceptedRefs = new Map(
    (input.acceptedSuggestions ?? []).map((a) => [a.stepKey, a.sourceRefs]),
  );

  const readingsByStep = new Map<string, string[]>();
  for (const question of view.pendingQuestions ?? []) {
    if (question.reason !== "CONTRADICTION") continue;
    const list = readingsByStep.get(question.stepKey) ?? [];
    list.push(
      ...(question.readings.length > 0
        ? question.readings
        : [question.question]),
    );
    readingsByStep.set(question.stepKey, list);
  }
  for (const check of input.checks ?? []) {
    for (const key of check.stepKeys) {
      const list = readingsByStep.get(key) ?? [];
      list.push(check.fact);
      readingsByStep.set(key, list);
    }
  }

  const proposalsByStep = new Map<string, OnboardingCoverageProposal[]>();
  for (const suggestion of view.pendingSuggestions) {
    if (suggestion.status !== "PENDING") continue;
    const step = steps.get(suggestion.stepKey);
    if (step === undefined) continue;
    const list = proposalsByStep.get(suggestion.stepKey) ?? [];
    list.push({
      suggestionId: suggestion.id,
      display: displayOnboardingValue(
        step,
        suggestion.suggestedValue,
        input.labelFor,
      ),
      source: proposalSource(suggestion.sourceRefs),
      sourceRefs: suggestion.sourceRefs.slice(0, 20),
      note: suggestion.rationale ?? null,
    });
    proposalsByStep.set(suggestion.stepKey, list);
  }

  const ordered = input.definition.steps
    .flatMap((step) => {
      const fieldProfile = profile.fields[step.stepKey];
      return fieldProfile === undefined ? [] : [{ step, fieldProfile }];
    })
    .sort((a, b) => a.step.sequenceOrder - b.step.sequenceOrder);

  const fields: OnboardingCoverageField[] = ordered.map(
    ({ step, fieldProfile }) => {
      const progress = eligible.get(step.stepKey);
      const applicable = progress !== undefined;
      const required = step.required;
      const deferrable =
        !required &&
        (fieldProfile.deferrable ?? fieldProfile.priority !== "ESSENTIAL");
      const response = responses.get(step.stepKey);
      const seed = known.get(step.stepKey);
      const proposals = (proposalsByStep.get(step.stepKey) ?? []).slice(0, 8);
      const readings = [...new Set(readingsByStep.get(step.stepKey) ?? [])]
        .slice(0, 6)
        .map((r) => r.slice(0, 400));
      const declined = applicable && progress.status === "SKIPPED";

      let state: OnboardingCoverageState;
      let display: string | null = null;
      let source: OnboardingCoverageSource | null = null;
      let evidenceWanted: string[] = [];

      if (response !== undefined) {
        display = displayOnboardingValue(step, response.value, input.labelFor);
        // Saved is saved: once on the record, the answer is the person's,
        // credited to where they gave it, whatever registration offered.
        source = sourceOfResponse(response, acceptedRefs.get(step.stepKey));
      } else if (seed !== undefined) {
        display = seed.display.slice(0, 600);
        source = seed.source;
      }

      if (!applicable) {
        state = "INAPPLICABLE";
      } else if (readings.length > 0) {
        state = "CONTRADICTORY";
      } else if (response !== undefined) {
        const wanted = fieldProfile.evidenceWanted ?? [];
        const supported = wanted.some((t) => heldDocTypes.has(t));
        if (!supported && evidenceApplies(fieldProfile, response.value)) {
          state = "EVIDENCE_NEEDED";
          evidenceWanted = [...wanted].slice(0, 8);
        } else {
          state = "CONFIRMED_SAVED";
        }
      } else if (
        (fieldProfile.satisfiedByDocuments ?? []).some((t) =>
          heldDocTypes.has(t),
        )
      ) {
        state = "CONFIRMED_SAVED";
        display = "Uploaded";
        source = "DOCUMENT";
      } else if (declined) {
        state = "DEFERRABLE";
      } else if (seed !== undefined) {
        state = "KNOWN";
      } else if (proposals.length > 0) {
        state = "SUPPLIED_UNCONFIRMED";
      } else if (deferrable) {
        state = "DEFERRABLE";
      } else {
        state = "MISSING";
      }

      return {
        fieldKey: step.stepKey,
        concept: fieldProfile.concept,
        label: (fieldProfile.label ?? step.configuration.prompt).slice(0, 160),
        phaseKey: step.configuration.phaseKey ?? null,
        state,
        priority: fieldProfile.priority,
        required,
        applicable,
        deferrable,
        declined,
        display,
        source,
        proposals: state === "INAPPLICABLE" ? [] : proposals,
        readings,
        evidenceWanted,
        savePending: pendingSaves.has(step.stepKey),
        dependsOn: branchDependencies(step.branching).slice(0, 8),
        ...(fieldProfile.rank === undefined ? {} : { rank: fieldProfile.rank }),
        ...(fieldProfile.askable === false ? { askable: false } : {}),
      };
    },
  );

  for (const [fieldKey, doc] of Object.entries(profile.documentFields ?? {})) {
    const held = doc.documentTypes.some((t) => heldDocTypes.has(t));
    fields.push({
      fieldKey,
      concept: doc.concept,
      label: doc.label.slice(0, 160),
      phaseKey: null,
      state: held ? "CONFIRMED_SAVED" : "DEFERRABLE",
      priority: doc.priority,
      required: false,
      applicable: true,
      deferrable: true,
      declined: false,
      display: held ? "Uploaded" : null,
      source: held ? "DOCUMENT" : null,
      proposals: [],
      readings: [],
      evidenceWanted: [],
      savePending: false,
      dependsOn: [],
    });
  }

  const applicableFields = fields.filter((f) => f.applicable);
  const count = (pred: (f: OnboardingCoverageField) => boolean) =>
    applicableFields.filter(pred).length;
  const essential = applicableFields.filter(
    (f) => f.priority === "ESSENTIAL" || f.required,
  );
  const contradictory = count((f) => f.state === "CONTRADICTORY");
  const pending = count((f) => f.savePending);
  const secondsLeft = applicableFields
    .filter(
      (f) =>
        !f.savePending &&
        (f.state === "MISSING" ||
          f.state === "CONTRADICTORY" ||
          f.state === "SUPPLIED_UNCONFIRMED"),
    )
    .reduce((total, f) => {
      const own = profile.fields[f.fieldKey]?.seconds;
      // A confirmation is quicker than an answer.
      const seconds =
        f.state === "SUPPLIED_UNCONFIRMED"
          ? 8
          : (own ?? DEFAULT_SECONDS[f.priority]);
      return total + seconds;
    }, 0);

  const coverage: OnboardingCoverage = {
    sessionId: view.session.id,
    journeyType: view.session.journeyType,
    definitionVersion: view.session.definitionVersion,
    profileVersion: profile.version,
    locale: input.locale ?? "en",
    fields,
    summary: {
      applicable: applicableFields.length,
      settled: count((f) => SETTLED.has(f.state)),
      essentialTotal: essential.length,
      essentialSettled: essential.filter((f) => SETTLED.has(f.state)).length,
      unconfirmed: count((f) => f.state === "SUPPLIED_UNCONFIRMED"),
      contradictory,
      missing: count((f) => f.state === "MISSING"),
      deferrable: count((f) => f.state === "DEFERRABLE"),
      evidenceNeeded: count((f) => f.state === "EVIDENCE_NEEDED"),
      pendingSaves: pending,
      canComplete:
        view.progress.canComplete && contradictory === 0 && pending === 0,
      minutesLeft: Math.ceil(secondsLeft / 60),
    },
    next: [],
    computedAt: input.now.toISOString(),
  };
  const withNext = { ...coverage, next: selectNextFields(coverage) };
  return OnboardingCoverageSchema.parse(withNext);
}

const PRIORITY_RANK: Record<OnboardingCoveragePriority, number> = {
  ESSENTIAL: 0,
  IMPORTANT: 1,
  OPTIONAL: 2,
};

/**
 * What to ask next, from coverage alone (directive: essentials first, defer
 * optional, never re-ask what is known). Contradictions first; then, tier by
 * tier, a grouped confirmation of what is already on offer before asking
 * afresh; evidence after every essential is settled; one optional offer
 * only when nothing else is open. Never a field that is settled, held for
 * retry, set aside, or off the path.
 */
export function selectNextFields(
  coverage: Pick<OnboardingCoverage, "fields">,
  max = 3,
): OnboardingNextField[] {
  // Most valuable first within a tier: the journey's rank, then its order.
  const open = coverage.fields
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => f.applicable && !f.savePending)
    .sort((a, b) => (a.f.rank ?? 500) - (b.f.rank ?? 500) || a.index - b.index)
    .map(({ f }) => f);
  const out: OnboardingNextField[] = [];
  const push = (
    f: OnboardingCoverageField,
    reason: OnboardingNextField["reason"],
  ) => {
    if (out.length < max && !out.some((o) => o.fieldKey === f.fieldKey)) {
      out.push({ fieldKey: f.fieldKey, reason });
    }
  };
  const tierOf = (f: OnboardingCoverageField) =>
    f.required ? 0 : PRIORITY_RANK[f.priority];

  for (const f of open)
    if (f.state === "CONTRADICTORY") push(f, "CONTRADICTION");
  for (const tier of [0, 1]) {
    for (const f of open) {
      if (tierOf(f) === tier && f.state === "SUPPLIED_UNCONFIRMED") {
        push(f, "CONFIRM_PROPOSAL");
      }
    }
    for (const f of open) {
      if (tierOf(f) === tier && f.state === "MISSING" && f.askable !== false) {
        push(f, tier === 0 ? "ESSENTIAL_MISSING" : "IMPORTANT_MISSING");
      }
    }
  }
  const essentialsOpen = open.some(
    (f) =>
      tierOf(f) === 0 &&
      (f.state === "MISSING" ||
        f.state === "SUPPLIED_UNCONFIRMED" ||
        f.state === "CONTRADICTORY"),
  );
  if (!essentialsOpen) {
    for (const f of open)
      if (f.state === "EVIDENCE_NEEDED") push(f, "EVIDENCE_NEEDED");
  }
  if (out.length === 0) {
    for (const f of open) {
      if (f.state === "SUPPLIED_UNCONFIRMED") push(f, "CONFIRM_PROPOSAL");
    }
    const offer = open
      .filter(
        (f) => f.state === "DEFERRABLE" && !f.declined && f.askable !== false,
      )
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])[0];
    if (offer !== undefined) push(offer, "OPTIONAL_OFFER");
  }
  return out;
}
