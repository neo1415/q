import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  Q_KNOWLEDGE_SCOPE_KINDS,
  QSituationDossierSchema,
  situationFacts,
  type QSituationDossier,
  type QSituationSource,
} from "@capital-q/contracts";
import {
  countRoundTrip,
  createRoundTripCounter,
  withRoundTripCounter,
} from "@capital-q/database";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createSituationAssembler,
  mandateTopics,
  type SituationAssemblerOptions,
  type SituationAssemblerPorts,
  type SituationSubject,
} from "../src/situation/index.js";

/**
 * Situation-first planning S2: the dossier is read as the asker through
 * the chat's own tool port, every source at once, each capped; what cannot
 * be read is not known (never none); one side never holds the other's
 * private material; and the whole dossier fits the round-trip budget
 * (addendum 4: <= 25).
 *
 * The fake port answers each tool with a fixture that satisfies the real
 * tool's output schema and counts ONE round trip per call: the cost of a
 * tool's own batched read. What is measured here is the assembler's share
 * (calls, sharing, no per-item loops); a tool that itself costs more than
 * one round trip is visible per source on the run counter
 * (`situation.<SOURCE>` phases) in production.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const INVESTOR_ORG = "b0000000-0000-4000-8000-000000000002";
const OTHER_INVESTOR = "b0000000-0000-4000-8000-000000000003";
const RELATIONSHIP = "d0000000-0000-4000-8000-000000000004";
const RUN = "90000000-0000-4000-8000-000000000001";
const NOW = "2026-10-28T10:00:00.000Z";

const MANDATE_SECRET = "MANDATE-SECRET-cheque-7m";
const CASH_SECRET = "CASH-SECRET-runway-4-months";

const actor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: randomUUID(),
  actorType: "HUMAN",
});

function contextOf(): QToolExecutionContext {
  const plan = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: actor.userId, organisationId: actor.organisationId },
    purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    scopes: Q_KNOWLEDGE_SCOPE_KINDS.map((kind) => ({
      kind,
      ...(kind === "COMPANY_PROFILE"
        ? { subject: { kind: "COMPANY", companyId: COMPANY } }
        : {}),
      contextLabel: "organisation_private",
      sensitivity: "CONFIDENTIAL",
      layer: "STRUCTURED_STATE",
      factCategories: [],
      projection: "FULL",
      rights: {
        canUseForReasoning: true,
        canDiscloseExistence: true,
        canQuote: true,
        canProvideLink: true,
      },
      filter: {
        tenantId: TENANT,
        ...(kind === "COMPANY_PROFILE" ? { companyId: COMPANY } : {}),
      },
      isEvidence: true,
    })),
    denied: [],
    maxSensitivity: "HIGHLY_CONFIDENTIAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: NOW,
    revalidateAfter: "2026-10-28T10:01:00.000Z",
    revalidateOnResume: true,
  });
  return {
    actor,
    runId: RUN as QToolExecutionContext["runId"],
    correlationId: "cor_test",
    capability: "ANSWER",
    plan,
  };
}

// --- fixtures, each in its tool's real output shape -------------------------------

const readMy = (kind: string, title: string, status: string) => ({
  kind,
  available: true,
  items: [
    {
      id: `${kind}-1`,
      title,
      status,
      at: "2026-10-20",
      facts: { owner: "you" },
    },
  ],
});

const FIXTURES: Readonly<Record<string, unknown>> = {
  list_my_relationships: {
    yourSide: "COMPANY",
    relationships: [
      {
        relationshipId: RELATIONSHIP,
        counterpart: {
          kind: "INVESTOR_ORGANISATION",
          id: OTHER_INVESTOR,
          name: "Lagos Ventures",
        },
        state: "CONNECTED",
        stateSince: "2026-10-10T09:00:00.000Z",
        milestones: [],
        nextStep: "SCHEDULE_MEETING",
        lastMessage: {
          from: "THEM",
          at: "2026-10-27T15:00:00.000Z",
          preview: "Could you share churn by cohort?",
        },
        messagesRead: "OK",
      },
    ],
    saved: [],
    passed: [],
    truthClass: "VERIFIED",
    source: "Capital Q relationship history",
  },
  list_incoming_interest: {
    interests: [
      {
        investorOrganisationId: OTHER_INVESTOR,
        investorName: "Lagos Ventures",
        investorType: "venture fund",
        expressedAt: "2026-10-09T09:00:00.000Z",
        note: "We like the SME lending angle; how sticky are your merchants?",
        answer: "ACCEPTED",
        answeredAt: "2026-10-10T09:00:00.000Z",
      },
    ],
    truthClass: "VERIFIED",
  },
  find_prospective_investors: {
    fitVersion: "prospect-fit.v2",
    companySource: "CAPITAL_Q_RECORD",
    compared: { countryCode: "NG", stageCode: "seed" },
    prospects: [
      {
        investorOrganisationId: INVESTOR_ORG,
        name: "Harbour Capital",
        investorType: "venture fund",
        hqCountry: "Kenya",
        publicDescription: null,
        websiteUrl: null,
        deploymentState: null,
        reasons: [],
        label: "likely fit, not evidence of interest",
        gate: {
          title: "Seed fintech",
          acceptingApplications: true,
          criteria: [
            { label: "Seed stage", required: true, standing: "MET" },
            {
              label: "Revenue over $20k MRR",
              required: true,
              standing: "NOT_MET",
            },
            { label: "Audited accounts", required: false, standing: "UNKNOWN" },
          ],
        },
      },
    ],
    notes: [],
  },
  coach_my_deck: {
    deckTitle: "Tallyloom seed deck",
    coaching: {
      rubricVersion: 1,
      sections: DECK_SECTIONS.map((section, index) => ({
        section,
        score: index === 6 ? 1 : 4,
        level: index === 6 ? "MENTIONED" : "BASIC",
        requiredForMinimum: index === 6,
        atStandard: index !== 6,
        gaps: index === 6 ? ["No dated revenue figures"] : [],
        improve:
          index === 6 ? "Show monthly revenue for the last 12 months." : null,
      })),
      checks: [
        {
          code: "UNDATED_FIGURES",
          passed: false,
          words: "Revenue figures have no dates.",
        },
      ],
      sectionsAtStandard: DECK_SECTIONS.length - 1,
      atMinimumStandard: false,
    },
    privateToYou: true,
  },
  read_company_data_room: {
    viewer: "OWNER",
    documents: [
      {
        title: "2025 management accounts",
        folder: "Financials",
        status: "on request; opened by 2",
      },
    ],
    openRequests: 1,
  },
  "read_my:media": readMy("media", "Seed pitch", "investors can play it"),
  "read_my:readiness": readMy(
    "readiness",
    "Traction evidence",
    "blocking: no dated revenue",
  ),
  "read_my:plan": readMy("plan", "Upload monthly revenue", "not done"),
  "read_my:gateq": readMy("gateq", "Tallyloom application", "unread"),
  "read_my:feed": readMy("feed", "Tallyloom", "in your feed"),
  "read_my_record:PROFILE_FINDINGS": {
    status: "FOUND",
    data: {
      subjectType: "COMPANY",
      subjectId: COMPANY,
      findings: [
        {
          id: randomUUID(),
          key: "presence.milestone",
          statement:
            "TechCabal reported 4,000 merchants in June 2026; the deck says 6,000.",
          truthClass: "USER_CLAIM",
          evidenceStatus: "EXTERNALLY_VERIFIED",
          lifecycleStatus: "CONTRADICTORY",
          recordedAt: "2026-10-01T09:00:00.000Z",
          sources: [
            {
              title: "TechCabal",
              url: "https://techcabal.com/tallyloom",
              retrievedAt: null,
            },
          ],
        },
      ],
    },
  },
  "read_my_record:COMPANY_NETWORK_PREVIEW": {
    status: "FOUND",
    data: {
      name: "Tallyloom",
      stage: "seed",
      sectors: ["fintech", "SME lending"],
    },
  },
  get_capital_objective: {
    companyId: COMPANY,
    availability: "CURRENT",
    objective: {
      capitalObjectiveId: randomUUID(),
      objectiveType: "RAISE",
      status: "ACTIVE",
      target: { amount: "1500000", currency: "USD" },
      targetStage: "seed",
      instrumentCode: "safe",
      targetCloseDate: "2027-03-31",
      startedAt: "2026-09-01T09:00:00.000Z",
      truthClass: "USER_CLAIM",
    },
    note: CASH_SECRET,
  },
  list_schedule: {
    meetings: [
      {
        id: "m1",
        relationshipId: RELATIONSHIP,
        purpose: "Intro call",
        startsAt: "2026-10-30T13:00:00.000Z",
        local: "2pm",
        organisedByYou: true,
        with: ["Ada Obi"],
        brief: null,
      },
    ],
    reminders: [
      {
        id: "r1",
        title: "Send the deck",
        dueAt: "2026-10-29T09:00:00.000Z",
        relationshipId: null,
      },
    ],
  },
  my_board: {
    action: "LIST",
    items: [
      {
        itemId: "b1",
        kind: "TASK",
        title: "Collect cohort churn",
        status: "TODO",
        refId: null,
        notes: null,
        dueOn: "2026-11-02",
        workJobId: null,
        revision: 1,
      },
    ],
    more: 0,
  },
  list_q_work: {
    items: [
      {
        delegationId: "w1",
        kind: "OUTREACH",
        status: "RUNNING",
        summary: "Following up with Harbour Capital",
        expiresAt: "2026-11-30T00:00:00.000Z",
        lanes: [],
      },
    ],
  },
  list_pending_approvals: {
    items: [
      {
        approvalId: "p1",
        summary: "Reply to Lagos Ventures",
        requestedAt: "2026-10-27T16:00:00.000Z",
        expiresAt: "2026-11-03T16:00:00.000Z",
      },
    ],
  },
  get_q_daily: {
    status: "READY",
    editionDate: "2026-10-28",
    number: 12,
    href: "/daily",
    headlines: [
      {
        section: "Market",
        headline: "CBN publishes open-banking rules",
        publisher: "BusinessDay",
      },
    ],
    qTake: null,
    frequency: "DAILY",
    email: false,
    sections: [],
    nextDueAt: null,
  },
  get_investor_mandate: {
    investorOrganisationId: INVESTOR_ORG,
    displayName: "Harbour Capital",
    investorType: "venture fund",
    deploymentState: "deploying",
    mandates: [
      {
        mandateId: randomUUID(),
        status: "ACTIVE",
        version: 3,
        discoveryMode: "BALANCED",
        cheque: { currency: "USD", typical: MANDATE_SECRET },
        stage: { minStageCode: "pre_seed", maxStageCode: "seed" },
        constraints: [],
        taxonomyPreferences: [
          {
            vocabularyCode: "industry",
            canonicalCode: "fintech",
            preferenceStrength: "STRONG",
            isExclusion: false,
          },
        ],
        truthClass: "USER_CLAIM",
      },
    ],
    truncated: false,
  },
};

/** The fixture key a call answers to: read_my and read_my_record by kind. */
function fixtureKey(name: string, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>;
  if (name === "read_my" && typeof record["kind"] === "string")
    return `read_my:${record["kind"]}`;
  if (name === "read_my_record" && typeof record["record"] === "string") {
    return `read_my_record:${record["record"]}`;
  }
  return name;
}

type FakeOptions = {
  readonly delayMs?: Readonly<Record<string, number>>;
  readonly denied?: readonly string[];
  readonly overrides?: Readonly<Record<string, unknown>>;
};

function fakeTools(options: FakeOptions = {}) {
  const calls: {
    name: string;
    key: string;
    signal: AbortSignal | undefined;
  }[] = [];
  const port: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: async (proposal, context) => {
      const key = fixtureKey(proposal.name, proposal.arguments);
      calls.push({ name: proposal.name, key, signal: context.signal });
      // The tool's own batched read: one round trip.
      countRoundTrip();
      const delay = options.delayMs?.[key] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const base = {
        callId: proposal.callId,
        toolName: proposal.name as QToolCallOutcome["toolName"],
        toolVersion: 1,
        classification: "READ_ONLY" as QToolCallOutcome["classification"],
        latencyMs: delay,
      };
      if (options.denied?.includes(key)) {
        return {
          ...base,
          status: "DENIED",
          failureCode: "NOT_AVAILABLE",
          sensitivity: null,
          result: {
            ok: false,
            error: { code: "NOT_AVAILABLE", safeMessage: "Not available." },
          },
        };
      }
      const data = options.overrides?.[key] ?? FIXTURES[key];
      return {
        ...base,
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        result: { ok: true, data: strip(data) },
      };
    },
  };
  return { port, calls };
}

/** The capital fixture carries a planted secret outside its schema; the tool would strip it. */
function strip(data: unknown): unknown {
  if (typeof data !== "object" || data === null || !("note" in data))
    return data;
  const { note: _note, ...rest } = data as Record<string, unknown>;
  return rest;
}

const FOUNDER: SituationSubject = { side: "FOUNDER", companyId: COMPANY };
const INVESTOR: SituationSubject = {
  side: "INVESTOR",
  investorOrganisationId: INVESTOR_ORG,
};

function assemblerWith(
  tools: QToolPort,
  extra: Partial<SituationAssemblerPorts> = {},
  options: SituationAssemblerOptions = {},
) {
  return createSituationAssembler(
    {
      tools,
      // Each port's own read: one round trip.
      memory: () => {
        countRoundTrip();
        return Promise.resolve(["Prefers investors who lead seed rounds."]);
      },
      activity: () => {
        countRoundTrip();
        return Promise.resolve([
          {
            at: "2026-10-27T12:00:00.000Z",
            what: "recorded a $1M commitment from Zino Aviation",
            record: null,
          },
        ]);
      },
      ...extra,
    },
    { now: () => new Date(NOW), ...options },
  );
}

const sectionOf = (dossier: QSituationDossier, source: QSituationSource) => {
  const section = dossier.sections.find((entry) => entry.source === source);
  if (section === undefined) throw new Error(`no ${source} section`);
  return section;
};

const FOUNDER_READ: readonly QSituationSource[] = [
  "ACTIVITY",
  "RELATIONSHIPS",
  "MESSAGES",
  "SCHEDULE",
  "BOARD",
  "Q_WORK",
  "MEMORY",
  "Q_DAILY",
  "INTEREST",
  "PROSPECTS",
  "PROFILE",
  "DECK",
  "DATA_ROOM",
  "PITCH_VIDEO",
  "READINESS",
  "CLAIMS",
  "CAPITAL",
];

describe("situation assembler", () => {
  it("assembles a founder's full dossier within the round-trip budget", async () => {
    const { port, calls } = fakeTools();
    const assembler = assemblerWith(port);
    const counter = createRoundTripCounter(RUN);
    const dossier = await withRoundTripCounter(counter, () =>
      assembler.assemble({
        context: contextOf(),
        subject: FOUNDER,
        ask: "How do I improve my chances of closing the round?",
        publicProfile: {
          name: "Tallyloom",
          country: "Nigeria",
          sectors: ["fintech"],
        },
      }),
    );

    expect(QSituationDossierSchema.safeParse(dossier).success).toBe(true);
    for (const source of FOUNDER_READ) {
      const section = sectionOf(dossier, source);
      expect(section.status, source).toBe("READ");
      expect(section.facts.length, source).toBeGreaterThan(0);
    }
    for (const source of ["MANDATE", "GATEQ", "FEED_DECISIONS"] as const) {
      expect(sectionOf(dossier, source).status).toBe("NOT_APPLICABLE");
    }
    // Public research is its own step: until it runs, public is not known.
    expect(dossier.unknowns).toEqual(["PUBLIC"]);
    expect(dossier.publicTopics).toEqual(["fintech Nigeria", "Tallyloom"]);

    const facts = situationFacts(dossier);
    expect(facts.map((fact) => fact.ref)).toEqual(
      facts.map((_, index) => `F${String(index + 1)}`),
    );
    const text = facts.map((fact) => fact.statement).join("\n");
    expect(text).toContain("Could you share churn by cohort?");
    expect(text).toContain("how sticky are your merchants?");
    expect(text).toContain("not met: Revenue over $20k MRR");
    expect(text).toContain("Deck section traction scores 1/5");
    expect(text).toContain("USD 1500000");
    expect(text).toContain("recorded a $1M commitment from Zino Aviation");
    // Open and pending said as such (live 2026-10-30: an open board task
    // "Approve sharing ..." was read as an approval already given).
    expect(text).toContain(
      'On your board, not done yet (todo): task "Collect cohort churn", due 2026-11-02.',
    );
    expect(text).toContain(
      "Waiting for your approval, not approved yet (nothing is sent or changed until you approve, change or decline it on its card; asked 2026-10-27): Reply to Lagos Ventures",
    );
    const contradiction = facts.find((fact) =>
      fact.statement.includes("TechCabal"),
    );
    expect(contradiction?.statement).toContain("[contradictory]");
    expect(contradiction?.evidenceStatus).toBe("EXTERNALLY_VERIFIED");
    expect(
      sectionOf(dossier, "CAPITAL").facts.map((fact) => fact.category),
    ).toEqual(["RAISE_TARGET", "FUNDING_DEADLINE"]);

    // One call per distinct read: the relationships list is shared.
    expect(
      calls.filter((call) => call.name === "list_my_relationships"),
    ).toHaveLength(1);
    expect(new Set(calls.map((call) => call.key)).size).toBe(calls.length);
    // Addendum 4: <= 25 round trips for the whole dossier.
    expect(counter.count).toBeLessThanOrEqual(25);
    // 16 tool reads + memory + activity.
    expect(counter.count).toBe(calls.length + 2);
    expect(counter.count).toBe(18);
    expect(
      Object.keys(counter.phases).every((phase) =>
        phase.startsWith("situation."),
      ),
    ).toBe(true);
  });

  it("keeps a timed-out source as not known, and a slow source never delays the rest", async () => {
    const { port, calls } = fakeTools({ delayMs: { coach_my_deck: 5_000 } });
    const assembler = assemblerWith(
      port,
      {},
      { readTimeoutMs: 100, dossierTimeoutMs: 400 },
    );
    const started = performance.now();
    const dossier = await assembler.assemble({
      context: contextOf(),
      subject: FOUNDER,
      ask: "Plan my raise",
    });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1_000);
    const deck = sectionOf(dossier, "DECK");
    expect(deck).toMatchObject({
      status: "UNAVAILABLE",
      reason: "TIMED_OUT",
      facts: [],
    });
    expect(dossier.unknowns).toContain("DECK");
    expect(sectionOf(dossier, "INTEREST").status).toBe("READ");
    // The late read was told to stop.
    expect(
      calls.find((call) => call.name === "coach_my_deck")?.signal?.aborted,
    ).toBe(true);
  });

  it("caps the whole dossier, and a denied or failed read is not known, never none", async () => {
    const { port } = fakeTools({
      denied: ["read_company_data_room"],
      overrides: { list_incoming_interest: { interests: "not a list" } },
    });
    const assembler = assemblerWith(
      port,
      { memory: () => new Promise<readonly string[]>(() => undefined) },
      { dossierTimeoutMs: 150 },
    );
    const dossier = await assembler.assemble({
      context: contextOf(),
      subject: FOUNDER,
      ask: "Plan",
    });
    expect(sectionOf(dossier, "MEMORY")).toMatchObject({
      status: "UNAVAILABLE",
      reason: "TIMED_OUT",
    });
    expect(sectionOf(dossier, "DATA_ROOM")).toMatchObject({
      status: "UNAVAILABLE",
      reason: "NOT_PERMITTED",
    });
    expect(sectionOf(dossier, "INTEREST")).toMatchObject({
      status: "UNAVAILABLE",
      reason: "FAILED",
    });
    expect(dossier.unknowns).toEqual(
      expect.arrayContaining(["MEMORY", "DATA_ROOM", "INTEREST"]),
    );
  });

  it("never gives a founder an investor's private mandate", async () => {
    const { port, calls } = fakeTools();
    const dossier = await assemblerWith(port).assemble({
      context: contextOf(),
      subject: FOUNDER,
      ask: "Which investors should I go after?",
    });
    expect(calls.map((call) => call.name)).not.toContain(
      "get_investor_mandate",
    );
    expect(calls.map((call) => call.key)).not.toContain("read_my:gateq");
    expect(JSON.stringify(dossier)).not.toContain(MANDATE_SECRET);
    expect(
      situationFacts(dossier).some((fact) => fact.label === "investor_private"),
    ).toBe(false);
    expect(
      situationFacts(dossier).some(
        (fact) => fact.category === "INVESTOR_THESIS",
      ),
    ).toBe(false);
    // Prospects come from what investors publish, never their mandate.
    expect(
      sectionOf(dossier, "PROSPECTS").facts.every(
        (fact) => fact.label === "network_visible",
      ),
    ).toBe(true);
  });

  it("never gives an investor a founder's private financials", async () => {
    const { port, calls } = fakeTools({
      overrides: {
        list_my_relationships: {
          ...(FIXTURES["list_my_relationships"] as object),
          yourSide: "INVESTOR",
          saved: [{ companyId: COMPANY, name: "Tallyloom", stageCode: "seed" }],
          passed: [],
        },
      },
    });
    const dossier = await assemblerWith(port).assemble({
      context: contextOf(),
      subject: INVESTOR,
      ask: "Plan my next quarter's deployment",
    });
    const names = calls.map((call) => call.key);
    for (const founderRead of [
      "get_capital_objective",
      "coach_my_deck",
      "read_company_data_room",
      "list_incoming_interest",
      "read_my:readiness",
      "read_my:plan",
      "read_my_record:PROFILE_FINDINGS",
    ]) {
      expect(names).not.toContain(founderRead);
    }
    const facts = situationFacts(dossier);
    expect(facts.some((fact) => fact.label === "founder_private")).toBe(false);
    expect(
      facts.some((fact) =>
        [
          "CASH_POSITION",
          "BURN_RATE",
          "PAYROLL_TIMING",
          "RAISE_TARGET",
        ].includes(fact.category ?? ""),
      ),
    ).toBe(false);
    expect(JSON.stringify(dossier)).not.toContain(CASH_SECRET);
    for (const source of [
      "CAPITAL",
      "READINESS",
      "DECK",
      "DATA_ROOM",
      "INTEREST",
    ] as const) {
      expect(sectionOf(dossier, source).status).toBe("NOT_APPLICABLE");
    }
    // Their own side is read: mandate, inbox, feed, saves.
    expect(sectionOf(dossier, "MANDATE").status).toBe("READ");
    // Owner 2026-10-29: their declared sectors are public vocabulary for
    // research topics; the cheque and their organisation's name never are.
    expect(dossier.publicTopics).toEqual(["fintech"]);
    expect(dossier.publicTopics.join(" ")).not.toContain(MANDATE_SECRET);
    expect(dossier.publicTopics.join(" ")).not.toContain("Harbour");
    expect(sectionOf(dossier, "GATEQ").status).toBe("READ");
    expect(sectionOf(dossier, "FEED_DECISIONS").facts[0]?.statement).toContain(
      "You saved Tallyloom",
    );
  });

  it("caches per actor, re-reads only what an event touched, and forgets on invalidate", async () => {
    const { port, calls } = fakeTools();
    const assembler = assemblerWith(port);
    const request = {
      context: contextOf(),
      subject: FOUNDER,
      ask: "Plan",
    } as const;
    await assembler.assemble(request);
    const first = calls.length;
    await assembler.assemble(request);
    expect(calls.length).toBe(first);
    await assembler.assemble({ ...request, refresh: ["INTEREST"] });
    expect(calls.slice(first).map((call) => call.name)).toEqual([
      "list_incoming_interest",
    ]);
    assembler.invalidate(actor);
    await assembler.assemble(request);
    expect(calls.length).toBe(first * 2 + 1);
  });

  it("adds public findings from the bounded research step, seeing topics only", async () => {
    const { port } = fakeTools();
    const assembler = assemblerWith(port);
    const dossier = await assembler.assemble({
      context: contextOf(),
      subject: FOUNDER,
      ask: "Plan my raise",
      publicProfile: {
        name: "Tallyloom",
        country: "Nigeria",
        sectors: ["fintech"],
      },
    });
    let seen: unknown = null;
    const withPublic = await assembler.research(dossier, {
      ask: "Plan my raise",
      hook: (input) => {
        seen = input;
        return Promise.resolve([
          {
            statement:
              "The CBN's open-banking rules take effect in January 2027.",
            url: "https://www.cbn.gov.ng/open-banking",
            publishedOn: "2026-10-20",
            truthClass: "VERIFIED",
            evidenceStatus: "EXTERNALLY_VERIFIED",
          },
          {
            statement: "A page with no address is dropped.",
            url: "javascript:alert(1)",
            publishedOn: null,
            truthClass: "UNKNOWN",
            evidenceStatus: "NO_EVIDENCE",
          },
        ]);
      },
    });
    expect(Object.keys(seen as object).sort()).toEqual([
      "ask",
      "journey",
      "side",
      "signal",
      "topics",
    ]);
    expect(JSON.stringify((seen as { topics: unknown }).topics)).not.toContain(
      "1500000",
    );
    const publicSection = sectionOf(withPublic, "PUBLIC");
    expect(publicSection.status).toBe("READ");
    expect(publicSection.facts).toHaveLength(1);
    expect(publicSection.facts[0]?.provenance.url).toBe(
      "https://www.cbn.gov.ng/open-banking",
    );
    expect(withPublic.unknowns).toEqual([]);
    expect(QSituationDossierSchema.safeParse(withPublic).success).toBe(true);

    const late = await assembler.research(dossier, {
      ask: "Plan",
      timeoutMs: 20,
      hook: () => new Promise(() => undefined),
    });
    expect(sectionOf(late, "PUBLIC")).toMatchObject({
      status: "UNAVAILABLE",
      reason: "TIMED_OUT",
    });
  });
});

describe("mandate topics (owner 2026-10-29)", () => {
  it("are their declared sectors in each declared geography; exclusions, cheques and names never", () => {
    const topics = mandateTopics([
      {
        investorOrganisationId: INVESTOR_ORG,
        displayName: "Harbour Capital",
        investorType: null,
        deploymentState: null,
        mandates: [
          {
            mandateId: randomUUID(),
            status: "ACTIVE",
            version: 1,
            discoveryMode: null,
            cheque: { currency: "USD", min: "250000", max: "1000000" },
            stage: { minStageCode: "seed", maxStageCode: "seed" },
            constraints: [],
            taxonomyPreferences: (
              [
                ["industry", "fintech", false],
                ["business_model", "b2b_saas", false],
                ["industry", "digital_lending", true],
                ["geography", "nigeria", false],
                ["geography", "kenya", false],
              ] as const
            ).map(([vocabularyCode, canonicalCode, isExclusion]) => ({
              vocabularyCode,
              canonicalCode,
              preferenceStrength: isExclusion ? "HARD_EXCLUSION" : "MUST",
              isExclusion,
            })),
            truthClass: "USER_CLAIM",
          },
        ],
        truncated: false,
      },
    ]);
    expect(topics).toEqual([
      "fintech b2b saas nigeria",
      "fintech b2b saas kenya",
    ]);
    const all = topics.join(" ");
    for (const never of ["250000", "1000000", "lending", "Harbour", "seed"])
      expect(all).not.toContain(never);
  });
});
