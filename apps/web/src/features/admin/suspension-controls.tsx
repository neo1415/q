"use client";

import {
  suspendAccountAction,
  suspendOrganisationAction,
} from "./console-actions";
import { ReasonAction } from "./console-ui";
import { useT } from "@/features/i18n/language";

/** Suspend or lift a suspension, with a reason (ADR 0033). */
export function AccountSuspension({
  userId,
  suspended,
  name,
}: {
  readonly userId: string;
  readonly suspended: boolean;
  readonly name: string;
}) {
  const t = useT();

  return suspended ? (
    <ReasonAction
      label={t("Lift suspension")}
      title={t(`Lift ${name}'s suspension?`)}
      description={t("They can sign in and use Capital Q again at once.")}
      confirm="Lift suspension"
      run={(reason) => suspendAccountAction({ userId, suspend: false, reason })}
    />
  ) : (
    <ReasonAction
      label={t("Suspend account")}
      title={t(`Suspend ${name}?`)}
      description={t(
        "Every request they make is refused until the suspension is lifted. Q stops acting for them.",
      )}
      confirm="Suspend account"
      variant="danger"
      run={(reason) => suspendAccountAction({ userId, suspend: true, reason })}
    />
  );
}

export function OrganisationSuspension({
  organisationId,
  name,
}: {
  readonly organisationId: string;
  readonly name: string;
}) {
  const t = useT();

  return (
    <div className="flex flex-wrap gap-2">
      <ReasonAction
        label={t("Suspend all members")}
        title={t(`Suspend every member of ${name}?`)}
        description={t(
          "Each active member is suspended and audited one by one. Your own account is never included.",
        )}
        confirm="Suspend members"
        variant="danger"
        run={(reason) =>
          suspendOrganisationAction({ organisationId, suspend: true, reason })
        }
      />
      <ReasonAction
        label={t("Lift all suspensions")}
        title={t(`Lift suspensions for ${name}?`)}
        confirm="Lift suspensions"
        run={(reason) =>
          suspendOrganisationAction({ organisationId, suspend: false, reason })
        }
      />
    </div>
  );
}
