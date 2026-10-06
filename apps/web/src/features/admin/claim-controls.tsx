"use client";

import { useId, useState } from "react";

import { Input } from "@capital-q/ui/input";

import {
  decideCompanyClaimAction,
  publishCompanyAction,
} from "./console-actions";
import { ReasonAction } from "./console-ui";

/** P14: approve or decline a claim on a company nobody holds. */
export function ClaimDecision({
  requestId,
  companyName,
}: {
  readonly requestId: string;
  readonly companyName: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ReasonAction
        label="Approve"
        title={`Make them the owner of ${companyName}?`}
        description="They become its first owner on Capital Q and can invite their team. Check the evidence first."
        confirm="Approve"
        variant="primary"
        run={(reason) =>
          decideCompanyClaimAction({ requestId, approve: true, reason })
        }
      />
      <ReasonAction
        label="Decline"
        title={`Decline this claim on ${companyName}?`}
        confirm="Decline"
        run={(reason) =>
          decideCompanyClaimAction({ requestId, approve: false, reason })
        }
      />
    </div>
  );
}

/**
 * P14 item 7: an unclaimed real company's profile, public at an external
 * URL or back to the network. The two are different audiences and are
 * named differently everywhere (ADR-001).
 */
export function PublishCompany() {
  const id = useId();
  const [companyId, setCompanyId] = useState("");
  return (
    <div className="flex flex-col gap-3" data-admin-publish>
      <Input
        id={`${id}-company`}
        label="Company id"
        description="From the company's address on Capital Q: /company/<id>. Only a company nobody has claimed."
        value={companyId}
        onChange={(event) => setCompanyId(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <ReasonAction
          label="Make public"
          title="Make this company's profile public?"
          description="Public: anyone with the link can see its declared profile, outside Capital Q. Not the same as visible on the network."
          confirm="Make public"
          variant="primary"
          run={(reason) =>
            publishCompanyAction({ companyId, publicExternal: true, reason })
          }
        />
        <ReasonAction
          label="Back to the network"
          title="Show it to people on Capital Q only?"
          description="Network: only signed-in people on Capital Q can see its profile."
          confirm="Back to the network"
          run={(reason) =>
            publishCompanyAction({ companyId, publicExternal: false, reason })
          }
        />
      </div>
    </div>
  );
}
