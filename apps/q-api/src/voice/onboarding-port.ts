import {
  findTaxonomyCandidates,
  getOnboardingSession,
  getTaxonomyNode,
  listInvestorMandates,
  listOnboardingInterviewTurnSteps,
  listTaxonomyNodes,
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
  FOUNDER_STEPS,
  FOUNDER_UTTERANCE_ALIASES,
  founderRecordChecks,
} from "@capital-q/founder-onboarding";
import {
  INVESTOR_CONCEPT_FAMILIES,
  INVESTOR_COVERAGE_PROFILE,
  INVESTOR_STEPS,
  INVESTOR_UTTERANCE_ALIASES,
  investorPlausibility,
  NOT_SURE_OPTION_KEY,
} from "@capital-q/investor-onboarding";
import {
  deriveOnboardingCoverage,
  isLocalFigureProposal,
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
import { countryOfNodeId } from "@capital-q/taxonomy/countries";
import type { Logger } from "@capital-q/observability";
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
  EXCLUSION_MEANING_REASON,
  EXCLUSION_SIBLINGS,
  exclusionMeaningUnsettled,
  asciiDigits,
  definitionFor,
  describeValue,
  documentFindingsIn,
  optionsOf,
  readRefusal,
  recordedCurrency,
  SCALE_WORDS,
  spokenFiguresIn,
  toOpenStep,
  toResponseValue,
  MONEY_STEP,
  wholeWordsWithin,
} from "./interview-steps.js";
import {
  REVIEW_NOT_SHOWN_REASON,
  STILL_SAVING_FINISH_REASON,
} from "./onboarding-flow.js";
import {
  writeSession,
  type SessionWrite,
  type SessionWriteContext,
} from "./session-writes.js";
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
  "NOT saved yet; saved automatically once their firm or company is set up (investor: firm name and how they invest; founder: company name). Nothing is lost; do not ask it again. Say it will be saved once that is in, never that it is saved, kept or set up; never mention 'context'. Ask for whichever of those is still missing.";

/**
 * What Q is told about an answer held because its save failed for a reason
 * no answer explains (live 2026-10-28: "Your cheque range is kept" for a
 * change that was only queued). The confirmation is for committed writes.
 */
const STILL_SAVING_REASON =
  'Not saved yet: it is still being saved and is confirmed next turn; nothing is lost. Say it is still saving ("saving…"), never that it is saved or kept, do not ask it again, and carry on.';

/**
 * The review steps that read the whole record back for their yes (the
 * company snapshot, the mandate review): confirmed only once shown.
 */
const RECORD_REVIEWS: ReadonlySet<string> = new Set([
  // Production re-test 2026-10-28: the company review and the raise
  // confirmation were confirmed on "that's all" before anything was read
  // back; every review the person confirms is shown first.
  FOUNDER_STEPS.review,
  FOUNDER_STEPS.raiseConfirm,
  FOUNDER_STEPS.snapshot,
  INVESTOR_STEPS.review,
]);

/**
 * Choices that describe how someone works, not things they list by name:
 * no option's label is the words people use for it, so the reading's
 * choice is never cut back to the options whose labels their words repeat
 * (live 2026-10-28: "we like to lead sometimes but mostly follow" was
 * saved as lead only; following a lead is "Co-invest alongside a lead").
 */
const MEANING_ONLY_CHOICES: ReadonlySet<string> = new Set([
  INVESTOR_STEPS.investmentRole,
]);

/**
 * Steps the journey saves only as one of their options, because it sets
 * the person up from the option key (`bootstrapInvestor` reads how they
 * invest to create the firm). Their words outside the options are never
 * kept as the answer here: nothing would be set up, and every other
 * answer would wait on it (live 2026-10-28).
 */
const OPTION_ONLY_STEPS: ReadonlySet<string> = new Set([
  INVESTOR_STEPS.investorType,
  INVESTOR_STEPS.currency,
  FOUNDER_STEPS.currency,
]);

/**
 * Money currency steps (live 2026-10-28, Tiara: "I do the dollars and
 * pounds" was saved as her sentence, so the mandate got no currency and
 * no cheque). The mandate holds one currency for its cheque amounts. When
 * they name more than one, the first named is kept as the answer and the
 * others are noted beside it for Q to ask which is their main one; their
 * sentence is never the answer.
 */
const FIRST_NAMED_KEPT_STEPS: ReadonlySet<string> = new Set([
  INVESTOR_STEPS.currency,
  FOUNDER_STEPS.currency,
]);

/** How the note that settles a check on the record begins. */
const SETTLED_NOTE = "They confirmed this is right";

/**
 * Their own words kept beside a list of options or categories (live check
 * 2026-10-31, "Halvmåne": "consumer apps" beside Gambling and Speculative
 * crypto was kept but never said in the read-back): shown with the list.
 */
function theirWordsBesideList(
  value: OnboardingResponseValue,
  note: string | null | undefined,
): boolean {
  return (
    (value.type === "MULTI_SELECT" || value.type === "RESOURCE_REFERENCE") &&
    note !== null &&
    note !== undefined &&
    note.trim().length > 0 &&
    !note.startsWith(SETTLED_NOTE) &&
    !note.startsWith(ALSO_NAMED_NOTE) &&
    !note.startsWith(READ_AS_NOTE)
  );
}

/** How their own words kept beside a list are shown with it. */
export const ALSO_SAID_NOTE = "Also said:";

/** How a note of options also named on a one-choice step begins. */
export const ALSO_NAMED_NOTE = "Also named:";

/**
 * How a note begins that says how their words were read into categories
 * the list has (sweep D2, 2026-10-29: "Benelux" as the Netherlands): the
 * read-back shows it beside the categories, so they can correct it.
 */
export const READ_AS_NOTE = "Read as:";

/** The most categories one reading of a field's whole list is offered. */
const WHOLE_VOCABULARY_MAX = 80;
/**
 * The most categories a field may have for its whole list to be read, in
 * parts of at most WHOLE_VOCABULARY_MAX (live recheck 2026-10-30: the
 * geography list grew to every country, 270 entries).
 */
const WHOLE_LIST_NODES_MAX = 400;
/** The most parts one whole list is read in (one bounded reading each). */
const WHOLE_LIST_PARTS_MAX = 5;

/**
 * Steps whose answer is one country, chosen from the geography taxonomy
 * (founder v8 F1.country): a region is never offered or saved for them,
 * and the canonical country list says which nodes are countries.
 */
const COUNTRY_ONLY_STEPS: ReadonlySet<string> = new Set([
  FOUNDER_STEPS.country,
]);

/** A lookup's candidates that are countries; a region dropped is no exact match. */
function onlyCountries(
  found: TaxonomyCandidateResponse,
): TaxonomyCandidateResponse {
  const candidates = found.candidates.filter(
    (candidate) => countryOfNodeId(candidate.nodeId) !== null,
  );
  return candidates.length === found.candidates.length
    ? found
    : { ...found, resolution: "CANDIDATES", candidates };
}

/** A category as the reader is offered it. */
export type WholeListCandidate = {
  readonly nodeId: string;
  readonly displayName: string;
  readonly vocabularyCode: string;
};

/**
 * A field's whole list in parts the reader is offered one at a time, each
 * holding whole branches of the hierarchy (a region with every country in
 * it), so words naming a group the list lacks ("Benelux") are read against
 * a part that holds all of the group's members. A list that fits one part
 * is one part, as before. Null: a branch alone is larger than one part, or
 * the list needs more parts than allowed (it is not offered).
 */
export function wholeListParts(
  nodes: readonly (WholeListCandidate & {
    readonly parentNodeId: string | null;
  })[],
  max: number = WHOLE_VOCABULARY_MAX,
  partsMax: number = WHOLE_LIST_PARTS_MAX,
): readonly (readonly WholeListCandidate[])[] | null {
  const plain = (node: WholeListCandidate): WholeListCandidate => ({
    nodeId: node.nodeId,
    displayName: node.displayName,
    vocabularyCode: node.vocabularyCode,
  });
  if (nodes.length === 0) return null;
  if (nodes.length <= max) return [nodes.map(plain)];
  const ids = new Set(nodes.map((node) => node.nodeId));
  const children = new Map<string, (typeof nodes)[number][]>();
  const roots: (typeof nodes)[number][] = [];
  for (const node of nodes) {
    // A node whose parent is not listed starts a branch of its own.
    if (node.parentNodeId === null || !ids.has(node.parentNodeId)) {
      roots.push(node);
      continue;
    }
    const list = children.get(node.parentNodeId) ?? [];
    list.push(node);
    children.set(node.parentNodeId, list);
  }
  const branchOf = (root: (typeof nodes)[number]): WholeListCandidate[] => {
    const out: WholeListCandidate[] = [];
    const visit = (node: (typeof nodes)[number]) => {
      out.push(plain(node));
      for (const child of children.get(node.nodeId) ?? []) visit(child);
    };
    visit(root);
    return out;
  };
  const branches = roots.map(branchOf);
  if (branches.some((branch) => branch.length > max)) return null;
  // Largest branches first, each into the first part with room for it.
  const parts: WholeListCandidate[][] = [];
  for (const branch of [...branches].sort((a, b) => b.length - a.length)) {
    const part = parts.find((p) => p.length + branch.length <= max);
    if (part === undefined) parts.push([...branch]);
    else part.push(...branch);
  }
  return parts.length > partsMax ? null : parts;
}

/**
 * Reference names that take "the" in a sentence ("the Netherlands", "the
 * Nordics"). Capital Q's own reference data, never a person's words.
 */
const THE_NAMES: ReadonlySet<string> = new Set([
  "Bahamas",
  "Caribbean",
  "Comoros",
  "Gambia",
  "Gulf (GCC)",
  "Maldives",
  "Middle East",
  "Netherlands",
  "Nordics",
  "Philippines",
  "Seychelles",
]);
const THE_WORDS =
  /\b(?:Republic|Kingdom|States|Emirates|Islands|Territories)\b/u;

/**
 * The saved categories as a person would say them, built from the saved
 * nodes themselves (final check 2026-10-30: "Read as: “Benelux” as
 * Belgium, Luxembourg, Netherlands, Nordics."). A category that holds
 * others is named as a region, so nobody reads "Nordics" as a country:
 * "Belgium, Luxembourg, the Netherlands and the Nordics region".
 */
export function savedPlacesInWords(
  nodes: readonly { readonly displayName: string; readonly group: boolean }[],
): string {
  const words = nodes.map(({ displayName, group }) => {
    const the =
      !/^the\s/iu.test(displayName) &&
      (THE_NAMES.has(displayName) || THE_WORDS.test(displayName))
        ? "the "
        : "";
    return `${the}${displayName}${group ? " region" : ""}`;
  });
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The note kept beside the first-named option, saying what to ask. */
export function alsoNamedNote(labels: readonly string[]): string {
  return `${ALSO_NAMED_NOTE} ${labels.join(", ")}. Only one is kept here, the first they named; ask which is their main one.`.slice(
    0,
    400,
  );
}

/**
 * What the loop is told when it tries to fill an upload step with words.
 * It answers the loop's real question (what now?) so it stops retrying:
 * nothing is wrong, nothing more is needed this turn.
 */
export const UPLOAD_ONLY_REASON =
  "Nothing to record here, and nothing went wrong: this step is filled only by an upload. What they said they have is noted for this conversation. Do not record this step again; say once that they can add it with the upload button whenever they like (for a founder with no deck, offer to make one), then move on.";

/**
 * The same refusal once their material is in (live 25 Oct, run b9-0746):
 * "I've just uploaded the deck" read as stating the upload step, the write
 * was refused with "they can add it with the upload button", and Q told
 * them the deck had not been read while its 15 facts waited on screen.
 */
export function uploadReadReason(findings: number): string {
  return `Nothing to record here, and nothing went wrong: their upload already fills this step, and ${String(findings)} ${findings === 1 ? "fact" : "facts"} read from their material ${findings === 1 ? "waits" : "wait"} on screen for their confirmation. Do not record this step again. Never say it has not been read and never point them to the upload button: read back what was found and ask them to confirm it.`;
}

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
  /**
   * The held changes themselves, oldest first: a correction to one is
   * written after it, so the record keeps both versions (production
   * re-test 2026-10-28: 25000 corrected to 50000 left no history).
   */
  readonly pendingValues?:
    | (() => Promise<
        readonly {
          readonly stepKey: string;
          readonly value: unknown;
          readonly note?: string | undefined;
        }[]
      >)
    | undefined;
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
  /**
   * The step Q's latest kept line asked, if any: the one the person is
   * answering. A finding for it waits until their words are read.
   */
  readonly askingStep?: (() => Promise<string | null>) | undefined;
};

/** Notes joined, each piece once (pieces are split on ";"). */
function joinedNotes(
  ...all: (string | null | undefined)[]
): string | undefined {
  const pieces = all
    .flatMap((n) => (n ?? "").split(/\s*;\s*/u))
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  const kept = pieces.filter(
    (piece, index) =>
      pieces.findIndex((p) => p.toLowerCase() === piece.toLowerCase()) ===
      index,
  );
  return kept.length === 0 ? undefined : kept.join("; ").slice(0, 500);
}

/** One value, whatever order a list was given in. */
/**
 * A list answer added to what is on the record (owner 2026-10-28): the
 * recorded items first, then the new ones; their other words likewise.
 * Null when the two are not lists of the same kind (nothing to add to).
 */
export function addedTo(
  onRecord: {
    readonly value: OnboardingResponseValue;
    readonly note?: string | null;
  },
  value: OnboardingResponseValue,
  note: string | undefined,
): {
  readonly value: OnboardingResponseValue;
  readonly note: string | undefined;
} | null {
  const notes = joinedNotes;
  if (onRecord.value.type === "MULTI_SELECT" && value.type === "MULTI_SELECT") {
    return {
      value: {
        ...value,
        optionKeys: [
          ...new Set([...onRecord.value.optionKeys, ...value.optionKeys]),
        ],
      },
      note: notes(onRecord.note, note),
    };
  }
  // Words never replace a list on the record (production re-test
  // 2026-10-28): the list stays, their words beside it.
  if (
    (onRecord.value.type === "MULTI_SELECT" ||
      onRecord.value.type === "RESOURCE_REFERENCE") &&
    value.type === "TEXT"
  ) {
    return {
      value: onRecord.value,
      note: notes(onRecord.note, note, value.text.slice(0, 200)),
    };
  }
  if (
    onRecord.value.type === "RESOURCE_REFERENCE" &&
    value.type === "RESOURCE_REFERENCE"
  ) {
    return {
      value: {
        ...value,
        resourceIds: [
          ...new Set([...onRecord.value.resourceIds, ...value.resourceIds]),
        ],
      },
      note: notes(onRecord.note, note),
    };
  }
  return null;
}

/** A list step's value as on the record or planned, with its note. */
type OnRecordList = {
  readonly value: OnboardingResponseValue;
  readonly note?: string | undefined;
};

/** A step that holds several values: a many-of list, or categories. */
function holdsMany(step: OnboardingStepManifest): boolean {
  const c = step.configuration;
  return (
    (c.stepType === "multi_select" && c.maxSelections > 1) ||
    (c.stepType === "reference_select" && c.maxItems > 1)
  );
}

/**
 * Several values for one list step as one: every item and every note
 * kept (lists first, so words said beside a list join its note). Null
 * when they cannot be one value (different kinds of list).
 */
export function mergeListValues(
  values: readonly OnRecordList[],
): OnRecordList | null {
  const isList = (value: OnboardingResponseValue) =>
    value.type === "MULTI_SELECT" || value.type === "RESOURCE_REFERENCE";
  const ordered = [...values].sort(
    (a, b) => Number(isList(b.value)) - Number(isList(a.value)),
  );
  const [head, ...rest] = ordered;
  if (head === undefined) return null;
  let merged: OnRecordList = head;
  for (const next of rest) {
    if (merged.value.type === "TEXT" && next.value.type === "TEXT") {
      const pieces = [merged.value.text, next.value.text].map((t) => t.trim());
      merged = {
        value: {
          ...merged.value,
          text: [...new Set(pieces.filter((t) => t.length > 0))]
            .join("; ")
            .slice(0, 2000),
        },
        note: joinedNotes(merged.note, next.note),
      };
      continue;
    }
    const added = addedTo(
      { value: merged.value, note: merged.note ?? null },
      next.value,
      next.note,
    );
    if (added === null) return null;
    merged = added;
  }
  return merged;
}

export function sameValue(
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
        /** Read from their own uploaded document (a deck read-back). */
        readonly fromDocument: boolean;
      }[]
    >;
    /**
     * Q's held summaries the person just agreed to: pending since before
     * this turn, said back in Q's last turn, and affirmed by their latest
     * words. Code accepts these without waiting on a model.
     */
    readonly affirmedParaphrases: () => Promise<ReadonlySet<string>>;
    /**
     * Values Q inferred from their words (the reading's `source`, live
     * re-check 2026-10-31: "we write cheques of EUR 750k to 3 million"
     * saved as "actively investing"): each held as a suggestion for their
     * yes, never written. CLAUDE.md: material Q-extracted facts require
     * confirmation before they are authoritative.
     */
    readonly holdInferred: (
      answers: readonly {
        readonly stepKey: string;
        readonly value: string | readonly string[] | number | boolean;
        readonly quote: string;
        readonly ownWords?: boolean | undefined;
      }[],
    ) => Promise<readonly OnboardingRecordResult[]>;
    /**
     * A needed step they said they do not know (live re-check 2026-10-31):
     * recorded as not known (NOT_KNOWN_TEXT), never their sentence and
     * never a value read into it, and still answerable later. Optional
     * steps are set aside instead (setAside).
     */
    readonly recordNotKnown: (
      items: readonly { readonly stepKey: string; readonly quote: string }[],
    ) => Promise<readonly OnboardingRecordResult[]>;
  };

/**
 * What a needed step holds when they said they do not know and it has no
 * "Not sure yet" option of its own (investor v3 gave the deployment status
 * one, 2026-10-31): the same words the discovery style kept live
 * ("Discovery style · I don't know"), so the read-back says it plainly and
 * a later answer replaces it.
 */
export const NOT_KNOWN_TEXT = "I don't know";

/** Text compared for "already says this": case, quotes and spacing aside. */
function normalisedText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[‘’“”"']/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Their words kept beside the categories that matched (a category answer
 * with a note): reported as such, so nothing claims them as a category.
 */
function keptInWordsOf(
  value: OnboardingResponseValue,
  note: string | undefined,
): { keptInWords?: string[] } {
  if (value.type !== "RESOURCE_REFERENCE" || note === undefined) return {};
  const words = note
    .split(/;\s*/u)
    .map((w) => w.trim().slice(0, 200))
    .filter((w) => w.length > 0)
    .slice(0, 8);
  return words.length === 0 ? {} : { keptInWords: words };
}

/** Whether the mandate step is open and unanswered on an investor's session. */
export function mandateStepOpen(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
): boolean {
  if (journeyType !== "investor") return false;
  const subject = view.session.subject;
  const open = view.progress.eligibleSteps.find(
    (e) => e.stepKey === INVESTOR_STEPS.mandateContext,
  );
  return (
    subject !== null &&
    subject.type === "INVESTOR_ORGANISATION" &&
    open !== undefined &&
    open.status !== "COMPLETED" &&
    open.status !== "SKIPPED" &&
    !view.responses.some((r) => r.stepKey === INVESTOR_STEPS.mandateContext)
  );
}

/**
 * The mandate being defined, recorded whenever its step is open, not only
 * while the session's cursor is on it (QA 25 Oct: the conversation moved
 * the cursor past it, the step stayed open, and a session whose mandate
 * was already live could never complete: in production no investor
 * session has completed without it). Every path that reads the session
 * for Q settles it: a turn's port, and the resume line. The same rule the
 * step's own context applies (`preselectedMandate`), under the person's
 * own token; anything less certain is left for their choice. Any failure
 * leaves the view as it was.
 */
export async function settleMandateStep(
  session: ApiSession,
  onboardingSessionId: string,
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
): Promise<OnboardingSessionView> {
  const subject = view.session.subject;
  if (!mandateStepOpen(view, journeyType) || subject === null) return view;
  try {
    const page = await listInvestorMandates(session, subject.id, {
      limit: 50,
    });
    const mandateId = preselectedMandate(page.items);
    if (mandateId === null) return view;
    return await writeSession(
      {
        session,
        onboardingSessionId,
        version: () => Promise.resolve(view.session.version),
      },
      {
        kind: "SUBMIT",
        request: {
          stepKey: INVESTOR_STEPS.mandateContext,
          response: {
            value: {
              type: "RESOURCE_REFERENCE",
              resourceType: "INVESTOR_MANDATE",
              resourceIds: [mandateId],
            },
            channel: "CONVERSATION",
          },
        },
      },
    );
  } catch {
    return view;
  }
}

/**
 * The one mandate the journey may choose for the investor, as the mandate
 * step's own context does: their only open mandate, or their only draft.
 * Never "the first one"; anything else is their choice. Null: theirs.
 */
export function preselectedMandate(
  mandates: readonly { readonly id: string; readonly status: string }[],
): string | null {
  const open = mandates.filter((m) => m.status !== "CLOSED");
  if (open.length === 1) return open[0]?.id ?? null;
  const drafts = open.filter((m) => m.status === "DRAFT");
  return drafts.length === 1 ? (drafts[0]?.id ?? null) : null;
}

/**
 * A step that points at a platform record (the mandate being defined), not
 * a vocabulary: the journey's to settle, never a question for the person
 * (live 2026-10-16; QA 25 Oct: asked again on return after "Looks right").
 */
export function isPlatformReference(step: OnboardingStepManifest): boolean {
  return (
    step.configuration.stepType === "reference_select" &&
    step.configuration.resourceType !== "TAXONOMY_NODE"
  );
}

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
  /**
   * Where a failure on the save or reading path is reported with its
   * reason (live recheck 2026-10-30: failures hidden by catch-all handlers
   * were invisible). Absent: not reported.
   */
  readonly logger?: Pick<Logger, "info" | "warn"> | undefined;
  /**
   * One closed question about their words, read by meaning (J7). Absent:
   * nothing is read, and lists they gave before are kept (QO-27).
   */
  readonly wordsCheck?:
    | ((
        question: string,
        words: string,
      ) => Promise<"YES" | "NO" | "UNSURE" | null>)
    | undefined;
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
   * A whole-conversation reading (live 2026-10-30, Granary): the Q line
   * the person was answering when they said the words a quote is from,
   * so a summary Q said back there and they agreed to is theirs however
   * long ago the reading caught up with it. Absent: only `lastQTurn`.
   */
  readonly qLineBefore?: ((quote: string) => string | undefined) | undefined;
  /**
   * When the person said the words a quote is from (ISO), so a re-reading
   * of the same words keeps the summary already held for their yes rather
   * than replacing it with a newly worded one (live 2026-10-30: every
   * reading re-held five summaries, expiring the ones on screen, and the
   * person's Keep came back 409). Absent: a hold always replaces.
   */
  readonly saidAt?: ((quote: string) => string | undefined) | undefined;
  /**
   * The conversation-first path (owner 2026-10-17, re-agreed 2026-10-30):
   * a narrative answer (what the company does, how it makes money) is
   * saved only as Q's summary that Q said back in the conversation and
   * they agreed to; never their raw words written straight in, however
   * close the reading's cut of them is. Absent: their own words may be
   * written directly (the guided interview, which reads back itself).
   */
  readonly narrativeFromReadBackOnly?: boolean | undefined;
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
        /** A question beyond their setup they asked, read by meaning. */
        readonly lookup?: string | null;
        /** They want to stop for now and come back later. */
        readonly pausing?: boolean;
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
  /**
   * List steps whose new answer adds to what is on the record rather than
   * replacing it: the transcript reading found no sign they meant it as
   * the whole list. Absent: an answer replaces, as a typed one does.
   */
  readonly addsTo?: ReadonlySet<string> | undefined;
  /**
   * List steps whose new answer the transcript reading found to be the
   * whole list (its `replaces`): what is on the record is not kept beside
   * it, whatever a check of the words alone would say.
   */
  readonly replaces?: ReadonlySet<string> | undefined;
  /**
   * Steps whose answer only agrees to what Q offered (the transcript
   * reading's `affirms`): saved as the value Q offered, or not at all;
   * never with the person's agreeing words as its text or note.
   */
  readonly affirmed?: ReadonlySet<string> | undefined;
  /**
   * A category word the taxonomy lookup found ambiguous, chosen among the
   * lookup's own candidates by meaning (TAXONOMY_MAPPING). Null or empty:
   * their word is kept in their words, as before. Absent: likewise.
   */
  readonly chooseCategories?:
    | ((choice: {
        readonly field: string;
        readonly phrase: string;
        readonly sentence: string;
        readonly candidates: readonly {
          readonly nodeId: string;
          readonly displayName: string;
          readonly vocabularyCode: string;
        }[];
      }) => Promise<readonly string[] | null>)
    | undefined;
  /**
   * Whether the person has been shown what this review step confirms (Q
   * asked it, or read back the whole record). A review is confirmed only
   * after its read-back was shown (production re-test 2026-10-28: the
   * company snapshot was confirmed in the same second as the raise, never
   * shown). Absent: every review counts as shown, as before.
   */
  readonly reviewShown?: ((stepKey: string) => boolean) | undefined;
}): BoundOnboardingPort {
  /**
   * A failure on a save or reading path, reported with its reason (live
   * recheck 2026-10-30: a reading that failed behind a catch-all left no
   * trace). The caller goes on with `fallback`, which never claims a save.
   */
  const reported =
    <T>(what: string, fallback: T) =>
    (error: unknown): T => {
      input.logger?.warn(
        { err: error, onboardingSessionId: input.onboardingSessionId, what },
        "onboarding step failed; went on without it",
      );
      return fallback;
    };
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
  /** QO-25: the steps that hold their role now, and the reading of it. */
  const ROLE_NOW_STEPS: ReadonlySet<string> = new Set([
    FOUNDER_STEPS.founderRole,
    INVESTOR_STEPS.businessTitle,
  ]);
  const ROLE_NOW_QUESTION =
    "Do these words state the person's role today, in their own current company or firm (not a past job)?";
  /** QO-27: whether their words replace a list they gave before; null: unread. */
  const REPLACES_QUESTION =
    "Do these words replace what they said before for this (a correction such as 'not X, Y' or 'only Y'), rather than add to it?";
  const replacesEarlier = async (
    quote: string,
  ): Promise<"YES" | "NO" | "UNSURE" | null> =>
    quote.trim().length === 0 || input.wordsCheck === undefined
      ? null
      : input
          .wordsCheck(REPLACES_QUESTION, quote)
          .catch(reported("replaces check", null));
  /** The steps this turn's answers are for, so a sibling in it counts. */
  const turnSteps = new Set<string>();
  /**
   * Another step of the same concept family already answered, or answered
   * in this turn: the concept is held there (one concept, one answer).
   */
  const familySiblingAnswered = (
    stepKey: string,
    view: OnboardingSessionView,
  ): string | undefined => {
    const families =
      input.journeyType === "investor" ? INVESTOR_CONCEPT_FAMILIES : [];
    const family = families.find((f) => f.stepKeys.includes(stepKey));
    return family?.stepKeys.find(
      (key) =>
        key !== stepKey &&
        (turnSteps.has(key) ||
          view.responses.some((response) => response.stepKey === key)),
    );
  };
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
    .catch(reported("held writes read", []));
  /**
   * A reading from their own document that Q's last turn read back to
   * them word for word (QA F-134, 25 Oct): their plain yes to it is their
   * approval of exactly what they heard, as for Q's summary of their
   * words. A reading Q did not say back is not theirs to approve.
   */
  const readBackHeard = async (
    step: OnboardingStepManifest,
    held: {
      readonly value: OnboardingResponseValue;
      readonly fromDocument?: boolean | undefined;
    },
  ): Promise<boolean> =>
    held.fromDocument === true &&
    heardBack(await spoken(step, held.value, await current()), input.lastQTurn);
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
   * The mandate being defined, recorded whenever its step is open
   * (`settleMandateStep`). Once per port: a list that names no single
   * mandate is not read again this turn.
   */
  let mandateLooked = false;
  const settleMandate = async (
    view: OnboardingSessionView,
  ): Promise<OnboardingSessionView> => {
    if (mandateLooked || !mandateStepOpen(view, input.journeyType)) {
      return view;
    }
    mandateLooked = true;
    return settleMandateStep(
      input.session,
      input.onboardingSessionId,
      view,
      input.journeyType,
    );
  };

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
    if (step === null || step === undefined) return settleMandate(view);
    if (step.presentation.stepType !== "reference_select") {
      return settleMandate(view);
    }
    const resourceType = step.presentation.resourceType;
    if (resourceType === "TAXONOMY_NODE") return settleMandate(view);
    const suggested = step.context?.["suggestedMandateId"];
    if (typeof suggested !== "string" || suggested.length === 0) return view;
    try {
      return await sessionWrite(
        {
          kind: "SUBMIT",
          request: {
            stepKey: step.stepKey,
            response: {
              value: {
                type: "RESOURCE_REFERENCE",
                resourceType,
                resourceIds: [suggested],
              },
              channel: "CONVERSATION",
            },
          },
        },
        { version: () => Promise.resolve(view.session.version) },
      );
    } catch (caught: unknown) {
      reported("mandate preselection", undefined)(caught);
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
  /**
   * A field's whole category list (geography), by vocabulary codes, for
   * words the lookup found nothing for, in parts of whole branches (see
   * wholeListParts); null when it is too large to offer, or could not be
   * read.
   */
  /** Listed categories that hold others (a region): said as one. */
  const groupNodeIds = new Set<string>();
  const wholeLists = new Map<
    string,
    Promise<readonly (readonly WholeListCandidate[])[] | null>
  >();
  const wholeVocabulary = (codes: readonly string[]) => {
    const key = [...codes].sort().join(",");
    const cached = wholeLists.get(key);
    if (cached !== undefined) return cached;
    const loading = (async () => {
      const nodes: (WholeListCandidate & {
        readonly parentNodeId: string | null;
      })[] = [];
      for (const code of codes) {
        let cursor: string | undefined;
        do {
          const page = await listTaxonomyNodes(input.session, code, {
            limit: 100,
            ...(cursor === undefined ? {} : { cursor }),
          });
          for (const node of page.items) {
            nodes.push({
              nodeId: node.id,
              displayName: node.displayName,
              vocabularyCode: node.vocabularyCode,
              parentNodeId: node.parentNodeId,
            });
          }
          if (nodes.length > WHOLE_LIST_NODES_MAX) return null;
          cursor = page.nextCursor;
        } while (cursor !== undefined);
      }
      for (const node of nodes) {
        if (node.parentNodeId !== null) groupNodeIds.add(node.parentNodeId);
      }
      return wholeListParts(nodes);
    })().catch(reported("category list read", null));
    wholeLists.set(key, loading);
    return loading;
  };
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
          } catch (caught: unknown) {
            reported("category name read", undefined)(caught);
            // A name that cannot be read is left out, never guessed.
            return null;
          }
        }),
      );
      return names.filter((name): name is string => name !== null).join(", ");
    }
    return describeValue(
      step,
      value,
      recordedCurrency(view, steps, step.stepKey),
    ).trim();
  };

  /**
   * What was recorded, in words. Categories that matched with their other
   * words kept beside them say both (live 24 Oct: "Egypt, Morocco and the
   * Gulf" saved Egypt and Morocco with "the Gulf" in their words, and the
   * receipt said "the Gulf (geography)", naming the words as the saved
   * categories and the saved ones not at all).
   */
  const recordedLine = async (
    step: OnboardingStepManifest,
    value: OnboardingResponseValue,
    note: string | undefined,
    view: OnboardingSessionView,
  ): Promise<string> => {
    if (note === undefined) return spoken(step, value, view);
    if (note.startsWith(ALSO_NAMED_NOTE) || note.startsWith(READ_AS_NOTE)) {
      return `${await spoken(step, value, view)} (${note})`;
    }
    if (value.type === "RESOURCE_REFERENCE" && value.resourceIds.length > 0) {
      const names = await spoken(step, value, view);
      // Their words matched no category: said so, never as one.
      if (names.length > 0) {
        return `${names}, with “${note}” kept as you said it (no category matched it)`;
      }
    }
    return `${note} (in their words)`;
  };

  /** The note that settles a check: prose, with the code's own check id. */
  const settledNote = (checkId: string) =>
    `${SETTLED_NOTE} as it stands when asked (check ${checkId}).`;

  /** Checks on what is on the record that the person has not settled. */
  const openChecks = (view: OnboardingSessionView) => {
    const values = new Map(view.responses.map((r) => [r.stepKey, r.value]));
    // Final check 2026-10-30: a founder's "raising now" and "not right now"
    // sat side by side unasked; the founder journey had no checks at all.
    const found =
      input.journeyType === "investor"
        ? investorPlausibility(values)
        : founderRecordChecks(values);
    return found.filter(
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
      pendingNow().catch(reported("held writes read", [])),
      input.held === undefined
        ? new Set<string>()
        : input.held
            .pendingSteps()
            .catch(reported("held steps read", new Set<string>())),
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
                  // Never cut mid-word or mid-sentence (live 2026-10-30).
                  wholeWordsWithin(
                    stored.value.type === "SINGLE_SELECT" &&
                      stored.value.optionKey === "other" &&
                      stored.note !== null &&
                      stored.note.length > 0
                      ? `${stored.note} (in their words)`
                      : stored.note?.startsWith(ALSO_NAMED_NOTE) === true ||
                          stored.note?.startsWith(READ_AS_NOTE) === true
                        ? `${await spoken(step, stored.value, view)} (${stored.note})`
                        : // Their other words, said apart from the list
                          // (live check 2026-10-31, "Nordlicht": "Never
                          // show: Gambling, Speculative crypto; consumer apps
                          // (in their words)" read as a listed exclusion).
                          theirWordsBesideList(stored.value, stored.note)
                          ? `${await spoken(step, stored.value, view)}. ${ALSO_SAID_NOTE} ${stored.note ?? ""}`
                          : await spoken(step, stored.value, view),
                    600,
                  ) || null,
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
              // A figure read from their highly confidential accounts is
              // confirmed on screen, never put to the voice model (owner
              // 2026-10-28).
              const offer = field.proposals.find(
                (p) =>
                  (p.source === "DOCUMENT" || p.source === "PUBLIC_RESEARCH") &&
                  !isLocalFigureProposal(p.sourceRefs),
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
        // QA QO-29 (23 Oct): an investor at 9 of 9 essentials saw "Finish
        // your mandate" in Discover; the feed waited on a "Looks right" at
        // the end of every optional question, and the chip was gone after a
        // reload. Once nothing essential is missing, making the mandate live
        // is asked next: still their own yes (activation is consequential),
        // never assumed.
        const reviewKey = INVESTOR_STEPS.review;
        const readyToReview =
          input.journeyType === "investor" &&
          view.session.status !== "COMPLETED" &&
          eligibleKeys.has(reviewKey) &&
          !answeredKeys.has(reviewKey) &&
          !coverage.next.some((n) => n.reason === "ESSENTIAL_MISSING");
        return [
          ...(readyToReview
            ? [{ stepKey: reviewKey, reason: "CONFIRM_PROPOSAL" as const }]
            : []),
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
  /**
   * Every write of this port's goes through the one per-session chain
   * (session-writes.ts): in order with this process's other writes to the
   * session, made again on the fresh version after a conflict.
   */
  const sessionWrite = <W extends SessionWrite>(
    write: W,
    options: Pick<SessionWriteContext, "version" | "idempotencyKey"> = {},
  ) =>
    writeSession(
      {
        session: input.session,
        onboardingSessionId: input.onboardingSessionId,
        version:
          options.version ?? (async () => (await current()).session.version),
        fresh: async () => (await fresh()).session.version,
        idempotencyKey: options.idempotencyKey,
        logger: input.logger,
      },
      write,
    );

  const submit = async (
    stepKey: string,
    value: OnboardingResponseValue,
    note?: string,
  ): Promise<void> => {
    trusted = false;
    readAt = null;
    latest = await settle(
      await sessionWrite({
        kind: "SUBMIT",
        request: {
          stepKey,
          response: {
            value,
            ...(note === undefined ? {} : { note }),
            // Given in the conversation with Q, not the form (lane ob1).
            channel: "CONVERSATION",
          },
        },
      }),
    );
    trusted = true;
  };

  /** Where a refusal names a prerequisite by its field, the step that holds it. */
  const stepNamed = (suffix: string | null): string | undefined =>
    suffix === null
      ? undefined
      : [...steps.keys()].find((key) => key.endsWith(`.${suffix}`));

  /**
   * QA QO-27 (23 Oct): "pre-seed and seed" saved with Series A added. When
   * their own English words name some of a list's choices exactly, a choice
   * the model added beside them is its inference and is dropped; when their
   * words name none ("early stage"), the model's reading stands, checked as
   * before. Kept to lists: one choice is checked below.
   */
  const namedOnly = (
    resolved: Extract<Resolved, { ok: true }>,
    answer: Answer,
  ): Extract<Resolved, { ok: true }> => {
    if (
      resolved.value.type !== "MULTI_SELECT" ||
      MEANING_ONLY_CHOICES.has(resolved.step.stepKey) ||
      resolved.note !== undefined ||
      answer.basis === "DELEGATED" ||
      !turnIsEnglish(answer.quote)
    ) {
      return resolved;
    }
    const named = new Set([
      ...optionsNamedIn(input.journeyType, resolved.step, answer.quote),
      ...input.personTurns
        .filter((said) => quoteOccursIn(answer.quote, said))
        .flatMap((said) => [
          ...optionsNamedIn(input.journeyType, resolved.step, said),
        ]),
    ]);
    const words = [
      answer.quote,
      ...input.personTurns.filter((said) => quoteOccursIn(answer.quote, said)),
    ];
    // A choice they named in part keeps too (live 24 Oct: "never crypto,
    // gambling or tobacco" lost Speculative crypto because only Gambling and
    // Tobacco were named in full). By the choice's own distinctive words.
    const partly = partlyNamedOptions(resolved.step, named, words);
    const kept = resolved.value.optionKeys.filter(
      (key) => named.has(key) || partly.has(key),
    );
    return kept.length === 0 || kept.length === resolved.value.optionKeys.length
      ? resolved
      : { ...resolved, value: { type: "MULTI_SELECT", optionKeys: kept } };
  };

  type Resolved =
    | {
        readonly ok: true;
        readonly step: OnboardingStepManifest;
        readonly value: OnboardingResponseValue;
        /** Their own words where the options could not hold them. */
        readonly note?: string | undefined;
        /**
         * Other options they named for a one-choice step that keeps the
         * first (ALSO_NAMED_NOTE): Capital Q's words, not theirs.
         */
        readonly aside?: string | undefined;
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
    // Their words only agreed to what Q offered (the reading's `affirms`):
    // the value is Q's, and their agreeing words are never kept as the
    // answer's text or note (live final re-check 2026-10-31: "Yes, please."
    // saved as the deployment status, "; yes" in a category note).
    const affirmed = input.affirmed?.has(answer.stepKey) === true;
    const refuse = (result: OnboardingRecordResult): Resolved => ({
      ok: false,
      result,
    });
    /** Words naming none of a choice step's options: the options, to read against. */
    const unmatchedResult = (
      step: OnboardingStepManifest,
    ): OnboardingRecordResult => {
      const options = optionsOf(step);
      return {
        stepKey: step.stepKey,
        outcome: "UNMATCHED",
        reason: OPTION_ONLY_STEPS.has(step.stepKey)
          ? "That names none of this step's options, and this step is saved only as one of them (it sets them up). Choose the option below that means what they said and record it by its label exactly; if their words leave it open, ask them which."
          : options.some((o) => o.key === "other")
            ? "That names none of this step's options. Choose the option below that means what they said and record it by its label exactly. If none fits and their words are a real answer, record their own words with ownWords true; they are kept as they said them. If their words are unclear, ask them."
            : // No catch-all to keep their words in (live 2026-10-01:
              // "a few paying customers" asked for six turns running).
              "That names none of this step's options, and this step cannot keep other words. If one option plainly means what they said, record it by its label exactly. Otherwise say so once in a few words, recommend the closest option with recommend and ask if it will do; never put the same choice to them again after that.",
        // Labels only: a key that is a word they used pulls a model to it
        // (live recheck 2026-10-30: "follow a lead" saved as `follow`).
        // A label given back exactly names its option.
        candidates: options.slice(0, 40).map((o) => o.label.slice(0, 160)),
      };
    };
    /**
     * Words no listed category holds, for a field that keeps categories
     * only: nothing saved; the person picks from the category list.
     */
    const noCategoryResult = (
      step: OnboardingStepManifest,
    ): OnboardingRecordResult => ({
      stepKey: step.stepKey,
      outcome: "UNMATCHED",
      reason:
        "None of Capital Q's listed categories holds those words, and this field keeps listed categories only, so nothing was saved and their words are not its value. Ask them to choose from the category list on screen, or put the closest listed categories to them and ask if they fit.",
    });
    /** A yes to an offer that names none of the step's choices. */
    const affirmedUnmatched = (
      step: OnboardingStepManifest,
    ): OnboardingRecordResult => ({
      ...unmatchedResult(step),
      reason:
        "They agreed to what you offered, but it names none of this step's choices, and their yes is not an answer's words. Nothing was recorded; ask them which choice they mean.",
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
    let aside: string | undefined;
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
    // An approximate answer to a number step (live check 2026-10-31,
    // "Lobbykylm": runway saved as "Burn is about 40k euros a month and we
    // have a bit under a year of runway"): the reading's words for this
    // field, when they are theirs as said, are the field's part; their
    // whole sentence can carry other fields. Otherwise the field's clauses.
    const approximateWordsFor = (reading: string): string => {
      const words = reading.trim().replace(/\s+/gu, " ");
      const theirs =
        words.length > 0 &&
        (textStatedIn(words, answer.quote ?? "") ||
          input.personTurns.some((said) => textStatedIn(words, said)));
      return theirs ? words.slice(0, 500) : ownWordsFor(reading);
    };
    const c = step.configuration;
    if (
      c.stepType === "reference_select" &&
      c.resourceType === "TAXONOMY_NODE"
    ) {
      const countryOnly = COUNTRY_ONLY_STEPS.has(step.stepKey);
      // typeof, not Array.isArray: the latter widens a readonly list to any[].
      const phrases = (
        typeof answer.value === "object" ? answer.value : [String(answer.value)]
      ).slice(0, 8);
      const ids: string[] = [];
      const unmatched: string[] = [];
      /** Words read as listed categories they did not name as such. */
      const readAs: string[] = [];
      /** Phrases no lookup placed: read against the whole list after. */
      const wholeListPhrases: string[] = [];
      for (const phrase of phrases) {
        const looked: TaxonomyCandidateResponse = await findTaxonomyCandidates(
          input.session,
          {
            text: phrase,
            vocabularyCodes: [...c.vocabularyCodes],
          },
        );
        const found = countryOnly ? onlyCountries(looked) : looked;
        const best = found.candidates[0];
        if (best === undefined) {
          // Read against the whole list once every other phrase of theirs
          // is placed (below).
          wholeListPhrases.push(phrase);
          continue;
        }
        if (found.resolution !== "EXACT" && found.candidates.length > 1) {
          // Production re-test 2026-10-28: "health" matched Healthcare,
          // Digital Health and Health Access, and was never saved as a
          // sector. Which of the lookup's own candidates their word names
          // is read by meaning (TAXONOMY_MAPPING); never outside them.
          const chosen =
            input.chooseCategories === undefined
              ? null
              : await input
                  .chooseCategories({
                    field: (SPOKEN_QUESTIONS[step.stepKey] ?? c.prompt).slice(
                      0,
                      200,
                    ),
                    phrase,
                    sentence: answer.quote ?? phrase,
                    candidates: found.candidates.slice(0, 12),
                  })
                  .catch(
                    reported("category reading (lookup candidates)", null),
                  );
          if (chosen !== null && chosen.length > 0) {
            for (const id of chosen) {
              const node = found.candidates.find((cand) => cand.nodeId === id);
              if (node === undefined) continue;
              if (!ids.includes(id)) ids.push(id);
              nodeNames.set(id, node.displayName);
            }
            continue;
          }
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
      const namedByOthers = new Set(ids);
      for (const phrase of wholeListPhrases) {
        // Sweep D2 (2026-10-29): "Benelux and the Nordics" matched no
        // category and was kept as plain words. A small field's whole
        // list is offered to the reader, which reads, by meaning, which
        // listed categories the words name (a region: its listed
        // members only). Nothing listed: kept in their words, as before.
        // A large list (every country) is read in parts of whole
        // regions, side by side; what each part names is kept.
        const listed =
          input.chooseCategories === undefined
            ? null
            : await wholeVocabulary(c.vocabularyCodes);
        // One country (founder v8): the whole list is its countries.
        const parts =
          listed === null
            ? null
            : listed
                .map((part) =>
                  part.filter(
                    (n) =>
                      (!countryOnly || countryOfNodeId(n.nodeId) !== null) &&
                      // A category another phrase of theirs names is not
                      // this phrase's reading (live 2026-10-31:
                      // "consumer apps, gambling or crypto" read
                      // "consumer apps" as Gambling and Crypto).
                      !namedByOthers.has(n.nodeId),
                  ),
                )
                .filter((part) => part.length > 0);
        const choose = input.chooseCategories;
        const chosen =
          parts === null || choose === undefined
            ? null
            : (
                await Promise.all(
                  parts.map((part) =>
                    choose({
                      field: (SPOKEN_QUESTIONS[step.stepKey] ?? c.prompt).slice(
                        0,
                        200,
                      ),
                      phrase,
                      sentence: answer.quote ?? phrase,
                      candidates: part,
                    }).catch(reported("category reading (whole list)", null)),
                  ),
                )
              ).flatMap((one) => one ?? []);
        const whole = parts?.flat();
        const names: { displayName: string; group: boolean }[] = [];
        for (const id of chosen ?? []) {
          const node = whole?.find((candidate) => candidate.nodeId === id);
          if (node === undefined || namedByOthers.has(id)) continue;
          if (!ids.includes(id)) ids.push(id);
          nodeNames.set(id, node.displayName);
          names.push({
            displayName: node.displayName,
            // "region" is a place's word (live final re-check 2026-10-31:
            // "grain-storage analytics" read as "Agriculture region").
            group:
              groupNodeIds.has(id) && c.vocabularyCodes.includes("geography"),
          });
        }
        if (names.length > 0) {
          readAs.push(`“${phrase}” as ${savedPlacesInWords(names)}`);
          continue;
        }
        unmatched.push(phrase);
      }
      if (affirmed && unmatched.length > 0) {
        // A yes to what Q offered: what Q offered that names a category is
        // kept; nothing else of it is "their words".
        if (ids.length === 0) return refuse(affirmedUnmatched(step));
        unmatched.length = 0;
      }
      if (unmatched.length > 0 && ids.length > 0) {
        // The categories that matched, with their other words beside them:
        // the model's phrase where it is theirs, else the part of their
        // quote it stands for; a phrase in neither is left out and the
        // categories still save (live AO 2026-10-17: "port technology"
        // for "anything that makes ports less painful" lost all sectors).
        const quote = answer.quote ?? "";
        // Their own words are never dropped: in the quote, or in any turn
        // of theirs (QA F-137: "crypto" in "We never invest in crypto or
        // gambling" was lost when the quote left it out).
        const kept = unmatched
          .map((phrase) =>
            textStatedIn(phrase, quote) ||
            input.personTurns.some((said) => textStatedIn(phrase, said))
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
        // QA QO-28 (23 Oct): "We never invest in crypto, gambling or
        // tobacco" saved its three red flags AND the raw sentence as
        // "Sectors never shown". When the concept is already answered in
        // its structured sibling (now or in this same turn), their words
        // are not saved a second time as text.
        const sibling = familySiblingAnswered(step.stepKey, await current());
        if (sibling !== undefined) {
          return {
            ok: false,
            result: {
              stepKey: step.stepKey,
              outcome: "CONFIRMED_AS_STATED",
              recorded:
                `Already covered by their answer to "${(SPOKEN_QUESTIONS[sibling] ?? steps.get(sibling)?.configuration.prompt ?? sibling).slice(0, 160)}"; nothing more to save here.`.slice(
                  0,
                  600,
                ),
            },
          };
        }
        // Categories already on the record are never replaced by words
        // (production re-test 2026-10-28: the sectors on record became the
        // free text "fintech and health" on a later reading, and Discover
        // matched without sectors). The categories stay; their words are
        // kept beside them as a note.
        const onRecord = (await current()).responses.find(
          (response) => response.stepKey === step.stepKey,
        );
        if (
          onRecord?.value.type === "RESOURCE_REFERENCE" &&
          onRecord.value.resourceIds.length > 0
        ) {
          return {
            ok: true,
            step,
            value: onRecord.value,
            note: ownWordsFor(unmatched.join(", ")).slice(0, 200),
          };
        }
        // No category holds their words. A category field holds listed
        // categories only (live 2026-10-31, "Tidevand": a rambling
        // sentence was saved as the sector and read back as "Sector:
        // basically fishing boats…"; the runtime now refuses it too):
        // nothing is saved and the person chooses from the list.
        return refuse(noCategoryResult(step));
      }
      // QA QO-27 (23 Oct): "West Africa" said after "the UK" replaced the
      // UK. A list they already gave keeps what they said before unless
      // their words replace it, read by meaning; unsure keeps both.
      const before = (await current()).responses.find(
        (response) => response.stepKey === step.stepKey,
      )?.value;
      const earlier =
        before?.type === "RESOURCE_REFERENCE"
          ? before.resourceIds.filter((id) => !ids.includes(id))
          : [];
      const keepEarlier =
        earlier.length > 0 &&
        c.maxItems > 1 &&
        input.replaces?.has(step.stepKey) !== true &&
        (await replacesEarlier(answer.quote ?? "")) !== "YES";
      value = {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: (keepEarlier ? [...earlier, ...ids] : ids).slice(
          0,
          c.maxItems,
        ),
      };
      if (readAs.length > 0) {
        // Capital Q's words, not theirs (so not checked as theirs), kept
        // beside the categories and said in the read-back, so they can
        // correct it.
        aside = `${READ_AS_NOTE} ${readAs.join("; ")}.`.slice(0, 300);
      }
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
      // Sweep D2 (2026-10-29): "Eindhoven, the Netherlands" named no option
      // by key or label and was saved as "Somewhere else", though the
      // Netherlands is one. Which of this step's own options their words
      // name is read by meaning (the same reader as for categories, given
      // the options); never a catch-all, never outside the options.
      if (unnamed.length > 0 && input.chooseCategories !== undefined) {
        // An option their other words already name is not this phrase's
        // reading (live check 2026-10-31, "Halvmåne": "consumer apps,
        // gambling or crypto are a firm no" kept Gambling and Speculative
        // crypto and lost "consumer apps"), as for categories.
        const namedByOthers = new Set(
          c.stepType === "multi_select" ? keys : [],
        );
        const choices = options
          .filter((o) => o.key !== "other" && !namedByOthers.has(o.key))
          .map((o) => ({
            nodeId: o.key,
            displayName: o.label,
            vocabularyCode: step.stepKey,
          }));
        const still: string[] = [];
        for (const phrase of unnamed) {
          if (choices.length === 0) {
            still.push(phrase);
            continue;
          }
          const chosen = await input
            .chooseCategories({
              field: (SPOKEN_QUESTIONS[step.stepKey] ?? c.prompt).slice(0, 200),
              phrase: phrase.slice(0, 200),
              sentence: answer.quote ?? phrase,
              candidates: choices,
            })
            .catch(reported("option reading", null));
          const picked = (chosen ?? []).filter((key) =>
            choices.some((choice) => choice.nodeId === key),
          );
          if (picked.length === 0) {
            still.push(phrase);
            continue;
          }
          keys.push(
            ...(c.stepType === "single_select" ? picked.slice(0, 1) : picked),
          );
        }
        unnamed.splice(0, unnamed.length, ...still);
      }
      // A yes to what Q offered names an option or nothing: never "their
      // words" on the catch-all or as the answer's text.
      if (affirmed && unnamed.length > 0) {
        if (keys.length === 0) return refuse(affirmedUnmatched(step));
        unnamed.length = 0;
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
      } else if (
        unnamed.length > 0 &&
        keys.length === 0 &&
        OPTION_ONLY_STEPS.has(step.stepKey)
      ) {
        // Live 2026-10-28 (investor ca3626ab): "I'm an angel, also run a
        // small syndicate called Harmattan Angels" was recorded as the
        // investor type's free text. The journey sets the firm up from
        // that step's option key, so no firm existed and every other
        // answer of the sentence waited on it. A step the journey can
        // only save as one of its options is handed back with them: the
        // model reads which one is meant, or asks.
        return refuse(unmatchedResult(step));
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
      const distinct = [...new Set(keys)];
      const [only] = distinct;
      if (
        c.stepType === "single_select" &&
        distinct.length > 1 &&
        only !== undefined
      ) {
        if (FIRST_NAMED_KEPT_STEPS.has(step.stepKey)) {
          // The first they named is kept; the others are noted beside it
          // and asked about, never saved as their sentence.
          aside = alsoNamedNote(
            distinct
              .slice(1)
              .map((key) => options.find((o) => o.key === key)?.label ?? key),
          );
        } else if (OPTION_ONLY_STEPS.has(step.stepKey)) {
          return refuse({
            stepKey: step.stepKey,
            outcome: "AMBIGUOUS",
            reason:
              "They named more than one of this step's options and it keeps one: ask which one they mean.",
            candidates: distinct
              .map((key) => options.find((o) => o.key === key)?.label ?? key)
              .slice(0, 40),
          });
        }
      }
      value =
        only === undefined
          ? null
          : c.stepType === "single_select"
            ? distinct.length === 1 || aside !== undefined
              ? toResponseValue(step, only)
              : null
            : toResponseValue(step, distinct);
    } else {
      const raw =
        typeof answer.value === "number" ? String(answer.value) : answer.value;
      value = toResponseValue(step, raw);
      // A number question answered in words no figure can be read from
      // ("a dozen or so", "about half the team"): kept as they said it,
      // unless the figure is impossible, which is asked about instead.
      if (
        value === null &&
        c.stepType === "range" &&
        !affirmed &&
        !impossibleFigure(raw)
      ) {
        return {
          ok: true,
          step,
          value: { type: "TEXT", text: approximateWordsFor(String(raw)) },
        };
      }
    }
    if (
      value === null &&
      (c.stepType === "single_select" || c.stepType === "multi_select") &&
      !affirmed &&
      !OPTION_ONLY_STEPS.has(step.stepKey)
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
          ? unmatchedResult(step)
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
                      latest !== null && documentFindingsIn(latest) > 0
                      ? uploadReadReason(documentFindingsIn(latest))
                      : UPLOAD_ONLY_REASON
                    : "That does not fit what this step records.",
            },
      );
    }
    return {
      ok: true,
      step,
      value,
      ...(otherWords === undefined ? {} : { note: otherWords }),
      ...(aside === undefined ? {} : { aside }),
    };
  };

  const withdraw = async (stepKey: string): Promise<void> => {
    trusted = false;
    readAt = null;
    latest = await settle(
      await sessionWrite({ kind: "WITHDRAW", stepKey, request: {} }),
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
        alreadyRecorded: true,
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
    } catch (caught: unknown) {
      reported("answer reading", undefined)(caught);
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
      .catch(reported("hold until step opens", undefined));
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
        recorded: (await recordedLine(step, value, note, after)).slice(0, 600),
        ...keptInWordsOf(value, note),
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
              : STILL_SAVING_REASON,
          };
        } catch (caught: unknown) {
          reported("hold after a failed save", undefined)(caught);
          // The hold itself failed: report the original failure honestly.
        }
      }
      return refused(step.stepKey, error);
    }
  };

  /**
   * Text Q said back in the line the person was answering, which the
   * reading found they agreed to (the quote is their agreeing words): the
   * reading decides the agreement by meaning; code only checks that every
   * word carrying the text is in what Q said to them there.
   */
  const agreedReadBack = (text: string, quote: string): boolean => {
    const qLine = input.qLineBefore?.(quote);
    return qLine !== undefined && heardBack(text, qLine);
  };
  /**
   * Their own words from a short line of theirs, a sentence or two
   * ("Robotics for warehouse logistics.", "change our description to
   * …"): nothing to say back. Words cut from a long line were told at
   * length and are said back first (live 2026-10-30: a ramble minus "so
   * basically, um" was saved as the description). Structure only: how
   * long their line is and whether the words are in it, never what they
   * mean.
   */
  const shortWholeLine = (text: string): boolean =>
    input.personTurns.some(
      (said) =>
        said.trim().split(/\s+/u).length <= SHORT_ANSWER_WORDS &&
        textStatedIn(text, said),
    );
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
      agreedReadBack(text, quote) ||
      textStatedIn(text, quote) ||
      // Or the field's part of the same turn of theirs the quote is from
      // (a quote cut short before the words about this field).
      input.personTurns.some(
        (said) => quoteOccursIn(quote, said) && textStatedIn(text, said),
      )
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
    // Already in what this step records (a note kept earlier): nothing to
    // hold for their yes, and never offered to them again (live 25 Oct
    // e2e: "Paying customers: the 210 customers is right" re-offered).
    const onRecord = (await current()).responses.find(
      (r) => r.stepKey === step.stepKey,
    );
    if (
      onRecord?.value.type === "TEXT" &&
      normalisedText(value.text).length > 0 &&
      normalisedText(onRecord.value.text).includes(normalisedText(value.text))
    ) {
      return {
        stepKey: step.stepKey,
        outcome: "COMMITTED",
        question,
        recorded: value.text.slice(0, 600),
        alreadyRecorded: true,
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
          keepPendingSince: input.saidAt?.(quote),
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
   * said, and not something they
   * said they are not ("we are not raising"). Code, not a reading.
   */
  const assertedNow = (
    quote: string,
    reading: { readonly lookup?: string | null } | null,
  ): boolean => {
    const latest = input.personTurns[0];
    if (
      // Unread words give nothing, and words the reading found asking
      // something beyond their setup state nothing about them.
      reading === null ||
      (reading.lookup ?? null) !== null ||
      latest === undefined ||
      !(quoteOccursIn(quote, latest) || shortWordIn(quote, latest))
    ) {
      return false;
    }
    // Whether their words answer or ask is read by meaning (the reader and
    // the model that chose to record them), never by how a sentence opens:
    // speech-to-text runs a question into the answer that follows it
    // ("What do you mean by that question okay I mainly do series A",
    // live 2026-10-27), which an opening-word rule refused.
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
    if (quote !== undefined && assertedNow(quote, authority)) return null;
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
      let unshownReview = false;
      if (!answersLeft) {
        for (let guard = 0; guard < 4; guard += 1) {
          const open = view.progress.eligibleSteps.find(
            (e) =>
              e.status !== "COMPLETED" &&
              steps.get(e.stepKey)?.configuration.stepType === "confirmation",
          );
          if (open === undefined) break;
          if (
            RECORD_REVIEWS.has(open.stepKey) &&
            input.reviewShown?.(open.stepKey) === false
          ) {
            unshownReview = true;
            break;
          }
          await submit(open.stepKey, { type: "CONFIRMATION", confirmed: true });
          written.push(open.stepKey);
          view = await current();
        }
        if (view.progress.canComplete) {
          trusted = false;
          readAt = null;
          const before = view;
          latest = await sessionWrite(
            { kind: "COMPLETE", request: {} },
            { version: () => Promise.resolve(before.session.version) },
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
            : unshownReview
              ? "Confirmed. The last review has not been shown to them yet: read back what is saved, from the state, in a few plain sentences, and ask if it is right before anything is finished."
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
  /**
   * Steps written in the current `record` call: a later item for one of
   * them in the same call (a retry, planned after the batch) adds to what
   * the call just wrote, never replaces it.
   */
  const addingNow = new Set<string>();
  /** What the record holds for each list step an already-saved item names. */
  const onRecordFor = async (
    plans: readonly Planned[],
  ): Promise<ReadonlyMap<string, OnRecordList>> => {
    const wanted = new Set(
      plans.flatMap((plan) =>
        plan.kind === "DONE" && plan.result.alreadyRecorded === true
          ? [plan.result.stepKey]
          : [],
      ),
    );
    if (wanted.size === 0) return new Map();
    const view = latest ?? (await current());
    return new Map(
      view.responses
        .filter((r) => wanted.has(r.stepKey))
        .map(
          (r) =>
            [r.stepKey, { value: r.value, note: r.note ?? undefined }] as const,
        ),
    );
  };
  /**
   * Every write a call planned for one list step, merged into ONE write
   * (live 2026-10-31, "Fjordwerk": "Nordics and Germany" came from the
   * reader as two items; both went in one batch, the second superseding
   * the first, and only Germany stayed). Each item was checked on its own
   * words when it was planned; this only joins what those checks allowed.
   * An item already on the record (planned as nothing to write) is kept
   * in the merged list too, or a list restated whole would drop it. The
   * other items' outcomes are the merged write's (`followers`).
   */
  const mergeListPlans = (
    plans: readonly Planned[],
    onRecord: ReadonlyMap<string, OnRecordList>,
  ): {
    readonly plans: readonly Planned[];
    readonly leaders: ReadonlySet<number>;
    readonly followers: ReadonlyMap<number, number>;
  } => {
    const out = [...plans];
    const leaders = new Set<number>();
    const followers = new Map<number, number>();
    const groups = new Map<string, number[]>();
    for (const [index, plan] of plans.entries()) {
      if (plan.kind !== "WRITE" || !holdsMany(plan.step)) continue;
      const group = groups.get(plan.step.stepKey) ?? [];
      group.push(index);
      groups.set(plan.step.stepKey, group);
    }
    for (const [stepKey, indices] of groups) {
      const saved = plans.flatMap((plan, index) =>
        plan.kind === "DONE" &&
        plan.result.alreadyRecorded === true &&
        plan.result.stepKey === stepKey
          ? [index]
          : [],
      );
      const record = saved.length > 0 ? onRecord.get(stepKey) : undefined;
      const writes = indices.flatMap((index) => {
        const plan = plans[index];
        return plan?.kind === "WRITE" ? [plan] : [];
      });
      const first = writes[0];
      const leader = indices[0];
      if (
        first === undefined ||
        leader === undefined ||
        writes.length + (record === undefined ? 0 : 1) < 2
      ) {
        continue;
      }
      const joined = mergeListValues([
        ...(record === undefined ? [] : [record]),
        ...writes.map((plan) => ({ value: plan.value, note: plan.note })),
      ]);
      if (joined === null) continue;
      const quotes = [...new Set(writes.map((plan) => plan.quote.trim()))];
      out[leader] = {
        kind: "WRITE",
        step: first.step,
        value: joined.value,
        note: joined.note,
        quote: quotes.join(" … ").slice(0, 400),
      };
      leaders.add(leader);
      for (const index of [...indices.slice(1), ...saved]) {
        // Its outcome is the leader's, filled in once that is written.
        out[index] = done({ stepKey, outcome: "COMMITTED" });
        followers.set(index, leader);
      }
    }
    return { plans: out, leaders, followers };
  };
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
    // A summary of Q's they agreed to is saved as its content, cleanly
    // cased (live check 2026-10-31, "Grannskap": saved as "The problem
    // you're addressing is that…", "The process is: …" and "a marketplace
    // where…"). The reading gives the field's content (reader v12); a
    // topic's name Q put before it ("The process is: …") is left out.
    if (
      answer.basis !== "DELEGATED" &&
      narrative !== undefined &&
      PARAPHRASABLE.has(narrative.configuration.stepType) &&
      typeof answer.value === "string" &&
      (input.affirmed?.has(answer.stepKey) === true ||
        agreedReadBack(answer.value.trim(), answer.quote))
    ) {
      const reference = (await heard).find(
        (held) =>
          held.stepKey === answer.stepKey &&
          held.value.type === "TEXT" &&
          isParaphraseRationale(held.rationale),
      )?.value;
      const content = summaryContent(
        answer.value,
        reference?.type === "TEXT" ? reference.text : null,
      );
      if (content !== answer.value) {
        return planOne({ ...answer, value: content });
      }
    }
    if (
      answer.basis !== "DELEGATED" &&
      narrative !== undefined &&
      PARAPHRASABLE.has(narrative.configuration.stepType) &&
      typeof answer.value === "string" &&
      answer.value.trim().length > 0 &&
      !(input.narrativeFromReadBackOnly === true
        ? agreedReadBack(answer.value.trim(), answer.quote) ||
          shortWholeLine(answer.value.trim())
        : textInTheirWords(answer.value.trim(), answer.quote))
    ) {
      // Their yes agreed to Q's one summary line, and the reading found it
      // covered this step too (live 2026-10-31, "Tidevand": one yes to a
      // summary of the company, its solution and how it works saved only
      // the description; the solution and how it works were each put to
      // them again). What is saved is Q's own words for it from that line,
      // never words Q did not say to them.
      const fromSummary =
        input.affirmed?.has(answer.stepKey) === true
          ? summaryWordsFor(answer.value, input.qLineBefore?.(answer.quote))
          : null;
      if (fromSummary !== null && fromSummary !== answer.value.trim()) {
        return planOne({ ...answer, value: fromSummary });
      }
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
    // A firm exclusion only from a declared one, and never a preference
    // written over one: which they meant is the reading's, by meaning.
    // No reader in this composition (as notStated): the check stands aside.
    if (answer.basis !== "DELEGATED" && input.authority !== undefined) {
      const meant = await input.authority();
      if (
        exclusionMeaningUnsettled(
          answer.stepKey,
          meant?.stated ?? null,
          (key) => input.statedEarlier?.(key, answer.quote) === true,
        )
      ) {
        return done({
          stepKey: answer.stepKey.slice(0, 80),
          outcome: "REJECTED",
          reason: EXCLUSION_MEANING_REASON,
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
    const resolvedRaw = await (warmed.get(answer) ?? resolve(answer));
    if (!resolvedRaw.ok) return done(resolvedRaw.result);
    const resolved = namedOnly(resolvedRaw, answer);
    // QA QO-25 (23 Oct): "I was a product lead at Paystack" saved their
    // role as Product; they are the CEO. A role is their role now: words
    // about a past job are read by meaning and not recorded as it.
    if (
      ROLE_NOW_STEPS.has(resolved.step.stepKey) &&
      answer.basis !== "DELEGATED" &&
      (answer.quote ?? "").trim().length > 0 &&
      (await input.wordsCheck?.(ROLE_NOW_QUESTION, answer.quote ?? "")) === "NO"
    ) {
      return done({
        stepKey: resolved.step.stepKey,
        outcome: "REJECTED",
        reason:
          "Those words describe a past role, not their role now, so nothing was recorded. Keep it as their background and ask what their role is today.",
      });
    }
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
      assertedNow(answer.quote, reading) ||
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
        } catch (caught: unknown) {
          reported("recommendation hold", undefined)(caught);
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
      // side by side in the quote, and may sit in another of their turns:
      // QA F-137, "crypto" left out of the model's quote).
      !resolved.note
        .split(/\s*;\s*/u)
        .every(
          (piece) =>
            textStatedIn(piece, answer.quote) ||
            input.personTurns.some((said) => textStatedIn(piece, said)),
        ) &&
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
    const adding =
      input.addsTo?.has(resolved.step.stepKey) === true ||
      addingNow.has(resolved.step.stepKey);
    const onRecord = (
      adding || resolved.value.type === "TEXT"
        ? (latest ?? (await current()))
        : latest
    )?.responses.find((r) => r.stepKey === resolved.step.stepKey);
    // A list they add to (owner 2026-10-28: "crypto and gambling" replaced
    // by "adult content" on a later reading): what is on the record stays,
    // with the new items beside it, unless the reading found they meant
    // this as the whole list.
    const structuredList =
      onRecord !== undefined &&
      (onRecord.value.type === "MULTI_SELECT" ||
        onRecord.value.type === "RESOURCE_REFERENCE") &&
      resolved.value.type === "TEXT";
    const added =
      onRecord !== undefined && (adding || structuredList)
        ? addedTo(onRecord, resolved.value, resolved.note)
        : null;
    const value = added?.value ?? resolved.value;
    const note = added === null ? resolved.note : added.note;
    if (
      onRecord !== undefined &&
      (added === null
        ? resolved.note === undefined &&
          (resolved.aside === undefined ||
            (onRecord.note ?? undefined) === resolved.aside)
        : (onRecord.note ?? undefined) === note) &&
      sameValue(onRecord.value, value)
    ) {
      return done({
        stepKey: resolved.step.stepKey,
        outcome: "COMMITTED",
        alreadyRecorded: true,
        question: (
          SPOKEN_QUESTIONS[resolved.step.stepKey] ??
          resolved.step.configuration.prompt
        ).slice(0, 400),
        recorded: (
          await spoken(resolved.step, value, latest ?? (await current()))
        ).slice(0, 600),
      });
    }
    return {
      kind: "WRITE",
      step: resolved.step,
      value,
      // A reading of their words (READ_AS_NOTE) is kept with their own
      // words beside it, when there are both.
      note:
        note !== undefined && resolved.aside?.startsWith(READ_AS_NOTE) === true
          ? `${resolved.aside} Kept as they said it: ${note}.`.slice(0, 500)
          : (note ?? resolved.aside),
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
    /** Indices of `ready` held because their step was not open yet. */
    const waitingOnStep = new Set<number>();
    if (ready.length > 0) {
      trusted = false;
      readAt = null;
      try {
        type BatchItem = {
          readonly stepKey: string;
          readonly value: OnboardingResponseValue;
          readonly note?: string | undefined;
        };
        const submitBatch = (items: readonly BatchItem[]) =>
          sessionWrite({
            kind: "SUBMIT_MANY",
            request: {
              responses: items.map((item) => ({
                stepKey: item.stepKey,
                response: {
                  value: item.value,
                  ...(item.note === undefined ? {} : { note: item.note }),
                  channel: "CONVERSATION" as const,
                },
              })),
            },
          });
        const asItem = (item: (typeof ready)[number]): BatchItem => ({
          stepKey: item.plan.step.stepKey,
          value: item.value,
          note: item.plan.note,
        });
        // A correction to an answer still held (waiting for the firm):
        // the original is written first, then the correction, so the
        // record keeps both (production re-test 2026-10-28: "25 to 100k",
        // then "make that 50": the 25000 was never on the record).
        const originals = await heldOriginals(ready.map(asItem));
        const first = await submitBatch(
          ready.map((item, index) => originals.get(index) ?? asItem(item)),
        );
        const corrected = [...originals.keys()].sort((a, b) => a - b);
        const second =
          corrected.length === 0
            ? null
            : await submitBatch(
                corrected.flatMap((index) => {
                  const item = ready[index];
                  return item === undefined ? [] : [asItem(item)];
                }),
              );
        const out = {
          view: (second ?? first).view,
          results: {
            at: (index: number) => {
              const at = corrected.indexOf(index);
              return second !== null && at >= 0
                ? (second.results[at] ?? first.results[index])
                : first.results[index];
            },
          },
        };
        latest = await settle(out.view);
        trusted = true;
        const after = latest;
        // In order: a fact kept with their notes appends to one answer.
        const settleOne = async (
          item: (typeof ready)[number],
          index: number,
        ): Promise<OnboardingRecordResult> => {
          const outcome = out.results.at(index);
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
              } catch (caught: unknown) {
                reported("hold after a failed save", undefined)(caught);
                // The hold itself failed: refused below, honestly.
              }
            }
            if (offPath({ problem })) {
              await holdUntilOpen(stepKey, item.value, item.plan.note);
              waitingOnStep.add(index);
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
            recorded: (
              await recordedLine(
                item.plan.step,
                item.value,
                item.plan.note,
                after,
              )
            ).slice(0, 600),
            ...keptInWordsOf(item.value, item.plan.note),
            ...(item.movedFrom === undefined
              ? {}
              : { movedFrom: item.movedFrom }),
          };
        };
        for (const [index, item] of ready.entries()) {
          settled.push(await settleOne(item, index));
        }
        // A fact whose step opened with another answer of the same batch
        // ("raising 400k": the amount before "raising", live 2026-10-28)
        // lands this turn, not the next: what the batch held is replayed
        // once now that the batch is on the record.
        if (waitingOnStep.size > 0 && written.length > 0) {
          const drained = await replayHeldWrites().catch(
            reported("held writes replay", null),
          );
          if (drained !== null && drained.applied.length > 0) {
            const now = await current();
            for (const index of waitingOnStep) {
              const item = ready[index];
              const stepKey = item?.plan.step.stepKey;
              if (
                item === undefined ||
                stepKey === undefined ||
                !drained.applied.includes(stepKey)
              ) {
                continue;
              }
              settled[index] = {
                stepKey,
                outcome: "COMMITTED",
                question: questionOf(item.plan.step),
                recorded: (
                  await recordedLine(
                    item.plan.step,
                    item.value,
                    item.plan.note,
                    now,
                  )
                ).slice(0, 600),
                ...keptInWordsOf(item.value, item.plan.note),
              };
            }
          }
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
                reason: STILL_SAVING_REASON,
              });
              continue;
            } catch (caught: unknown) {
              reported("hold after a failed save", undefined)(caught);
              // The hold itself failed: report the original failure.
            }
          }
          settled.push(refused(stepKey, error));
        }
        // One answer the service failed on takes the whole batch down with
        // it (one transaction). Each held answer is tried again on its own
        // now, so the others land this turn and only the failing one waits
        // (live 2026-10-28: nine mandate answers queued behind a website).
        const heldNow = settled.filter((r) => r.outcome === "HELD_FOR_RETRY");
        if (heldNow.length > 1) {
          const drained = await replayHeldWrites().catch(
            reported("held writes replay", null),
          );
          if (drained !== null && drained.applied.length > 0) {
            const now = await current();
            for (const [index, item] of ready.entries()) {
              const stepKey = item.plan.step.stepKey;
              if (
                settled[index]?.outcome !== "HELD_FOR_RETRY" ||
                !drained.applied.includes(stepKey)
              ) {
                continue;
              }
              noteFigure(item.plan.step, item.value, item.plan.quote);
              settled[index] = {
                stepKey,
                outcome: "COMMITTED",
                question: questionOf(item.plan.step),
                recorded: (
                  await recordedLine(
                    item.plan.step,
                    item.value,
                    item.plan.note,
                    now,
                  )
                ).slice(0, 600),
                ...keptInWordsOf(item.value, item.plan.note),
              };
            }
          }
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
    } catch (caught: unknown) {
      reported("save", undefined)(caught);
      // Not recordable yet (another step first): Q asks as before.
      return false;
    }
  };

  /**
   * For each write that changes an answer still held (not yet on the
   * record), the held original, by the write's index: written first, so
   * the correction is a new version beside it, never folded into it.
   */
  const heldOriginals = async (
    items: readonly {
      readonly stepKey: string;
      readonly value: OnboardingResponseValue;
    }[],
  ): Promise<
    Map<
      number,
      {
        readonly stepKey: string;
        readonly value: OnboardingResponseValue;
        readonly note?: string | undefined;
      }
    >
  > => {
    const originals = new Map<
      number,
      {
        readonly stepKey: string;
        readonly value: OnboardingResponseValue;
        readonly note?: string | undefined;
      }
    >();
    const listed = input.held?.pendingValues;
    if (listed === undefined) return originals;
    const pending = await listed().catch(reported("held originals read", []));
    if (pending.length === 0) return originals;
    const onRecord = new Set(
      (latest ?? (await current())).responses.map((r) => r.stepKey),
    );
    for (const [index, item] of items.entries()) {
      // Only an answer never on the record: one that is on it already
      // has its history there.
      if (onRecord.has(item.stepKey)) continue;
      const held = pending.findLast((p) => p.stepKey === item.stepKey);
      if (held === undefined) continue;
      // The held row is data, not a trusted value: validated again.
      const value = OnboardingResponseValueSchema.safeParse(held.value);
      if (!value.success || sameValue(value.data, item.value)) continue;
      originals.set(index, {
        stepKey: item.stepKey,
        value: value.data,
        ...(held.note === undefined ? {} : { note: held.note }),
      });
    }
    return originals;
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
          await sessionWrite(
            { kind: "SUBMIT", request: { stepKey: write.stepKey, response } },
            {
              // Derived from the held row and the version it targets: a
              // retried replay of the same version replays, not repeats.
              idempotencyKey: (version) => pendingReplayKey(write.id, version),
            },
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
      const waiting = await pendingNow().catch(
        reported("held writes read", []),
      );
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
        } catch (caught: unknown) {
          reported("recommendation", undefined)(caught);
          results.push({ stepKey: step.stepKey, outcome: "REJECTED" });
        }
      }
      return results;
    },
    answeredSteps: async () =>
      new Set((await current()).responses.map((r) => r.stepKey)),
    askingStep: async () => {
      const kept = await listOnboardingInterviewTurnSteps(
        input.session,
        input.onboardingSessionId,
        6,
      );
      return kept.items.findLast((t) => t.role === "Q")?.stepKey ?? null;
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
          (paraphrase || (await readBackHeard(step, held))) &&
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
          trusted = false;
          readAt = null;
          latest = await settle(
            await sessionWrite({
              kind: "RESOLVE",
              suggestionId: held.id,
              request: { resolution: "ACCEPT" },
            }),
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
              "This one is needed to set them up, so it cannot be set aside on the record. If they declined it for now, leave it: do not ask it again in this conversation (it is listed when they finish) and move on. Otherwise say briefly why it matters and ask it plainly.",
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
            const before = view;
            latest = await settle(
              await sessionWrite(
                { kind: "SKIP", stepKey: step.stepKey, request: {} },
                { version: () => Promise.resolve(before.session.version) },
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
          const before = view;
          latest = await settle(
            await sessionWrite(
              { kind: "SKIP", stepKey: waitingStep.stepKey, request: {} },
              { version: () => Promise.resolve(before.session.version) },
            ),
          );
          view = latest;
        } catch (caught: unknown) {
          reported("set aside", undefined)(caught);
          break;
        }
      }
      // An answer still saving is answered, not missing (live f46ddb69:
      // nine mandate answers queued, and "that's all" named none of them).
      const saving =
        input.held === undefined
          ? new Set<string>()
          : await input.held
              .pendingSteps()
              .catch(reported("held steps read", new Set<string>()));
      const open = missing(view);
      const gaps = open.filter((gap) => !saving.has(gap.stepKey));
      if (gaps.length > 0) return { completed: false, missing: gaps };
      if (open.length > 0) {
        return {
          completed: false,
          missing: [],
          reason: STILL_SAVING_FINISH_REASON,
        };
      }
      // The journey's own review steps, confirmed on the person's word —
      // one after another, since the next becomes eligible after the last.
      for (let guard = 0; guard < 4; guard += 1) {
        const open = view.progress.eligibleSteps.find(
          (e) =>
            e.status !== "COMPLETED" &&
            steps.get(e.stepKey)?.configuration.stepType === "confirmation",
        );
        if (open === undefined) break;
        // Shown first, then confirmed on their yes (the voice path's rule).
        if (
          RECORD_REVIEWS.has(open.stepKey) &&
          input.reviewShown?.(open.stepKey) === false
        ) {
          return {
            completed: false,
            missing: [],
            reason: REVIEW_NOT_SHOWN_REASON,
          };
        }
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
        const before = view;
        latest = await sessionWrite(
          { kind: "COMPLETE", request: {} },
          { version: () => Promise.resolve(before.session.version) },
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
      turnSteps.clear();
      addingNow.clear();
      for (const answer of answers) turnSteps.add(answer.stepKey);
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
      const writeMerged = (
        plan: Extract<Planned, { kind: "WRITE" }>,
        stepKey: string,
      ): Promise<OnboardingRecordResult> =>
        write(plan.step, plan.value, plan.note, plan.quote)
          .then((result) => {
            if (result.outcome === "COMMITTED") {
              noteFigure(plan.step, plan.value, plan.quote);
            }
            return result;
          })
          .catch((error: unknown) => refused(stepKey, error));
      // One write per list step (live 2026-10-31, "Fjordwerk": the reader
      // gave "Nordics" and "Germany" as two items; each was written over
      // the other in the same batch and only Germany stayed). Every item
      // is checked on its own words above; what they allow is merged here.
      const merged = mergeListPlans(plans, await onRecordFor(plans));
      for (const [index, plan] of merged.plans.entries()) plans[index] = plan;
      const writes = plans.flatMap((plan, index) =>
        plan.kind === "WRITE" ? [{ plan, index }] : [],
      );
      // At most ONBOARDING_RESPONSES_BATCH_MAX a transaction; a longer
      // answer is saved in consecutive batches, in order.
      // One write correcting a held answer goes the batch way too: the
      // original is written first there, then the correction.
      const correctsHeld = async (): Promise<boolean> => {
        const only = writes[0]?.plan;
        return (
          writes.length === 1 &&
          only?.kind === "WRITE" &&
          (
            await heldOriginals([
              { stepKey: only.step.stepKey, value: only.value },
            ]).catch(reported("held originals read", new Map()))
          ).size > 0
        );
      };
      const committedBatch =
        writes.length > 1 || (await correctsHeld())
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
        // Several items merged into this write: written as merged, never
        // re-planned from one of them.
        if (plan.kind === "WRITE" && merged.leaders.has(index)) {
          results.push(await writeMerged(plan, answer.stepKey));
          continue;
        }
        // One write, a confirmation, or a batch the service could not
        // take as one: the single path, in the order they spoke.
        results.push(await safely(answer));
      }
      // Items merged into another's write share its outcome.
      for (const [index, leader] of merged.followers) {
        const result = results[leader];
        if (result !== undefined) results[index] = result;
      }
      /**
       * Answers tried again after the batch, planned together and merged
       * as the batch was: one write per list step, adding to what this
       * call already wrote for it (never replacing it).
       */
      const retry = async (indices: readonly number[]): Promise<void> => {
        for (const result of results) {
          if (result.outcome === "COMMITTED") addingNow.add(result.stepKey);
        }
        const again: Planned[] = [];
        for (const index of indices) {
          const answer = answers[index];
          if (answer === undefined) continue;
          again.push(
            await planOne(answer).catch((error: unknown): Planned =>
              done(refused(answer.stepKey, error)),
            ),
          );
        }
        const joined = mergeListPlans(again, await onRecordFor(again));
        for (const [at, plan] of joined.plans.entries()) {
          const index = indices[at];
          const answer = index === undefined ? undefined : answers[index];
          if (index === undefined || answer === undefined) continue;
          results[index] =
            plan.kind === "DONE"
              ? plan.result
              : plan.kind === "WRITE"
                ? await writeMerged(plan, answer.stepKey)
                : await safely(answer);
        }
        for (const [at, leader] of joined.followers) {
          const index = indices[at];
          const result = results[indices[leader] ?? -1];
          if (index !== undefined && result !== undefined) {
            results[index] = result;
          }
        }
      };
      // Live AI 2026-10-16: a new investor's first answer set up their
      // profile in this batch, and the category look-ups planned before it
      // were refused (no organisation context yet), so geography and
      // sectors were lost. Once anything committed, they are planned again.
      if (written.length > writtenBefore) {
        await retry(
          [...failedToPlan].filter(
            (index) => results[index]?.outcome !== "COMMITTED",
          ),
        );
      }
      // A refused step whose prerequisite landed later in the batch gets
      // one more try, so the order they spoke in does not matter (each
      // round's writes may let another's prerequisite land).
      const triedAgain = new Set<number>();
      for (;;) {
        const round = results.flatMap((result, index) =>
          !triedAgain.has(index) &&
          result.outcome === "NEEDS_FIRST" &&
          answers[index] !== undefined &&
          result.needsStepKey !== undefined &&
          written.includes(result.needsStepKey)
            ? [index]
            : [],
        );
        if (round.length === 0) break;
        for (const index of round) triedAgain.add(index);
        await retry(round);
      }
      // QA F-52: what was kept until the firm or company existed is saved
      // the turn it comes to exist, not one turn later. Held rows older
      // than an answer this turn saved directly are settled, never written
      // over it (the drain compares when each was given).
      if (input.held !== undefined && written.length > writtenBefore) {
        await replayHeldWrites().catch(reported("held writes replay", null));
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
        } catch (caught: unknown) {
          reported("stated option save", undefined)(caught);
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
      const affirmed = new Set<string>();
      for (const held of await heard) {
        const step = steps.get(held.stepKey);
        if (
          (isParaphraseRationale(held.rationale) &&
            held.value.type === "TEXT" &&
            heardBack(held.value.text, input.lastQTurn)) ||
          (step !== undefined && (await readBackHeard(step, held)))
        ) {
          affirmed.add(held.stepKey);
        }
      }
      return affirmed;
    },
    holdInferred: async (answers) => {
      /** The part of their words a held value was read from. */
      const inferredFrom = (
        step: OnboardingStepManifest,
        answer: {
          readonly quote: string;
          readonly value: string | readonly string[] | number | boolean;
        },
      ): string => {
        const label =
          coverageProfileFor(input.journeyType).fields[step.stepKey]?.label ??
          SPOKEN_QUESTIONS[step.stepKey] ??
          step.configuration.prompt;
        const value =
          typeof answer.value === "object"
            ? answer.value.join(" ")
            : String(answer.value);
        return fieldWordsOf(answer.quote, `${label} ${value}`).slice(0, 160);
      };
      const results: OnboardingRecordResult[] = [];
      /** What this call holds for each step so far. */
      const heldHere = new Map<string, OnRecordList>();
      for (const answer of answers) {
        try {
          if (!said(answer.quote)) {
            results.push(unsaid(answer.stepKey));
            continue;
          }
          const resolved = await resolve(answer);
          if (!resolved.ok) {
            results.push(resolved.result);
            continue;
          }
          // Already what the record holds: nothing to put to them.
          const onRecord = (await current()).responses.find(
            (r) => r.stepKey === resolved.step.stepKey,
          );
          if (
            onRecord !== undefined &&
            sameValue(onRecord.value, resolved.value)
          ) {
            continue;
          }
          // A figure read from words that give none ("a bit under a year
          // of runway" read as 12, live 2026-10-31): an approximation is
          // kept as they said it, as "a dozen or so" is, never a bare
          // figure put to them as theirs.
          const approximately =
            resolved.value.type === "RANGE" &&
            onRecord === undefined &&
            // An amount said in words ("half a million") is still a
            // figure, put to them as before.
            !MONEY_STEP.test(resolved.step.stepKey)
              ? inferredFrom(resolved.step, answer)
              : null;
          if (
            resolved.value.type === "RANGE" &&
            approximately !== null &&
            approximately.trim().length > 0 &&
            figureStatedIn(resolved.value.value, approximately) === null &&
            !impossibleFigure(resolved.value.value)
          ) {
            results.push(
              await write(resolved.step, {
                type: "TEXT",
                text: approximately.slice(0, 500),
              }),
            );
            continue;
          }
          if (
            resolved.value.type === "TEXT" &&
            PARAPHRASABLE.has(resolved.step.configuration.stepType)
          ) {
            results.push(
              await holdParaphrase(resolved.step, resolved.value, answer.quote),
            );
            continue;
          }
          const question = (
            SPOKEN_QUESTIONS[resolved.step.stepKey] ??
            resolved.step.configuration.prompt
          ).slice(0, 400);
          if (store === undefined) {
            results.push({
              stepKey: resolved.step.stepKey,
              outcome: "REJECTED",
              question,
              reason:
                "That would be your inference, so nothing was recorded. Ask them.",
            });
            continue;
          }
          // Items of one list step held together are one suggestion with
          // them all (live 2026-10-31: each item held over the one before).
          const before = heldHere.get(resolved.step.stepKey);
          const value =
            before === undefined || !holdsMany(resolved.step)
              ? resolved.value
              : (mergeListValues([before, { value: resolved.value }])?.value ??
                resolved.value);
          heldHere.set(resolved.step.stepKey, { value });
          try {
            await store.recommend({
              userId,
              sessionId: input.onboardingSessionId,
              stepKey: resolved.step.stepKey,
              value,
              // The words that gave it, not the head of a long line (live
              // 2026-10-31: "a bit under a year of runway" was held as 12
              // months under a quote cut before it, and kept as a bare 12).
              rationale: `From what you said earlier: "${inferredFrom(
                resolved.step,
                answer,
              )}"`,
              runId: input.runId ?? null,
              // A re-reading of the same words keeps the suggestion already
              // waiting rather than replacing it (as holdParaphrase); the
              // merged one replaces this call's own first item.
              keepPendingSince:
                before === undefined ? input.saidAt?.(answer.quote) : undefined,
            });
          } catch (error: unknown) {
            if (
              typeof error === "object" &&
              error !== null &&
              "reason" in error &&
              error.reason === "SUGGESTION_REJECTED_BEFORE"
            ) {
              // They turned exactly this down: never put to them again.
              results.push({
                stepKey: resolved.step.stepKey,
                outcome: "REJECTED",
                question,
                reason: "They turned that suggestion down before.",
              });
              continue;
            }
            throw error;
          }
          results.push({
            stepKey: resolved.step.stepKey,
            outcome: "REJECTED",
            question,
            reason:
              "Held for their confirmation, not recorded: it is your reading of something they said. Put it to them; their yes records it.",
          });
        } catch (error: unknown) {
          results.push(refused(answer.stepKey, error));
        }
      }
      return results;
    },
    recordNotKnown: async (items) => {
      const results: OnboardingRecordResult[] = [];
      for (const item of items) {
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
        if (!step.required) {
          results.push({
            stepKey: step.stepKey,
            outcome: "REJECTED",
            question,
            reason: "An optional step they do not know is set aside.",
          });
          continue;
        }
        if (!said(item.quote)) {
          results.push(unsaid(step.stepKey));
          continue;
        }
        // Theirs only when the reading of their words found it (declined
        // carries what they do not know, by meaning).
        if (input.authority !== undefined) {
          const authority = await input.authority();
          if (authority?.declined.has(step.stepKey) !== true) {
            results.push({
              stepKey: step.stepKey,
              outcome: "REJECTED",
              question,
              reason: "Their words do not say they do not know this one.",
            });
            continue;
          }
        }
        try {
          const onRecord = (await current()).responses.find(
            (r) => r.stepKey === step.stepKey,
          );
          // The step's own "Not sure yet" where it has one (investor v3,
          // live re-check 2026-10-31): an answer its write target reads as
          // unknown. Otherwise the words of NOT_KNOWN_TEXT.
          const notSure = optionsOf(step).find(
            (option) => option.key === NOT_SURE_OPTION_KEY,
          );
          const recorded = notSure?.label ?? NOT_KNOWN_TEXT;
          if (
            (onRecord?.value.type === "TEXT" &&
              onRecord.value.text === NOT_KNOWN_TEXT) ||
            (onRecord?.value.type === "SINGLE_SELECT" &&
              onRecord.value.optionKey === NOT_SURE_OPTION_KEY)
          ) {
            results.push({
              stepKey: step.stepKey,
              outcome: "COMMITTED",
              question,
              recorded,
              alreadyRecorded: true,
            });
            continue;
          }
          // A new version over whatever was there (history kept): what was
          // on record is no longer known, by their own word. A session
          // pinned to a version without the option takes the words.
          const asOption =
            notSure === undefined
              ? false
              : await submit(step.stepKey, {
                  type: "SINGLE_SELECT",
                  optionKey: NOT_SURE_OPTION_KEY,
                }).then(() => true, reported("not-sure option save", false));
          if (!asOption) {
            await submit(step.stepKey, { type: "TEXT", text: NOT_KNOWN_TEXT });
          }
          written.push(step.stepKey);
          results.push({
            stepKey: step.stepKey,
            outcome: "COMMITTED",
            question,
            recorded: asOption ? recorded : NOT_KNOWN_TEXT,
          });
        } catch (error: unknown) {
          results.push(refused(step.stepKey, error));
        }
      }
      return results;
    },
    pendingRecommendations: async () => {
      const view = await current();
      const list = await pendingNow().catch(reported("held writes read", []));
      const out: {
        stepKey: string;
        value: string;
        rationale: string | null;
        fromDocument: boolean;
      }[] = [];
      for (const item of list) {
        const step = steps.get(item.stepKey);
        if (step === undefined) continue;
        out.push({
          stepKey: item.stepKey,
          value: (await spoken(step, item.value, view)).slice(0, 600),
          rationale: item.rationale,
          fromDocument: item.fromDocument === true,
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
/** The most words a line of theirs may have and still need no say-back. */
const SHORT_ANSWER_WORDS = 30;

/**
 * Whether a step's answer is told at length (what the company does, the
 * problem, how it makes money): saved as Q's summary they agreed to in
 * the conversation, never as their raw words.
 */
export function isLongAnswerStep(
  journeyType: "investor" | "founder",
  stepKey: string,
): boolean {
  const step = definitionFor(journeyType).steps.find(
    (s) => s.stepKey === stepKey,
  );
  return step !== undefined && PARAPHRASABLE.has(step.configuration.stepType);
}

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

/** How many words a topic's name before a colon may be. */
const TOPIC_NAME_WORDS_MAX = 6;

/**
 * A summary of Q's as a field's content (live check 2026-10-31,
 * "Grannskap": "The process is: farms list…" and "a marketplace where…"
 * were saved as they were said). The reading gives the content (reader
 * v12); this keeps two things structural, never a list of phrases: a
 * say-back line written as a topic's name and then its content ("The
 * problem: Small farms…", as ONBOARDING_TYPED_REPLY v6 asks) keeps the
 * content only, when the name is a few words before the line's first
 * colon and the reading's own earlier text for the field (`reference`)
 * shares none of the name's words; and the first letter is a capital.
 * Idempotent.
 */
export function summaryContent(text: string, reference: string | null): string {
  let content = text.trim().replace(/\s+/gu, " ");
  const colon = content.indexOf(":");
  if (colon > 0) {
    const name = content.slice(0, colon);
    const rest = content.slice(colon + 1).trim();
    const nameWords = name.split(/\s+/u).filter((w) => w.length > 0);
    const referenceWords = new Set(contentWords(reference ?? ""));
    if (
      nameWords.length <= TOPIC_NAME_WORDS_MAX &&
      !/[\d.!?;]/u.test(name) &&
      rest.split(/\s+/u).length >= 3 &&
      !contentWords(name).some((word) => referenceWords.has(word))
    ) {
      content = rest;
    }
  }
  const head = content.charAt(0);
  return head.toLocaleUpperCase() === head
    ? content
    : `${head.toLocaleUpperCase()}${content.slice(1)}`;
}

/**
 * Q's own words for one field, from a summary line of Q's they agreed to:
 * the statements of that line (never its question) that the reading of
 * the field mostly shares words with. Null when no part of the line does.
 * Structure only, as `fieldClausesOf`: which field a line covered is the
 * reading's, by meaning; this only finds where in Q's line it is.
 */
export function summaryWordsFor(
  reading: string,
  qLine: string | undefined,
): string | null {
  if (qLine === undefined) return null;
  const wanted = new Set(contentWords(reading));
  if (wanted.size === 0) return null;
  const DECIMAL = "\u0000";
  const statements = (
    qLine
      .replace(/(\d)\.(\d)/gu, `$1${DECIMAL}$2`)
      .match(/[^.!?]+[.!?]*/gu) ?? [qLine]
  )
    .map((sentence) => sentence.replaceAll(DECIMAL, ".").trim())
    // What Q asked is not what Q said back: a question is left out, and a
    // short question tagged on a statement ("…rejected loads—is that
    // right?") leaves the statement.
    .map((sentence) => {
      if (!sentence.endsWith("?")) return sentence;
      const cut = Math.max(
        sentence.lastIndexOf("—"),
        sentence.lastIndexOf("–"),
        sentence.lastIndexOf(" - "),
        sentence.lastIndexOf(", "),
      );
      const tag = cut < 0 ? sentence : sentence.slice(cut);
      return cut > 0 && tag.trim().split(/\s+/u).length <= 6
        ? sentence.slice(0, cut)
        : "";
    })
    .filter((sentence) => sentence.trim().length > 0);
  const parts: string[] = [];
  for (const statement of statements) {
    for (const clause of statement.split(
      /\s*[;:]\s+|\s*[—–]\s*|,\s+(?=\p{Ll})/u,
    )) {
      const words = contentWords(clause);
      if (words.length === 0) continue;
      const shared = words.filter((word) => wanted.has(word)).length;
      if (shared / words.length >= 0.5) {
        parts.push(clause.trim().replace(/[,;:\s.]+$/u, ""));
      }
    }
  }
  return parts.length > 0 ? parts.join("; ").slice(0, 600) : null;
}

/** The clauses of their words that carry the field's own words, or null. */
export function fieldClausesOf(quote: string, reading: string): string | null {
  const said = quote.trim();
  if (said.length <= 80) return said.length > 0 ? said : null;
  const wanted = new Set(contentWords(reading));
  if (wanted.size === 0) return null;
  const carries = (text: string) =>
    contentWords(text).some((word) => wanted.has(word));
  // A point between two digits is a decimal, not a sentence's end (live
  // 2026-10-28: "KSh 2.1m a month" was kept as "KSh 2.; 1m a month").
  const DECIMAL = "\u0000";
  const sentences = (
    said
      .replace(/(\d)\.(\d)/gu, `$1${DECIMAL}$2`)
      .match(/[^.!?;]+[.!?;]*/gu) ?? [said]
  ).map((sentence) => sentence.replaceAll(DECIMAL, "."));
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
/**
 * Choices whose label they named in part: a word of the label (three
 * letters or more) said as a whole word, when no choice they named in full
 * shares it. "crypto" names Speculative crypto beside Gambling and Tobacco;
 * "Series A" never names Series B, which shares only "series" with it. The
 * vocabulary's own labels compared with their words, nothing else.
 */
export function partlyNamedOptions(
  step: { readonly configuration: unknown },
  namedInFull: ReadonlySet<string>,
  texts: readonly string[],
): ReadonlySet<string> {
  const options =
    (
      step.configuration as {
        readonly options?: readonly {
          readonly optionKey?: string;
          readonly label?: string;
        }[];
      }
    ).options ?? [];
  const wordsOf = (label: string) =>
    normalisedWords(label)
      .trim()
      .split(" ")
      .filter((word) => word.length >= 3);
  const taken = new Set(
    options
      .filter((option) => namedInFull.has(option.optionKey ?? ""))
      .flatMap((option) => wordsOf(option.label ?? "")),
  );
  const said = texts.map(normalisedWords).join(" ");
  const partly = new Set<string>();
  for (const option of options) {
    const key = option.optionKey ?? "";
    if (key.length === 0 || namedInFull.has(key)) continue;
    const distinctive = wordsOf(option.label ?? "").filter(
      (word) => !taken.has(word),
    );
    if (
      distinctive.some((word) =>
        [word, `${word}s`, word.replace(/s$/u, "")].some((form) =>
          said.includes(` ${form} `),
        ),
      )
    ) {
      partly.add(key);
    }
  }
  return partly;
}

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
