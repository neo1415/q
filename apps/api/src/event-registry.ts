import { createEventRegistry, type EventRegistry } from "@capital-q/contracts";
import { COMPANY_EVENTS } from "@capital-q/companies/events";
import { INVESTOR_EVENTS } from "@capital-q/investors/events";
import { ORGANISATION_EVENTS } from "@capital-q/organisations/events";

/**
 * The production event registry the API's OutboxWriter validates against.
 * Must list the same definitions as apps/workers/src/event-registry.ts; a
 * domain packet adds its events to both when they land.
 */
export function createProductionEventRegistry(): EventRegistry {
  return createEventRegistry([
    ...ORGANISATION_EVENTS,
    ...COMPANY_EVENTS,
    ...INVESTOR_EVENTS,
  ]);
}
