"use server";

import {
  ApiProblemError,
  createGateway,
  draftGatewayVersion,
  listGateways,
  publishGatewayVersion,
} from "@capital-q/api-client";
import type { GatewayDto } from "@capital-q/contracts";

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
