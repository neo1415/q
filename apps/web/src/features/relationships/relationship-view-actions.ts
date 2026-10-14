"use server";
import {
  RelationshipQuerySchema,
  SaveRelationshipViewRequestSchema,
} from "@capital-q/contracts";
import {
  queryOwnRelationships,
  listRelationshipViews,
  saveRelationshipView,
  deleteRelationshipView,
  exportRelationshipView,
} from "@capital-q/api-client";
import { apiSession, resolveOwnContext } from "@/features/q/context";
async function owned() {
  const context = await resolveOwnContext();
  const session = await apiSession();
  if (
    session === null ||
    (context.kind !== "FOUNDER" && context.kind !== "INVESTOR")
  )
    throw new Error("Relationships unavailable");
  return {
    session,
    companyId: context.kind === "FOUNDER" ? context.companyId : undefined,
  };
}
export async function queryRelationshipViewAction(input: unknown) {
  try {
    const { session, companyId } = await owned();
    const query = RelationshipQuerySchema.parse(input);
    return {
      ok: true as const,
      ...(await queryOwnRelationships(session, {
        ...query,
        ...(companyId === undefined ? {} : { companyId }),
      })),
    };
  } catch {
    return { ok: false as const };
  }
}
export async function listRelationshipViewsAction() {
  try {
    const { session } = await owned();
    return { ok: true as const, ...(await listRelationshipViews(session)) };
  } catch {
    return { ok: false as const };
  }
}
export async function saveRelationshipViewAction(id: string, input: unknown) {
  try {
    const { session } = await owned();
    return {
      ok: true as const,
      view: await saveRelationshipView(
        session,
        id,
        SaveRelationshipViewRequestSchema.parse(input),
      ),
    };
  } catch {
    return { ok: false as const };
  }
}
export async function deleteRelationshipViewAction(
  id: string,
  version: number,
) {
  try {
    const { session } = await owned();
    await deleteRelationshipView(session, id, version);
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}
export async function exportRelationshipViewAction(input: unknown) {
  try {
    const { session, companyId } = await owned();
    const query = RelationshipQuerySchema.parse(input);
    const { cursor: _cursor, limit: _limit, ...definition } = query;
    return {
      ok: true as const,
      ...(await exportRelationshipView(session, {
        query: {
          ...definition,
          ...(companyId === undefined ? {} : { companyId }),
        },
      })),
    };
  } catch {
    return { ok: false as const };
  }
}
