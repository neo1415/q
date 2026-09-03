import { createEventRegistry, type EventRegistry } from "@capital-q/contracts";
import { ORGANISATION_EVENTS } from "@capital-q/organisations/events";

/**
 * The production event registry the worker validates outbox rows against.
 *
 * Each domain packet adds its definitions here as they land; the API keeps
 * an identical list for its OutboxWriter (apps/api/src/event-registry.ts).
 * Test-only definitions (test.fixture.*) never appear in this list.
 */
export function createProductionEventRegistry(): EventRegistry {
  return createEventRegistry([...ORGANISATION_EVENTS]);
}
