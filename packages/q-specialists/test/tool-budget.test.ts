import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CLIENT_ACTION_TOOLS,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  Q_KNOWLEDGE_SCOPE_KINDS,
  type QTaskClass,
} from "@capital-q/contracts";
import type { QToolExecutionContext, QToolFocus } from "@capital-q/q-runtime";
import {
  createDefaultQTools,
  createQToolRegistry,
  toolAreaOf,
  type QToolPorts,
  type QToolRecord,
} from "@capital-q/q-tools";
import { ActorContextSchema } from "@capital-q/security";

import {
  PLAIN_QUESTION_FOCUS,
  toolFocusOf,
  type FocusReading,
} from "../src/tool-focus.js";

/**
 * Tool budget (2026-10-12). Measured in production: each answer round
 * offered ~107 tools whose schemas were ~30k of ~44k input tokens. A
 * question to Q is now shown READ_ONLY tools and the core only; a request
 * to act, a hand, a named action and an unread turn are unchanged.
 *
 * The registry here holds every tool and the plan every scope kind (the
 * worst case, as in q-tools' offer tests), so what is measured is what the
 * focus decides, not what a thin plan happens to leave out. Sizes are the
 * serialized declarations the provider receives; tokens are approximate
 * (characters / 4).
 */

const STUB: unknown = {};
const GIVEN: Readonly<Record<string, unknown>> = {
  clientActions: true,
  relationships: { ownRelationships: STUB },
  pendingProposals: {
    inConversation: STUB,
    approve: STUB,
    decline: STUB,
    inboxItem: STUB,
  },
};
const EVERY_PORT = new Proxy(GIVEN, {
  get: (target, key: string): unknown => target[key] ?? STUB,
  has: () => true,
}) as unknown as QToolPorts;
const registry = createQToolRegistry(createDefaultQTools(EVERY_PORT));

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const RUN = "90000000-0000-4000-8000-000000000001";
const actor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: randomUUID(),
  actorType: "HUMAN",
});

function contextOf(
  taskClass: QTaskClass,
  focus: QToolFocus | null,
): QToolExecutionContext {
  const plan = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: actor.userId, organisationId: actor.organisationId },
    purpose: { capability: "ANSWER", taskClass },
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
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
  return {
    actor,
    runId: RUN as QToolExecutionContext["runId"],
    correlationId: "cor_test",
    capability: "ANSWER",
    plan,
    ...(focus === null ? {} : { focus }),
  };
}

/** What the offer was before the budget: no reads-only, a plain question unfocused. */
function before(focus: QToolFocus | null): QToolFocus | null {
  if (focus === null || focus === PLAIN_QUESTION_FOCUS) return null;
  return {
    areas: focus.areas,
    tools: focus.tools,
    ...(focus.widen === undefined ? {} : { widen: focus.widen }),
  };
}

const names = (records: readonly QToolRecord[]) =>
  records.map((record) => record.definition.providerName);
const chars = (records: readonly QToolRecord[]) =>
  records.reduce(
    (sum, record) => sum + JSON.stringify(record.modelDefinition).length,
    0,
  );

const reading = (over: Partial<FocusReading>): FocusReading => ({
  kind: "QUESTION_TO_Q",
  questionKind: null,
  namedTools: [],
  hand: null,
  handOver: false,
  research: "OFFERED",
  text: "",
  ...over,
});

type Turn = {
  readonly name: string;
  readonly purpose: QTaskClass;
  readonly reading: FocusReading | null;
  readonly subjects: readonly string[];
  /** What the turn's existing behaviour needs offered. */
  readonly needs: readonly string[];
  /** The least reduction in schema characters this turn must show. */
  readonly minCut: number;
};

const TURNS: readonly Turn[] = [
  {
    name: "investor on a company profile: what are the risks here?",
    purpose: "COUNTERPARTY_COMPANY_QUESTION",
    reading: reading({
      questionKind: "ADVICE",
      text: "What are the main risks with this company?",
    }),
    subjects: ["COMPANY"],
    needs: [
      "get_company",
      "read_company_deck",
      "read_company_data_room",
      "company_assumptions",
      "fit_profile",
      "research_public_web",
      "use_capability",
      "open_page",
      "show",
    ],
    // Already narrowed to its areas before (55 tools); the browser actions
    // Q answers with are most of what is left.
    minCut: 0.25,
  },
  {
    name: "investor, a question the reader gave no kind (the whole list before)",
    purpose: "INVESTOR_QUESTION",
    reading: reading({ text: "Anything I should know about Ledgerfold?" }),
    subjects: ["COMPANY"],
    needs: [
      "get_company",
      "get_relationship",
      "search_companies",
      "research_public_web",
      "use_capability",
      "open_page",
    ],
    // The ~100-tool shape production measured.
    minCut: 0.4,
  },
  {
    name: "founder on home: how is my raise going?",
    purpose: "OWN_COMPANY_QUESTION",
    reading: reading({
      questionKind: "THEIR_OWN_RECORDS",
      text: "How is my raise going?",
    }),
    subjects: ["CAPITAL_OBJECTIVE"],
    needs: [
      "get_capital_objective",
      "read_my_record",
      "list_my_relationships",
      "get_relationship",
      "use_capability",
      "open_page",
    ],
    minCut: 0.5,
  },
  {
    name: "a team job: have Q chase every investor who has gone quiet",
    purpose: "ACTION_PREPARATION",
    reading: reading({
      kind: "TOOL_REQUEST",
      namedTools: ["propose_q_job"],
      text: "Have Q follow up with every investor who has gone quiet",
    }),
    subjects: [],
    needs: ["propose_q_job", "list_q_work", "use_capability"],
    minCut: 0,
  },
  {
    name: "navigation: take me to my pipeline",
    purpose: "GENERAL_QUESTION",
    reading: reading({
      kind: "TOOL_REQUEST",
      hand: "NAVIGATE",
      text: "Take me to my pipeline",
    }),
    subjects: [],
    needs: ["open_page", "control_screen", "use_capability"],
    minCut: 0,
  },
  {
    name: "no reading (LOW or failed): the purpose's whole list",
    purpose: "OWN_COMPANY_QUESTION",
    reading: null,
    subjects: ["COMPANY"],
    needs: ["change_my_raise", "update_company_profile", "propose_meeting"],
    minCut: 0,
  },
];

function measure(turn: Turn) {
  const focus = toolFocusOf({
    reading: turn.reading,
    subjectKinds: turn.subjects,
    areaOf: toolAreaOf,
    previous: null,
  });
  const was = registry.eligible(contextOf(turn.purpose, before(focus)));
  const now = registry.eligible(contextOf(turn.purpose, focus));
  return { focus, was, now };
}

describe("tool budget: what a turn is shown, before and after", () => {
  it("reports each representative turn's schema size", () => {
    const rows = TURNS.map((turn) => {
      const { was, now } = measure(turn);
      return {
        turn: turn.name,
        tools: `${was.length} -> ${now.length}`,
        chars: `${chars(was)} -> ${chars(now)}`,
        approxTokens: `${Math.ceil(chars(was) / 4)} -> ${Math.ceil(chars(now) / 4)}`,
        cut: `${Math.round((1 - chars(now) / chars(was)) * 100)}%`,
      };
    });
    // The numbers the slice is judged by, in the test log.
    console.table(rows);
    expect(rows).toHaveLength(TURNS.length);
  });

  it.each(TURNS)("$name: cut at least as promised", (turn) => {
    const { was, now } = measure(turn);
    expect(1 - chars(now) / chars(was)).toBeGreaterThanOrEqual(turn.minCut);
    if (turn.minCut === 0) {
      // Not a question: exactly the offer it had.
      expect(names(now)).toEqual(names(was));
    }
  });

  it.each(TURNS)("$name: still offers what the turn needs", (turn) => {
    const offered = new Set(names(measure(turn).now));
    for (const tool of turn.needs) expect(offered, tool).toContain(tool);
  });

  it.each(TURNS)(
    "$name: only narrows; whatever it stops showing still executes and is one use_capability away",
    (turn) => {
      const { focus, was, now } = measure(turn);
      const shown = new Set(names(now));
      // Never a tool the old offer did not have (the plan decides).
      for (const tool of shown) expect(names(was)).toContain(tool);
      const context = contextOf(turn.purpose, focus);
      const loadable = new Set(names(registry.available(context)));
      for (const tool of names(was).filter((name) => !shown.has(name))) {
        expect(
          registry.offeredByProviderName(context, tool),
          tool,
        ).toBeDefined();
        expect(loadable, tool).toContain(tool);
        // Only change-making tools leave the offer, never a browser action.
        const record = registry
          .list()
          .find((r) => r.definition.providerName === tool);
        expect(record?.definition.classification, tool).not.toBe("READ_ONLY");
        expect(Q_CLIENT_ACTION_TOOLS, tool).not.toContain(tool);
      }
      // The core a turn keeps is shown first: all of it, except that a
      // question leaves out the core's change-makers.
      const core = registry
        .list()
        .filter(
          (r) =>
            r.definition.core === true &&
            (focus?.readsOnly !== true ||
              r.definition.classification === "READ_ONLY" ||
              (Q_CLIENT_ACTION_TOOLS as readonly string[]).includes(
                r.definition.providerName,
              )),
        )
        .map((r) => r.definition.providerName);
      expect(names(now).slice(0, core.length).sort()).toEqual([...core].sort());
    },
  );

  it("the same turn is offered the same tools in the same order (provider prompt cache)", () => {
    for (const turn of TURNS) {
      expect(names(measure(turn).now)).toEqual(names(measure(turn).now));
    }
  });
});
