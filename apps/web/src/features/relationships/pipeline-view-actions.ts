"use server";

import { z } from "zod";

import {
  ApiProblemError,
  deleteRelationshipView,
  listRelationshipViews,
  saveRelationshipView,
  type ApiSession,
} from "@capital-q/api-client";
import {
  SaveRelationshipViewRequestSchema,
  type SavedRelationshipView,
  type SavedRelationshipViewList,
} from "@capital-q/contracts";

import { apiSession, resolveOwnContext } from "@/features/q/context";

/**
 * CRM saved views, server side (2026-10-15). Server actions so the session
 * token never reaches the browser. The party is never taken from the
 * browser: a founder's views are their own company's, resolved here from
 * their active context; the API authorises it again.
 */
export type ViewResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();

async function run<T>(
  work: (session: ApiSession, companyId: string | undefined) => Promise<T>,
): Promise<ViewResult<T>> {
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  if (session === null)
    return { ok: false, message: "Please sign in again to continue." };
  if (context.kind !== "FOUNDER" && context.kind !== "INVESTOR")
    return { ok: false, message: "Saved views belong to your organisation." };
  try {
    return {
      ok: true,
      value: await work(
        session,
        context.kind === "FOUNDER" ? context.companyId : undefined,
      ),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError &&
        error.status < 500 &&
        error.problem?.detail !== undefined
          ? error.problem.detail
          : "Couldn't reach Capital Q just now. Your views are unchanged.",
    };
  }
}

export async function listPipelineViewsAction(): Promise<
  ViewResult<SavedRelationshipViewList>
> {
  return run((session, companyId) => listRelationshipViews(session, companyId));
}

export async function savePipelineViewAction(
  viewId: string,
  input: unknown,
): Promise<ViewResult<SavedRelationshipView>> {
  const id = Id.safeParse(viewId);
  const body = SaveRelationshipViewRequestSchema.safeParse(input);
  if (!id.success || !body.success)
    return { ok: false, message: "Name this view and try again." };
  return run((session, companyId) =>
    saveRelationshipView(session, id.data, body.data, companyId),
  );
}

export async function deletePipelineViewAction(
  viewId: string,
  expectedVersion: number,
): Promise<ViewResult<true>> {
  const id = Id.safeParse(viewId);
  const version = z.number().int().positive().safeParse(expectedVersion);
  if (!id.success || !version.success)
    return { ok: false, message: "That view couldn't be found." };
  return run(async (session, companyId) => {
    await deleteRelationshipView(session, id.data, version.data, companyId);
    return true as const;
  });
}
