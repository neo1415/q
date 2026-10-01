"use client";

import { setFlagAction } from "./console-actions";
import { ReasonAction } from "./console-ui";

const NAMES: Readonly<Record<string, string>> = {
  "q.autonomy.errands": "Let Q handle this (errands)",
  "q.autonomy.delegations": "Standing delegations",
  "q.daily": "The Q Daily",
};

export function flagName(key: string): string {
  return NAMES[key] ?? key;
}

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
