"use client";

import { setFlagAction } from "./console-actions";
import { ReasonAction } from "./console-ui";
import { flagName } from "./flag-names";

export function FlagToggle({
  flagKey,
  enabled,
}: {
  readonly flagKey: string;
  readonly enabled: boolean;
}) {
  const name = flagName(flagKey);
  return enabled ? (
    <ReasonAction
      label="Turn off"
      title={`Turn off ${name}?`}
      description="No new step starts while it's off. Work in progress stops at its next step."
      confirm="Turn off"
      variant="danger"
      run={(reason) => setFlagAction({ key: flagKey, enabled: false, reason })}
    />
  ) : (
    <ReasonAction
      label="Turn on"
      title={`Turn ${name} back on?`}
      confirm="Turn on"
      variant="primary"
      run={(reason) => setFlagAction({ key: flagKey, enabled: true, reason })}
    />
  );
}
