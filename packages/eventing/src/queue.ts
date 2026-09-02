/**
 * The durable queue canonical domain events are published to.
 *
 * A code constant, not configuration: queue identity is architecture, and an
 * environment typo must not be able to reroute production events.
 */
export const DOMAIN_EVENTS_QUEUE = "domain-events" as const;
