import { z } from "zod";

import type { SnapshotSection } from "@capital-q/ui/intelligence-snapshot";

import {
  ASSET_TYPES,
  CLARIFICATION_WITH_DECK,
  CLARIFICATION_WITHOUT_DECK,
  COUNTRY_OPTIONS,
  CURRENCIES,
  DECK_FACTS,
  DESCRIPTION_FACTS,
  FIXTURE_COMPANY_NAME,
  FOUNDER_COUNT_OPTIONS,
  FULL_TIME_OPTIONS,
  FUNCTION_OPTIONS,
  INSTRUMENT_OPTIONS,
  INTENT_OPTIONS,
  PRE_REVENUE_METRICS,
  PROVISIONAL_ACCEPTED_EXTENSIONS,
  RAISING_OPTIONS,
  REVENUE_METRICS,
  ROLE_OPTIONS,
  STAGE_OPTIONS,
  TAXONOMY_SUGGESTIONS,
  TEAM_SIZE_OPTIONS,
  TIMEFRAME_OPTIONS,
  USE_OF_FUNDS_OPTIONS,
} from "../fixtures/nexarail";
import {
  StepResponseSchema,
  type FounderOnboardingSessionView,
  type SectionId,
  type StepResponse,
  type StepSummary,
  type StepView,
} from "../models/presentation";
import {
  type FounderOnboardingClient,
  FounderOnboardingClientError,
} from "./client";

/**
 * FounderOnboardingFixtureClient — deterministic, synthetic, development-only.
 *
 * Plays the role the onboarding runtime (CQ-ONB-001/002) will play: it owns
 * the step definition, decides which step comes next, adapts the business
 * section to the stage answer and the review/clarification steps to whether
 * a document was provided, and returns whole session views. Screens never
 * decide any of that.
 *
 * State lives in sessionStorage under a namespaced development key so
 * refresh and re-entry resume. It holds only what the founder typed into a
 * synthetic session; there is no real document content and no upload.
 *
 * Never composed in production: see `compose.ts` and the web config guard.
 */

export const FIXTURE_ADAPTER_NAME = "FounderOnboardingFixtureClient";
export const FIXTURE_STORAGE_KEY = "cq:dev:founder-onboarding:fixture:v1";

export const FIXTURE_SEEDS = [
  "reset",
  "review",
  "revenue",
  "clarify",
  "intelligence",
  "flaky",
] as const;
export type FixtureSeed = (typeof FIXTURE_SEEDS)[number];

const StoredStateSchema = z.object({
  version: z.literal(1),
  responses: z.record(
    z.string(),
    z.union([StepResponseSchema, z.object({ skipped: z.literal(true) })]),
  ),
  files: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sizeBytes: z.number(),
      kind: z.string(),
      state: z.enum([
        "selected",
        "uploading",
        "uploaded",
        "processing",
        "ready",
        "failed",
      ]),
      failureReason: z.string().optional(),
    }),
  ),
  currentStepId: z.string(),
  status: z.enum(["in_progress", "complete"]),
  failNextSave: z.boolean(),
  fileCounter: z.number().int(),
});
type StoredState = z.infer<typeof StoredStateSchema>;
type StoredResponse = StoredState["responses"][string];

type StepDefinition = {
  readonly id: string;
  readonly section: SectionId;
  readonly title: string;
  readonly optional: boolean;
};

const SECTIONS = [
  { id: "company", label: "Company" },
  { id: "business", label: "Business" },
  { id: "raise", label: "Raise" },
  { id: "review", label: "Review" },
] as const;

const DEFINITION: readonly StepDefinition[] = [
  {
    id: "intent",
    section: "company",
    title: "What brings you to Capital Q?",
    optional: false,
  },
  {
    id: "company_basics",
    section: "company",
    title: "Your company",
    optional: false,
  },
  {
    id: "stage",
    section: "company",
    title: "What stage is the company at?",
    optional: false,
  },
  {
    id: "description",
    section: "company",
    title: "What does the company do?",
    optional: true,
  },
  {
    id: "assets",
    section: "company",
    title: "What do you already have?",
    optional: false,
  },
  {
    id: "understanding",
    section: "company",
    title: "Here's what I understand",
    optional: false,
  },
  {
    id: "team",
    section: "business",
    title: "Your founding team",
    optional: false,
  },
  {
    id: "edge",
    section: "business",
    title: "What gives your team an edge?",
    optional: true,
  },
  {
    id: "traction",
    section: "business",
    title: "Business and traction",
    optional: false,
  },
  {
    id: "capital_objective",
    section: "raise",
    title: "The raise",
    optional: false,
  },
  {
    id: "clarification",
    section: "review",
    title: "One thing to clarify",
    optional: true,
  },
  {
    id: "intelligence",
    section: "review",
    title: "Your initial company understanding",
    optional: false,
  },
];

const EMPTY_STATE: StoredState = {
  version: 1,
  responses: {},
  files: [],
  currentStepId: "intent",
  status: "in_progress",
  failNextSave: false,
  fileCounter: 0,
};

const SEEDED_RESPONSES: Record<string, StoredResponse> = {
  intent: { kind: "choice", value: "raising" },
  company_basics: {
    kind: "company_basics",
    name: FIXTURE_COMPANY_NAME,
    website: "nexarail.example",
    countryCode: "NG",
  },
  stage: { kind: "choice", value: "seed" },
  description: {
    kind: "narrative",
    text: "We automate claims handling for mid-sized insurers with an API their existing systems can call.",
  },
  assets: { kind: "asset_selection", assetTypes: ["pitch_deck"] },
  understanding: {
    kind: "understanding_review",
    facts: DECK_FACTS.map((fact) => ({
      id: fact.id,
      value: fact.value,
      verdict: fact.id === "traction" ? "suggested" : "confirmed",
    })),
    taxonomy: [...TAXONOMY_SUGGESTIONS],
  },
  team: {
    kind: "team",
    founders: "2",
    fullTime: "all",
    role: "ceo",
    functions: ["product", "engineering", "domain"],
    teamSize: "6_15",
  },
  edge: { skipped: true },
  traction: {
    kind: "traction",
    metrics: {
      signal: { value: "pilots" },
      pilots: { value: "4" },
      partnerships: { unknown: true },
    },
  },
  capital_objective: {
    kind: "capital_objective",
    raisingStatus: "active",
    targetAmount: { amount: "2500000", currency: "USD" },
    instrument: "priced",
    timeframe: "3_6",
    useOfFunds: ["product", "gtm"],
  },
  clarification: { kind: "clarification", choice: "31" },
};

const SEED_FILE: StoredState["files"][number] = {
  id: "fixture-file-1",
  name: "NexaRail-seed-deck.pdf",
  sizeBytes: 2_411_000,
  kind: "PDF",
  state: "ready",
};

function seededState(seed: FixtureSeed): StoredState {
  const take = (ids: readonly string[]): StoredState["responses"] =>
    Object.fromEntries(
      ids.map((id) => [id, SEEDED_RESPONSES[id] as StoredResponse]),
    );
  switch (seed) {
    case "reset":
      return EMPTY_STATE;
    case "flaky":
      return { ...EMPTY_STATE, failNextSave: true };
    case "review":
      return {
        ...EMPTY_STATE,
        responses: take([
          "intent",
          "company_basics",
          "stage",
          "description",
          "assets",
        ]),
        files: [SEED_FILE],
        currentStepId: "understanding",
        fileCounter: 1,
      };
    case "revenue":
      return {
        ...EMPTY_STATE,
        responses: {
          ...take([
            "intent",
            "company_basics",
            "description",
            "assets",
            "understanding",
            "team",
            "edge",
          ]),
          stage: { kind: "choice", value: "series_a" },
        },
        files: [SEED_FILE],
        currentStepId: "traction",
        fileCounter: 1,
      };
    case "clarify":
      return {
        ...EMPTY_STATE,
        responses: take([
          "intent",
          "company_basics",
          "stage",
          "description",
          "assets",
          "understanding",
          "team",
          "edge",
          "traction",
          "capital_objective",
        ]),
        files: [SEED_FILE],
        currentStepId: "clarification",
        fileCounter: 1,
      };
    case "intelligence":
      return {
        ...EMPTY_STATE,
        responses: take(Object.keys(SEEDED_RESPONSES)),
        files: [SEED_FILE],
        currentStepId: "intelligence",
        fileCounter: 1,
      };
  }
}

export type FixtureClientOptions = {
  /** sessionStorage in the browser; null keeps state in memory (tests). */
  readonly storage: Storage | null;
  readonly seed?: FixtureSeed | undefined;
};

export function createFounderOnboardingFixtureClient(
  options: FixtureClientOptions,
): FounderOnboardingClient {
  const { storage } = options;
  let memory: StoredState =
    options.seed !== undefined ? seededState(options.seed) : load();
  if (options.seed !== undefined) {
    persist(memory);
  }

  function load(): StoredState {
    if (storage === null) {
      return EMPTY_STATE;
    }
    try {
      const raw = storage.getItem(FIXTURE_STORAGE_KEY);
      if (raw === null) {
        return EMPTY_STATE;
      }
      const parsed = StoredStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : EMPTY_STATE;
    } catch {
      return EMPTY_STATE;
    }
  }

  function persist(state: StoredState): void {
    memory = state;
    if (storage !== null) {
      try {
        storage.setItem(FIXTURE_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Storage may be unavailable (private mode); the session still works in memory.
      }
    }
  }

  // ---- derived definition helpers ------------------------------------------

  function response<TKind extends StepResponse["kind"]>(
    state: StoredState,
    stepId: string,
    kind: TKind,
  ): Extract<StepResponse, { kind: TKind }> | undefined {
    const stored = state.responses[stepId];
    if (stored === undefined || "skipped" in stored || stored.kind !== kind) {
      return undefined;
    }
    return stored as Extract<StepResponse, { kind: TKind }>;
  }

  const hasDocument = (state: StoredState) =>
    state.files.some((file) => file.state === "ready");
  const stageValue = (state: StoredState) =>
    response(state, "stage", "choice")?.value;
  const isRevenueStage = (state: StoredState) => {
    const stage = stageValue(state);
    return stage === "series_a" || stage === "series_b_plus";
  };
  const companyName = (state: StoredState) =>
    response(state, "company_basics", "company_basics")?.name ?? "your company";

  function stepStatus(state: StoredState, id: string): StepSummary["status"] {
    if (state.currentStepId === id && state.status === "in_progress") {
      return "current";
    }
    const stored = state.responses[id];
    if (stored === undefined) {
      return id === "intelligence" && state.status === "complete"
        ? "completed"
        : "pending";
    }
    return "skipped" in stored ? "skipped" : "completed";
  }

  function indexOf(id: string): number {
    const index = DEFINITION.findIndex((step) => step.id === id);
    if (index < 0) {
      throw new FounderOnboardingClientError(
        "REJECTED",
        "Unknown onboarding step.",
      );
    }
    return index;
  }

  function buildStep(state: StoredState, id: string): StepView {
    const definition = DEFINITION[indexOf(id)];
    if (definition === undefined) {
      throw new FounderOnboardingClientError(
        "REJECTED",
        "Unknown onboarding step.",
      );
    }
    const stored = state.responses[id];
    const base = {
      id,
      section: definition.section,
      title: definition.title,
      optional: definition.optional,
      skipped: stored !== undefined && "skipped" in stored,
    };
    switch (id) {
      case "intent":
        return {
          ...base,
          kind: "choice",
          help: "We'll use this to focus what Q asks first.",
          options: INTENT_OPTIONS,
          response: response(state, id, "choice"),
        };
      case "company_basics":
        return {
          ...base,
          kind: "company_basics",
          help: "Just the basics. Q fills in the rest from what you share next.",
          countries: COUNTRY_OPTIONS,
          response: response(state, id, "company_basics"),
        };
      case "stage":
        return {
          ...base,
          kind: "choice",
          help: "This shapes which questions matter, not how the company is judged.",
          options: STAGE_OPTIONS,
          response: response(state, id, "choice"),
        };
      case "description":
        return {
          ...base,
          kind: "narrative",
          prompt: `In a sentence or two, what does ${companyName(state)} do?`,
          help: "Plain language is best. Q maps it to categories for you.",
          placeholder: "We help … do … by …",
          maxLength: 400,
          voiceEnabled: false,
          response: response(state, id, "narrative"),
        };
      case "assets":
        return {
          ...base,
          kind: "asset_selection",
          help: "Q works from whatever exists. Nothing here is a requirement.",
          privacyNote:
            "Your files stay private to your company unless you choose to share information later.",
          assetTypes: ASSET_TYPES,
          exclusiveValues: ["nothing"],
          acceptedExtensions: PROVISIONAL_ACCEPTED_EXTENSIONS,
          files: state.files,
          response: response(state, id, "asset_selection"),
        };
      case "understanding": {
        const saved = response(state, id, "understanding_review");
        const source = hasDocument(state) ? DECK_FACTS : DESCRIPTION_FACTS;
        const stage = STAGE_OPTIONS.find(
          (option) => option.value === stageValue(state),
        )?.label;
        const facts = source.map((fact) => {
          const savedFact = saved?.facts.find((entry) => entry.id === fact.id);
          const value =
            fact.id === "stage" && stage !== undefined ? stage : fact.value;
          return savedFact === undefined
            ? { ...fact, value }
            : { ...fact, value: savedFact.value, verdict: savedFact.verdict };
        });
        return {
          ...base,
          kind: "understanding_review",
          intro: hasDocument(state)
            ? "Based on your deck and what you've told me so far. Confirm what's right, fix what isn't, and mark what I'm missing."
            : "Based on what you've told me so far. Without a document there are gaps; that's expected at this point.",
          privacyNote: "Private to your company",
          primaryActionLabel: "Confirm and continue",
          facts,
          taxonomyOptions:
            saved === undefined
              ? [...TAXONOMY_SUGGESTIONS]
              : Array.from(
                  new Set([...TAXONOMY_SUGGESTIONS, ...saved.taxonomy]),
                ),
          taxonomySelected: saved?.taxonomy ?? [...TAXONOMY_SUGGESTIONS],
          response: saved,
        };
      }
      case "team":
        return {
          ...base,
          kind: "team",
          help: "Structure first; the story comes next.",
          founderOptions: FOUNDER_COUNT_OPTIONS,
          fullTimeOptions: FULL_TIME_OPTIONS,
          roleOptions: ROLE_OPTIONS,
          functionOptions: FUNCTION_OPTIONS,
          teamSizeOptions: TEAM_SIZE_OPTIONS,
          response: response(state, id, "team"),
        };
      case "edge":
        return {
          ...base,
          kind: "narrative",
          prompt: "What gives your founding team an edge here?",
          help: "Optional. A few specific sentences beat a paragraph of adjectives.",
          placeholder: "Before this we …",
          maxLength: 600,
          voiceEnabled: false,
          response: response(state, id, "narrative"),
        };
      case "traction": {
        const revenue = isRevenueStage(state);
        return {
          ...base,
          kind: "traction",
          variant: revenue ? "revenue" : "pre_revenue",
          intro: revenue
            ? "You said the company is past seed, so these questions are about revenue. Leave anything you don't track."
            : "At this stage Q looks for early signal rather than revenue. Leave anything that doesn't apply.",
          metrics: revenue ? REVENUE_METRICS : PRE_REVENUE_METRICS,
          currencies: CURRENCIES,
          response: response(state, id, "traction"),
        };
      }
      case "capital_objective":
        return {
          ...base,
          kind: "capital_objective",
          help: "Kept separate from the company profile. You can change any of this later.",
          raisingOptions: RAISING_OPTIONS,
          instrumentOptions: INSTRUMENT_OPTIONS,
          timeframeOptions: TIMEFRAME_OPTIONS,
          useOfFundsOptions: USE_OF_FUNDS_OPTIONS,
          currencies: CURRENCIES,
          response: response(state, id, "capital_objective"),
        };
      case "clarification": {
        const withDeck = hasDocument(state);
        const source = withDeck
          ? CLARIFICATION_WITH_DECK
          : CLARIFICATION_WITHOUT_DECK;
        return {
          ...base,
          kind: "clarification",
          observation: source.observation,
          question: source.question,
          why: source.why,
          options: [...source.options],
          allowText: true,
          response: response(state, id, "clarification"),
        };
      }
      case "intelligence":
        return {
          ...base,
          kind: "intelligence_snapshot",
          ...buildSnapshot(state),
          response: undefined,
        };
      default:
        throw new FounderOnboardingClientError(
          "REJECTED",
          "Unknown onboarding step.",
        );
    }
  }

  function buildSnapshot(state: StoredState): {
    headline: string;
    summary: string;
    sections: readonly SnapshotSection[];
    nextSteps: readonly { id: string; text: string }[];
    provenanceNote: string;
  } {
    const withDeck = hasDocument(state);
    const raise = response(state, "capital_objective", "capital_objective");
    const clarification = response(state, "clarification", "clarification");
    const customers =
      clarification?.choice === "45"
        ? "45"
        : clarification?.choice === "31"
          ? "31"
          : undefined;
    const raising = raise?.raisingStatus === "active";

    const standsOut: SnapshotSection = {
      id: "stands_out",
      title: "What stands out",
      items: [
        withDeck
          ? {
              id: "traction",
              text: `Enterprise traction is becoming clear${customers !== undefined ? `: ${customers} paying insurers is a real base for a claims product` : ""}.`,
              evidence: "from_document",
              evidenceDetail: "deck",
            }
          : {
              id: "focus",
              text: "The problem is narrow and specific, which makes the story easier for investors to evaluate.",
              evidence: "from_founder",
            },
        {
          id: "team",
          text: "A founding team covering product, engineering and industry depth removes the most common early objection.",
          evidence: "from_founder",
        },
      ],
    };
    const attention: SnapshotSection = {
      id: "attention",
      title: "What needs attention",
      items: [
        raising
          ? {
              id: "size",
              text: "The current raise is large relative to the evidence available for revenue durability.",
              evidence: "inferred",
            }
          : {
              id: "readiness",
              text: "Without a raise defined, Q can't yet frame readiness against a target.",
              evidence: "uncertain",
            },
        {
          id: "concentration",
          text: "Customer concentration isn't supported clearly yet.",
          evidence: "needs_evidence",
        },
        ...(withDeck
          ? []
          : [
              {
                id: "document",
                text: "There is no document behind the company description, so most facts are self-reported.",
                evidence: "needs_evidence" as const,
              },
            ]),
      ],
    };
    const investorsAsk: SnapshotSection = {
      id: "investors",
      title: "What investors may ask",
      items: [
        {
          id: "retention",
          text: "How many of the paying insurers renewed, and what does implementation take?",
          evidence: "inferred",
        },
        {
          id: "use",
          text: "What specifically the raise funds, and what changes by the end of it.",
          evidence:
            raise?.useOfFunds !== undefined && raise.useOfFunds.length > 0
              ? "from_founder"
              : "needs_evidence",
        },
      ],
    };
    return {
      headline: "Here's how I currently understand your company.",
      summary:
        "This is an initial understanding, not a score. It gets sharper as you add evidence, and nothing here is visible to investors.",
      sections: [standsOut, attention, investorsAsk],
      nextSteps: [
        {
          id: "concentration",
          text: "Clarify customer concentration: the top three customers as a share of revenue.",
        },
        {
          id: "use",
          text: "Add use-of-funds detail so the raise reads as a plan, not a number.",
        },
        {
          id: "financials",
          text: withDeck
            ? "Update the financial evidence behind the deck's revenue figures."
            : "Share a deck or memo so Q can check the story against a document.",
        },
      ],
      provenanceNote:
        "Synthetic preview from the development fixture. Real intelligence is produced by Q from your evidence.",
    };
  }

  function view(state: StoredState): FounderOnboardingSessionView {
    return {
      sessionId: "fixture-session",
      definitionVersion: "fixture-founder-1",
      status: state.status,
      sections: SECTIONS,
      steps: DEFINITION.map((step) => ({
        id: step.id,
        section: step.section,
        title: step.title,
        status: stepStatus(state, step.id),
      })),
      currentStepId: state.currentStepId,
      step: buildStep(state, state.currentStepId),
      source: { adapter: FIXTURE_ADAPTER_NAME, synthetic: true },
    };
  }

  function nextStepId(id: string): string {
    const next = DEFINITION[indexOf(id) + 1];
    return next === undefined ? id : next.id;
  }

  function advance(
    state: StoredState,
    fromId: string,
    stored: StoredResponse,
  ): StoredState {
    const next = nextStepId(fromId);
    // Reaching first-value intelligence completes the initial journey.
    const complete = next === "intelligence";
    return {
      ...state,
      responses: { ...state.responses, [fromId]: stored },
      currentStepId: next,
      status: complete ? "complete" : "in_progress",
    };
  }

  const ready = <T>(value: T): Promise<T> => Promise.resolve(value);

  return {
    getSession: () => ready(view(memory)),

    saveResponse: ({ stepId, response: candidate }) => {
      if (memory.failNextSave) {
        persist({ ...memory, failNextSave: false });
        return Promise.reject(
          new FounderOnboardingClientError(
            "NETWORK",
            "We couldn't save that. Check your connection and try again.",
          ),
        );
      }
      const parsed = StepResponseSchema.safeParse(candidate);
      if (!parsed.success) {
        return Promise.reject(
          new FounderOnboardingClientError(
            "REJECTED",
            "That answer couldn't be saved as entered.",
          ),
        );
      }
      if (stepId === "assets") {
        const failed = memory.files.some((file) => file.state === "failed");
        if (failed) {
          return Promise.reject(
            new FounderOnboardingClientError(
              "REJECTED",
              "Remove or retry the file that couldn't be read, or continue without it.",
            ),
          );
        }
      }
      persist(advance(memory, stepId, parsed.data));
      return ready(view(memory));
    },

    skipStep: ({ stepId }) => {
      const definition = DEFINITION[indexOf(stepId)];
      if (definition === undefined || !definition.optional) {
        return Promise.reject(
          new FounderOnboardingClientError(
            "REJECTED",
            "This step can't be skipped.",
          ),
        );
      }
      persist(advance(memory, stepId, { skipped: true }));
      return ready(view(memory));
    },

    goBack: ({ stepId }) => {
      const previous = DEFINITION[indexOf(stepId) - 1];
      if (previous === undefined) {
        return ready(view(memory));
      }
      persist({ ...memory, currentStepId: previous.id, status: "in_progress" });
      return ready(view(memory));
    },

    openStep: ({ stepId }) => {
      // Only ground already covered can be reopened; F8 is never reachable by
      // jumping ahead of the steps that feed it.
      const status = stepStatus(memory, stepId);
      if (status === "pending") {
        return Promise.reject(
          new FounderOnboardingClientError(
            "REJECTED",
            "That step isn't available yet.",
          ),
        );
      }
      persist({ ...memory, currentStepId: stepId, status: "in_progress" });
      return ready(view(memory));
    },

    attachFile: ({ file }) => {
      const extension = file.name
        .toLowerCase()
        .slice(file.name.lastIndexOf("."));
      const accepted = (
        PROVISIONAL_ACCEPTED_EXTENSIONS as readonly string[]
      ).includes(extension);
      const unreadable = file.name.toLowerCase().includes("unreadable");
      const counter = memory.fileCounter + 1;
      const selection: StoredState["files"][number] = {
        id: `fixture-file-${String(counter)}`,
        name: file.name,
        sizeBytes: file.sizeBytes,
        kind: extension.replace(".", "").toUpperCase() || "FILE",
        state: !accepted || unreadable ? "failed" : "ready",
        ...(accepted
          ? unreadable
            ? {
                failureReason:
                  "This file couldn't be read. It may be scanned, protected or empty.",
              }
            : {}
          : {
              failureReason:
                "This file type isn't supported yet. PDF, Word, PowerPoint and text files are.",
            }),
      };
      persist({
        ...memory,
        files: [...memory.files, selection],
        fileCounter: counter,
      });
      return ready(view(memory));
    },

    removeFile: ({ fileId }) => {
      persist({
        ...memory,
        files: memory.files.filter((file) => file.id !== fileId),
      });
      return ready(view(memory));
    },

    retryFile: ({ fileId }) => {
      persist({
        ...memory,
        files: memory.files.map((file) => {
          if (file.id !== fileId) {
            return file;
          }
          // A genuinely unreadable file stays failed; a transient failure clears.
          if (file.name.toLowerCase().includes("unreadable")) {
            return file;
          }
          const { failureReason: _dropped, ...rest } = file;
          return { ...rest, state: "ready" as const };
        }),
      });
      return ready(view(memory));
    },
  };
}
