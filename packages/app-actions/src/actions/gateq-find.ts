import { z } from "zod";

import {
  COMPANY_CLAIM_DECISION_PATH,
  COMPANY_CLAIM_REQUESTS_PATH,
  ClaimDecisionRequestSchema,
  ClaimDecisionResultDtoSchema,
  type ClaimDecisionResultDto,
  COMPANY_CLAIM_EVIDENCE_COMPLETE_PATH,
  COMPANY_CLAIM_EVIDENCE_PATH,
  ClaimEvidenceCompleteDtoSchema,
  ClaimEvidenceUploadDtoSchema,
  ClaimEvidenceUploadRequestSchema,
  type ClaimEvidenceCompleteDto,
  type ClaimEvidenceUploadDto,
  type ClaimEvidenceUploadRequest,
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

import {
  defineAppAction,
  definePersonAction,
  portMissing,
  type AnyAppAction,
  type AnyPersonAction,
} from "../define.js";

/**
 * F3 (2026-10-06): "Find my startup", declared once (ADR 0040).
 *
 * A founder's claim request is their own act on the screen where they show
 * it is theirs (a work email, a registry document, or asking the members);
 * Q offers that screen. An investor's saved search is their own word, so Q
 * can save one when asked.
 */

export type CompanyClaimsPort = {
  /**
   * Null: the company is not one they may see (the same as none).
   * 2026-10-08 (F2): the requester is a person; a newcomer with no
   * organisation yet claims too. Their own context, when present, adds the
   * companies their organisation may see. Nothing about the company changes
   * until a decision admits them into its organisation.
   */
  readonly request: (
    requester: {
      readonly userId: string;
      readonly tenantId?: string | undefined;
      readonly organisationId?: string | undefined;
    },
    companyId: string,
    input: CompanyClaimRequest,
  ) => Promise<CompanyClaimResultDto | null>;
  /**
   * 2026-10-08: the claimant's registry document: a direct upload to
   * private storage on their own pending REGISTRY_DOCUMENT claim, then
   * what storage observed. NOT_FOUND: no such claim of theirs.
   */
  readonly evidenceUpload?:
    | ((
        requester: { readonly userId: string },
        companyId: string,
        input: ClaimEvidenceUploadRequest,
      ) => Promise<ClaimEvidenceUploadDto>)
    | undefined;
  readonly evidenceComplete?:
    | ((
        requester: { readonly userId: string },
        companyId: string,
      ) => Promise<ClaimEvidenceCompleteDto>)
    | undefined;
  /**
   * P14: a company admin decides a claim on their own company; approval
   * admits the requester as a Member. Null: nothing they may decide.
   */
  readonly decideAsMember?:
    | ((
        actor: ActorContext,
        companyId: string,
        requestId: string,
        input: {
          readonly approve: boolean;
          readonly reason?: string | undefined;
        },
      ) => Promise<ClaimDecisionResultDto | null>)
    | undefined;
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

const CLAIM = definePersonAction<z.infer<typeof Claim>, ClaimOut>({
  name: "company.claim.request",
  short: "claim my company",
  area: "gateway",
  classification: "INSTANT",
  does: "Asks to claim their company on Capital Q, or to join it when it already has members.",
  input: Claim,
  output: z.custom<ClaimOut>(),
  run: (ports, context, input) =>
    (ports.companyClaims ?? portMissing("companyClaims")).request(
      {
        userId: context.person.userId,
        tenantId: context.person.context?.tenantId,
        organisationId: context.person.context?.organisationId,
      },
      input.companyId,
      input.input,
    ),
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

const Evidence = z
  .object({ companyId: UuidSchema, input: ClaimEvidenceUploadRequestSchema })
  .strict();

/**
 * 2026-10-08: the registry document behind a claim. The browser puts the
 * bytes straight to private storage; the API never relays them. Evidence
 * for whoever decides, never a decision.
 */
const CLAIM_EVIDENCE = definePersonAction<
  z.infer<typeof Evidence>,
  ClaimEvidenceUploadDto
>({
  name: "company.claim.evidence.upload",
  short: "attach a registry document",
  area: "gateway",
  classification: "INSTANT",
  does: "Attaches their registry document to their claim on a company.",
  input: Evidence,
  output: z.custom<ClaimEvidenceUploadDto>(),
  run: (ports, context, input) => {
    const upload =
      (ports.companyClaims ?? portMissing("companyClaims")).evidenceUpload ??
      portMissing("companyClaims");
    return upload(
      { userId: context.person.userId },
      input.companyId,
      input.input,
    );
  },
  http: {
    method: "POST",
    path: COMPANY_CLAIM_EVIDENCE_PATH,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      input: body,
    }),
    respond: (out) => ClaimEvidenceUploadDtoSchema.parse(out),
    notFound: (out) => out.status === "NOT_FOUND",
  },
  qCapability: "offer.find_my_startup",
});

const EvidenceDone = z.object({ companyId: UuidSchema }).strict();

const CLAIM_EVIDENCE_DONE = definePersonAction<
  z.infer<typeof EvidenceDone>,
  ClaimEvidenceCompleteDto
>({
  name: "company.claim.evidence.complete",
  short: "finish attaching a document",
  area: "gateway",
  classification: "INSTANT",
  does: "Confirms their registry document finished uploading to their claim.",
  input: EvidenceDone,
  output: z.custom<ClaimEvidenceCompleteDto>(),
  run: (ports, context, input) => {
    const complete =
      (ports.companyClaims ?? portMissing("companyClaims")).evidenceComplete ??
      portMissing("companyClaims");
    return complete({ userId: context.person.userId }, input.companyId);
  },
  http: {
    method: "POST",
    path: COMPANY_CLAIM_EVIDENCE_COMPLETE_PATH,
    fromRequest: (params) => ({ companyId: params["companyId"] }),
    respond: (out) => ClaimEvidenceCompleteDtoSchema.parse(out),
    notFound: (out) => out.status === "NOT_FOUND",
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

const Decide = z
  .object({
    companyId: UuidSchema,
    requestId: UuidSchema,
    input: ClaimDecisionRequestSchema,
  })
  .strict();
type DecideOut = ClaimDecisionResultDto | null;

/**
 * P14: a company's admin lets a claimant in (as a Member) or declines,
 * from Settings → Team. Their own decision on their own team's screen; Q
 * offers that screen and never decides who joins.
 */
const DECIDE_CLAIM = defineAppAction<z.infer<typeof Decide>, DecideOut>({
  name: "company.claim.decide",
  short: "answer a company claim",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Lets someone who claimed their company in as a Member, or declines them.",
  input: Decide,
  output: z.custom<DecideOut>(),
  authorize: serviceDecides,
  run: (ports, context, input) => {
    const decide =
      (ports.companyClaims ?? portMissing("companyClaims")).decideAsMember ??
      portMissing("companyClaims");
    return decide(context.actor, input.companyId, input.requestId, input.input);
  },
  targets: () => [],
  card: () => ({ summary: "Answer a company claim", preview: "" }),
  done: (out) =>
    out === null
      ? "That claim isn't one you can answer."
      : out.status === "APPROVED"
        ? "Let in as a Member."
        : "Declined.",
  succeeded: (out) => out !== null,
  http: {
    method: "POST",
    path: COMPANY_CLAIM_DECISION_PATH,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      requestId: params["requestId"],
      input: body,
    }),
    respond: (out) => ClaimDecisionResultDtoSchema.parse(out),
    notFound: (out) => out === null,
  },
  qCapability: "offer.team_manage",
});

export const GATEQ_FIND_ACTIONS: readonly AnyAppAction[] = [
  SAVE_ALERT,
  DECIDE_CLAIM,
];

/** F2: a claim is a person's act, organisation or not. */
export const GATEQ_FIND_PERSON_ACTIONS: readonly AnyPersonAction[] = [
  CLAIM,
  CLAIM_EVIDENCE,
  CLAIM_EVIDENCE_DONE,
];
