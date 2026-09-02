import { randomUUID } from "node:crypto";

/**
 * Diagnostic identifiers. These are opaque correlation handles, not domain
 * entity identifiers, and they carry no authority: the presence of a tenantId
 * in a logging context never implies the caller is authorized for that tenant.
 *
 * Inbound `X-Request-Id` and correlation headers are untrusted external input.
 * They are not accepted here; HTTP propagation is governed by Document 22 and
 * arrives with the API contract packets. Until then IDs are server-generated.
 */

export function createRequestId(): string {
  return `req_${randomUUID()}`;
}

export function createCorrelationId(): string {
  return `cor_${randomUUID()}`;
}
