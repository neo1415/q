import type { Metadata } from "next";

import { getMyInvitations, previewInvitation } from "@capital-q/api-client";
import { InvitationTokenSchema } from "@capital-q/contracts";

import { getSessionUser } from "@/auth/session";
import { apiSession } from "@/features/q/context";
import { JoinCard } from "@/features/team/join-card";
import { loadMyOrganisations } from "@/features/team/load-organisations";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

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
  const t = await serverT();
  const { token } = await params;
  const valid = InvitationTokenSchema.safeParse(token);
  const [session, user, organisations] = await Promise.all([
    apiSession(),
    getSessionUser(),
    loadMyOrganisations(),
  ]);
  const [preview, mine] =
    !valid.success || session === null
      ? [null, null]
      : await Promise.all([
          previewInvitation(session, valid.data).catch(() => null),
          // Their own invitations (to their verified email): the same one
          // there carries its id for Decline, and when it expires.
          getMyInvitations(session)
            .then((out) => out.items)
            .catch(() => null),
        ]);
  const own =
    preview === null || preview.state !== "PENDING"
      ? null
      : (mine?.find(
          (item) =>
            item.organisationName === preview.organisationName &&
            item.role === preview.role,
        ) ?? null);
  const current =
    organisations.find((organisation) => organisation.active) ?? null;
  return (
    <QSection
      id="invitation"
      kind="OTHER"
      total={0}
      label={t("an invitation to join")}
    >
      <JoinCard
        token={valid.success ? valid.data : ""}
        preview={preview}
        signedInAs={user?.email ?? null}
        invitation={
          own === null
            ? null
            : { invitationId: own.invitationId, expiresAt: own.expiresAt }
        }
        keeps={current === null ? null : current.name}
        alreadyIn={
          preview !== null &&
          organisations.some(
            (organisation) => organisation.name === preview.organisationName,
          )
        }
      />
    </QSection>
  );
}
