"use client";

import { useId, useState } from "react";

import { Button } from "@capital-q/ui/button";
import { Input, Textarea } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";

import { grantRoleAction, revokeRoleAction } from "./console-actions";
import { ReasonAction, ResultLine, useConsoleAction } from "./console-ui";
import { ROLE_WORDS } from "./words";
import { useT } from "@/features/i18n/language";

const ROLE_OPTIONS = Object.entries(ROLE_WORDS).map(([value, label]) => ({
  value,
  label,
}));

/** Give someone a console role, or change theirs (platform owner only). */
export function GrantRole() {
  const t = useT();

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
        label={t("Their Capital Q email")}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Select
        id={roleId}
        label={t("Role")}
        value={role}
        options={ROLE_OPTIONS.map((option) => ({
          ...option,
          label: t(option.label),
        }))}
        onChange={(e) => setRole(e.target.value)}
      />
      <Textarea
        id={reasonId}
        label={t("Reason")}
        description={t("At least 3 characters.")}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={pending || email.length === 0 || reason.trim().length < 3}
        >
          {pending ? t("Saving…") : t("Save role")}
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
  const t = useT();

  return (
    <ReasonAction
      label={t("Remove")}
      title={t(`Remove ${name} from the console?`)}
      description={t("They lose console access at once.")}
      confirm="Remove access"
      variant="danger"
      run={(reason) => revokeRoleAction({ userId, reason })}
    />
  );
}
