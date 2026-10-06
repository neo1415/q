import { z } from "zod";

import {
  COMPANY_CLAIM_REQUESTS_PATH,
  CompanyClaimRequestSchema,
  CompanyClaimResultDtoSchema,
  GATEQ_STARTUP_ALERTS_PATH,
  StartupAlertDtoSchema,
  StartupAlertRequestSchema,
  UuidSchema,
  type CompanyClaimRequest,
  type CompanyClaimResultDto,
  type StartupAlertDto,
  type StartupAlertRequest,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";

/**
 * F3 (2026-10-06): "Find my startup", declared once (ADR 0040).
 *
 * A founder's claim request is their own act on the screen where they show
 * it is theirs (a work email, a registry document, or asking the members);
 * Q offers that screen. An investor's saved search is their own word, so Q
 * can save one when asked.
 */

export type CompanyClaimsPort = {
  /** Null: the company is not one they may see (the same as none). */
  readonly request: (
    actor: ActorContext,
    companyId: string,
    input: CompanyClaimRequest,
  ) => Promise<CompanyClaimResultDto | null>;
};

export type StartupAlertsPort = {
  readonly save: (
    actor: ActorContext,
    input: StartupAlertRequest,
  ) => Promise<StartupAlertDto | null>;
};

const serviceDecides = () => Promise.resolve({ ok: true as const });

const Claim = z
  .object({ companyId: UuidSchema, input: CompanyClaimRequestSchema })
  .strict();
type ClaimOut = CompanyClaimResultDto | null;

const CLAIM = defineAppAction<z.infer<typeof Claim>, ClaimOut>({
  name: "company.claim.request",
  short: "claim my company",
  area: "gateway",
  classification: "INSTANT",
  does: "Asks to claim their company on Capital Q, or to join it when it already has members.",
  input: Claim,
  output: z.custom<ClaimOut>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    (ports.companyClaims ?? portMissing("companyClaims")).request(
      context.actor,
      input.companyId,
      input.input,
    ),
  targets: () => [],
  card: () => ({ summary: "Claim", preview: "" }),
  done: (out) =>
    out === null
      ? "That company isn't one you can see."
      : out.status === "EMAIL_NOT_AT_COMPANY"
        ? "That email isn't at the company's website domain."
        : "Your request is in.",
  succeeded: (out) => out !== null && out.status !== "EMAIL_NOT_AT_COMPANY",
  http: {
    method: "POST",
    path: COMPANY_CLAIM_REQUESTS_PATH,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      input: body,
    }),
    status: (out) => (out?.status === "REQUESTED" ? 201 : 200),
    respond: (out) => CompanyClaimResultDtoSchema.parse(out),
    notFound: (out) => out === null,
    idempotencyKeyOf: (input) => input.input.clientRequestId,
  },
  qCapability: "offer.find_my_startup",
});

const Alert = z.object({ input: StartupAlertRequestSchema }).strict();
type AlertOut = StartupAlertDto | null;

const SAVE_ALERT = defineAppAction<
  z.infer<typeof Alert>,
  AlertOut,
  { description: string }
>({
  name: "gateq.startup_alert.save",
  short: "save a startup search",
  area: "gateway",
  classification: "INSTANT",
  does: "Saves the investor's description of the companies they want as an alert. A search, never a change to their mandate.",
  input: Alert,
  output: z.custom<AlertOut>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    (ports.startupAlerts ?? portMissing("startupAlerts")).save(
      context.actor,
      input.input,
    ),
  targets: () => [],
  card: () => ({ summary: "Alert", preview: "" }),
  done: (out) =>
    out === null
      ? "Alerts belong to a firm; switch to yours first."
      : "Saved as an alert.",
  succeeded: (out) => out !== null,
  http: {
    method: "POST",
    path: GATEQ_STARTUP_ALERTS_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    status: (out) => (out !== null && !out.deduplicated ? 201 : 200),
    respond: (out) => StartupAlertDtoSchema.parse(out),
    notFound: (out) => out === null,
    idempotencyKeyOf: (input) => input.input.clientRequestId,
  },
  tool: {
    name: "save_startup_alert",
    description:
      'Saves the investor\'s description of the startups they want ("seed fintech in Nigeria raising under $2M") as an alert on their GateQ Find tab. It never changes their declared mandate.',
    input: z
      .object({
        description: z
          .string()
          .trim()
          .min(3)
          .max(500)
          .describe("What they're looking for, in their words."),
      })
      .strict(),
    references: {},
    purposes: ["ACTION_PREPARATION"],
    eval: {
      say: [
        "Watch for seed fintech in Ghana raising under $2M.",
        "Save an alert for climate hardware in East Africa.",
      ],
    },
    toCanonical: (tool, context) =>
      Promise.resolve({
        input: {
          description: tool.description,
          clientRequestId: `q:${context.idempotencyKey}`
            .slice(0, 128)
            .replace(/[^A-Za-z0-9:_-]/g, "-"),
        },
      }),
  },
});

export const GATEQ_FIND_ACTIONS: readonly AnyAppAction[] = [CLAIM, SAVE_ALERT];
