"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { MyInvitationDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import {
  acceptInvitationByIdAction,
  declineInvitationAction,
} from "./team-actions";
import { teamWords } from "./team-words";

const ROLE = { ADMIN: "Admin", MEMBER: "Member" } as const;

/**
 * F2: invitations sent to the signed-in person's verified email, where they
 * land, so joining never depends on finding the email. The list comes from
 * the server, which matched it; Accept and Decline send only the id, and
 * the API checks the email again before acting.
 */
export function PendingInvitationsList({
  items,
}: {
  readonly items: readonly MyInvitationDto[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const shown = items.filter((item) => !gone.includes(item.invitationId));
  if (shown.length === 0) return null;
  return (
    <section
      aria-label="Invitations to join a team"
      className="mx-auto flex w-full max-w-[560px] flex-col gap-3"
      data-pending-invitations
    >
      {shown.map((item) => {
        const words = teamWords(item.kind);
        const inviter =
          item.invitedByName ?? `Someone at ${item.organisationName}`;
        return (
          <div
            key={item.invitationId}
            className="cq-panel flex flex-col gap-3 px-5 py-4"
            data-pending-invitation={item.invitationId}
          >
            <p className="cq-body text-(--cq-text-primary)">
              {inviter} invited you to join {item.organisationName}, their{" "}
              {words.word}, as {ROLE[item.role] === "Admin" ? "an" : "a"}{" "}
              {ROLE[item.role]}.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                className={buttonClassName("primary", "regular")}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const out = await acceptInvitationByIdAction(
                      item.invitationId,
                    );
                    if (!out.ok) {
                      setError(out.message);
                      return;
                    }
                    router.push("/settings/team");
                    router.refresh();
                  });
                }}
                data-pending-invitation-accept
              >
                Join {item.organisationName}
              </button>
              <button
                type="button"
                disabled={pending}
                className={buttonClassName("quiet", "regular")}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const out = await declineInvitationAction(
                      item.invitationId,
                    );
                    if (!out.ok) {
                      setError(out.message);
                      return;
                    }
                    setGone((was) => [...was, item.invitationId]);
                    router.refresh();
                  });
                }}
                data-pending-invitation-decline
              >
                Decline
              </button>
            </div>
          </div>
        );
      })}
      {error === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {error}
        </p>
      )}
    </section>
  );
}
