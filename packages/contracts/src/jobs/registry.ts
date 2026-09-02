import type { z } from "zod";

import {
  messageAccepted,
  messageRejected,
  type MessageParseResult,
} from "../messaging/result.js";
import { jobKey, type JobDefinition } from "./definition.js";
import {
  JobEnvelopeSchema,
  type CapitalQJob,
  type JobEnvelope,
} from "./envelope.js";

export type JobRegistry = {
  readonly has: (name: string, version: number) => boolean;
  readonly get: (name: string, version: number) => JobDefinition | undefined;
  readonly list: () => readonly JobDefinition[];
  readonly parse: (input: unknown) => MessageParseResult<CapitalQJob<unknown>>;
  readonly parseAs: <TData extends z.ZodType>(
    definition: JobDefinition<TData>,
    input: unknown,
  ) => MessageParseResult<CapitalQJob<z.infer<TData>>>;
};

/**
 * Build an immutable job registry.
 *
 * Same construction-time registration and duplicate rejection as the event
 * registry, for the same reason: a job type whose payload meaning can be
 * silently replaced is not a contract.
 */
export function createJobRegistry(
  definitions: readonly JobDefinition[],
): JobRegistry {
  const byKey = new Map<string, JobDefinition>();

  for (const definition of definitions) {
    const key = jobKey(definition.name, definition.version);

    if (byKey.has(key)) {
      throw new Error(`Duplicate job definition for ${key}`);
    }

    byKey.set(key, definition);
  }

  const registry: JobRegistry = {
    has: (name, version) => byKey.has(jobKey(name, version)),
    get: (name, version) => byKey.get(jobKey(name, version)),
    list: () => [...byKey.values()],

    parse: (input) => {
      const envelope = JobEnvelopeSchema.safeParse(input);

      if (!envelope.success) {
        return messageRejected("INVALID_ENVELOPE", { error: envelope.error });
      }

      const { type, jobVersion } = envelope.data;
      const definition = byKey.get(jobKey(type, jobVersion));

      if (definition === undefined) {
        const knownAtOtherVersion = [...byKey.values()].some(
          (candidate) => candidate.name === type,
        );

        return messageRejected(
          knownAtOtherVersion ? "UNSUPPORTED_VERSION" : "UNKNOWN_TYPE",
          { type, version: jobVersion },
        );
      }

      const data = definition.dataSchema.safeParse(envelope.data.data);

      if (!data.success) {
        return messageRejected("INVALID_PAYLOAD", {
          type,
          version: jobVersion,
          error: data.error,
        });
      }

      return messageAccepted<CapitalQJob<unknown>>({
        ...(envelope.data satisfies JobEnvelope),
        data: data.data,
      });
    },

    parseAs: (definition, input) => {
      // Validates against this definition's own schema rather than re-labelling
      // a registry-wide result, so the payload type is genuinely recovered
      // instead of asserted.
      const envelope = JobEnvelopeSchema.safeParse(input);

      if (!envelope.success) {
        return messageRejected("INVALID_ENVELOPE", { error: envelope.error });
      }

      const { type, jobVersion } = envelope.data;

      if (type !== definition.name) {
        return messageRejected("UNKNOWN_TYPE", { type, version: jobVersion });
      }

      if (jobVersion !== definition.version) {
        return messageRejected("UNSUPPORTED_VERSION", {
          type,
          version: jobVersion,
        });
      }

      const data = definition.dataSchema.safeParse(envelope.data.data);

      if (!data.success) {
        return messageRejected("INVALID_PAYLOAD", {
          type,
          version: jobVersion,
          error: data.error,
        });
      }

      return messageAccepted({ ...envelope.data, data: data.data });
    },
  };

  return registry;
}
