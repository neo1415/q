"use server";

import { z } from "zod";

import { ApiProblemError, addRelationshipNote } from "@capital-q/api-client";
import {
  RelationshipNoteBodySchema,
  type RelationshipNote,
} from "@capital-q/contracts";

import { apiSession, resolveOwnContext } from "@/features/q/context";

/**
 * CRM private notes, server side (S3). A server action so the session
 * token never reaches the browser. The side is never taken from the
 * browser: a founder's notes are their own company's, resolved here from
 * their active context; the API authorises it again.
 */
export type NoteResult =
  | { readonly ok: true; readonly note: RelationshipNote }
  | { readonly ok: false; readonly message: string };

const Input = z
  .object({
    relationshipId: z.string().uuid(),
    noteId: z.string().uuid(),
    body: RelationshipNoteBodySchema,
    supersedesNoteId: z.string().uuid().optional(),
  })
  .strict();

export async function addRelationshipNoteAction(
  input: unknown,
): Promise<NoteResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "Write a note of up to 4,000 characters." };
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  if (session === null)
    return { ok: false, message: "Please sign in again to continue." };
  if (context.kind !== "FOUNDER" && context.kind !== "INVESTOR")
    return { ok: false, message: "Notes belong to your organisation." };
  const { relationshipId, noteId, body, supersedesNoteId } = parsed.data;
  try {
    return {
      ok: true,
      note: await addRelationshipNote(
        session,
        relationshipId,
        noteId,
        {
          body,
          ...(supersedesNoteId === undefined ? {} : { supersedesNoteId }),
        },
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
          : "Couldn't save the note just now. Nothing was lost; try again.",
    };
  }
}
