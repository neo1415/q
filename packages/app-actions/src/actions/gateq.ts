import { z } from "zod";

import {
  GATEQ_EMBED_ORIGINS_MAX,
  GATEQ_GATEWAY_APPEARANCE_PATH,
  GATEQ_GATEWAY_POLICY_EXTRACTIONS_PATH,
  GATEQ_GATEWAY_STATUS_PATH,
  GatewayAppearanceDtoSchema,
  GatewayAppearanceRequestSchema,
  GatewayDtoSchema,
  GatewayStatusRequestSchema,
  normaliseEmbedOrigin,
  PolicyExtractionDtoSchema,
  PolicyExtractionRequestSchema,
  UuidSchema,
  type PolicyExtractionDto,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  defineAppAction,
  portMissing,
  refusal,
  type AnyAppAction,
} from "../define.js";
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

const READ_MANDATE = defineAppAction<z.infer<typeof Read>, PolicyExtractionDto>(
  {
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
  },
);

// ---------------------------------------------------------------------------
// B6 / B7: the gateway's look, where it may be embedded, and whether it is
// open. What the public sees is the organisation admin's call
// (investor.gateway.publish, inside the service), so Q prepares each on an
// approval card; the screen's Save or Pause press is the approval there.
// ---------------------------------------------------------------------------

type AdminResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false };

type Appearance = {
  readonly gatewayId: string;
  readonly revision: number;
  readonly accentHex: string | null;
  readonly embedOrigins: readonly string[];
  readonly updatedAt: string | null;
};

type GatewayRow = {
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
  readonly status: "ACTIVE" | "DISABLED";
  readonly createdAt: string;
};

/** GateQ's gateway administration (packages/gateq gatewayAdminActionsPort). */
export type GateqGatewayAdminPort = {
  /** Their organisation's open gateway, else its paused one; null: none. */
  readonly ownGateway: (actor: ActorContext) => Promise<{
    readonly id: string;
    readonly status: "ACTIVE" | "DISABLED";
  } | null>;
  readonly appearance: (
    actor: ActorContext,
    gatewayId: string,
  ) => Promise<AdminResult<Appearance & { readonly canChange: boolean }>>;
  readonly setAppearance: (
    actor: ActorContext,
    gatewayId: string,
    input: {
      readonly accentHex: string | null;
      readonly embedOrigins: readonly string[];
    },
  ) => Promise<AdminResult<Appearance>>;
  readonly setStatus: (
    actor: ActorContext,
    gatewayId: string,
    status: "ACTIVE" | "DISABLED",
  ) => Promise<AdminResult<GatewayRow>>;
};

const admin = (ports: AppActionPorts) =>
  ports.gateqGatewayAdmin ?? portMissing("gateqGatewayAdmin");

const ADMIN_PURPOSES = ["ACTION_PREPARATION", "GENERAL_QUESTION"] as const;

const NOT_THEIRS = "Only an admin of your firm can change your gateway.";

/**
 * The organisation Q acts for, set only by Q's own path from the actor, so
 * the approval card names what it touches. Never authority: the service
 * reads the gateway's organisation off its row.
 */
const ForOrganisation = { organisationId: UuidSchema.optional() };
const targetsOf = (input: {
  readonly organisationId?: string | undefined;
}): readonly QSubjectRef[] =>
  input.organisationId === undefined
    ? []
    : [{ kind: "ORGANISATION", organisationId: input.organisationId }];

const Appear = z
  .object({
    gatewayId: UuidSchema,
    ...ForOrganisation,
    input: GatewayAppearanceRequestSchema,
  })
  .strict();
type AppearInput = z.infer<typeof Appear>;

/** A colour as said ("#0F766E", "0f766e") in the one stored spelling. */
const hexOf = (said: string): string | null => {
  const match = /^#?([0-9a-f]{6})$/iu.exec(said.trim());
  return match?.[1] === undefined ? null : `#${match[1].toLowerCase()}`;
};

const SET_APPEARANCE = defineAppAction<
  AppearInput,
  AdminResult<Appearance>,
  { accentColour: string | null; embedSites?: string[] | undefined }
>({
  name: "gateway.appearance.set",
  short: "brand my gateway",
  area: "gateway",
  classification: "CONSEQUENTIAL",
  does: "Sets their GateQ gateway's accent colour and the websites allowed to embed it; the public page and embed change at once.",
  input: Appear,
  output: z.custom<AdminResult<Appearance>>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    admin(ports).setAppearance(context.actor, input.gatewayId, input.input),
  targets: targetsOf,
  supersedes: true,
  card: (input) => ({
    summary:
      input.input.accentHex === null
        ? "Use Capital Q's colour on your gateway"
        : `Brand your gateway ${input.input.accentHex}`,
    preview:
      input.input.embedOrigins.length === 0
        ? "Any website may embed it."
        : `Only these websites may embed it: ${input.input.embedOrigins.join(", ")}.`,
  }),
  done: (out) => (out.ok ? "Your gateway's look is updated." : NOT_THEIRS),
  succeeded: (out) => out.ok,
  http: {
    method: "PUT",
    path: GATEQ_GATEWAY_APPEARANCE_PATH,
    fromRequest: (params, body) => ({
      gatewayId: params["gatewayId"],
      input: body,
    }),
    respond: (out) =>
      out.ok
        ? GatewayAppearanceDtoSchema.parse({
            ...out.value,
            embedOrigins: [...out.value.embedOrigins],
            canChange: true,
          })
        : null,
    notFound: (out) => !out.ok,
  },
  tool: {
    name: "set_gateway_appearance",
    purposes: [...ADMIN_PURPOSES],
    description:
      "Prepares, for their approval, their GateQ gateway's accent colour (#rrggbb, or null for Capital Q's) and, if they name them, the only websites allowed to embed it. Capital Q keeps the colour readable.",
    input: z
      .object({
        accentColour: z
          .string()
          .max(9)
          .nullable()
          .describe("A hex colour such as #0f766e, or null for Capital Q's."),
        embedSites: z
          .array(z.string().max(300))
          .max(GATEQ_EMBED_ORIGINS_MAX)
          .optional()
          .describe(
            "The websites allowed to embed the gateway; [] for any site. Omit to keep the current list.",
          ),
      })
      .strict(),
    references: {},
    eval: {
      say: [
        "Make my gateway teal, #0f766e.",
        "Brand my GateQ page in our colour #b45309.",
      ],
      orSays: "gateway yet|only an admin",
    },
    toCanonical: async (tool, context, ports) => {
      const own = await admin(ports).ownGateway(context.actor);
      if (own === null) return refusal("You don't have a GateQ gateway yet.");
      const accentHex =
        tool.accentColour === null ? null : hexOf(tool.accentColour);
      if (tool.accentColour !== null && accentHex === null) {
        return refusal("That isn't a colour I can use. Try one like #0f766e.");
      }
      let embedOrigins: string[];
      if (tool.embedSites === undefined) {
        const current = await admin(ports).appearance(context.actor, own.id);
        if (!current.ok) return refusal(NOT_THEIRS);
        embedOrigins = [...current.value.embedOrigins];
      } else {
        const origins = tool.embedSites.map(normaliseEmbedOrigin);
        const usable = origins.filter(
          (origin): origin is string => origin !== null,
        );
        if (usable.length !== origins.length) {
          return refusal(
            "One of those isn't a website address I can use (https only).",
          );
        }
        embedOrigins = [...new Set(usable)];
      }
      return {
        gatewayId: own.id,
        ...(context.actor.organisationId === undefined
          ? {}
          : { organisationId: context.actor.organisationId }),
        input: { accentHex, embedOrigins },
      };
    },
  },
});

const Status = z
  .object({
    gatewayId: UuidSchema,
    ...ForOrganisation,
    input: GatewayStatusRequestSchema,
  })
  .strict();

const SET_STATUS = defineAppAction<
  z.infer<typeof Status>,
  AdminResult<GatewayRow>,
  { open: boolean }
>({
  name: "gateway.status.set",
  short: "pause or reopen my gateway",
  area: "gateway",
  classification: "CONSEQUENTIAL",
  does: "Pauses their GateQ gateway (its page and embed stop taking applications) or reopens it. Rules and applications are kept.",
  input: Status,
  output: z.custom<AdminResult<GatewayRow>>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    admin(ports).setStatus(context.actor, input.gatewayId, input.input.status),
  targets: targetsOf,
  supersedes: true,
  card: (input) =>
    input.input.status === "ACTIVE"
      ? {
          summary: "Reopen your gateway",
          preview: "Founders can find your gateway and apply again.",
        }
      : {
          summary: "Pause your gateway",
          preview:
            "Its page and embed stop taking applications. Your rules and applications are kept.",
        },
  done: (out, input) =>
    !out.ok
      ? NOT_THEIRS
      : input.input.status === "ACTIVE"
        ? "Your gateway is open again."
        : "Your gateway is paused.",
  succeeded: (out) => out.ok,
  http: {
    method: "PUT",
    path: GATEQ_GATEWAY_STATUS_PATH,
    fromRequest: (params, body) => ({
      gatewayId: params["gatewayId"],
      input: body,
    }),
    respond: (out) =>
      out.ok
        ? GatewayDtoSchema.parse({
            id: out.value.id,
            publicId: out.value.publicId,
            name: out.value.name,
            status: out.value.status,
            createdAt: out.value.createdAt,
          })
        : null,
    notFound: (out) => !out.ok,
  },
  tool: {
    name: "set_gateway_open",
    purposes: [...ADMIN_PURPOSES],
    description:
      "Prepares, for their approval, pausing their GateQ gateway (open: false) or reopening it (open: true).",
    input: z
      .object({
        open: z.boolean().describe("true to reopen, false to pause."),
      })
      .strict(),
    references: {},
    eval: {
      say: ["Pause my GateQ gateway.", "Reopen my gateway to applications."],
      orSays: "gateway yet|only an admin",
    },
    toCanonical: async (tool, context, ports) => {
      const own = await admin(ports).ownGateway(context.actor);
      return own === null
        ? refusal("You don't have a GateQ gateway yet.")
        : {
            gatewayId: own.id,
            ...(context.actor.organisationId === undefined
              ? {}
              : { organisationId: context.actor.organisationId }),
            input: { status: tool.open ? "ACTIVE" : "DISABLED" },
          };
    },
  },
});

export const GATEQ_ACTIONS: readonly AnyAppAction[] = [
  READ_MANDATE,
  SET_APPEARANCE,
  SET_STATUS,
];
