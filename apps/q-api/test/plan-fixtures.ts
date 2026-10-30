import { randomUUID } from "node:crypto";

import {
  PermittedContextPlanSchema,
  QRunIdSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  Q_SITUATION_SOURCES,
  Q_SITUATION_SOURCES_BY_SIDE,
  Q_SITUATION_VERSION,
  QSituationDossierSchema,
  type QPlan,
  type QPlanStatus,
  type QSituationDossier,
  type QSituationSide,
  type QSituationSource,
  type QTeamThreadAppend,
  type QTeamThreadEntry,
} from "@capital-q/contracts";
import type {
  PlanReviewResult,
  PlanWriteResult,
  PlanWriteStep,
} from "@capital-q/q-core";
import type { QToolExecutionContext } from "@capital-q/q-runtime";
import type { SituationAssembler } from "@capital-q/q-specialists";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import type {
  PlanHead,
  PlanStore,
  StoredPlanVersion,
} from "../src/composition/workforce/plan-store.js";
import { boundThread } from "../src/composition/workforce/plan-store.js";

/**
 * Situation-first planning test fixtures: a founder and an investor, their
 * situations as the S2 assembler would hand them over (contract-valid
 * dossiers), an in-memory plan store with the migration's rules (versions
 * in order, append-only thread, idempotency keys), and fake models.
 */

export const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const COMPANY = "c0000000-0000-4000-8000-000000000001";
export const INVESTOR_ORG = "b0000000-0000-4000-8000-000000000002";
export const RUN = "90000000-0000-4000-8000-000000000001";
export const JOB = "70000000-0000-4000-8000-000000000001";
export const LEAD_RUN = "71000000-0000-4000-8000-000000000001";

export const founder: ActorContext = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: randomUUID(),
  actorType: "HUMAN",
});
export const investor: ActorContext = ActorContextSchema.parse({
  userId: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
  tenantId: TENANT,
  organisationId: "e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0",
  membershipId: randomUUID(),
  actorType: "HUMAN",
});

export function contextOf(actor: ActorContext): QToolExecutionContext {
  const plan = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: QRunIdSchema.parse(RUN),
    tenantId: TENANT,
    actor: { userId: actor.userId, organisationId: actor.organisationId },
    purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity: "HIGHLY_CONFIDENTIAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: "2026-10-28T10:00:00.000Z",
    revalidateAfter: "2026-10-28T10:01:00.000Z",
    revalidateOnResume: true,
  });
  return {
    actor,
    runId: QRunIdSchema.parse(RUN),
    correlationId: "cor_test",
    capability: "ANSWER",
    plan,
  };
}

type FactSeed = {
  readonly statement: string;
  readonly truthClass?:
    "VERIFIED" | "USER_CLAIM" | "ESTIMATE" | "Q_INFERENCE" | "UNKNOWN";
};

/** A contract-valid dossier: the given sections READ, the rest of the side UNAVAILABLE. */
export function dossierOf(
  side: QSituationSide,
  read: Partial<Record<QSituationSource, readonly FactSeed[]>>,
): QSituationDossier {
  const allowed = new Set(Q_SITUATION_SOURCES_BY_SIDE[side]);
  let next = 1;
  const sections = Q_SITUATION_SOURCES.map((source) => {
    if (!allowed.has(source)) {
      return {
        source,
        status: "NOT_APPLICABLE" as const,
        reason: null,
        facts: [],
        truncated: false,
      };
    }
    const seeds = read[source];
    if (seeds === undefined) {
      return {
        source,
        status: "UNAVAILABLE" as const,
        reason: "NOT_OFFERED" as const,
        facts: [],
        truncated: false,
      };
    }
    return {
      source,
      status: "READ" as const,
      reason: null,
      truncated: false,
      facts: seeds.map((seed) => ({
        ref: `F${String(next++)}`,
        statement: seed.statement,
        truthClass: seed.truthClass ?? "VERIFIED",
        evidenceStatus: "PLATFORM_VERIFIED" as const,
        asOf: "2026-10-27",
        provenance: {
          tool: "fixture",
          record: null,
          url: source === "PUBLIC" ? "https://example.org/news" : null,
        },
        label:
          source === "PUBLIC"
            ? ("public_external" as const)
            : ("organisation_private" as const),
        category: null,
      })),
    };
  });
  return QSituationDossierSchema.parse({
    version: Q_SITUATION_VERSION,
    side,
    asOf: "2026-10-28T10:00:00.000Z",
    sections,
    unknowns: sections
      .filter((section) => section.status === "UNAVAILABLE")
      .map((section) => section.source),
    publicTopics: ["Healthtech Kenya", "Afya Grid"],
  });
}

/**
 * The owner's founder example: Kestrel Ventures expressed interest and
 * asked for unit economics; the deck has no business-model slide; the raise
 * is open; readiness flags the data room. F1..F8.
 */
export const FOUNDER_DOSSIER = dossierOf("FOUNDER", {
  INTEREST: [
    {
      statement:
        "Kestrel Ventures expressed interest on 2026-10-20 with the note: 'Keen to see unit economics per clinic before a call.'",
    },
  ],
  RELATIONSHIPS: [
    {
      statement:
        "Kestrel Ventures: interest received, waiting on your reply since 2026-10-20.",
    },
    {
      statement:
        "Baobab Capital: connected since 2026-09-30; no message for 21 days.",
    },
  ],
  DECK: [
    {
      statement:
        "Deck coaching: Business model 1/5 -- no slide shows revenue per clinic.",
      truthClass: "Q_INFERENCE",
    },
  ],
  CAPITAL: [
    {
      statement: "Raise: you report USD 750,000 seed, open since 2026-09-01.",
      truthClass: "USER_CLAIM",
    },
  ],
  READINESS: [
    {
      statement:
        "Readiness: data room has no financial model; action 'Upload your financial model' is yours.",
    },
  ],
  PROSPECTS: [
    {
      statement:
        "Savanna Health Fund invests in healthtech in Kenya; its stage gate is met.",
    },
  ],
  ACTIVITY: [{ statement: "You recorded a commitment on 2026-10-26." }],
});

export const INVESTOR_DOSSIER = dossierOf("INVESTOR", {
  MANDATE: [
    {
      statement:
        "Your mandate: seed fintech in East Africa, cheques USD 100,000-500,000.",
      truthClass: "USER_CLAIM",
    },
  ],
  FEED_DECISIONS: [
    { statement: "You passed on 9 of the last 10 companies Q showed you." },
  ],
  GATEQ: [{ statement: "GateQ inbox: 4 applications unread, oldest 12 days." }],
  RELATIONSHIPS: [
    { statement: "Lipa Labs: in conversation since 2026-10-02; your move." },
  ],
  PROSPECTS: [
    {
      statement:
        "Q's feed has 3 seed fintech companies in Kenya you have not seen.",
    },
  ],
});

/** A dossier the fake assembler hands back, recording how it was asked. */
export function fakeAssembler(dossier: QSituationDossier) {
  const calls: { kind: "assemble" | "research"; subject?: unknown }[] = [];
  const assembler: SituationAssembler = {
    assemble: (request) => {
      calls.push({ kind: "assemble", subject: request.subject });
      return Promise.resolve(dossier);
    },
    research: (current) => {
      calls.push({ kind: "research" });
      return Promise.resolve(current);
    },
    invalidate: () => undefined,
  };
  return { assembler, calls };
}

// --- models ---------------------------------------------------------------------

export const step = (
  over: Partial<PlanWriteStep> & Pick<PlanWriteStep, "key" | "title" | "cites">,
): PlanWriteStep => ({
  why: "Because the situation says so.",
  owner: "YOU",
  action: { kind: "TASK" },
  due: null,
  evidenceNeeded: [],
  ...over,
});

/** The founder example's plan, as PLAN_WRITE might write it. */
export const FOUNDER_PLAN: PlanWriteResult = {
  goal: "Improve your chances of getting investment",
  side: "FOUNDER",
  situationSummary:
    "Kestrel Ventures is interested and waiting on unit economics (F4, F2); your deck's business model scores 1/5 (F6); your seed raise is open (F8); you recorded a commitment on 26 Oct (F1).",
  situationRefs: ["F1", "F2", "F4", "F6", "F8"],
  steps: [
    step({
      key: "S1",
      title:
        "Reply to Kestrel Ventures with revenue per clinic, as their note asked",
      why: "Kestrel asked for unit economics before a call and has waited since 20 Oct.",
      cites: ["F4", "F2"],
      owner: "YOU",
      action: { kind: "TOOL_PROPOSAL", tool: "propose_chat_message" },
      due: "2026-10-30",
      evidenceNeeded: ["Revenue per clinic for the last 3 months"],
    }),
    step({
      key: "S2",
      title: "Add a Business model slide showing revenue per clinic",
      why: "Deck coaching scores the business model 1/5: no slide shows revenue per clinic.",
      cites: ["F6"],
      owner: "Q",
      action: { kind: "TASK" },
      due: "2026-11-04",
    }),
    step({
      key: "S3",
      title: "Upload your financial model to the data room",
      why: "Readiness says the data room has no financial model, which Kestrel will ask for next.",
      cites: ["F7", "F99"],
      owner: "YOU",
      action: { kind: "TASK" },
      due: "2026-11-06",
    }),
    step({
      key: "S4",
      title: "Request a connection with Savanna Health Fund",
      why: "Savanna invests in Kenyan healthtech and its stage gate is met.",
      cites: ["F5"],
      owner: "Q",
      action: { kind: "TOOL_PROPOSAL", tool: "propose_connection_request" },
      due: null,
    }),
    step({
      key: "S5",
      title: "Write to Baobab Capital with your October progress",
      why: "Baobab has heard nothing for 21 days while your raise is open.",
      cites: ["F3", "F8"],
      owner: "TOGETHER",
      action: { kind: "TOOL_PROPOSAL", tool: "propose_chat_message" },
      due: "2026-11-01",
    }),
    step({
      key: "S6",
      title: "Research investors who backed clinics in Kenya this year",
      why: "Invented: nothing in the situation supports this.",
      cites: ["F42"],
      owner: "Q",
      action: { kind: "WORKFORCE", roles: ["RESEARCH"] },
      due: null,
    }),
  ],
  openQuestions: [
    "Your monthly burn is not known; it changes how long the raise can run.",
  ],
  clarification: null,
};

export const INVESTOR_PLAN: PlanWriteResult = {
  goal: "Get better deal flow",
  side: "INVESTOR",
  situationSummary:
    "You pass on most of what Q shows (F5) while 4 GateQ applications wait unread (F4).",
  situationRefs: ["F3", "F4", "F5"],
  steps: [
    step({
      key: "I1",
      title: "Clear the 4 unread GateQ applications, oldest first",
      why: "They have waited up to 12 days; your inbox is deal flow already at your door.",
      cites: ["F4"],
      owner: "YOU",
      action: { kind: "TASK" },
      due: "2026-10-31",
    }),
    step({
      key: "I2",
      title:
        "Tighten your mandate's stage and cheque so the feed fits what you keep",
      why: "You passed on 9 of 10 companies shown against your stated mandate.",
      cites: ["F3", "F5"],
      owner: "TOGETHER",
      action: { kind: "APP_ACTION", name: "investor.mandate.change" },
      due: null,
    }),
    step({
      key: "I3",
      title: "Reply to Lipa Labs: it is your move",
      why: "Lipa Labs has waited on you since 2 Oct.",
      cites: ["F1"],
      owner: "Q",
      action: { kind: "WORKFORCE", roles: ["CONVERSATION"] },
      due: "2026-10-30",
    }),
    step({
      key: "I4",
      title: "Look at the 3 Kenyan seed fintech companies you have not seen",
      why: "They fit your mandate and are new in your feed.",
      cites: ["F2"],
      owner: "YOU",
      action: { kind: "TASK" },
      due: null,
    }),
  ],
  openQuestions: [],
  clarification: null,
};

/** A review: full marks, or with these points off one item, with a defect. */
export function review(
  off: number,
  item: keyof Omit<PlanReviewResult, "firewall" | "score"> = "specificity",
): PlanReviewResult {
  const full = {
    situationCoverage: 15,
    specificity: 20,
    citesFacts: 15,
    ownerClassification: 10,
    feasibility: 10,
    noInventedFacts: 15,
    asksNothingKnown: 10,
    roleCorrectWording: 5,
  } as const;
  const result = Object.fromEntries(
    Object.entries(full).map(([key, max]) => [
      key,
      {
        score: key === item ? Math.max(0, max - off) : max,
        defects:
          key === item && off > 0
            ? [
                {
                  stepKey: "s2",
                  problem:
                    "The slide's step does not say which figures to show.",
                  fix: "Name revenue per clinic and gross margin per clinic.",
                },
              ]
            : [],
      },
    ]),
  ) as unknown as Omit<PlanReviewResult, "firewall" | "score">;
  return {
    ...result,
    firewall: { held: true, defects: [] },
    score: 100 - off,
  };
}

/** A write the schema refused whole: its refused fields, as the gateway logs them. */
export type RefusedWrite = { readonly refused: readonly string[] };

export function fakePlanModels(input: {
  readonly writes: readonly (PlanWriteResult | RefusedWrite | null)[];
  readonly reviews: readonly (PlanReviewResult | null)[];
}) {
  const calls: {
    task: "WRITE" | "REVIEW";
    mode?: string;
    fixes?: string;
    focus?: string;
    plan?: string;
  }[] = [];
  let writes = 0;
  let reviews = 0;
  return {
    calls,
    models: {
      writePlan: (
        _who: unknown,
        _trace: unknown,
        variables: { readonly mode: string; readonly fixes: string },
        onRefused?: (refusals: readonly string[]) => void,
      ) => {
        calls.push({
          task: "WRITE",
          mode: variables.mode,
          fixes: variables.fixes,
        });
        const next =
          input.writes[Math.min(writes, input.writes.length - 1)] ?? null;
        writes += 1;
        if (next !== null && "refused" in next) {
          onRefused?.(next.refused);
          return Promise.resolve(null);
        }
        return Promise.resolve(next);
      },
      reviewPlan: (
        _who: unknown,
        _trace: unknown,
        variables: { readonly focus: string; readonly plan?: string },
      ) => {
        calls.push({
          task: "REVIEW",
          focus: variables.focus,
          ...(variables.plan === undefined ? {} : { plan: variables.plan }),
        });
        const next =
          input.reviews[Math.min(reviews, input.reviews.length - 1)] ?? null;
        reviews += 1;
        return Promise.resolve(next);
      },
    },
  };
}

// --- the store ------------------------------------------------------------------

/** The migration's rules in memory: owner-bound rows, versions in order, append-only. */
export function memoryPlanStore() {
  const plans = new Map<
    string,
    PlanHead & { tenantId: string; userId: string; key: string }
  >();
  const versions = new Map<string, StoredPlanVersion[]>();
  const shas = new Map<string, string>();
  const thread: (QTeamThreadEntry & { owner: string; key: string })[] = [];
  let roundTrips = 0;
  const ownerKey = (owner: { tenantId: string; userId: string }) =>
    `${owner.tenantId}:${owner.userId}`;
  const store: PlanStore = {
    ensurePlan: (owner, input) => {
      roundTrips += 1;
      const found = [...plans.values()].find(
        (plan) =>
          plan.tenantId === owner.tenantId &&
          plan.userId === owner.userId &&
          plan.key === input.idempotencyKey,
      );
      if (found !== undefined) return Promise.resolve(found);
      const planId = randomUUID();
      const head = {
        planId,
        currentVersion: 0,
        status: "DRAFT" as QPlanStatus,
        side: input.side,
        goal: input.goal,
        jobId: input.jobId,
        tenantId: owner.tenantId,
        userId: owner.userId,
        key: input.idempotencyKey,
      };
      plans.set(planId, head);
      return Promise.resolve(head);
    },
    head: (owner, planId) => {
      roundTrips += 1;
      const plan = plans.get(planId);
      return Promise.resolve(
        plan === undefined || ownerKey(plan) !== ownerKey(owner) ? null : plan,
      );
    },
    addVersion: (owner, input) => {
      roundTrips += 2;
      const plan = plans.get(input.planId);
      if (plan === undefined || ownerKey(plan) !== ownerKey(owner)) {
        return Promise.resolve(false);
      }
      const list = versions.get(input.planId) ?? [];
      if (list.some((one) => one.plan.version === input.plan.version)) {
        return Promise.resolve(false);
      }
      if (input.plan.version !== plan.currentVersion + 1) {
        throw new Error("plan version is not the next");
      }
      list.push({
        plan: input.plan,
        bodySha256: input.bodySha256,
        headVersion: input.plan.version,
        status: input.status,
        situation: input.situation,
        createdAt: new Date().toISOString(),
      });
      versions.set(input.planId, list);
      shas.set(
        `${input.planId}:${String(input.plan.version)}`,
        input.bodySha256,
      );
      plans.set(input.planId, {
        ...plan,
        currentVersion: input.plan.version,
        status: input.status,
      });
      return Promise.resolve(true);
    },
    setStatus: (owner, planId, status) => {
      roundTrips += 1;
      const plan = plans.get(planId);
      if (plan !== undefined && ownerKey(plan) === ownerKey(owner)) {
        plans.set(planId, { ...plan, status });
      }
      return Promise.resolve();
    },
    read: (owner, planId, version) => {
      roundTrips += 1;
      const plan = plans.get(planId);
      if (plan === undefined || ownerKey(plan) !== ownerKey(owner)) {
        return Promise.resolve(null);
      }
      const wanted = version ?? plan.currentVersion;
      const found = versions
        .get(planId)
        ?.find((one) => one.plan.version === wanted);
      return Promise.resolve(
        found === undefined
          ? null
          : { ...found, headVersion: plan.currentVersion, status: plan.status },
      );
    },
    appendThread: (owner, entry: QTeamThreadAppend) => {
      roundTrips += 1;
      const existing = thread.find(
        (one) =>
          one.owner === ownerKey(owner) && one.key === entry.idempotencyKey,
      );
      if (existing !== undefined) return Promise.resolve(existing);
      const seq =
        thread.filter((one) =>
          entry.planId !== null
            ? one.planId === entry.planId
            : one.planId === null && one.jobId === entry.jobId,
        ).length + 1;
      const row = {
        id: randomUUID(),
        planId: entry.planId,
        jobId: entry.jobId,
        kind: entry.kind,
        author: entry.author,
        stepKey: entry.stepKey,
        factRef: entry.factRef,
        text: entry.text,
        seq,
        createdAt: new Date().toISOString(),
        owner: ownerKey(owner),
        key: entry.idempotencyKey,
      };
      thread.push(row);
      return Promise.resolve(row);
    },
    readThread: (owner, of, bounds) => {
      roundTrips += 1;
      const rows = thread
        .filter((one) => one.owner === ownerKey(owner))
        .filter((one) =>
          "planId" in of ? one.planId === of.planId : one.jobId === of.jobId,
        )
        .filter(
          (one) =>
            bounds?.kinds === undefined || bounds.kinds.includes(one.kind),
        )
        .filter((one) => one.seq > (bounds?.afterSeq ?? 0))
        .sort((a, b) => b.seq - a.seq);
      return Promise.resolve(
        bounds?.all === true ? rows.slice(0, 300).reverse() : boundThread(rows),
      );
    },
    livePlans: (tenantId) => {
      roundTrips += 1;
      return Promise.resolve(
        [...plans.values()]
          .filter(
            (plan) =>
              plan.tenantId === tenantId &&
              ["ACCEPTED", "ON_BOARD", "EXECUTING"].includes(plan.status),
          )
          .map((plan) => ({
            planId: plan.planId,
            tenantId: plan.tenantId,
            userId: plan.userId,
            version: plan.currentVersion,
            body: versions.get(plan.planId)?.at(-1)?.plan ?? null,
          })),
      );
    },
  };
  return {
    store,
    plans,
    versions,
    thread,
    roundTrips: () => roundTrips,
    latest: (planId: string): QPlan | undefined =>
      versions.get(planId)?.at(-1)?.plan,
  };
}
