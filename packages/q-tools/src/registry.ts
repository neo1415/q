import { z } from "zod";

import {
  ModelToolDefinitionSchema,
  QToolNameSchema,
  type ModelToolDefinition,
  type QToolName,
} from "@capital-q/contracts";
import type { QOfferedTool, QToolExecutionContext } from "@capital-q/q-runtime";

import type { AnyQToolDefinition } from "./definition.js";
import { planScopeKinds } from "./plan.js";

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
  /** The minimum tool set for this context, in stable id order. */
  readonly eligible: (context: QToolExecutionContext) => readonly QToolRecord[];
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
    if (definition.riskClass !== "SAFE_READ") {
      throw new Error(
        `tool ${id} is ${definition.riskClass}; only SAFE_READ tools can be registered before the approval engine exists`,
      );
    }
    if (definition.classification !== "READ_ONLY") {
      throw new Error(`tool ${id} must be READ_ONLY to be SAFE_READ`);
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

  const eligible = (context: QToolExecutionContext): readonly QToolRecord[] => {
    if (context.actor.actorType !== "HUMAN") {
      return [];
    }
    const kinds = planScopeKinds(context.plan);
    const purpose = context.plan.purpose.taskClass;
    return [...activeById.values()]
      .filter(({ definition }) =>
        definition.supportedPurposes.includes(purpose),
      )
      .filter(
        ({ definition }) =>
          definition.requiredScopeKinds.length === 0 ||
          definition.requiredScopeKinds.some((kind) => kinds.has(kind)),
      )
      .sort((a, b) => a.definition.id.localeCompare(b.definition.id));
  };

  return {
    get: (id, version) => byVersion.get(versionIdOf(id, version)),
    getActive: (id) => activeById.get(id),
    list: () => records,
    eligible,
    offeredByProviderName: (context, providerName) =>
      eligible(context).find(
        (record) => record.definition.providerName === providerName,
      ),
  };
}
