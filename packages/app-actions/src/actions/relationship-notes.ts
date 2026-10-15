import { z } from "zod";

import {
  CreateRelationshipNoteRequestSchema,
  NETWORK_COMPANY_RELATIONSHIP_NOTE_PATH,
  NETWORK_RELATIONSHIP_NOTE_PATH,
  RelationshipNoteSchema,
  UuidSchema,
  type RelationshipNote,
} from "@capital-q/contracts";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * CRM private notes (S3, 2026-10-15): add a note, or a correction of one,
 * to a relationship record, for the person's own side only. The person's
 * own private write, so INSTANT. Q never writes or reads notes (they are
 * not Q context); Q can take them to the record, where they write.
 *
 * Authorisation is the network service's own (requireRelationshipListingScope
 * plus the relationship having that party), the same for every caller; the
 * company id in a founder's path is input the service checks, never proof.
 */

const notes = (ports: AppActionPorts) =>
  ports.relationshipNotes ?? portMissing("relationshipNotes");

/** The service decides; a refusal there is the route's one not-found. */
const serviceDecides = () => Promise.resolve({ ok: true as const });

const Add = z
  .object({
    relationshipId: UuidSchema,
    noteId: UuidSchema,
    /** A founder's company: their side. Absent: an investor's. */
    companyId: UuidSchema.optional(),
    request: CreateRelationshipNoteRequestSchema,
  })
  .strict();
type AddInput = z.infer<typeof Add>;

function addAction(path: string, company: boolean) {
  return defineAppAction<AddInput, RelationshipNote>({
    name: company ? "crm.company_note.add" : "crm.investor_note.add",
    short: "add a private CRM note",
    area: "crm",
    classification: "INSTANT",
    does: company
      ? "Adds a private note (or a correction of one) to their company's record of one investor relationship; only their company reads it."
      : "Adds a private note (or a correction of one) to their firm's record of one company relationship; only their firm reads it.",
    input: Add,
    output: RelationshipNoteSchema,
    authorize: serviceDecides,
    run: (ports, context, input) =>
      notes(ports).add(
        context.actor,
        input.relationshipId,
        input.noteId,
        input.request,
        input.companyId,
      ),
    targets: () => [],
    card: (input) => ({
      summary:
        input.request.supersedesNoteId === undefined
          ? "Add a private note"
          : "Correct a private note",
      preview: input.request.body,
    }),
    done: () => "Note saved.",
    qCapability: "offer.crm_notes",
    http: {
      method: "PUT",
      path,
      fromRequest: (params, body) => ({
        relationshipId: params["relationshipId"],
        noteId: params["noteId"],
        ...(params["companyId"] === undefined
          ? {}
          : { companyId: params["companyId"] }),
        request: body,
      }),
      // Idempotent on the client-chosen note id.
      idempotencyKeyOf: (input) => `crm-note:${input.noteId}`,
      respond: (out) => RelationshipNoteSchema.parse(out),
    },
  });
}

export const RELATIONSHIP_NOTE_ACTIONS: readonly AnyAppAction[] = [
  addAction(NETWORK_RELATIONSHIP_NOTE_PATH, false),
  addAction(NETWORK_COMPANY_RELATIONSHIP_NOTE_PATH, true),
];
