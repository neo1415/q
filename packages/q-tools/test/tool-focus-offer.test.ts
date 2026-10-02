import { describe, expect, it } from "vitest";

import {
  MODEL_TOOLS_MAX,
  Q_KNOWLEDGE_SCOPE_KINDS,
  Q_TASK_CLASSES,
  type QKnowledgeScopeKind,
} from "@capital-q/contracts";
import type { QToolFocus } from "@capital-q/q-runtime";
import { APP_ACTIONS, qToolName } from "@capital-q/app-actions";

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

  it("an action asked for by name is offered on every purpose the plan allows", () => {
    for (const purpose of Q_TASK_CLASSES) {
      for (const record of registry.list()) {
        if (record.definition.status !== "ACTIVE") continue;
        const name = record.definition.providerName;
        // The plan's scopes still decide; the worst case holds them all.
        const offered = names(
          registry.eligible(worstCase(purpose, { areas: [], tools: [name] })),
        );
        expect(offered, `${purpose}: ${name}`).toContain(name);
      }
    }
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

  it("asked by meaning: the reader's list is unchanged (every relevant tool, unfocused)", async () => {
    const executor = createQToolExecutor({ registry });
    for (const purpose of Q_TASK_CLASSES) {
      const focused = worstCase(purpose, { areas: ["Screens"], tools: [] });
      const listed = (await executor.available?.(focused)) ?? [];
      expect(listed.map((tool) => tool.definition.name)).toEqual(
        names(registry.ranked(worstCase(purpose)).slice(0, MODEL_TOOLS_MAX)),
      );
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
});
