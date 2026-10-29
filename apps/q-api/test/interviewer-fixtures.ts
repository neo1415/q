import type {
  OnboardingResponseValue,
  OnboardingSessionView,
} from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { InterviewConductorResult } from "@capital-q/q-core";

import { OnboardingSuggestionIdSchema } from "@capital-q/onboarding";

import type {
  InterviewGateway,
  InterviewTurnInput,
} from "../src/voice/interview-steps.js";
import type { RecommendationStore } from "../src/voice/onboarding-port.js";

/**
 * A standing-in investor onboarding session for the interviewer tests.
 *
 * Built over the REAL investor definition rather than an invented one,
 * because the behaviour under test is precisely how readings are matched
 * to steps, how the journey's prerequisites refuse them and how its
 * option vocabularies constrain them. A hand-written three-step journey
 * would agree with whatever the code did.
 *
 * It is a fake of the owning service, not of the interviewer: it accepts
 * or refuses submissions the way the service does, and the tests assert
 * on what it ended up holding. Prose is never the evidence.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const NOW = "2026-09-23T09:00:00.000Z";

export type InvestorWorld = {
  readonly journey?: "founder" | "investor" | undefined;
  readonly fetch: typeof fetch;
  /** What the session holds, as the owning service would report it. */
  readonly recordedValue: (
    stepKey: string,
  ) => OnboardingResponseValue | undefined;
  /** The person's own words kept with an answer, if any. */
  readonly recordedNote: (stepKey: string) => string | undefined;
  /** Put a value on the record directly, standing in for an earlier turn. */
  readonly record: (stepKey: string, value: OnboardingResponseValue) => void;
  readonly skippedSteps: () => readonly string[];
  /** The onboarding thread the API keeps, oldest first. */
  readonly thread: () => readonly {
    readonly role: "PERSON" | "Q";
    readonly text: string;
  }[];
  /** Every submission attempt, accepted or not, in order. */
  readonly attempts: () => readonly string[];
  /** Each batch submission, by the steps it carried. */
  readonly batches: () => readonly (readonly string[])[];
  /** Every value a step held, in order: its answer history. */
  readonly history: (stepKey: string) => readonly OnboardingResponseValue[];
  /**
   * Q's recommendations as the onboarding service keeps them (P0-2): a
   * durable store the world owns, so a second interviewer instance (a
   * restart) sees the same ones, and acceptance goes through the
   * session's resolve route exactly as in production.
   */
  readonly recommendations: RecommendationStore;
};

export type WorldOptions = {
  /** The journey the session follows (default investor). */
  readonly journey?: "founder" | "investor" | undefined;
  readonly currentStepKey: string;
  /** Option keys or text already answered, by step. */
  readonly recorded?: Readonly<Record<string, string>> | undefined;
  /**
   * Prerequisites the fake service enforces: submitting the key is
   * refused until the named step is answered. This is how the real
   * journey behaves — I2 refuses everything until a mandate is selected
   * — and it is the condition that used to destroy volunteered answers.
   */
  readonly refuseUntil?: Readonly<Record<string, string>> | undefined;
  /**
   * The firm or company is not set up until every one of these steps is
   * answered: any other step is refused as the service does before then
   * (OnboardingContextRequiredError, QA F-52).
   */
  readonly setUpBy?: readonly string[] | undefined;
  /**
   * Refuse to set aside a step that holds an answer, as the real journey
   * does (STEP_NOT_ELIGIBLE). Opt-in: the clears path's tests predate it.
   */
  readonly refuseSkipOfAnswered?: boolean | undefined;
  /** Taxonomy nodes the classifier returns, by phrase. */
  readonly taxonomy?: Readonly<Record<string, string>> | undefined;
  /** Phrases the classifier finds ambiguous, with its candidates. */
  readonly taxonomyAmbiguous?:
    | Readonly<
        Record<
          string,
          readonly { readonly nodeId: string; readonly displayName: string }[]
        >
      >
    | undefined;
  /**
   * The category look-up is refused (400, no organisation context) until
   * this step holds an answer, as for a brand-new investor (live AI).
   */
  readonly taxonomyUntil?: string | undefined;
  /** Each vocabulary's top-level categories, by display name -> node id. */
  readonly taxonomyRoots?: Readonly<Record<string, string>> | undefined;
  /** The mandate candidate context the view carries on the I1 step. */
  /**
   * Steps off this person's path: the fake refuses them the way the
   * service does (409 STEP_NOT_ELIGIBLE), as revenue for a pre-seed company.
   */
  readonly ineligible?: readonly string[] | undefined;
  /** The session's subject (the investor organisation it is bound to). */
  readonly subject?:
    | {
        readonly type: "INVESTOR_ORGANISATION" | "COMPANY";
        readonly id: string;
      }
    | undefined;
  /**
   * Steps that open on their path only once another is answered (the raise
   * amount after "are you raising?"): refused as STEP_NOT_ELIGIBLE until
   * then, as the journey's branching does.
   */
  readonly opensAfter?: Readonly<Record<string, string>> | undefined;
  /**
   * Steps whose save fails with a 500 every time (live 2026-10-28: the
   * website). A batch carrying one fails whole, as one transaction does.
   */
  readonly failing?: readonly string[] | undefined;
  readonly mandates?:
    | {
        readonly candidates: readonly string[];
        readonly suggested: string | null;
      }
    | undefined;
};

const INVESTOR_STEPS = INVESTOR_DEFINITION_V1.steps;
const FOUNDER_STEPS_V3 = FOUNDER_DEFINITION_CURRENT.steps;

/** The JSON the client sent. Anything else is not a request this fake serves. */
function readBody(init: RequestInit | undefined): string {
  return typeof init?.body === "string" ? init.body : "{}";
}

function valueFor(
  stepKey: string,
  raw: string,
  STEPS: typeof INVESTOR_STEPS = INVESTOR_STEPS,
): OnboardingResponseValue {
  const step = STEPS.find((s) => s.stepKey === stepKey);
  const configuration = step?.configuration;
  switch (configuration?.stepType) {
    case "single_select":
      return { type: "SINGLE_SELECT", optionKey: raw };
    case "multi_select":
      return { type: "MULTI_SELECT", optionKeys: raw.split(",") };
    case "range":
      return { type: "RANGE", value: raw };
    case "confirmation":
      return { type: "CONFIRMATION", confirmed: raw === "true" };
    case "reference_select":
      return {
        type: "RESOURCE_REFERENCE",
        resourceType: configuration.resourceType,
        resourceIds: raw.split(","),
      };
    case "short_text":
    case "long_text":
    case "voice_text":
    case "document_upload":
    case undefined:
      return { type: "TEXT", text: raw };
  }
}

export function investorSession(options: WorldOptions): InvestorWorld {
  const journey = options.journey ?? "investor";
  const STEPS = journey === "founder" ? FOUNDER_STEPS_V3 : INVESTOR_STEPS;
  const held = new Map<string, OnboardingResponseValue>(
    Object.entries(options.recorded ?? {}).map(([key, raw]) => [
      key,
      valueFor(key, raw, STEPS),
    ]),
  );
  const setAside = new Set<string>();
  /** When each answer was given in this run (seeded answers: NOW). */
  const answeredAt = new Map<string, string>();
  const versions: { stepKey: string; value: OnboardingResponseValue }[] = [];
  const answer = (stepKey: string, value: OnboardingResponseValue) => {
    versions.push({ stepKey, value });
    held.set(stepKey, value);
    answeredAt.set(stepKey, new Date().toISOString());
  };
  /** Notes kept with the current response, by step. */
  const notes = new Map<string, string>();
  const tried: string[] = [];
  /** Each batch submission, by the steps it carried. */
  const batches: string[][] = [];
  let version = 1;
  let currentStepKey = options.currentStepKey;
  type Kept = {
    readonly id: string;
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
    readonly rationale: string | null;
    readonly sources: readonly {
      readonly sourceType: string;
      readonly sourceId: string;
    }[];
    status: "PENDING" | "ACCEPTED" | "EXPIRED";
  };
  const kept: Kept[] = [];
  let completed = false;
  const canComplete = () =>
    STEPS.filter((step) => step.required).every((step) =>
      held.has(step.stepKey),
    );

  const view = (): OnboardingSessionView =>
    ({
      session: {
        id: SESSION_ID,
        journeyType: journey,
        definitionVersionId: "22222222-2222-4222-8222-222222222222",
        definitionVersion: 1,
        status: completed ? "COMPLETED" : "ACTIVE",
        subject: options.subject ?? null,
        currentStepKey,
        version,
        startedAt: NOW,
        lastActivityAt: NOW,
        completedAt: null,
      },
      phases: [],
      currentStep: currentStep(),
      progress: {
        currentStepKey,
        currentPhaseKey: null,
        // Off their path: not listed, as the service lists only eligible steps.
        eligibleSteps: STEPS.filter(
          (step) => options.ineligible?.includes(step.stepKey) !== true,
        ).map((step) => ({
          stepKey: step.stepKey,
          required: step.required,
          status: held.has(step.stepKey)
            ? "COMPLETED"
            : setAside.has(step.stepKey)
              ? "SKIPPED"
              : "PENDING",
        })),
        eligibleStepCount: STEPS.length,
        completedEligibleStepCount: held.size,
        canGoBack: true,
        canSkipCurrentStep: true,
        canComplete: canComplete(),
      },
      pendingSuggestions: [],
      responses: [...held.entries()].map(([stepKey, value], index) => ({
        id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
        stepKey,
        responseType:
          value.type === "SINGLE_SELECT"
            ? "SINGLE_SELECT"
            : value.type === "MULTI_SELECT"
              ? "MULTI_SELECT"
              : value.type === "RANGE"
                ? "RANGE"
                : value.type === "CONFIRMATION"
                  ? "CONFIRMATION"
                  : value.type === "RESOURCE_REFERENCE"
                    ? "RESOURCE_REFERENCE"
                    : "TEXT",
        value,
        sourceModality: "TYPED_TEXT",
        note: notes.get(stepKey) ?? null,
        createdAt: answeredAt.get(stepKey) ?? NOW,
      })),
      pendingQuestions: [],
    }) as unknown as OnboardingSessionView;

  const currentStep = () => {
    const step = STEPS.find((s) => s.stepKey === currentStepKey);
    if (step === undefined) return null;
    const c = step.configuration;
    // The presentation the owning service renders is the step's own
    // configuration: same discriminant, same constraints. Spreading it
    // keeps this fake honest as the definition changes, and zod strips
    // the definition-only keys.
    const presentation = { ...c };
    const mandates = options.mandates;
    const context =
      mandates !== undefined && c.stepType === "reference_select"
        ? {
            kind: "investor.mandates",
            investorOrganisationId: "org-1",
            candidates: mandates.candidates.map((id, index) => ({
              mandateId: id,
              name: `Mandate ${String(index + 1)}`,
              status: "DRAFT",
              version: 1,
            })),
            suggestedMandateId: mandates.suggested,
          }
        : undefined;
    return {
      stepKey: step.stepKey,
      stepType: c.stepType,
      required: step.required,
      prompt: c.prompt,
      presentation,
      ...(context === undefined ? {} : { context }),
    };
  };

  /** The owning service's refusal, in the shape the client parses. */
  const refusal = (needs: string) =>
    new Response(
      JSON.stringify({
        type: "about:blank",
        title: "The answer was not accepted.",
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: "req_test",
        errors: [
          {
            path: "stepKey",
            code: `${needs}_required`,
            message: `Answer ${needs} first.`,
          },
        ],
      }),
      { status: 422, headers: { "content-type": "application/problem+json" } },
    );

  /** The onboarding thread, as the API keeps it (oldest first). */
  const thread: {
    role: "PERSON" | "Q";
    text: string;
    channel: string;
    createdAt: string;
  }[] = [];

  const serverError = () =>
    new Response(
      JSON.stringify({
        type: "about:blank",
        title: "Internal server error",
        status: 500,
        code: "INTERNAL_ERROR",
        requestId: "req_test",
      }),
      { status: 500, headers: { "content-type": "application/problem+json" } },
    );

  const fetchFake: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? "GET";

    if (
      method === "GET" &&
      /\/taxonomy\/vocabularies\/[^/]+\/nodes/.test(url)
    ) {
      const code =
        /\/vocabularies\/([^/]+)\/nodes/.exec(url)?.[1] ?? "industry";
      return Promise.resolve(
        Response.json({
          items: Object.entries(options.taxonomyRoots ?? {}).map(
            ([displayName, id]) => ({
              id,
              vocabularyCode: decodeURIComponent(code),
              canonicalCode: displayName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_"),
              displayName,
              description: null,
              parentNodeId: null,
              depth: 0,
              status: "ACTIVE",
            }),
          ),
        }),
      );
    }

    if (
      url.includes("/taxonomy/candidates") &&
      options.taxonomyUntil !== undefined &&
      !held.has(options.taxonomyUntil)
    ) {
      return Promise.resolve(
        Response.json(
          {
            type: "urn:capitalq:problem:actor-context-required",
            title: "Organisation context required",
            status: 400,
            code: "ACTOR_CONTEXT_REQUIRED",
            detail: "Choose an organisation context.",
          },
          {
            status: 400,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      );
    }
    if (url.includes("/taxonomy/candidates")) {
      const body = JSON.parse(readBody(init)) as {
        text?: string;
      };
      const phrase = (body.text ?? "").toLowerCase();
      const node = options.taxonomy?.[phrase];
      const several = options.taxonomyAmbiguous?.[phrase];
      if (node === undefined && several !== undefined) {
        // Several categories the word could mean: the lookup abstains
        // from choosing (live 2026-10-28: "health").
        return Promise.resolve(
          Response.json({
            resolution: "AMBIGUOUS",
            candidates: several.map((c, index) => ({
              nodeId: c.nodeId,
              vocabularyCode: "industry",
              canonicalCode: c.displayName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_"),
              displayName: c.displayName,
              rank: index + 1,
              confidence: "0.6000",
              matchTypes: ["LEXICAL"],
              rationaleSummary: "test fixture",
            })),
            taxonomyVersions: { industry: 1 },
            classifier: {
              provider: "capital_q",
              model: "deterministic_lexical",
              version: "test",
            },
          }),
        );
      }
      return Promise.resolve(
        Response.json({
          resolution: node === undefined ? "ABSTAINED" : "EXACT",
          ...(node === undefined
            ? { abstentionReason: "NO_CANDIDATES" }
            : undefined),
          candidates:
            node === undefined
              ? []
              : [
                  {
                    nodeId: node,
                    vocabularyCode: "industry",
                    canonicalCode: phrase.replace(/[^a-z0-9]+/g, "_"),
                    displayName: body.text ?? "",
                    rank: 1,
                    confidence: "1.0000",
                    matchTypes: ["DISPLAY_NAME_EXACT"],
                    rationaleSummary: "test fixture",
                  },
                ],
          taxonomyVersions: { industry: 1 },
          classifier: {
            provider: "capital_q",
            model: "deterministic_lexical",
            version: "test",
          },
        }),
      );
    }

    if (/\/turns(\?limit=\d+)?$/.test(url)) {
      if (method === "POST") {
        const body = JSON.parse(readBody(init)) as {
          turns: { role: "PERSON" | "Q"; text: string; channel: string }[];
        };
        for (const t of body.turns) {
          thread.push({
            role: t.role,
            text: t.text,
            channel: t.channel,
            createdAt: new Date().toISOString(),
          });
        }
        return Promise.resolve(Response.json({ written: true }));
      }
      return Promise.resolve(Response.json({ items: [...thread] }));
    }

    const withdraw = /\/steps\/([^/]+)\/withdraw$/.exec(url);
    if (method === "POST" && withdraw !== null) {
      const stepKey = decodeURIComponent(withdraw[1] ?? "");
      const step = STEPS.find((s) => s.stepKey === stepKey);
      if (step === undefined || step.required || !held.has(stepKey)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              type: "urn:capitalq:problem:resource-conflict",
              title:
                "The request conflicts with the current state of the resource.",
              status: 409,
              detail: "Not withdrawable. (NOTHING_TO_WITHDRAW)",
              code: "RESOURCE_CONFLICT",
              requestId: "req_test",
            }),
            {
              status: 409,
              headers: { "content-type": "application/problem+json" },
            },
          ),
        );
      }
      held.delete(stepKey);
      setAside.add(stepKey);
      version += 1;
      return Promise.resolve(Response.json(view()));
    }

    const resolveSuggestion = /\/suggestions\/([^/]+)\/resolve$/.exec(url);
    if (method === "POST" && resolveSuggestion !== null) {
      const id = decodeURIComponent(resolveSuggestion[1] ?? "");
      const suggestion = kept.find((k) => k.id === id);
      if (suggestion === undefined || suggestion.status !== "PENDING") {
        return Promise.resolve(refusal("suggestion"));
      }
      suggestion.status = "ACCEPTED";
      answer(suggestion.stepKey, suggestion.value);
      tried.push(suggestion.stepKey);
      version += 1;
      return Promise.resolve(Response.json(view()));
    }

    const skip = /\/steps\/([^/]+)\/skip$/.exec(url);
    if (method === "POST" && skip !== null) {
      const stepKey = decodeURIComponent(skip[1] ?? "");
      // The journey will not set aside a step it holds as answered.
      if (options.refuseSkipOfAnswered === true && held.has(stepKey)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              type: "urn:capitalq:problem:resource-conflict",
              title:
                "The request conflicts with the current state of the resource.",
              status: 409,
              detail:
                "The onboarding session does not allow this action right now. (STEP_NOT_ELIGIBLE)",
              code: "RESOURCE_CONFLICT",
              requestId: "req_test",
            }),
            {
              status: 409,
              headers: { "content-type": "application/problem+json" },
            },
          ),
        );
      }
      setAside.add(stepKey);
      version += 1;
      // The real journey moves on from a step set aside, as it does from
      // one answered.
      if (stepKey === currentStepKey) {
        const next = STEPS.find(
          (step) => !held.has(step.stepKey) && !setAside.has(step.stepKey),
        );
        currentStepKey = next?.stepKey ?? currentStepKey;
      }
      return Promise.resolve(Response.json(view()));
    }

    if (method === "POST" && url.endsWith("/complete")) {
      if (!canComplete()) {
        return Promise.resolve(refusal("review"));
      }
      completed = true;
      version += 1;
      return Promise.resolve(Response.json(view()));
    }

    const submitOne = (body: {
      stepKey: string;
      response: { value: OnboardingResponseValue; note?: string };
    }): Promise<Response> => {
      tried.push(body.stepKey);
      if (options.failing?.includes(body.stepKey) === true) {
        return Promise.resolve(serverError());
      }
      const opensAfter = options.opensAfter?.[body.stepKey];
      if (
        options.ineligible?.includes(body.stepKey) === true ||
        (opensAfter !== undefined && !held.has(opensAfter))
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              type: "urn:capitalq:problem:resource-conflict",
              title: "The request conflicts with the current state.",
              status: 409,
              code: "RESOURCE_CONFLICT",
              requestId: "req_test",
              detail:
                "The onboarding session does not allow this action right now. (STEP_NOT_ELIGIBLE)",
            }),
            {
              status: 409,
              headers: { "content-type": "application/problem+json" },
            },
          ),
        );
      }
      const setUpBy = options.setUpBy ?? [];
      if (
        setUpBy.length > 0 &&
        !setUpBy.includes(body.stepKey) &&
        setUpBy.some((key) => !held.has(key))
      ) {
        const message =
          "This is kept and saved once the firm or company is set up; its name comes first.";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              type: "urn:capitalq:problem:invalid-request",
              title: "The request is not valid.",
              status: 400,
              code: "INVALID_REQUEST",
              requestId: "req_test",
              detail: message,
              errors: [
                { path: "value", code: "onboarding_context_required", message },
              ],
            }),
            {
              status: 400,
              headers: { "content-type": "application/problem+json" },
            },
          ),
        );
      }
      const needs = options.refuseUntil?.[body.stepKey];
      if (needs !== undefined && !held.has(needs)) {
        return Promise.resolve(refusal(needs.split(".").at(-1) ?? needs));
      }
      // The journey keeps a red flag in one exclusion list, never both.
      const sibling =
        body.stepKey === "I7.avoid"
          ? "I7.hard_exclusions"
          : body.stepKey === "I7.hard_exclusions"
            ? "I7.avoid"
            : undefined;
      const other = sibling === undefined ? undefined : held.get(sibling);
      if (
        other?.type === "MULTI_SELECT" &&
        body.response.value.type === "MULTI_SELECT" &&
        body.response.value.optionKeys.some((key) =>
          other.optionKeys.includes(key),
        )
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              type: "urn:capitalq:problem:validation-failed",
              title: "The request is not valid.",
              status: 422,
              code: "VALIDATION_FAILED",
              requestId: "req_test",
              errors: [
                {
                  path: "value.optionKeys",
                  code: "conflicting_exclusion",
                  message:
                    "Listed both as something to avoid and never to show.",
                },
              ],
            }),
            {
              status: 422,
              headers: { "content-type": "application/problem+json" },
            },
          ),
        );
      }
      answer(body.stepKey, body.response.value);
      if (body.response.note === undefined) notes.delete(body.stepKey);
      else notes.set(body.stepKey, body.response.note);
      version += 1;
      const next = STEPS.find(
        (step) => !held.has(step.stepKey) && !setAside.has(step.stepKey),
      );
      currentStepKey = next?.stepKey ?? currentStepKey;
      return Promise.resolve(Response.json(view()));
    };
    if (method === "POST" && url.endsWith("/responses/batch")) {
      // One transaction in the service: each answer as a single submission
      // would be, refused ones reported, the rest committed together; a
      // refused one retried once another has landed.
      const body = JSON.parse(readBody(init)) as {
        responses: {
          stepKey: string;
          response: { value: OnboardingResponseValue; note?: string };
        }[];
      };
      batches.push(body.responses.map((r) => r.stepKey));
      if (
        body.responses.some(
          (r) => options.failing?.includes(r.stepKey) === true,
        )
      ) {
        return Promise.resolve(serverError());
      }
      return (async () => {
        const results = new Map<
          number,
          { stepKey: string; outcome: string; refusal?: unknown }
        >();
        let open = body.responses.map((_, index) => index);
        for (let pass = 0; open.length > 0; pass += 1) {
          const refusedNow: number[] = [];
          for (const index of open) {
            const item = body.responses[index];
            if (item === undefined) continue;
            const response = await submitOne(item);
            if (response.ok) {
              results.set(index, {
                stepKey: item.stepKey,
                outcome: "COMMITTED",
              });
            } else {
              const problem = (await response.json()) as {
                detail?: string;
                errors?: unknown[];
              };
              results.set(index, {
                stepKey: item.stepKey,
                outcome: "REFUSED",
                refusal: {
                  detail: problem.detail ?? null,
                  errors: problem.errors ?? [],
                },
              });
              refusedNow.push(index);
            }
          }
          if (refusedNow.length === open.length || pass > body.responses.length)
            break;
          open = refusedNow;
        }
        return Response.json({
          view: view(),
          results: body.responses.map((_, index) => results.get(index)),
        });
      })();
    }

    if (method === "POST" && url.endsWith("/responses")) {
      return submitOne(
        JSON.parse(readBody(init)) as {
          stepKey: string;
          response: { value: OnboardingResponseValue; note?: string };
        },
      );
    }

    return Promise.resolve(Response.json(view()));
  };

  return {
    journey,
    fetch: fetchFake,
    recordedValue: (stepKey) => held.get(stepKey),
    recordedNote: (stepKey) => notes.get(stepKey),
    record: (stepKey, value) => {
      answer(stepKey, value);
      version += 1;
    },
    skippedSteps: () => [...setAside],
    thread: () => thread.map((t) => ({ role: t.role, text: t.text })),
    attempts: () => [...tried],
    batches: () => batches.map((b) => [...b]),
    history: (stepKey) =>
      versions.filter((v) => v.stepKey === stepKey).map((v) => v.value),
    recommendations: {
      recommend: (input) => {
        for (const earlier of kept) {
          if (
            earlier.stepKey === input.stepKey &&
            earlier.status === "PENDING"
          ) {
            earlier.status = "EXPIRED";
          }
        }
        const item: Kept = {
          id: `a0000000-0000-4000-8000-${String(kept.length + 1).padStart(12, "0")}`,
          stepKey: input.stepKey,
          value: input.value,
          rationale: input.rationale,
          sources: (input.sources ?? []).map((source) => ({
            sourceType: source.sourceType,
            sourceId: source.url,
          })),
          status: "PENDING",
        };
        kept.push(item);
        return Promise.resolve({
          id: OnboardingSuggestionIdSchema.parse(item.id),
          stepKey: item.stepKey,
          value: item.value,
          rationale: item.rationale,
          payloadSha256: JSON.stringify(item.value),
          sources: item.sources,
        });
      },
      pending: () =>
        Promise.resolve(
          kept
            .filter((k) => k.status === "PENDING")
            .map((k) => ({
              id: OnboardingSuggestionIdSchema.parse(k.id),
              stepKey: k.stepKey,
              value: k.value,
              rationale: k.rationale,
              payloadSha256: JSON.stringify(k.value),
              sources: k.sources,
            })),
        ),
    },
  };
}

/** A result with every field at its quietest; tests override what they mean. */
export const base: InterviewConductorResult = {
  reply: "",
  intent: "ANSWER",
  answers: [],
  categoryPhrases: [],
  confirmations: [],
  skips: [],
  askNext: null,
  showOptions: false,
  questionForQ: null,
  answerFromState: null,
  skipRemainingOptional: false,
  navigate: null,
  lookup: null,
  pronounce: null,
  unrestricted: [],
  frustrated: false,
  reading: null,
  delivery: null,
  offered: [],
};

export function gateway(
  ...results: readonly InterviewConductorResult[]
): InterviewGateway {
  let index = 0;
  return {
    execute: () => {
      const value = results[Math.min(index, results.length - 1)];
      index += 1;
      return Promise.resolve({
        output: { kind: "STRUCTURED", value },
      } as never);
    },
  };
}

export function turn(
  world: InvestorWorld,
  utterance: string,
): InterviewTurnInput {
  return {
    session: {
      baseUrl: "http://api.test",
      accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
      fetch: world.fetch,
    },
    onboardingSessionId: SESSION_ID,
    journeyType: world.journey ?? "investor",
    channel: "text",
    attribution: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
      correlationId: "cor_test",
    },
    utterance,
    recentTurns: [],
  };
}
