"use server";

import { cookies } from "next/headers";

import { loadWebServerConfig } from "@capital-q/config/web";

import { sessionCookieOptions } from "@/auth/cookie-options";
import { WORKSPACE_CHOSEN_COOKIE } from "@/auth/registration";
import { switchOrganisationAction } from "../team/team-actions";

/**
 * The arrival chooser's one action: make the chosen workspace the active
 * context, then remember for this browser session that the choice was made.
 *
 * The switch is the API's, under the person's own session; it refuses an
 * organisation they do not belong to, so the id from the page is a request,
 * never proof. The cookie only stops the chooser re-appearing on every visit
 * to `/`; it carries no organisation and grants nothing.
 */
export async function chooseWorkspaceAction(
  organisationId: string,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly message: string }
> {
  const out = await switchOrganisationAction(organisationId);
  if (!out.ok) return out;
  await rememberWorkspaceChosen();
  return { ok: true };
}

/** "Keep the current one": nothing to switch, the choice is still made. */
export async function keepWorkspaceAction(): Promise<{ readonly ok: true }> {
  await rememberWorkspaceChosen();
  return { ok: true };
}

async function rememberWorkspaceChosen(): Promise<void> {
  const jar = await cookies();
  // A session cookie (no maxAge): once per browser session, not forever.
  jar.set(
    WORKSPACE_CHOSEN_COOKIE,
    "1",
    sessionCookieOptions(loadWebServerConfig().auth),
  );
}
