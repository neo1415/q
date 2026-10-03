import { z } from "zod";

import {
  MODEL_TOOLS_MAX,
  ModelToolDefinitionSchema,
  QToolNameSchema,
  type ModelToolDefinition,
  type QToolName,
} from "@capital-q/contracts";
import type { QOfferedTool, QToolExecutionContext } from "@capital-q/q-runtime";

import { capabilityArea, Q_CAPABILITIES } from "./capabilities.js";
import type { AnyQToolDefinition } from "./definition.js";
import { planScopeKinds } from "./plan.js";

/**
 * The most tools one turn is offered (lead 2026-10-02). Every turn pays for
 * every offered tool's schema, so the offer follows what the turn is about
 * (its focus) rather than a static list per purpose; the provider's own
 * bound (MODEL_TOOLS_MAX) stays the hard ceiling above this.
 */
export const Q_TURN_TOOLS_MAX = 40;

/** Each tool's capability area, by provider name (the reader's areas). */
const TOOL_AREAS: ReadonlyMap<string, string> = new Map(
  Q_CAPABILITIES.flatMap((capability) =>
    capability.performedBy.kind === "TOOL"
      ? [
          [
            capability.performedBy.providerName,
            capability.area ?? capabilityArea(capability.group),
          ] as const,
        ]
      : [],
  ),
);

/** The area a tool is listed under, or null when no capability names it. */
export function toolAreaOf(providerName: string): string | null {
  return TOOL_AREAS.get(providerName) ?? null;
}

/**
 * The Capital Q-owned Tool Registry (doc 12 §33; packet §8-§12).
 *
 * Source-controlled definitions, registered once at composition. Records
 * are frozen; a duplicate (id, version) or two ACTIVE versions of one id,
 * or two ACTIVE tools projecting the same provider name, is a composition
 * fault and refuses to start. `DISABLED` is the kill switch: the tool
 * stays registered (a resumable run can still name it) but is never
 * offered and never executes. Only SAFE_READ tools are accepted until the
 * approval engine (CQ-Q-008) exists: a class that needs an approval has
 * no place to bind one yet.
 *
 * `eligible` derives the per-run tool set from purpose, actor and plan
 * (doc 15 §49): deterministic, data-driven, and never the whole catalogue.
 */

export type QToolVersionId = `${QToolName}/v${number}`;

function versionIdOf(id: QToolName, version: number): QToolVersionId {
  return `${id}/v${version}`;
}

export type QToolRecord = {
  readonly versionId: QToolVersionId;
  readonly definition: AnyQToolDefinition;
  /** The declaration a model sees; computed once at registration. */
  readonly modelDefinition: ModelToolDefinition;
};

export type QToolRegistry = {
  readonly get: (id: QToolName, version: number) => QToolRecord | undefined;
  readonly getActive: (id: QToolName) => QToolRecord | undefined;
  readonly list: () => readonly QToolRecord[];
  /**
   * The tool set for this context: the core, then the tools serving this
   * run's purpose, in a deterministic priority order, bounded by
   * MODEL_TOOLS_MAX. What the bound cut is in `ranked` past the bound.
   */
  readonly eligible: (context: QToolExecutionContext) => readonly QToolRecord[];
  /** Every tool relevant to this context, in priority order, unbounded. */
  readonly ranked: (context: QToolExecutionContext) => readonly QToolRecord[];
  /**
   * The reader's list: the unfocused offer, then the declared app actions
   * this plan's scopes allow on any purpose (each executes only when named).
   */
  readonly available: (
    context: QToolExecutionContext,
  ) => readonly QToolRecord[];
  /** Resolve a model's proposal to the record that was offered, if any. */
  readonly offeredByProviderName: (
    context: QToolExecutionContext,
    providerName: string,
  ) => QToolRecord | undefined;
};

/**
 * Keywords removed from the model-facing schema. Some providers validate a
 * model's generated arguments against the declared schema and fail the
 * whole request when an identifier misses a pattern; Capital Q validates
 * every argument itself and answers a bad one with INVALID_ARGUMENTS the
 * model can recover from. The bounds stay; the identity checks are ours.
 */
const MODEL_SCHEMA_OMITTED_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "format",
  "pattern",
]);

function projectSchema(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(projectSchema);
  }
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!MODEL_SCHEMA_OMITTED_KEYWORDS.has(key)) {
        out[key] = projectSchema(value);
      }
    }
    return out;
  }
  return node;
}

/** JSON Schema for the model: Zod's projection minus what providers reject or over-enforce. */
export function inputJsonSchemaOf(
  input: AnyQToolDefinition["input"],
): Record<string, unknown> {
  return projectSchema(z.toJSONSchema(input)) as Record<string, unknown>;
}

export function toOfferedTool(record: QToolRecord): QOfferedTool {
  return {
    toolName: record.definition.id,
    toolVersion: record.definition.version,
    classification: record.definition.classification,
    definition: record.modelDefinition,
    visibleStage: record.definition.visibleStage,
  };
}

export function createQToolRegistry(
  definitions: readonly AnyQToolDefinition[],
): QToolRegistry {
  const records: QToolRecord[] = [];
  const byVersion = new Map<string, QToolRecord>();
  const activeById = new Map<QToolName, QToolRecord>();
  const activeByProviderName = new Map<string, QToolRecord>();

  for (const definition of definitions) {
    const id = QToolNameSchema.parse(definition.id);
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      throw new Error(`tool ${id} has an invalid version`);
    }
    /**
     * Two lanes, and only two (ADR 0016). SAFE_READ tools read. The one
     * write lane is LOW_RISK_INTERNAL with a SIDE_EFFECT classification:
     * a write to the caller's own record, at their own word, that the
     * owning service validates again and that is idempotent there — an
     * onboarding answer. Anything that needs approval (CONFIRM_REQUIRED
     * and above) is an Approval Engine action, never a tool.
     */
    const read =
      definition.riskClass === "SAFE_READ" &&
      definition.classification === "READ_ONLY";
    const ownWrite =
      definition.riskClass === "LOW_RISK_INTERNAL" &&
      definition.classification === "SIDE_EFFECT";
    if (!read && !ownWrite) {
      throw new Error(
        `tool ${id} is ${definition.riskClass}/${definition.classification}; a tool is SAFE_READ/READ_ONLY or LOW_RISK_INTERNAL/SIDE_EFFECT, and anything else is an approval-engine action`,
      );
    }
    const versionId = versionIdOf(id, definition.version);
    if (byVersion.has(versionId)) {
      throw new Error(`duplicate tool version ${versionId}`);
    }
    const modelDefinition = ModelToolDefinitionSchema.parse({
      name: definition.providerName,
      description: definition.description,
      inputJsonSchema: inputJsonSchemaOf(definition.input),
    });
    const record: QToolRecord = Object.freeze({
      versionId,
      definition: Object.freeze(definition),
      modelDefinition: Object.freeze(modelDefinition),
    });
    if (definition.status === "ACTIVE") {
      if (activeById.has(id)) {
        throw new Error(`tool ${id} has two ACTIVE versions`);
      }
      const clash = activeByProviderName.get(definition.providerName);
      if (clash !== undefined) {
        throw new Error(
          `tools ${clash.versionId} and ${versionId} both project ${definition.providerName}`,
        );
      }
      activeById.set(id, record);
      activeByProviderName.set(definition.providerName, record);
    }
    byVersion.set(versionId, record);
    records.push(record);
  }
  records.sort((a, b) => a.versionId.localeCompare(b.versionId));
  Object.freeze(records);

  /**
   * Relevance, then priority (R33, lead decision 2026-09-27): the core
   * first; then the tools that declare fewer purposes, being the more
   * specific to this one; then id. Deterministic for the same catalogue
   * and plan, so the same run always offers the same tools.
   */
  const ranked = (context: QToolExecutionContext): readonly QToolRecord[] => {
    if (context.actor.actorType !== "HUMAN") {
      return [];
    }
    const kinds = planScopeKinds(context.plan);
    const purpose = context.plan.purpose.taskClass;
    const core = (record: QToolRecord) => record.definition.core === true;
    const focus = context.focus;
    const focused =
      focus !== undefined && (focus.areas.length > 0 || focus.tools.length > 0);
    const areas = new Set(focus?.areas ?? []);
    const named = new Set(focus?.tools ?? []);
    // Focused: the core, the tools the turn named (whatever their
    // purposes), and this purpose's tools in the turn's areas. A tool no
    // capability lists has no area to judge it by, so it is kept.
    const relevant = (record: QToolRecord): boolean => {
      if (core(record)) return true;
      const name = record.definition.providerName;
      const forPurpose = record.definition.supportedPurposes.includes(purpose);
      if (!focused) return forPurpose;
      // A named tool off this purpose is offered only when it is a declared
      // app action: what is offered is what may execute.
      if (named.has(name))
        return forPurpose || record.definition.eligibleWhenNamed === true;
      if (!forPurpose) return false;
      const area = TOOL_AREAS.get(name);
      return area === undefined || areas.has(area);
    };
    return [...activeById.values()]
      .filter(relevant)
      .filter(
        ({ definition }) =>
          definition.requiredScopeKinds.length === 0 ||
          definition.requiredScopeKinds.some((kind) => kinds.has(kind)),
      )
      .sort(
        (a, b) =>
          Number(core(b)) - Number(core(a)) ||
          // What the turn named leads, so no bound can cut it.
          Number(named.has(b.definition.providerName)) -
            Number(named.has(a.definition.providerName)) ||
          a.definition.supportedPurposes.length -
            b.definition.supportedPurposes.length ||
          a.definition.id.localeCompare(b.definition.id),
      );
  };

  const eligible = (context: QToolExecutionContext): readonly QToolRecord[] =>
    ranked(context).slice(0, Math.min(Q_TURN_TOOLS_MAX, MODEL_TOOLS_MAX));

  // What the run's purpose and plan allow, exactly as before a turn's focus
  // existed, within what one request can carry.
  const unfocused = (context: QToolExecutionContext): readonly QToolRecord[] =>
    ranked({ ...context, focus: undefined }).slice(0, MODEL_TOOLS_MAX);

  // The declared app actions this plan's scopes allow, whatever the purpose
  // (lead 2026-10-03: "We've decided not to proceed with Ledgerfold" plans
  // as INVESTOR_QUESTION, and relationship_outcome was refused there).
  const nameable = (context: QToolExecutionContext): readonly QToolRecord[] =>
    ranked({
      ...context,
      focus: {
        areas: [],
        tools: [...activeById.values()]
          .filter(({ definition }) => definition.eligibleWhenNamed === true)
          .map(({ definition }) => definition.providerName),
      },
    }).filter(({ definition }) => definition.eligibleWhenNamed === true);

  const available = (
    context: QToolExecutionContext,
  ): readonly QToolRecord[] => {
    const listed = unfocused(context);
    const names = new Set(listed.map(({ definition }) => definition.id));
    return [
      ...listed,
      ...nameable(context).filter(
        ({ definition }) => !names.has(definition.id),
      ),
    ];
  };

  return {
    get: (id, version) => byVersion.get(versionIdOf(id, version)),
    getActive: (id) => activeById.get(id),
    list: () => records,
    eligible,
    ranked,
    // What may execute is what the run's purpose and plan allow, exactly as
    // before a turn's focus existed: the focus narrows what the model is
    // shown (cost), never what the run is authorised to use. A code read
    // of a fact the model was not shown this turn still runs.
    // A declared app action the turn named may execute on any purpose its
    // plan's scopes allow; nothing else the focus names widens authority.
    offeredByProviderName: (context, providerName) =>
      unfocused(context).find(
        (record) => record.definition.providerName === providerName,
      ) ??
      (context.focus?.tools.includes(providerName) === true
        ? nameable(context).find(
            (record) => record.definition.providerName === providerName,
          )
        : undefined),
    available,
  };
}
