"use client";

import {
  suspendAccountAction,
  suspendOrganisationAction,
} from "./console-actions";
import { ReasonAction } from "./console-ui";

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
  return suspended ? (
    <ReasonAction
      label="Lift suspension"
      title={`Lift ${name}'s suspension?`}
      description="They can sign in and use Capital Q again at once."
      confirm="Lift suspension"
      run={(reason) => suspendAccountAction({ userId, suspend: false, reason })}
    />
  ) : (
    <ReasonAction
      label="Suspend account"
      title={`Suspend ${name}?`}
      description="Every request they make is refused until the suspension is lifted. Q stops acting for them."
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
  return (
    <div className="flex flex-wrap gap-2">
      <ReasonAction
        label="Suspend all members"
        title={`Suspend every member of ${name}?`}
        description="Each active member is suspended and audited one by one. Your own account is never included."
        confirm="Suspend members"
        variant="danger"
        run={(reason) =>
          suspendOrganisationAction({ organisationId, suspend: true, reason })
        }
      />
      <ReasonAction
        label="Lift all suspensions"
        title={`Lift suspensions for ${name}?`}
        confirm="Lift suspensions"
        run={(reason) =>
          suspendOrganisationAction({ organisationId, suspend: false, reason })
        }
      />
    </div>
  );
}
