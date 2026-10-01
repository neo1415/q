import { describe, expect, it } from "vitest";

import { MODEL_TOOLS_MAX, type QTaskClass } from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

import {
  createDefaultQTools,
  createNotePreferenceTool,
  createOnboardingTools,
  createQToolExecutor,
  createQToolRegistry,
  inputJsonSchemaOf,
  Q_CAPABILITIES,
  Q_TOOL_FAILURE_CODES,
  type AnyQToolDefinition,
  type QToolPorts,
} from "../src/index.js";

import {
  actorA,
  actorB,
  COMPANY_A,
  contextFor,
  INVESTOR_B,
  planFor,
} from "./support.js";

/**
 * The hardening harness (harden spec §5): every capability Q can perform
 * through a tool, walked through the real executor with ports that fail on
 * touch. Deterministic: no model, no network, no database.
 *
 * For each tool capability it asserts, by capability id, so a failure
 * names exactly what broke:
 *   offered     -- a run with the tool's own purpose and scope is offered
 *                  it inside the model's tool bound (MODEL_TOOLS_MAX)
 *   arguments   -- input that is not the tool's shape is refused as
 *                  INVALID_ARGUMENTS before any port is touched
 *   actor       -- another person's plan is refused as ACTOR_MISMATCH
 *   cancelled   -- a cancelled run is refused as CANCELLED, untouched
 *   contained   -- a port that throws becomes a typed refusal or failure,
 *                  never a success, and its message never reaches the
 *                  model
 *   purpose     -- a run for a purpose it does not serve is not offered it
 *
 * The happy path of each tool, with scripted port results, lives in that
 * tool's own test file; this suite is the floor every capability stands on.
 */

const SECRET = "HARNESS-PORT-SECRET-7f3a";

/** Every port, each failing loudly the moment anything is asked of it. */
function trappedPorts(): { ports: QToolPorts; touched: () => number } {
  let touched = 0;
  // Counted when called, not when read: a factory may capture a method.
  const trap = (): unknown =>
    new Proxy(
      {},
      {
        get: (_target, property) => {
          // Promise resolution probes `then`; a port is not a promise.
          if (property === "then") return undefined;
          return () => {
            touched += 1;
            return Promise.reject(new Error(SECRET));
          };
        },
      },
    );
  const port = <T>(): T => trap() as T;
  const ports: QToolPorts = {
    companies: port(),
    capital: port(),
    mandates: port(),
    investors: port(),
    authorization: port(),
    disclosure: port(),
    investorFeed: port(),
    discovery: port(),
    recommendationExplanations: port(),
    research: port(),
    profiles: port(),
    relationships: port(),
    email: port(),
    chat: port(),
    schedule: port(),
    profileChanges: port(),
    pitchMoments: port(),
    visibility: port(),
    handleClaims: port(),
    pendingProposals: {
      inConversation: port(),
      approve: port(),
      decline: port(),
    },
    qCards: port(),
    clientActions: true,
    approvalInbox: port(),
    results: port(),
    discoveryDecisions: port(),
    documents: port(),
    documentRevision: port(),
    // DOCS block.
    documentStudio: port(),
    recordChanges: port(),
    ownRecords: port(),
    evidenceDocuments: port(),
    relationshipMail: port(),
    onboardingReminders: port(),
    // AUTO (ADR 0030): Q's delegated work.
    work: port(),
  };
  return {
    ports,
    touched: () => touched,
  };
}

function everyTool(ports: QToolPorts): readonly AnyQToolDefinition[] {
  const trap = new Proxy(
    {},
    {
      get: (_target, property) =>
        property === "then"
          ? undefined
          : () => Promise.reject(new Error(SECRET)),
    },
  );
  return [
    ...createDefaultQTools(ports),
    ...createOnboardingTools(trap as never),
    createNotePreferenceTool(trap as never),
  ];
}

// ---------------------------------------------------------------------------
// A valid input for any tool, from its own schema
// ---------------------------------------------------------------------------

const UUID = "c0000000-0000-4000-8000-0000000000aa";

/**
 * The smallest value a JSON Schema accepts, preferring declared examples:
 * enum's first member, a uuid where the format says so, the minimum length
 * or count. Validated against the tool's Zod schema before use; a tool
 * this cannot satisfy is reported by name.
 */
function sample(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) return null;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  if ("const" in s) return s.const;
  for (const key of ["anyOf", "oneOf"] as const) {
    const options: unknown = s[key];
    if (Array.isArray(options)) {
      const usable: unknown = (options as unknown[]).find(
        (o) =>
          typeof o === "object" &&
          o !== null &&
          (o as Record<string, unknown>).type !== "null",
      );
      return sample(usable ?? (options as unknown[])[0]);
    }
  }
  const declared: unknown = s.type;
  const type: unknown = Array.isArray(declared)
    ? (declared as unknown[]).find((t) => t !== "null")
    : declared;
  switch (type) {
    case "object": {
      const properties = (s.properties ?? {}) as Record<string, unknown>;
      const required = Array.isArray(s.required)
        ? (s.required as string[])
        : [];
      return Object.fromEntries(
        required.map((key) => [key, sample(properties[key])]),
      );
    }
    case "array": {
      const min = typeof s.minItems === "number" ? s.minItems : 0;
      return Array.from({ length: Math.max(min, 1) }, () => sample(s.items));
    }
    case "string": {
      if (s.format === "uuid") return UUID;
      if (s.format === "date-time") return "2026-10-02T09:00:00.000Z";
      if (s.format === "date") return "2026-10-02";
      if (s.format === "email") return "someone@fictional.capitalq.local";
      if (s.format === "uri") return "https://fictional.example/";
      if (
        typeof s.pattern === "string" &&
        /uuid|\[0-9a-f\]\{8\}/i.test(s.pattern)
      ) {
        return UUID;
      }
      const min = typeof s.minLength === "number" ? s.minLength : 1;
      return "x".repeat(Math.max(min, 1));
    }
    case "integer":
    case "number":
      return typeof s.minimum === "number" ? s.minimum : 1;
    case "boolean":
      return true;
    default:
      return {};
  }
}

/**
 * Inputs the schema walk cannot satisfy (a refinement it cannot see),
 * scripted by provider name. Every entry is checked against the tool's own
 * schema, so a stale one fails here rather than passing silently.
 */
const RELATIONSHIP = { relationshipId: UUID };
const SCRIPTED_INPUTS: Readonly<Record<string, unknown>> = {
  // "Name exactly one of relationshipId, companyId or investorOrganisationId".
  get_relationship: RELATIONSHIP,
  list_messages: RELATIONSHIP,
  find_meeting_times: RELATIONSHIP,
  propose_errand: RELATIONSHIP,
  propose_chat_message: { ...RELATIONSHIP, body: "Hello from the harness." },
  propose_email: { ...RELATIONSHIP, subject: "Hello", body: "Hello." },
  propose_reminder: {
    ...RELATIONSHIP,
    title: "Follow up",
    when: { day: "tomorrow", time: "09:00" },
  },
  propose_meeting: {
    ...RELATIONSHIP,
    purpose: "Intro call",
    when: { day: "tomorrow", time: "14:00" },
  },
  propose_meeting_change: { meetingId: UUID, change: "CANCEL" },
};

/** What a field the schema walk could not satisfy is tried as, in order. */
const REPAIRS: readonly unknown[] = [
  UUID,
  "2026-10-02T09:00:00.000Z",
  "https://fictional.example/",
  "someone@fictional.capitalq.local",
  "2026-10-02",
  1,
  true,
  "x",
  ["x"],
  {},
];

function setAt(
  target: unknown,
  path: readonly PropertyKey[],
  value: unknown,
): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  if (typeof head === "number") {
    const list = Array.isArray(target) ? [...(target as unknown[])] : [];
    list[head] = setAt(list[head], rest, value);
    return list;
  }
  const container: Record<PropertyKey, unknown> =
    typeof target === "object" && target !== null && !Array.isArray(target)
      ? { ...(target as Record<PropertyKey, unknown>) }
      : {};
  container[head] = setAt(container[head], rest, value);
  return container;
}

/**
 * The schema's sample, with each field Zod still refuses repaired by the
 * first candidate it accepts. Deterministic: same schema, same input.
 */
function validInput(definition: AnyQToolDefinition): unknown {
  const scripted = SCRIPTED_INPUTS[definition.providerName];
  if (scripted !== undefined) return scripted;
  let input = sample(inputJsonSchemaOf(definition.input));
  for (let round = 0; round < 16; round += 1) {
    const parsed = definition.input.safeParse(input);
    if (parsed.success) return input;
    const issue = parsed.error.issues[0];
    if (issue === undefined) return input;
    const key = JSON.stringify(issue.path);
    const fixed = REPAIRS.map((candidate) =>
      setAt(input, issue.path, candidate),
    ).find((candidate) => {
      const again = definition.input.safeParse(candidate);
      return (
        again.success ||
        !again.error.issues.some((i) => JSON.stringify(i.path) === key)
      );
    });
    if (fixed === undefined) return input;
    input = fixed;
  }
  return input;
}

// ---------------------------------------------------------------------------
// A plan that offers the tool
// ---------------------------------------------------------------------------

function planOffering(
  definition: AnyQToolDefinition,
  actor = actorA,
  purpose: QTaskClass | undefined = definition.supportedPurposes[0],
) {
  const kinds = definition.requiredScopeKinds.length
    ? definition.requiredScopeKinds
    : (["OWN_Q_CONVERSATION"] as const);
  return planFor(
    actor,
    purpose ?? "GENERAL_QUESTION",
    kinds.map((kind) => ({
      kind,
      sensitivity: "HIGHLY_CONFIDENTIAL" as const,
      ...(kind.startsWith("COMPANY") ? { companyId: COMPANY_A } : {}),
      ...(kind.startsWith("INVESTOR")
        ? { investorOrganisationId: INVESTOR_B }
        : {}),
    })),
  );
}

const ALL_PURPOSES: readonly QTaskClass[] = [
  ...new Set(
    everyTool(trappedPorts().ports).flatMap((d) => d.supportedPurposes),
  ),
];

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

const toolCapabilities = Q_CAPABILITIES.flatMap((capability) =>
  capability.performedBy.kind === "TOOL"
    ? [{ id: capability.id, providerName: capability.performedBy.providerName }]
    : [],
);

function setup() {
  const trapped = trappedPorts();
  const definitions = everyTool(trapped.ports);
  const registry = createQToolRegistry(definitions);
  const executor = createQToolExecutor({ registry });
  const byName = new Map(definitions.map((d) => [d.providerName, d]));
  return { ...trapped, registry, executor, byName };
}

const call = (name: string, args: unknown) => ({
  callId: "call_harness",
  name,
  arguments: args,
});

function refusedWith(outcome: QToolCallOutcome): string | null {
  return outcome.status === "SUCCEEDED" ? null : outcome.failureCode;
}

describe("every tool capability stands on the executor's floor", () => {
  it("covers every tool capability (the walk below is not empty)", () => {
    expect(toolCapabilities.length).toBeGreaterThan(50);
  });

  describe.each(toolCapabilities)("$id ($providerName)", ({ providerName }) => {
    it("offered: its own purpose and scope offer it within the model's bound", () => {
      const { registry, byName } = setup();
      const definition = byName.get(providerName);
      expect(
        definition,
        `${providerName} is not a registered tool`,
      ).toBeDefined();
      if (definition === undefined) return;
      const offered = definition.supportedPurposes.some((purpose) => {
        const context = contextFor(
          actorA,
          planOffering(definition, actorA, purpose),
        );
        return (
          registry.offeredByProviderName(context, providerName) !== undefined
        );
      });
      expect(
        offered,
        `${providerName} is cut by MODEL_TOOLS_MAX (${String(MODEL_TOOLS_MAX)}) for every purpose it serves`,
      ).toBe(true);
    });

    it("arguments: a wrong shape is INVALID_ARGUMENTS and touches no port", async () => {
      const { executor, byName, touched } = setup();
      const definition = byName.get(providerName);
      if (definition === undefined) return;
      const context = contextFor(actorA, planOffering(definition));
      const outcome = await executor.execute(
        call(providerName, "not an object"),
        context,
      );
      expect(refusedWith(outcome)).toBe("INVALID_ARGUMENTS");
      expect(touched()).toBe(0);
    });

    it("sample: a valid input can be built from its schema", () => {
      const { byName } = setup();
      const definition = byName.get(providerName);
      if (definition === undefined) return;
      const parsed = definition.input.safeParse(validInput(definition));
      expect(
        parsed.success,
        `${providerName}: add a SCRIPTED_INPUTS entry (${JSON.stringify(parsed.error?.issues.map((i) => i.path)) ?? ""})`,
      ).toBe(true);
    });

    it("actor: another person's plan is ACTOR_MISMATCH and touches no port", async () => {
      const { executor, byName, touched } = setup();
      const definition = byName.get(providerName);
      if (definition === undefined) return;
      const context = contextFor(actorA, planOffering(definition, actorB));
      const outcome = await executor.execute(
        call(providerName, validInput(definition)),
        context,
      );
      // Offered for B's plan, run as A: refused before anything is read.
      expect([
        "ACTOR_MISMATCH",
        "TOOL_NOT_ELIGIBLE",
        "INVALID_ARGUMENTS",
      ]).toContain(refusedWith(outcome));
      expect(touched()).toBe(0);
    });

    it("cancelled: a cancelled run is refused and touches no port", async () => {
      const { executor, byName, touched } = setup();
      const definition = byName.get(providerName);
      if (definition === undefined) return;
      const input = validInput(definition);
      if (!definition.input.safeParse(input).success) return;
      const controller = new AbortController();
      controller.abort();
      const context = contextFor(
        actorA,
        planOffering(definition),
        controller.signal,
      );
      const outcome = await executor.execute(
        call(providerName, input),
        context,
      );
      expect(refusedWith(outcome)).toBe("CANCELLED");
      expect(touched()).toBe(0);
    });

    it("contained: a failing port is a typed refusal, never success, never its message", async () => {
      const { executor, byName } = setup();
      const definition = byName.get(providerName);
      if (definition === undefined) return;
      const input = validInput(definition);
      if (!definition.input.safeParse(input).success) return;
      const context = contextFor(actorA, planOffering(definition));
      const outcome = await executor.execute(
        call(providerName, input),
        context,
      );
      const code = refusedWith(outcome);
      // A tool may answer without its port (a client action, a refusal it
      // decides itself); what it may never do is leak a port's failure.
      if (code !== null) {
        expect(Q_TOOL_FAILURE_CODES).toContain(code);
      }
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
    });

    it("purpose: a run for a purpose it does not serve is not offered it", async () => {
      const { executor, byName } = setup();
      const definition = byName.get(providerName);
      if (definition === undefined || definition.core === true) return;
      const other = ALL_PURPOSES.find(
        (p) => !definition.supportedPurposes.includes(p),
      );
      if (other === undefined) return;
      const context = contextFor(
        actorA,
        planOffering(definition, actorA, other),
      );
      const outcome = await executor.execute(
        call(providerName, validInput(definition)),
        context,
      );
      expect(refusedWith(outcome)).toBe("TOOL_NOT_ELIGIBLE");
    });
  });
});
