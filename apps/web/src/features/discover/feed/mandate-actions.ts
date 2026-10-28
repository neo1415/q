"use server";

import {
  activateInvestorMandate,
  listInvestorMandates,
} from "@capital-q/api-client";

import { apiSession, resolveOwnContext } from "@/features/q/context";

export type StartDiscoverResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * "Show me companies now" (owner 2026-10-28): an investor who has started
 * their mandate but not finished it switches Discover on with what they
 * have told Q so far. Their tap is the declaration: the draft mandate they
 * defined becomes active through the Investor domain's own transition
 * (capability, version, audit, event), under their own session. Later
 * answers keep refining the same mandate; nothing is inferred or filled in.
 *
 * The organisation comes from the server's own resolution of who they
 * are, never from the browser.
 */
export async function startDiscoverWithMandateSoFarAction(): Promise<StartDiscoverResult> {
  const [context, session] = await Promise.all([
    resolveOwnContext(),
    apiSession(),
  ]);
  if (session === null) {
    return { ok: false, message: "You are signed out. Sign in and try again." };
  }
  if (context.kind !== "INVESTOR") {
    return { ok: false, message: "Discover ranks companies for investors." };
  }
  try {
    const active = await listInvestorMandates(
      session,
      context.investorOrganisationId,
      { status: "ACTIVE", limit: 1 },
    );
    if (active.items.length > 0) return { ok: true };
    const drafts = await listInvestorMandates(
      session,
      context.investorOrganisationId,
      { status: "DRAFT", limit: 2 },
    );
    const draft = drafts.items[0];
    // Several drafts: which one to switch on is theirs to say, in setup.
    if (draft === undefined || drafts.items.length > 1) {
      return {
        ok: false,
        message: "Choose which mandate to use in your setup first.",
      };
    }
    await activateInvestorMandate(
      session,
      context.investorOrganisationId,
      draft.id,
      { expectedVersion: draft.version },
    );
    return { ok: true };
  } catch {
    return {
      ok: false,
      message:
        "Discover couldn't be switched on just now. Try again in a moment.",
    };
  }
}
