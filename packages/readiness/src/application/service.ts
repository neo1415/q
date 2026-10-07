import { createHash } from "node:crypto";

import {
  type BlueprintPillar,
  type ReadinessActionStateRequest,
  type ReadinessBlueprintDto,
  type ReadinessDto,
  type ReadinessFollowUp,
  type ReadinessQuestionAnswerRequest,
  type ReadinessQuestionResult,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { assess, type ReadinessAssessment } from "../domain/assess.js";
import { buildBlueprint } from "../domain/blueprint.js";
import type { ReadinessInputs } from "../domain/inputs.js";
import { FACT_PILLAR } from "../domain/signals.js";
import type { ReadinessStore } from "../infrastructure/postgres.js";
import { READINESS_RULES_V1, type ReadinessRules } from "../rules/v1.js";

/**
 * The founder's readiness, served (Q.03, Q.04, Q.01 follow-ups).
 *
 * Context Firewall: every entry point resolves the company from the
 * actor's own context (`ownCompanyId`) and never takes one from the
 * caller; an investor, or a founder of another company, gets null (the
 * route's 404). Nothing outside this service reads what it produces:
 * no discovery, ranking, matching or investor-facing projection imports
 * this package (guarded by test/firewall.test.ts).
 *
 * Recomputed on every read from the current records, so it is never
 * stale; a new stored revision is appended only when the basis changed.
 */

/** A pending follow-up as the onboarding runtime holds it. */
export type ReadinessFollowUpSource = Omit<ReadinessFollowUp, "pillar"> & {
  readonly factKey: string;
};

export type ReadinessFollowUpPort = {
  readonly list: (
    actor: ActorContext,
  ) => Promise<readonly ReadinessFollowUpSource[]>;
  /** Answers through the interview's own commit (write targets, Write Gate). */
  readonly answer: (
    actor: ActorContext,
    questionId: string,
    answer: ReadinessQuestionAnswerRequest["answer"],
    idempotencyKey: string,
    correlationId: string,
  ) => Promise<"ANSWERED" | "NOT_FOUND" | "NOT_ANSWERABLE" | "INVALID">;
  readonly dismiss: (
    actor: ActorContext,
    questionId: string,
    idempotencyKey: string,
    correlationId: string,
  ) => Promise<"DISMISSED" | "NOT_FOUND">;
};

export type ReadinessPorts = {
  readonly store: ReadinessStore;
  /** The actor's own company, from the server-resolved context; null: none. */
  readonly ownCompanyId: (actor: ActorContext) => Promise<string | null>;
  readonly deck?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<ReadinessInputs["deck"]>)
    | undefined;
  readonly dataRoom?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<ReadinessInputs["dataRoom"]>)
    | undefined;
  readonly raise?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<ReadinessInputs["raise"]>)
    | undefined;
  readonly followUps?: ReadinessFollowUpPort | undefined;
  readonly rules?: ReadinessRules | undefined;
  readonly now?: (() => Date) | undefined;
};

export type ReadinessAnswerOutcome =
  | ReadinessQuestionResult
  | { readonly refused: "NOT_FOUND" | "NOT_ANSWERABLE" | "INVALID" };

/** Stable JSON: keys sorted, so the basis hash never depends on key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function basisHash(rulesVersion: string, inputs: ReadinessInputs) {
  return createHash("sha256")
    .update(rulesVersion)
    .update("\n")
    .update(stable(inputs))
    .digest("hex");
}

/** A UUID derived from the assessment revision, so a Blueprint id is reproducible. */
function derivedUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const safe = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

export function createReadinessService(ports: ReadinessPorts) {
  const rules = ports.rules ?? READINESS_RULES_V1;
  const now = ports.now ?? (() => new Date());

  async function gather(actor: ActorContext) {
    const companyId = await ports.ownCompanyId(actor);
    if (companyId === null) return null;
    const facts = await ports.store.profileFacts(companyId);
    if (facts === null) return null;
    // A source that cannot be read is unknown for this read (never zero):
    // the deck and raise read null, the data room null, follow-ups none.
    const [deck, dataRoom, raise, followUps, marks] = await Promise.all([
      ports.deck === undefined
        ? Promise.resolve(null)
        : safe(
            () => ports.deck?.(actor, companyId) ?? Promise.resolve(null),
            null,
          ),
      ports.dataRoom === undefined
        ? Promise.resolve(null)
        : safe(
            () => ports.dataRoom?.(actor, companyId) ?? Promise.resolve(null),
            null,
          ),
      ports.raise === undefined
        ? Promise.resolve(null)
        : safe(
            () => ports.raise?.(actor, companyId) ?? Promise.resolve(null),
            null,
          ),
      ports.followUps === undefined
        ? Promise.resolve([] as readonly ReadinessFollowUpSource[])
        : safe(
            () =>
              ports.followUps?.list(actor) ??
              Promise.resolve([] as readonly ReadinessFollowUpSource[]),
            [] as readonly ReadinessFollowUpSource[],
          ),
      ports.store.marks(companyId),
    ]);
    const inputs: ReadinessInputs = {
      stageCode: facts.stageCode,
      profile: facts.profile,
      team: facts.team,
      verification: facts.verification,
      claims: facts.claims,
      deck,
      dataRoom,
      raise,
      followUps: followUps.map((item) => ({
        factKey: item.factKey,
        reason: item.reason,
      })),
    };
    return { companyId, tenantId: facts.tenantId, inputs, followUps, marks };
  }

  async function current(actor: ActorContext): Promise<{
    readonly dto: ReadinessDto;
    readonly assessment: ReadinessAssessment;
    readonly tenantId: string;
  } | null> {
    const gathered = await gather(actor);
    if (gathered === null) return null;
    const { companyId, tenantId, inputs, followUps, marks } = gathered;
    const assessment = assess(inputs, rules, marks);
    const stored = await ports.store.record({
      tenantId,
      companyId,
      rulesVersion: rules.version,
      basisHash: basisHash(rules.version, inputs),
      // The diagnosis as computed (no action marks: those are their own
      // history), so a past revision can be shown as it was.
      assessment: {
        rulesVersion: assessment.rulesVersion,
        stageCode: assessment.stageCode,
        pillars: assessment.pillars,
        blockers: assessment.blockers,
        uncertainty: assessment.uncertainty,
      },
    });
    const dto: ReadinessDto = {
      companyId,
      rulesVersion: rules.version,
      revision: stored.revision,
      assessedAt: stored.assessedAt,
      stageCode: inputs.stageCode,
      pillars: [...assessment.pillars],
      blockers: [...assessment.blockers],
      actions: [...assessment.actions].slice(0, 60),
      followUps: followUps.slice(0, 50).map((item) => {
        const { factKey, ...rest } = item;
        const pillar = FACT_PILLAR[factKey.split(".")[0] ?? factKey];
        return {
          ...rest,
          pillar: (pillar as BlueprintPillar | undefined) ?? null,
        };
      }),
      uncertainty: [...assessment.uncertainty],
    };
    return { dto, assessment, tenantId };
  }

  return {
    rules,

    /** The diagnosis, the plan and the follow-ups; null: not a founder of a company. */
    read: async (actor: ActorContext): Promise<ReadinessDto | null> =>
      (await current(actor))?.dto ?? null,

    /** Mark an action done, or reopen it. The pillar still moves only on evidence. */
    setActionState: async (
      actor: ActorContext,
      actionKey: string,
      request: ReadinessActionStateRequest,
    ): Promise<{
      readonly key: string;
      readonly state: ReadinessDto["actions"][number]["state"];
    } | null> => {
      const now = await current(actor);
      if (now === null) return null;
      const action = now.dto.actions.find((item) => item.key === actionKey);
      if (action === undefined) return null;
      // Closed by evidence is not the founder's to reopen or tick.
      if (action.state === "DONE_BY_EVIDENCE") {
        return { key: action.key, state: action.state };
      }
      const isDone = action.state === "MARKED_DONE";
      if (isDone !== request.done) {
        await ports.store.mark({
          tenantId: now.tenantId,
          companyId: now.dto.companyId,
          actionKey,
          done: request.done,
          userId: actor.userId,
          rulesVersion: rules.version,
        });
      }
      return { key: action.key, state: request.done ? "MARKED_DONE" : "OPEN" };
    },

    answerFollowUp: async (
      actor: ActorContext,
      questionId: string,
      request: ReadinessQuestionAnswerRequest,
      idempotencyKey: string,
      correlationId: string,
    ): Promise<ReadinessAnswerOutcome | null> => {
      if (ports.followUps === undefined) return null;
      if ((await ports.ownCompanyId(actor)) === null) return null;
      const outcome = await ports.followUps.answer(
        actor,
        questionId,
        request.answer,
        idempotencyKey,
        correlationId,
      );
      if (outcome !== "ANSWERED") return { refused: outcome };
      const remaining = (await ports.followUps.list(actor)).length;
      return { questionId, status: "ANSWERED", remaining };
    },

    dismissFollowUp: async (
      actor: ActorContext,
      questionId: string,
      idempotencyKey: string,
      correlationId: string,
    ): Promise<ReadinessQuestionResult | null> => {
      if (ports.followUps === undefined) return null;
      if ((await ports.ownCompanyId(actor)) === null) return null;
      const outcome = await ports.followUps.dismiss(
        actor,
        questionId,
        idempotencyKey,
        correlationId,
      );
      if (outcome !== "DISMISSED") return null;
      const remaining = (await ports.followUps.list(actor)).length;
      return { questionId, status: "DISMISSED", remaining };
    },

    /**
     * The Blueprint v1 (plan-gated by the caller): the diagnosis' open
     * actions, sequenced. Null: the company is not the actor's own.
     */
    blueprint: async (
      actor: ActorContext,
      companyId: string,
      horizonMonths: 3 | 6 | 12,
    ): Promise<ReadinessBlueprintDto | null> => {
      const now$ = await current(actor);
      if (now$ === null || now$.dto.companyId !== companyId) return null;
      return buildBlueprint({
        id: derivedUuid(
          `${companyId}:${String(now$.dto.revision)}:${String(horizonMonths)}`,
        ),
        companyId,
        version: now$.dto.revision,
        horizonMonths,
        assessment: now$.assessment,
        evidenceAsOf: now$.dto.assessedAt,
        generatedAt: now().toISOString(),
      });
    },
  };
}

export type ReadinessService = ReturnType<typeof createReadinessService>;
