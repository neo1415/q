import type { z } from "zod";

import {
  messageAccepted,
  messageRejected,
  type MessageParseResult,
} from "../messaging/result.js";
import { eventKey, type EventDefinition } from "./definition.js";
import {
  EventEnvelopeSchema,
  type CapitalQEvent,
  type EventEnvelope,
} from "./envelope.js";

export type EventRegistry = {
  readonly has: (name: string, version: number) => boolean;
  readonly get: (name: string, version: number) => EventDefinition | undefined;
  readonly list: () => readonly EventDefinition[];
  /**
   * Validate an unknown value as a registered event.
   *
   * Envelope first, then type and version lookup, then the registered payload
   * schema. Each stage fails distinctly so a runtime can tell "this consumer is
   * out of date" from "this producer sent something broken".
   */
  readonly parse: (
    input: unknown,
  ) => MessageParseResult<CapitalQEvent<unknown>>;
  /**
   * Validate against one known definition, recovering the payload type.
   *
   * Preferred where the caller already knows which event it is handling: a
   * registry-wide lookup cannot return a precise payload type without either an
   * unsafe cast or type machinery that outlives its usefulness.
   */
  readonly parseAs: <TData extends z.ZodType>(
    definition: EventDefinition<TData>,
    input: unknown,
  ) => MessageParseResult<CapitalQEvent<z.infer<TData>>>;
};

/**
 * Build an immutable registry.
 *
 * Registration happens once, at construction, from code. There is no runtime
 * registration API: contracts are architecture, and a schema that can be
 * replaced at runtime is not a contract.
 */
export function createEventRegistry(
  definitions: readonly EventDefinition[],
): EventRegistry {
  const byKey = new Map<string, EventDefinition>();

  for (const definition of definitions) {
    const key = eventKey(definition.name, definition.version);

    if (byKey.has(key)) {
      // Deterministic failure rather than last-one-wins. Silent overwrite is
      // how two teams ship incompatible meanings for one event name.
      throw new Error(`Duplicate event definition for ${key}`);
    }

    byKey.set(key, definition);
  }

  const registry: EventRegistry = {
    has: (name, version) => byKey.has(eventKey(name, version)),
    get: (name, version) => byKey.get(eventKey(name, version)),
    list: () => [...byKey.values()],

    parse: (input) => {
      const envelope = EventEnvelopeSchema.safeParse(input);

      if (!envelope.success) {
        return messageRejected("INVALID_ENVELOPE", { error: envelope.error });
      }

      const { type, eventVersion } = envelope.data;
      const definition = byKey.get(eventKey(type, eventVersion));

      if (definition === undefined) {
        // Distinguish "never heard of this event" from "known event, version I
        // cannot interpret". An unsupported breaking version is never guessed
        // at by assuming it resembles one this build understands.
        const knownAtOtherVersion = [...byKey.values()].some(
          (candidate) => candidate.name === type,
        );

        return messageRejected(
          knownAtOtherVersion ? "UNSUPPORTED_VERSION" : "UNKNOWN_TYPE",
          { type, version: eventVersion },
        );
      }

      const data = definition.dataSchema.safeParse(envelope.data.data);

      if (!data.success) {
        return messageRejected("INVALID_PAYLOAD", {
          type,
          version: eventVersion,
          error: data.error,
        });
      }

      return messageAccepted<CapitalQEvent<unknown>>({
        ...(envelope.data satisfies EventEnvelope),
        data: data.data,
      });
    },

    parseAs: (definition, input) => {
      // Validates against this definition's own schema rather than re-labelling
      // a registry-wide result, so the payload type is genuinely recovered
      // instead of asserted.
      const envelope = EventEnvelopeSchema.safeParse(input);

      if (!envelope.success) {
        return messageRejected("INVALID_ENVELOPE", { error: envelope.error });
      }

      const { type, eventVersion } = envelope.data;

      if (type !== definition.name) {
        return messageRejected("UNKNOWN_TYPE", { type, version: eventVersion });
      }

      if (eventVersion !== definition.version) {
        return messageRejected("UNSUPPORTED_VERSION", {
          type,
          version: eventVersion,
        });
      }

      const data = definition.dataSchema.safeParse(envelope.data.data);

      if (!data.success) {
        return messageRejected("INVALID_PAYLOAD", {
          type,
          version: eventVersion,
          error: data.error,
        });
      }

      return messageAccepted({ ...envelope.data, data: data.data });
    },
  };

  return registry;
}
