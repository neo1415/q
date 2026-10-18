"use server";

import { z } from "zod";

import {
  ApiProblemError,
  createGateway,
  draftGatewayVersion,
  extractGatewayPolicy,
  listGateways,
  publishGatewayVersion,
} from "@capital-q/api-client";
import {
  GATEQ_MANDATE_TEXT_MAX_CHARS,
  GatewayDraftCriterionSchema,
  type GatewayDto,
  type PolicyExtractionDto,
} from "@capital-q/contracts";

import { apiSession, resolveOwnContext } from "@/features/q/context";

/**
 * The investor organisation's own gateway (CQ-GATE-001), opened with one
 * press: a gateway named for the organisation, a first version that takes
 * applications (OPEN: no screening rules until they add some), published.
 * Every call runs as the member; the API decides whether they may.
 */
export type GatewayResult =
  | { readonly ok: true; readonly gateway: GatewayDto }
  | { readonly ok: false; readonly message: string };

export async function openGatewayAction(): Promise<GatewayResult> {
  const context = await resolveOwnContext();
  const session = await apiSession();
  if (context.kind !== "INVESTOR" || session === null) {
    return {
      ok: false,
      message: "Only an investor organisation has a gateway.",
    };
  }
  const name = context.label ?? "Our fund";
  try {
    const existing = await listGateways(
      session,
      context.investorOrganisationId,
    );
    const gateway =
      existing.gateways.find((item) => item.status === "ACTIVE") ??
      (await createGateway(session, {
        investorOrganisationId: context.investorOrganisationId,
        name,
      }));
    const version = await draftGatewayVersion(session, gateway.id, {
      inboundMode: "OPEN",
      publicTitle: `Apply to ${name}`,
      publicDescription: `Tell Q about your company. ${name} reviews every application.`,
      criteria: [],
    });
    await publishGatewayVersion(session, gateway.id, version.id);
    return { ok: true, gateway };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError &&
        error.status < 500 &&
        error.problem?.detail !== undefined
          ? error.problem.detail
          : "Couldn't open your gateway just now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// P7: the mandate, read into rules the investor confirms, then published
// ---------------------------------------------------------------------------

export type ExtractResult =
  | { readonly ok: true; readonly extraction: PolicyExtractionDto }
  | { readonly ok: false; readonly message: string };

const ClientKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/);

function problemWords(error: unknown, fallback: string): string {
  return error instanceof ApiProblemError &&
    error.status < 500 &&
    error.problem?.detail !== undefined
    ? error.problem.detail
    : fallback;
}

/** The member's own ACTIVE gateway: never an id the browser names. */
async function ownGateway() {
  const context = await resolveOwnContext();
  const session = await apiSession();
  if (context.kind !== "INVESTOR" || session === null) return null;
  const { gateways } = await listGateways(
    session,
    context.investorOrganisationId,
  );
  const gateway = gateways.find((item) => item.status === "ACTIVE");
  return gateway === undefined ? null : { session, gateway, context };
}

export async function extractPolicyAction(input: {
  readonly text: string;
  readonly sourceKind: "PASTED_TEXT" | "UPLOADED_FILE";
  readonly clientRequestId: string;
}): Promise<ExtractResult> {
  const text = input.text.trim().slice(0, GATEQ_MANDATE_TEXT_MAX_CHARS);
  const key = ClientKey.safeParse(input.clientRequestId);
  if (text === "" || !key.success) {
    return { ok: false, message: "Paste your mandate first." };
  }
  try {
    const own = await ownGateway();
    if (own === null) {
      return { ok: false, message: "Open your gateway first." };
    }
    const extraction = await extractGatewayPolicy(own.session, own.gateway.id, {
      text,
      sourceKind:
        input.sourceKind === "UPLOADED_FILE" ? "UPLOADED_FILE" : "PASTED_TEXT",
      clientRequestId: key.data,
    });
    return { ok: true, extraction };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemWords(
        error,
        "Couldn't read that just now. Please try again.",
      ),
    };
  }
}

/**
 * Publish exactly the rules the investor confirmed. The payload is
 * validated against the API's own draft contract here and again there: a
 * rule that reaches GateQ is the one they saw, not the one Q proposed.
 */
export async function publishPolicyAction(
  criteria: unknown,
): Promise<GatewayResult> {
  const parsed = z
    .array(GatewayDraftCriterionSchema)
    .max(64)
    .safeParse(criteria);
  if (!parsed.success) {
    return { ok: false, message: "One of the rules isn't complete." };
  }
  try {
    const own = await ownGateway();
    if (own === null) {
      return { ok: false, message: "Open your gateway first." };
    }
    const name = own.context.label ?? "Our fund";
    const version = await draftGatewayVersion(own.session, own.gateway.id, {
      inboundMode: parsed.data.length === 0 ? "OPEN" : "QUALIFIED",
      publicTitle: `Do we fit? Ask Q about ${name}`,
      publicDescription: `Q checks your company against ${name}'s published mandate. Nothing is shared unless you choose to.`,
      criteria: parsed.data.map((criterion, index) => ({
        ...criterion,
        position: index + 1,
      })),
    });
    await publishGatewayVersion(own.session, own.gateway.id, version.id);
    return { ok: true, gateway: own.gateway };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemWords(
        error,
        "Couldn't publish just now. Please try again.",
      ),
    };
  }
}
