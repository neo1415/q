"use client";

import { useId, useState } from "react";

import { Button } from "@capital-q/ui/button";
import { Input, Textarea } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";

import { grantRoleAction, revokeRoleAction } from "./console-actions";
import { ReasonAction, ResultLine, useConsoleAction } from "./console-ui";
import { ROLE_WORDS } from "./words";

const ROLE_OPTIONS = Object.entries(ROLE_WORDS).map(([value, label]) => ({
  value,
  label,
}));

/** Give someone a console role, or change theirs (platform owner only). */
export function GrantRole() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("support");
  const [reason, setReason] = useState("");
  const { perform, pending, result } = useConsoleAction();
  const emailId = useId();
  const roleId = useId();
  const reasonId = useId();
  return (
    <form
      className="flex max-w-(--cq-layout-narrow) flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        perform(
          () => grantRoleAction({ email, role, reason }),
          () => {
            setEmail("");
            setReason("");
          },
        );
      }}
    >
      <Input
        id={emailId}
        label="Their Capital Q email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Select
        id={roleId}
        label="Role"
        value={role}
        options={ROLE_OPTIONS}
        onChange={(e) => setRole(e.target.value)}
      />
      <Textarea
        id={reasonId}
        label="Reason"
        description="At least 3 characters."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={pending || email.length === 0 || reason.trim().length < 3}
        >
          {pending ? "Saving…" : "Save role"}
        </Button>
      </div>
      <ResultLine result={result} />
    </form>
  );
}

export function RevokeRole({
  userId,
  name,
}: {
  readonly userId: string;
  readonly name: string;
}) {
  return (
    <ReasonAction
      label="Remove"
      title={`Remove ${name} from the console?`}
      description="They lose console access at once."
      confirm="Remove access"
      variant="danger"
      run={(reason) => revokeRoleAction({ userId, reason })}
    />
  );
}
