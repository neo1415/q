import { z } from "zod";

import {
  DeleteRelationshipViewResponseSchema,
  NETWORK_COMPANY_RELATIONSHIP_VIEW_PATH,
  NETWORK_COMPANY_RELATIONSHIP_VIEW_VERSION_PATH,
  NETWORK_RELATIONSHIP_VIEW_PATH,
  NETWORK_RELATIONSHIP_VIEW_VERSION_PATH,
  RelationshipViewVersionSchema,
  SaveRelationshipViewRequestSchema,
  SavedRelationshipViewSchema,
  UuidSchema,
  type SavedRelationshipView,
} from "@capital-q/contracts";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * CRM saved views (owner directive 2026-10-15 §D): save, rename and delete
 * a named pipeline view, for the person or (an organisation admin) for
 * their workspace. A presentation preference over the same authorised
 * pipeline, reversible and theirs, so INSTANT. Q opens a saved view
 * through the pipeline's own screen control; saving one is the person's
 * act on the CRM's pipeline, which Q offers to take them to.
 *
 * Authorisation is the network service's own (requireRelationshipListingScope
 * plus organisation.admin for workspace views), the same for every caller;
 * the company id in a founder's path is input the service checks against
 * their active organisation, never proof.
 */

const views = (ports: AppActionPorts) =>
  ports.relationshipViews ?? portMissing("relationshipViews");

/** The service decides; a refusal there is the route's one not-found. */
const serviceDecides = () => Promise.resolve({ ok: true as const });

const Party = z
  .object({
    viewId: UuidSchema,
    /** A founder's company: their side of the CRM. Absent: an investor's. */
    companyId: UuidSchema.optional(),
  })
  .strict();

const Save = Party.extend({
  request: SaveRelationshipViewRequestSchema,
}).strict();
type SaveInput = z.infer<typeof Save>;

const Delete = Party.extend({
  expectedVersion: RelationshipViewVersionSchema,
}).strict();
type DeleteInput = z.infer<typeof Delete>;

const OFFER = "offer.crm_saved_views" as const;

const party = (params: Record<string, string>) => ({
  viewId: params["viewId"],
  ...(params["companyId"] === undefined
    ? {}
    : { companyId: params["companyId"] }),
});

function saveAction(path: string, company: boolean) {
  return defineAppAction<SaveInput, SavedRelationshipView>({
    name: company ? "crm.company_view.save" : "crm.investor_view.save",
    short: "save a CRM view",
    area: "crm",
    classification: "INSTANT",
    does: company
      ? "Saves or renames a named view of their company's CRM pipeline (filters, layout, columns), for them or their team, as the pipeline does."
      : "Saves or renames a named view of their firm's CRM pipeline (filters, layout, columns), for them or their team, as the pipeline does.",
    input: Save,
    output: SavedRelationshipViewSchema,
    authorize: serviceDecides,
    run: (ports, context, input) =>
      views(ports).save(
        context.actor,
        input.viewId,
        input.request,
        input.companyId,
      ),
    targets: () => [],
    card: (input) => ({
      summary: `Save the CRM view "${input.request.name}"`,
      preview: "",
    }),
    done: (out) =>
      out.scope === "ORGANISATION"
        ? `Saved "${out.name}" for your team.`
        : `Saved "${out.name}".`,
    qCapability: OFFER,
    http: {
      method: "PUT",
      path,
      fromRequest: (params, body) => ({ ...party(params), request: body }),
      // Create is idempotent on the client's id; update is compare-and-swap.
      idempotencyKeyOf: (input) =>
        `crm-view:${input.viewId}:${String(input.request.expectedVersion)}`,
      respond: (out) => SavedRelationshipViewSchema.parse(out),
    },
  });
}

function deleteAction(path: string, company: boolean) {
  return defineAppAction<DeleteInput, true>({
    name: company ? "crm.company_view.delete" : "crm.investor_view.delete",
    short: "delete a CRM view",
    area: "crm",
    classification: "INSTANT",
    does: company
      ? "Deletes one of their company's saved CRM views (theirs, or the team's for an admin)."
      : "Deletes one of their firm's saved CRM views (theirs, or the team's for an admin).",
    input: Delete,
    output: z.literal(true),
    authorize: serviceDecides,
    run: async (ports, context, input) => {
      await views(ports).remove(
        context.actor,
        input.viewId,
        input.expectedVersion,
        input.companyId,
      );
      return true as const;
    },
    targets: () => [],
    card: () => ({ summary: "Delete a saved CRM view", preview: "" }),
    done: () => "Deleted the view.",
    qCapability: OFFER,
    http: {
      method: "DELETE",
      path,
      fromRequest: (params) => ({
        ...party(params),
        expectedVersion: params["version"],
      }),
      respond: () =>
        DeleteRelationshipViewResponseSchema.parse({ deleted: true }),
    },
  });
}

export const RELATIONSHIP_VIEW_ACTIONS: readonly AnyAppAction[] = [
  saveAction(NETWORK_RELATIONSHIP_VIEW_PATH, false),
  saveAction(NETWORK_COMPANY_RELATIONSHIP_VIEW_PATH, true),
  deleteAction(NETWORK_RELATIONSHIP_VIEW_VERSION_PATH, false),
  deleteAction(NETWORK_COMPANY_RELATIONSHIP_VIEW_VERSION_PATH, true),
];
