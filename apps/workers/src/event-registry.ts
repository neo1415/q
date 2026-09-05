import { createEventRegistry, type EventRegistry } from "@capital-q/contracts";
import { CAPITAL_EVENTS } from "@capital-q/capital/events";
import { COMPANY_EVENTS } from "@capital-q/companies/events";
import { EVIDENCE_EVENTS } from "@capital-q/evidence/events";
import { INVESTOR_EVENTS } from "@capital-q/investors/events";
import { NETWORK_EVENTS } from "@capital-q/network/events";
import { ONBOARDING_EVENTS } from "@capital-q/onboarding/events";
import { ORGANISATION_EVENTS } from "@capital-q/organisations/events";
import { PERMISSIONS_EVENTS } from "@capital-q/permissions/events";
import { TAXONOMY_EVENTS } from "@capital-q/taxonomy/events";

/**
 * The production event registry the worker validates outbox rows against.
 *
 * Each domain packet adds its definitions here as they land; the API keeps
 * an identical list for its OutboxWriter (apps/api/src/event-registry.ts).
 * Test-only definitions (test.fixture.*) never appear in this list.
 */
export function createProductionEventRegistry(): EventRegistry {
  return createEventRegistry([
    ...ORGANISATION_EVENTS,
    ...COMPANY_EVENTS,
    ...INVESTOR_EVENTS,
    ...EVIDENCE_EVENTS,
    ...CAPITAL_EVENTS,
    ...NETWORK_EVENTS,
    ...PERMISSIONS_EVENTS,
    ...TAXONOMY_EVENTS,
    ...ONBOARDING_EVENTS,
  ]);
}
