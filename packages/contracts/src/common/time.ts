import { z } from "zod";

/**
 * Timestamps cross the wire as RFC 3339 strings, never as Date objects.
 *
 * A Date is not JSON, is mutable, and silently carries the reading process's
 * local zone. Application code converts to and from Date internally; the
 * contract stays a string.
 *
 * A timezone designator is always required. A timestamp without one is not a
 * point in time -- it is a point in time in some zone the reader has to guess.
 */

/**
 * For external and integration boundaries, where a partner may legitimately
 * send a non-UTC offset.
 *
 * Accepts "2026-09-02T08:30:00Z" and "2026-09-02T10:30:00+01:00".
 * Rejects "2026-09-02T08:30:00" (no timezone).
 */
export const Rfc3339TimestampSchema = z.iso.datetime({ offset: true });

/**
 * For Capital Q-owned timestamps: createdAt, updatedAt, occurredAt.
 *
 * UTC only, so stored and compared values are directly ordered without offset
 * normalisation. Accepts "2026-09-02T08:30:00Z"; rejects a +01:00 offset.
 */
export const UtcTimestampSchema = z.iso.datetime();

/**
 * A calendar date (YYYY-MM-DD) with no time and no zone: a planning date such
 * as a target close, never an instant. A datetime supplied here is rejected
 * rather than truncated.
 */
export const LocalDateSchema = z.iso.date();

export type LocalDate = z.infer<typeof LocalDateSchema>;

export type Rfc3339Timestamp = z.infer<typeof Rfc3339TimestampSchema>;
export type UtcTimestamp = z.infer<typeof UtcTimestampSchema>;
