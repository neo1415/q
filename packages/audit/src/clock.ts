import { UtcTimestampSchema, type UtcTimestamp } from "@capital-q/contracts";

/**
 * Server time for `occurredAt`. Material-action time is created by the
 * application on the server, never taken from a browser or client request.
 */
export function occurredNow(): UtcTimestamp {
  return UtcTimestampSchema.parse(new Date().toISOString());
}
