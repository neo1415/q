import { createEventRegistry, type EventRegistry } from "@capital-q/contracts";
import { CAPITAL_EVENTS } from "@capital-q/capital/events";
import { COMPANY_EVENTS } from "@capital-q/companies/events";
import { INVESTOR_EVENTS } from "@capital-q/investors/events";
import { NETWORK_EVENTS } from "@capital-q/network/events";
import { ORGANISATION_EVENTS } from "@capital-q/organisations/events";
import { PERMISSIONS_EVENTS } from "@capital-q/permissions/events";

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
    ...CAPITAL_EVENTS,
    ...NETWORK_EVENTS,
    ...PERMISSIONS_EVENTS,
  ]);
}
