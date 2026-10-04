import { describe, expect, it } from "vitest";

import {
  MODEL_TOOLS_MAX,
  Q_KNOWLEDGE_SCOPE_KINDS,
  Q_TASK_CLASSES,
  type QKnowledgeScopeKind,
} from "@capital-q/contracts";
import type { QToolFocus } from "@capital-q/q-runtime";
import {
  APP_ACTIONS,
  appActionToolNames,
  qToolName,
} from "@capital-q/app-actions";
import { APP_ACTION_GROUPS } from "../src/index.js";

import {
  createDefaultQTools,
  createQToolRegistry,
  createQToolExecutor,
  Q_TURN_TOOLS_MAX,
  toolAreaOf,
  type QToolPorts,
  type QToolRecord,
} from "../src/index.js";
import { COMPANY_A, actorA, contextFor, planFor } from "./support.js";

/**
 * Lead 2026-10-02: tools are offered by what the turn is about (its
 * focus: capability areas and named tools), not by a static list per
 * purpose. Measured on the worst case (every port, every scope kind).
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

function worstCase(
  purpose: (typeof Q_TASK_CLASSES)[number],
  focus?: QToolFocus,
) {
  const context = contextFor(
    actorA,
    planFor(
      actorA,
      purpose,
      Q_KNOWLEDGE_SCOPE_KINDS.map((kind: QKnowledgeScopeKind) => ({
        kind,
        sensitivity: "CONFIDENTIAL" as const,
        ...(kind === "COMPANY_PROFILE" ? { companyId: COMPANY_A } : {}),
      })),
    ),
  );
  return focus === undefined ? context : { ...context, focus };
}

const names = (records: readonly QToolRecord[]) =>
  records.map((record) => record.definition.providerName);
const schemaChars = (records: readonly QToolRecord[]) =>
  records.reduce(
    (sum, record) => sum + JSON.stringify(record.modelDefinition).length,
    0,
  );

const AREAS = [
  ...new Set(
    registry
      .list()
      .map((record) => toolAreaOf(record.definition.providerName))
      .filter((area): area is string => area !== null),
  ),
].sort();

/** What readings produce (q-specialists' toolFocusOf), one per kind of turn. */
const TURN_FOCUSES: readonly QToolFocus[] = [
  { areas: ["Screens"], tools: [] }, // small talk, control
  { areas: ["Research"], tools: [] }, // advice, public facts
  { areas: ["Records"], tools: [] }, // options, a company on screen
  { areas: ["Records", "Relationships"], tools: [] }, // progress
  {
    areas: ["Documents", "Pitch", "Profile", "Records", "Relationships"],
    tools: [],
  }, // their own records
  ...registry
    .list()
    .filter((record) => record.definition.status === "ACTIVE")
    .map((record) => {
      const area = toolAreaOf(record.definition.providerName);
      return {
        areas: area === null ? [] : [area],
        tools: [record.definition.providerName],
      };
    }), // every action the reader can name
];

const PROPOSERS = appActionToolNames(APP_ACTIONS).filter((name) =>
  name.startsWith("propose_"),
);

describe("tools offered by what the turn is about", () => {
  it.each(Q_TASK_CLASSES)(
    "%s: no turn is offered more than Q_TURN_TOOLS_MAX, and the core always leads",
    (purpose) => {
      const core = registry
        .list()
        .filter((record) => record.definition.core === true)
        .map((record) => record.definition.providerName);
      for (const focus of [undefined, ...TURN_FOCUSES]) {
        const offered = names(registry.eligible(worstCase(purpose, focus)));
        expect(offered.length).toBeLessThanOrEqual(Q_TURN_TOOLS_MAX);
        expect(offered.slice(0, core.length).sort()).toEqual([...core].sort());
      }
    },
  );

  it("a declared app action asked for by name is offered and executes on every purpose the plan allows", () => {
    for (const purpose of Q_TASK_CLASSES) {
      for (const record of registry.list()) {
        if (record.definition.status !== "ACTIVE") continue;
        const name = record.definition.providerName;
        // The plan's scopes still decide; the worst case holds them all.
        const context = worstCase(purpose, { areas: [], tools: [name] });
        const offered = names(registry.eligible(context));
        const executes = registry.offeredByProviderName(context, name);
        // What is offered is what may execute (QA 2026-10-03: a named
        // relationship_outcome was offered, then refused TOOL_NOT_ELIGIBLE).
        expect(offered.includes(name), `${purpose}: ${name}`).toBe(
          executes !== undefined,
        );
        if (
          record.definition.eligibleWhenNamed === true ||
          record.definition.core === true ||
          record.definition.supportedPurposes.includes(purpose)
        ) {
          expect(offered, `${purpose}: ${name}`).toContain(name);
        }
      }
    }
  });

  it("an app action off this purpose executes only when the turn named it", () => {
    const outcome = "relationship_outcome";
    expect(
      registry.list().find((r) => r.definition.providerName === outcome)
        ?.definition.supportedPurposes,
    ).not.toContain("INVESTOR_QUESTION");
    const unnamed = worstCase("INVESTOR_QUESTION");
    expect(registry.offeredByProviderName(unnamed, outcome)).toBeUndefined();
    const named = worstCase("INVESTOR_QUESTION", {
      areas: [],
      tools: [outcome],
    });
    expect(registry.offeredByProviderName(named, outcome)).toBeDefined();
    expect(names(registry.eligible(named))).toContain(outcome);
    // A plan without its scope kinds never reaches it, named or not.
    const scopeless = {
      ...contextFor(actorA, planFor(actorA, "INVESTOR_QUESTION", [])),
      focus: { areas: [], tools: [outcome] },
    };
    expect(registry.offeredByProviderName(scopeless, outcome)).toBeUndefined();
  });

  it("every declared action's tool is reachable by name (ADR 0040 parity)", () => {
    const tools = new Set(names(registry.list()));
    for (const action of APP_ACTIONS) {
      const tool = qToolName(action);
      if (tool === null || !tools.has(tool)) continue;
      const offered = names(
        registry.eligible(
          worstCase("ACTION_PREPARATION", { areas: [], tools: [tool] }),
        ),
      );
      expect(offered, action.name).toContain(tool);
    }
  });

  it("every declared area has its capability group, so its actions sit in their own area", () => {
    for (const action of APP_ACTIONS) {
      expect(APP_ACTION_GROUPS[action.area], action.name).toBeDefined();
    }
  });

  it("a declared app action is offered and executes whenever its area is in the turn's focus, on any purpose (run d396af2f)", () => {
    expect(toolAreaOf("diligence_documents")).toBe("Relationships");
    expect(toolAreaOf("relationship_outcome")).toBe("Relationships");
    const app = registry
      .list()
      .filter((record) => record.definition.eligibleWhenNamed === true);
    for (const purpose of Q_TASK_CLASSES) {
      for (const widen of [true, false]) {
        const context = worstCase(purpose, {
          areas: ["Relationships"],
          tools: [],
          ...(widen ? { widen } : {}),
        });
        const offered = names(registry.eligible(context));
        expect(offered.length).toBeLessThanOrEqual(Q_TURN_TOOLS_MAX);
        for (const record of app) {
          const name = record.definition.providerName;
          if (toolAreaOf(name) !== "Relationships") continue;
          // What is offered may execute; the bound may cut what is shown,
          // never what the run may use.
          if (offered.includes(name)) {
            expect(
              registry.offeredByProviderName(context, name),
              `${purpose}: ${name}`,
            ).toBeDefined();
          }
        }
        expect(offered, `${purpose} widen=${String(widen)}`).toContain(
          "diligence_documents",
        );
      }
    }
    // Widened, nothing outside the purpose's list or the area's app
    // actions is offered.
    const allowed = new Set([
      ...names(registry.ranked(worstCase("INVESTOR_QUESTION"))),
      ...registry
        .list()
        .filter(
          (r) =>
            r.definition.eligibleWhenNamed === true &&
            toolAreaOf(r.definition.providerName) === "Relationships",
        )
        .map((r) => r.definition.providerName),
    ]);
    const widened = names(
      registry.eligible(
        worstCase("INVESTOR_QUESTION", {
          areas: ["Relationships"],
          tools: [],
          widen: true,
        }),
      ),
    );
    for (const name of widened) expect(allowed.has(name), name).toBe(true);
    // Another area's off-purpose app actions are not brought in by this one.
    const relationshipsOnly = names(
      registry.eligible(
        worstCase("INVESTOR_QUESTION", { areas: ["Relationships"], tools: [] }),
      ),
    );
    for (const record of registry.list()) {
      const name = record.definition.providerName;
      if (
        record.definition.eligibleWhenNamed === true &&
        !record.definition.supportedPurposes.includes("INVESTOR_QUESTION") &&
        toolAreaOf(name) !== "Relationships"
      ) {
        expect(relationshipsOnly, name).not.toContain(name);
      }
    }
  });

  it("run d396af2f: 'Ask Ledgerfold for their last 12 months of management accounts.' on INVESTOR_QUESTION, no tool named, runs diligence_documents", async () => {
    // The focus q-specialists derives for TOOL_REQUEST with nothing named
    // and the investor organisation as the subject.
    const context = worstCase("INVESTOR_QUESTION", {
      areas: ["Relationships"],
      tools: [],
      widen: true,
    });
    expect(names(registry.eligible(context))).toContain("diligence_documents");
    const executor = createQToolExecutor({ registry });
    const outcome = await executor.execute(
      {
        callId: "d396af2f",
        name: "diligence_documents",
        arguments: {
          relationship: "Ledgerfold",
          operation: "REQUEST",
          title: "Last 12 months of management accounts",
        },
      },
      context,
    );
    // Reached: its own authorize step decides, never TOOL_NOT_ELIGIBLE.
    expect(outcome.failureCode).not.toBe("TOOL_NOT_ELIGIBLE");
  });

  it("asked by meaning: the reader's list is every relevant tool, unfocused, then the app actions on any purpose", async () => {
    const executor = createQToolExecutor({ registry });
    for (const purpose of Q_TASK_CLASSES) {
      const focused = worstCase(purpose, { areas: ["Screens"], tools: [] });
      const listed = ((await executor.available?.(focused)) ?? []).map(
        (tool) => tool.definition.name,
      );
      const unfocused = names(
        registry.ranked(worstCase(purpose)).slice(0, MODEL_TOOLS_MAX),
      );
      expect(listed.slice(0, unfocused.length)).toEqual(unfocused);
      for (const name of listed.slice(unfocused.length)) {
        const record = registry
          .list()
          .find((r) => r.definition.providerName === name);
        // A generated tool, or the proposer still serving a declared action.
        expect(
          record?.definition.eligibleWhenNamed === true ||
            PROPOSERS.includes(name),
          name,
        ).toBe(true);
      }
      expect(listed).toContain("relationship_outcome");
      // QA run 92e8545d: a reminder is reachable whatever the turn is about.
      expect(listed, purpose).toContain("propose_reminder");
    }
  });

  it("focus narrows what the model is shown, never what the run may execute", () => {
    const narrow = worstCase("OWN_COMPANY_QUESTION", {
      areas: ["Screens"],
      tools: [],
    });
    expect(names(registry.eligible(narrow))).not.toContain("get_company");
    expect(registry.offeredByProviderName(narrow, "get_company")).toBeDefined();
  });

  it("measures: fewer tools and smaller schemas per turn than the static list", () => {
    const rows: string[] = [];
    let beforeTotal = 0;
    let afterTotal = 0;
    for (const purpose of Q_TASK_CLASSES) {
      const before = registry
        .ranked(worstCase(purpose))
        .slice(0, MODEL_TOOLS_MAX);
      const after = TURN_FOCUSES.map((focus) =>
        registry.eligible(worstCase(purpose, focus)),
      );
      const avg = after.reduce((s, r) => s + r.length, 0) / after.length;
      const avgChars =
        after.reduce((s, r) => s + schemaChars(r), 0) / after.length;
      beforeTotal += before.length;
      afterTotal += avg;
      rows.push(
        `${purpose}: ${String(before.length)} tools / ${String(schemaChars(before))} chars -> avg ${avg.toFixed(1)} tools / ${avgChars.toFixed(0)} chars`,
      );
      expect(avg).toBeLessThan(before.length);
    }
    console.info(
      `tool offer per turn (areas: ${AREAS.join(", ")})\n${rows.join("\n")}`,
    );
    expect(afterTotal).toBeLessThan(beforeTotal);
  });

  it("run 13955ca2: a research turn on an own-company plan keeps every research tool within the bound", () => {
    const research = [
      "extract_public_web",
      "lookup_public_profile",
      "research_public_web",
    ];
    // Their own records and research: 81 tools rank before the bound, and
    // without the guarantee the three sit at 42-44, past it.
    const areas = [
      "Documents",
      "Pitch",
      "Profile",
      "Records",
      "Relationships",
      "Research",
    ];
    expect(
      names(
        registry.eligible(
          worstCase("OWN_COMPANY_QUESTION", { areas, tools: [] }),
        ),
      ),
    ).not.toContain("research_public_web");
    const focus = { areas, tools: research };
    for (const purpose of [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "GENERAL_QUESTION",
    ] as const) {
      const context = worstCase(purpose, focus);
      const offered = names(registry.eligible(context));
      expect(offered.length).toBeLessThanOrEqual(Q_TURN_TOOLS_MAX);
      for (const tool of research) {
        expect(offered, `${purpose}: ${tool}`).toContain(tool);
        expect(registry.offeredByProviderName(context, tool)).toBeDefined();
      }
    }
  });
});
