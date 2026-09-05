import { randomBytes } from "node:crypto";

import type { TenantId } from "@capital-q/security";

/**
 * Object identity is chosen by the server and carries no meaning a client
 * could exploit or predict (doc 13 §74, doc 15 §24.1).
 *
 *   storage key ≠ authorization
 *
 * The tenant segment exists so operations can reason about a tenant's raw
 * objects; it is not a permission and it is not how any read is authorised.
 * The final segment is 128 bits of randomness, so two uploads cannot
 * collide by accident and no key can be guessed from a filename, a title, a
 * company name or a document id. The original filename never appears.
 */
export function createDocumentStorageKey(tenantId: TenantId): string {
  return `raw/${tenantId}/${randomBytes(16).toString("hex")}`;
}
