import { createEventRegistry, type EventRegistry } from "@capital-q/contracts";
import { CAPITAL_EVENTS } from "@capital-q/capital/events";
import { COMPANY_EVENTS } from "@capital-q/companies/events";
import { EVIDENCE_EVENTS } from "@capital-q/evidence/events";
import { INTEGRATIONS_EVENTS } from "@capital-q/integrations/events";
import { INVESTOR_EVENTS } from "@capital-q/investors/events";
import { MEDIA_EVENTS } from "@capital-q/media/events";
import { NETWORK_EVENTS } from "@capital-q/network/events";
import { ONBOARDING_EVENTS } from "@capital-q/onboarding/events";
import { ORGANISATION_EVENTS } from "@capital-q/organisations/events";
import { PERMISSIONS_EVENTS } from "@capital-q/permissions/events";
import { Q_ACTION_EVENTS } from "@capital-q/q-actions/events";
import { TAXONOMY_EVENTS } from "@capital-q/taxonomy/events";
import { VERIFICATION_EVENTS } from "@capital-q/verification/events";

/**
 * The production event registry the worker validates outbox rows against.
 *
 * Each domain packet adds its definitions here as they land; the API keeps
 * an identical list for its OutboxWriter (apps/api/src/event-registry.ts).
 * Test-only definitions (test.fixture.*) never appear in this list.
 *
 * Every event any deployable writes to the outbox must be here: the
 * publisher validates claimed rows against this registry, and a type it
 * does not know is retried and then left dead (DEF-A1: q-api's q.action.*
 * events sat dead from 2026-09-26 because this list omitted them). The
 * worker archives types it has no consumer for, so registering one is
 * always safe. `test/event-registry.test.ts` scans every defineEvent.
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
    ...MEDIA_EVENTS,
    ...VERIFICATION_EVENTS,
    ...INTEGRATIONS_EVENTS,
    // Written by q-api's Approval Engine (apps/q-api/src/main.ts).
    ...Q_ACTION_EVENTS,
  ]);
}
