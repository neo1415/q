import { createHash } from "node:crypto";

import { toJSONSchema, type z } from "zod";

import type {
  ModelMessage,
  ModelOutputSpec,
  ModelTextTaskClass,
  QCommunicationProfile,
  QOperatingMode,
} from "@capital-q/contracts";

import {
  COMMUNICATION_RENDERING_VERSION,
  renderCommunicationGuidance,
} from "../communication/guidance.js";
import {
  renderTemplate,
  type PromptId,
  type PromptVersionId,
} from "./definition.js";
import type { PromptRecord, PromptRegistry } from "./registry.js";

/**
 * Prompt bundle resolution and rendering (doc 12 §26; CQ-Q-006 §19, §43-§44).
 *
 *   Q runtime → resolve bundle → render trusted prompt + authorised data
 *   → Model Gateway → validated result
 *
 * The renderer consumes already-authorised inputs and nothing else: it
 * has no database, no ports and no way to reach context the caller did
 * not hand it. Output is a provider-neutral message list — the charter
 * with its communication guidance as the SYSTEM message, the task
 * rendering as the USER message — plus the gateway output spec and the
 * bundle identity to persist on the run.
 */

/**
 * Durable bundle identity, short enough for `q_runtime.runs.prompt_bundle_version`
 * (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`): `q-system.v1_company-analyst.v1_comm.v1`.
 */
export type PromptBundleVersion = string;

export type PromptBundle = {
  readonly bundleVersion: PromptBundleVersion;
  /** sha256 over the member content hashes; integrity, not identity. */
  readonly bundleHash: string;
  readonly charter: PromptVersionId;
  readonly task: PromptVersionId;
  readonly outputSchema: string;
  readonly communicationRenderingVersion: number;
};

export type RenderedPrompt = {
  readonly bundle: PromptBundle;
  readonly taskClass: ModelTextTaskClass;
  readonly messages: readonly ModelMessage[];
  readonly output: ModelOutputSpec;
  /** The Zod schema that accepts the model's output, when structured. */
  readonly outputSchema: z.ZodType<unknown> | undefined;
  /** Approximate rendered size, for budgeting and reporting. */
  readonly characters: number;
};

export type RenderRequest<V> = {
  readonly task: PromptId;
  /** Explicit version; default: the active version. */
  readonly taskVersion?: number | undefined;
  readonly charterVersion?: number | undefined;
  readonly operatingMode: QOperatingMode;
  readonly communicationProfile: QCommunicationProfile;
  /** What the runtime honestly knows about its own limits, trusted text. */
  readonly environmentNotes: string;
  /** The task's own variables, minus the frame the renderer supplies. */
  readonly variables: Omit<
    V,
    | "operatingMode"
    | "communicationProfile"
    | "communicationGuidance"
    | "environmentNotes"
  >;
};

function slugOf(versionId: PromptVersionId): string {
  return versionId.replace("/", ".");
}

export function bundleVersionOf(
  charter: PromptVersionId,
  task: PromptVersionId,
  communicationRenderingVersion: number = COMMUNICATION_RENDERING_VERSION,
): PromptBundleVersion {
  return `${slugOf(charter)}_${slugOf(task)}_comm.v${communicationRenderingVersion}`;
}

function resolve(
  registry: PromptRegistry,
  id: PromptId,
  version: number | undefined,
): PromptRecord {
  if (version === undefined) {
    return registry.getActive(id);
  }
  const record = registry.get(id, version);
  if (record === undefined) {
    throw new Error(`prompt ${id} v${version} is not registered`);
  }
  return record;
}

export function renderPrompt<V>(
  registry: PromptRegistry,
  request: RenderRequest<V>,
): RenderedPrompt {
  const charter = resolve(registry, "Q_SYSTEM", request.charterVersion);
  const task = resolve(registry, request.task, request.taskVersion);
  if (
    task.definition.kind !== "TASK" ||
    task.definition.taskClass === undefined
  ) {
    throw new Error(`${task.versionId} is not a task prompt`);
  }
  const communicationGuidance = renderCommunicationGuidance(
    request.communicationProfile,
  );
  const frame = {
    operatingMode: request.operatingMode,
    communicationProfile: request.communicationProfile,
    communicationGuidance,
    environmentNotes: request.environmentNotes,
  };
  const system = renderTemplate(charter.definition, frame);
  const user = renderTemplate(task.definition, {
    ...frame,
    ...(request.variables as Record<string, unknown>),
  });

  const output = task.definition.output;
  const outputSpec: ModelOutputSpec =
    output.kind === "TEXT"
      ? { kind: "TEXT" }
      : {
          kind: "STRUCTURED",
          schemaName: output.schemaName,
          jsonSchema: toJsonSchema(output.schema),
        };
  const outputIdentity =
    output.kind === "TEXT"
      ? "text"
      : `${output.schemaName}/v${output.schemaVersion}`;
  const bundleVersion = bundleVersionOf(charter.versionId, task.versionId);
  const bundleHash = createHash("sha256")
    .update(charter.contentHash)
    .update(task.contentHash)
    .update(outputIdentity)
    .update(`comm.v${COMMUNICATION_RENDERING_VERSION}`)
    .digest("hex");

  const messages: ModelMessage[] = [
    { role: "SYSTEM", content: system },
    { role: "USER", content: user },
  ];
  return {
    bundle: {
      bundleVersion,
      bundleHash,
      charter: charter.versionId,
      task: task.versionId,
      outputSchema: outputIdentity,
      communicationRenderingVersion: COMMUNICATION_RENDERING_VERSION,
    },
    taskClass: task.definition.taskClass,
    messages,
    output: outputSpec,
    outputSchema: output.kind === "STRUCTURED" ? output.schema : undefined,
    characters: system.length + user.length,
  };
}

function toJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  // Zod 4 emits standard JSON Schema; providers receive that, Capital Q
  // validates with the Zod schema itself.
  return toJSONSchema(schema);
}
