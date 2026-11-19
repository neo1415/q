import "server-only";

import { getAdminAccount, getAdminOrganisation } from "@capital-q/api-client";
import type { ApiSession } from "@capital-q/api-client";
import type { AdminAuditRowDto } from "@capital-q/contracts";

/**
 * Names for the audit log's resources, from the console's existing detail
 * reads (admin design 2026-11-19: rows showed raw ids). Only kinds whose id
 * one of those reads takes: a person (user_profile, keyed by user id) and
 * an organisation. Anything else, or a read that fails or is refused,
 * keeps its id: a name is never guessed.
 */

export type AuditResourceKind = "person" | "organisation";

const KIND_OF: Readonly<Record<string, AuditResourceKind>> = {
  user_profile: "person",
  organisation: "organisation",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** At most this many distinct lookups per page of rows. */
export const AUDIT_NAME_LOOKUPS = 25;

/** Which named kind a row's resource is, if a detail read names it. */
export function auditResourceKind(
  resourceType: string,
): AuditResourceKind | null {
  return KIND_OF[resourceType] ?? null;
}

export function auditResourceKey(kind: AuditResourceKind, id: string): string {
  return `${kind}:${id}`;
}

/** The distinct resources a page could name, in first-seen order, capped. */
export function auditLookups(
  rows: readonly Pick<AdminAuditRowDto, "resourceType" | "resourceId">[],
): readonly {
  readonly key: string;
  readonly kind: AuditResourceKind;
  readonly id: string;
}[] {
  const seen = new Map<string, { kind: AuditResourceKind; id: string }>();
  for (const row of rows) {
    const kind = KIND_OF[row.resourceType];
    // Both reads take a UUID; anything else would only be refused.
    if (kind === undefined || !UUID.test(row.resourceId)) continue;
    const key = auditResourceKey(kind, row.resourceId);
    if (!seen.has(key) && seen.size < AUDIT_NAME_LOOKUPS) {
      seen.set(key, { kind, id: row.resourceId });
    }
  }
  return [...seen].map(([key, value]) => ({ key, ...value }));
}

/** Where a named resource opens in the console. */
export function auditResourceHref(kind: AuditResourceKind, id: string): string {
  return kind === "person"
    ? `/admin/accounts/${encodeURIComponent(id)}`
    : `/admin/organisations/${encodeURIComponent(id)}`;
}

/**
 * Reads the names, in parallel, only when the role may read accounts (the
 * permission both detail reads need; the API checks it again).
 */
export async function auditResourceNames(
  session: ApiSession,
  rows: readonly AdminAuditRowDto[],
  canReadAccounts: boolean,
): Promise<ReadonlyMap<string, string>> {
  if (!canReadAccounts) return new Map();
  const found = await Promise.all(
    auditLookups(rows).map(async ({ key, kind, id }) => {
      const name =
        kind === "person"
          ? await getAdminAccount(session, id)
              .then((account) => account.name)
              .catch(() => null)
          : await getAdminOrganisation(session, id)
              .then((organisation) => organisation.name)
              .catch(() => null);
      return [key, name] as const;
    }),
  );
  return new Map(
    found.filter(
      (entry): entry is readonly [string, string] =>
        entry[1] !== null && entry[1].length > 0,
    ),
  );
}
