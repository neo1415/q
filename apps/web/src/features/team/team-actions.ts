"use server";

import { revalidatePath } from "next/cache";

import {
  acceptInvitation,
  ApiProblemError,
  changeTeamRole,
  decideTeamJoinRequest,
  inviteToTeam,
  leaveTeam,
  offerTeamOwnership,
  removeTeamMember,
  resendTeamInvitation,
  respondToTeamOwnership,
  requestToJoin,
  revokeTeamInvitation,
  switchOrganisation,
} from "@capital-q/api-client";
import {
  InvitableRoleSchema,
  InvitationTokenSchema,
  UuidSchema,
  type InviteResultDto,
  type TeamDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * G1/G2: the Team page's changes. Server actions, so the session token
 * never reaches the browser. Everything here is input to the API, which
 * acts in the person's own active organisation and decides, from their
 * role on the server, whether they may; nothing the browser says is trust.
 */

export type TeamActionResult<T = TeamDto> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const SIGN_IN = "Please sign in again to continue.";

async function run<T>(
  work: (
    session: NonNullable<Awaited<ReturnType<typeof apiSession>>>,
  ) => Promise<T>,
): Promise<TeamActionResult<T>> {
  const session = await apiSession();
  if (session === null) return { ok: false, message: SIGN_IN };
  try {
    const value = await work(session);
    revalidatePath("/settings/team");
    return { ok: true, value };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError) {
      if (error.status === 404) {
        return {
          ok: false,
          message:
            "That isn't on your team any more. Reload to see it as it is.",
        };
      }
      if (error.problem?.detail !== undefined) {
        return { ok: false, message: error.problem.detail };
      }
    }
    return { ok: false, message: "That didn't go through. Please try again." };
  }
}

const id = (value: string) => UuidSchema.safeParse(value).success;
const BAD = {
  ok: false as const,
  message: "That didn't go through. Reload and try again.",
};

export async function inviteAction(
  emails: readonly string[],
  role: string,
  message: string,
): Promise<TeamActionResult<InviteResultDto>> {
  const parsedRole = InvitableRoleSchema.safeParse(role);
  if (!parsedRole.success || emails.length === 0) {
    return { ok: false, message: "Add at least one email address." };
  }
  return run((session) =>
    inviteToTeam(session, {
      emails: emails.slice(0, 20),
      role: parsedRole.data,
      ...(message.trim() === ""
        ? {}
        : { message: message.trim().slice(0, 500) }),
    }),
  );
}

export async function resendAction(invitationId: string) {
  return id(invitationId)
    ? run((s) => resendTeamInvitation(s, invitationId))
    : BAD;
}

export async function revokeAction(invitationId: string) {
  return id(invitationId)
    ? run((s) => revokeTeamInvitation(s, invitationId))
    : BAD;
}

export async function changeRoleAction(membershipId: string, role: string) {
  const parsed = InvitableRoleSchema.safeParse(role);
  return id(membershipId) && parsed.success
    ? run((s) => changeTeamRole(s, membershipId, parsed.data))
    : BAD;
}

export async function removeAction(
  membershipId: string,
  handOverTo: string | null,
) {
  return id(membershipId) && (handOverTo === null || id(handOverTo))
    ? run((s) => removeTeamMember(s, membershipId, handOverTo))
    : BAD;
}

export async function leaveAction() {
  const out = await run((s) => leaveTeam(s));
  if (out.ok) revalidatePath("/", "layout");
  return out;
}

export async function offerOwnershipAction(membershipId: string) {
  return id(membershipId)
    ? run((s) => offerTeamOwnership(s, membershipId))
    : BAD;
}

export async function respondOwnershipAction(offerId: string, accept: boolean) {
  return id(offerId)
    ? run((s) => respondToTeamOwnership(s, offerId, accept))
    : BAD;
}

export async function decideJoinAction(requestId: string, approve: boolean) {
  return id(requestId)
    ? run((s) => decideTeamJoinRequest(s, requestId, approve))
    : BAD;
}

/** Switching: the server sets who they act for, from their own membership. */
/**
 * F8: ask a company's admins to let them in, from "Find my startup". A
 * person action: it works before they belong anywhere. The answer is the
 * same whether or not the organisation exists; admins decide on Team.
 */
export async function askToJoinAction(
  organisationId: string,
  message: string,
): Promise<TeamActionResult<{ readonly requested: true }>> {
  if (!id(organisationId)) return BAD;
  const note = message.trim().slice(0, 500);
  return run((s) =>
    requestToJoin(s, organisationId, note === "" ? undefined : note),
  );
}

export async function switchOrganisationAction(organisationId: string) {
  if (!id(organisationId)) return BAD;
  const out = await run((s) => switchOrganisation(s, organisationId));
  if (out.ok) revalidatePath("/", "layout");
  return out.ok ? { ok: true as const, value: null } : out;
}

export async function acceptInvitationAction(token: string) {
  if (!InvitationTokenSchema.safeParse(token).success) return BAD;
  const out = await run((s) => acceptInvitation(s, token));
  if (out.ok) revalidatePath("/", "layout");
  return out;
}
