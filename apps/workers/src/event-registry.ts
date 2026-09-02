import { createEventRegistry, type EventRegistry } from "@capital-q/contracts";

/**
 * The production event registry the worker validates outbox rows against.
 *
 * Empty today, and that is a valid state: no owning domain has shipped a
 * production event yet. Each domain packet adds its definitions here as they
 * land. Test-only definitions (test.fixture.*) never appear in this list.
 */
export function createProductionEventRegistry(): EventRegistry {
  return createEventRegistry([]);
}
