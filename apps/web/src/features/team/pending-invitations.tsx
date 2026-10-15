import { getMyInvitations } from "@capital-q/api-client";
import type { MyInvitationDto } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

import { PendingInvitationsList } from "./pending-invitations-list";

/**
 * F2: the invitee's pending invitations, read on the server under their own
 * session. The API matches them to the verified sign-in email; nothing the
 * browser says names an address. Unreadable is the same as none: a banner
 * that cannot load must never block the page it sits on.
 */
export async function loadMyInvitations(): Promise<readonly MyInvitationDto[]> {
  const session = await apiSession();
  if (session === null) return [];
  try {
    return (await getMyInvitations(session)).items;
  } catch {
    return [];
  }
}

export async function PendingInvitations() {
  const items = await loadMyInvitations();
  return items.length === 0 ? null : <PendingInvitationsList items={items} />;
}
