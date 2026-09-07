import { z } from "zod";

/**
 * Major version of the Q contract family.
 *
 * External HTTP versioning stays at `/v1`; this is the version of the Q
 * payload shapes themselves, stamped on the envelopes that outlive a request
 * -- a stream event that is persisted and replayed, a request envelope handed
 * between services, an action proposal awaiting approval -- so a reader can
 * refuse a shape it does not understand instead of guessing.
 *
 * Evolution is additive: new enum members, new optional fields and new union
 * members keep this at 1. Only a change that breaks an existing reader moves
 * it, and that is a deliberate event with an ADR, not a routine edit.
 */
export const Q_CONTRACT_VERSION = 1 as const;

export const QContractVersionSchema = z.literal(Q_CONTRACT_VERSION);

export type QContractVersion = typeof Q_CONTRACT_VERSION;
