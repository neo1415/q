"use client";

import { setFlagAction } from "./console-actions";
import { ReasonAction } from "./console-ui";
import { flagName } from "./flag-names";
import { useT } from "@/features/i18n/language";

export function FlagToggle({
  flagKey,
  enabled,
}: {
  readonly flagKey: string;
  readonly enabled: boolean;
}) {
  const t = useT();

  const name = flagName(flagKey);
  return enabled ? (
    <ReasonAction
      label={t("Turn off")}
      title={t(`Turn off ${name}?`)}
      description={t(
        "No new step starts while it's off. Work in progress stops at its next step.",
      )}
      confirm="Turn off"
      variant="danger"
      run={(reason) => setFlagAction({ key: flagKey, enabled: false, reason })}
    />
  ) : (
    <ReasonAction
      label={t("Turn on")}
      title={t(`Turn ${name} back on?`)}
      confirm="Turn on"
      variant="primary"
      run={(reason) => setFlagAction({ key: flagKey, enabled: true, reason })}
    />
  );
}
