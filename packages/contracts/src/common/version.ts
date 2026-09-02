import { z } from "zod";

/**
 * A monotonic positive integer version.
 *
 * A number is correct here, unlike money: these are small bounded counters, not
 * exact decimals, and JSON integers represent them without loss.
 *
 * Versions start at 1. Zero is reserved by nothing and means nothing, so it is
 * rejected rather than treated as "unversioned" -- an absent version and a
 * version of zero would otherwise be confusable.
 */
export const VersionSchema = z
  .number()
  .int("expected a whole number version")
  .min(1, "expected a version of 1 or greater");

export type Version = z.infer<typeof VersionSchema>;

/**
 * The version of a mutable resource, for optimistic concurrency: a caller sends
 * the version it read, and the write is rejected if the resource has moved on.
 *
 * The primitive is shared, but the concepts are not interchangeable -- a
 * resource version, an event version and a job schema version answer different
 * questions and live in different fields. There is deliberately no single
 * global CURRENT_VERSION for the product.
 *
 * HTTP expression of this (ETag, If-Match) belongs to the HTTP contract, and
 * eventVersion/jobVersion belong to the message envelopes in CQ-CON-003.
 */
export const ResourceVersionSchema = VersionSchema;

export type ResourceVersion = z.infer<typeof ResourceVersionSchema>;
