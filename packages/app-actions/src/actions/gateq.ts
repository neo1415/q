import { z } from "zod";

import {
  GATEQ_GATEWAY_POLICY_EXTRACTIONS_PATH,
  PolicyExtractionDtoSchema,
  PolicyExtractionRequestSchema,
  UuidSchema,
  type PolicyExtractionDto,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * GateQ from a mandate (P7, ADR 0040). The investor pastes or uploads their
 * mandate on the Gateway page; Capital Q's deterministic reader proposes
 * DRAFT criteria and records their provenance. Nothing becomes a rule here:
 * the investor reviews every proposal and publishes a version, which stays
 * the existing admin-only act. Q offers the Gateway screen for it
 * (`offer.gateway_mandate`) rather than reading a mandate it was handed in
 * conversation, because the confirmation belongs on the screen with the
 * rules in front of them.
 */

/** What the route reaches: GateQ authorises EDIT on the gateway itself. */
export type GateQPolicyExtractionPort = {
  readonly extract: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: string;
    readonly text: string;
    readonly sourceKind: "PASTED_TEXT" | "UPLOADED_FILE";
    readonly clientRequestId: string;
  }) => Promise<PolicyExtractionDto>;
};

const port = (ports: AppActionPorts) =>
  ports.gateqPolicyExtraction ?? portMissing("gateqPolicyExtraction");

/** GateQ's own authorise step (investor.gateway.edit) decides. */
const serviceDecides = () => Promise.resolve({ ok: true as const });

const Read = z
  .object({ gatewayId: UuidSchema, input: PolicyExtractionRequestSchema })
  .strict();

const READ_MANDATE = defineAppAction<
  z.infer<typeof Read>,
  PolicyExtractionDto
>({
  name: "gateway.policy.read_mandate",
  short: "draft gateway rules from mandate",
  area: "gateway",
  classification: "INSTANT",
  does: "Reads their mandate into draft GateQ rules they then review and publish on the Gateway page.",
  input: Read,
  output: PolicyExtractionDtoSchema,
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).extract({
      actor: context.actor,
      gatewayId: input.gatewayId,
      text: input.input.text,
      sourceKind: input.input.sourceKind,
      clientRequestId: input.input.clientRequestId,
    }),
  targets: () => [],
  card: () => ({ summary: "Draft gateway rules", preview: "" }),
  done: (out) =>
    `Drafted ${out.proposals.length} rule${out.proposals.length === 1 ? "" : "s"} to review.`,
  http: {
    method: "POST",
    path: GATEQ_GATEWAY_POLICY_EXTRACTIONS_PATH,
    fromRequest: (params, body) => ({
      gatewayId: params["gatewayId"],
      input: body,
    }),
    status: (out) => (out.deduplicated ? 200 : 201),
    respond: (out) => PolicyExtractionDtoSchema.parse(out),
    idempotencyKeyOf: (input) => input.input.clientRequestId,
  },
  qCapability: "offer.gateway_mandate",
});

export const GATEQ_ACTIONS: readonly AnyAppAction[] = [READ_MANDATE];
