import { z } from "zod";

import {
  NETWORK_COMPANY_RELATIONSHIP_SIDE_DETAILS_PATH,
  NETWORK_RELATIONSHIP_SIDE_DETAILS_PATH,
  RelationshipSideDetailsSchema,
  UpdateRelationshipSideDetailsRequestSchema,
  UuidSchema,
  type RelationshipSideDetails,
} from "@capital-q/contracts";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * A side's own pipeline fields on one relationship (decision 106, CRM
 * import gaps): its stage, deal owner, source and introducer, expected
 * cheque and priority. The person's own private write, so INSTANT; the
 * import sets the same fields on approval. Q reads them for the person's
 * own side (get_relationship) and takes them to the relationship to edit.
 *
 * Authorisation is the network service's own (requireRelationshipListingScope
 * plus the relationship having that party); the company id in a founder's
 * path is input the service checks, never proof. A save names the revision
 * it was made from and is refused over a newer one.
 */

const details = (ports: AppActionPorts) =>
  ports.relationshipSideDetails ?? portMissing("relationshipSideDetails");

/** The service decides; a refusal there is the route's one not-found. */
const serviceDecides = () => Promise.resolve({ ok: true as const });

const Update = z
  .object({
    relationshipId: UuidSchema,
    /** A founder's company: their side. Absent: an investor's. */
    companyId: UuidSchema.optional(),
    request: UpdateRelationshipSideDetailsRequestSchema,
  })
  .strict();
type UpdateInput = z.infer<typeof Update>;

const FIELD_WORDS: Readonly<Record<string, string>> = {
  stage: "stage",
  stageLabel: "stage",
  ownerMembershipId: "owner",
  source: "source",
  introducerName: "introducer",
  introducerEmail: "introducer",
  expected: "expected amount",
  priority: "priority",
};

function updateAction(path: string, company: boolean) {
  return defineAppAction<UpdateInput, RelationshipSideDetails>({
    name: company
      ? "crm.company_side_details.update"
      : "crm.investor_side_details.update",
    short: "update my pipeline fields",
    area: "crm",
    classification: "INSTANT",
    does: company
      ? "Sets their company's own stage, owner, source, expected cheque or priority on one investor relationship; only their company reads them."
      : "Sets their firm's own stage, owner, source, expected ticket or priority on one company relationship; only their firm reads them.",
    input: Update,
    output: RelationshipSideDetailsSchema,
    authorize: serviceDecides,
    run: (ports, context, input) =>
      details(ports).update(
        context.actor,
        input.relationshipId,
        input.request,
        {
          companyId: input.companyId,
          correlationId: context.correlationId,
        },
      ),
    targets: () => [],
    card: (input) => ({
      summary: "Update your pipeline fields",
      preview: `Changes ${[
        ...new Set(
          Object.keys(input.request)
            .filter((key) => key !== "revision")
            .map((key) => FIELD_WORDS[key] ?? key),
        ),
      ].join(", ")}; only your side sees them.`,
    }),
    done: () => "Saved.",
    qCapability: "offer.crm_side_details",
    http: {
      method: "PUT",
      path,
      fromRequest: (params, body) => ({
        relationshipId: params["relationshipId"],
        ...(params["companyId"] === undefined
          ? {}
          : { companyId: params["companyId"] }),
        request: body,
      }),
      respond: (out) => RelationshipSideDetailsSchema.parse(out),
    },
  });
}

export const RELATIONSHIP_SIDE_DETAIL_ACTIONS: readonly AnyAppAction[] = [
  updateAction(NETWORK_RELATIONSHIP_SIDE_DETAILS_PATH, false),
  updateAction(NETWORK_COMPANY_RELATIONSHIP_SIDE_DETAILS_PATH, true),
];
