import type { Metadata } from "next";

import { previewInvitation } from "@capital-q/api-client";
import { InvitationTokenSchema } from "@capital-q/contracts";

import { getSessionUser } from "@/auth/session";
import { apiSession } from "@/features/q/context";
import { JoinCard } from "@/features/team/join-card";
import { loadMyOrganisations } from "@/features/team/load-organisations";

export const metadata: Metadata = { title: "Join your team" };
export const dynamic = "force-dynamic";

/**
 * An invitation's link (G1/G2). Signed-out visitors are sent to sign in or
 * sign up first and come back here. The page reads what the link invites
 * to (the token goes to the API in a header) and offers Join; joining is
 * the API's to allow, as the invited, confirmed email only.
 */
export default async function JoinPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}) {
  const { token } = await params;
  const valid = InvitationTokenSchema.safeParse(token);
  const [session, user, organisations] = await Promise.all([
    apiSession(),
    getSessionUser(),
    loadMyOrganisations(),
  ]);
  const preview =
    !valid.success || session === null
      ? null
      : await previewInvitation(session, valid.data).catch(() => null);
  const current =
    organisations.find((organisation) => organisation.active) ?? null;
  return (
    <JoinCard
      token={valid.success ? valid.data : ""}
      preview={preview}
      signedInAs={user?.email ?? null}
      keeps={current === null ? null : current.name}
      alreadyIn={
        preview !== null &&
        organisations.some(
          (organisation) => organisation.name === preview.organisationName,
        )
      }
    />
  );
}
