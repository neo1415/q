"use client";

import { useId, useState } from "react";

import type { BillingFeatureStandingDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";

import {
  accrueFeesAction,
  assignPlanAction,
  overrideLimitAction,
  setFeeRateAction,
} from "./billing-console-actions";
import { ReasonAction, ResultLine, useConsoleAction } from "./console-ui";

/**
 * BILLING (ADR 0034): the operator's plan controls on an organisation, and
 * the fee ledger's controls. Each write names its reason (kept in the
 * audit log) and asks for a step-up when none is live.
 */

const TRIALS = [
  { value: "", label: "No end date" },
  { value: "14", label: "Trial: 14 days" },
  { value: "30", label: "Trial: 30 days" },
  { value: "90", label: "Trial: 90 days" },
];

export function AssignPlan({
  organisationId,
  currentKey,
  plans,
}: {
  readonly organisationId: string;
  readonly currentKey: string;
  readonly plans: readonly { readonly key: string; readonly name: string }[];
}) {
  const planId = useId();
  const trialId = useId();
  const [planKey, setPlanKey] = useState(currentKey);
  const [trial, setTrial] = useState("");
  const chosen = plans.find((plan) => plan.key === planKey)?.name ?? planKey;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Select
        id={planId}
        label="Plan"
        value={planKey}
        options={plans.map((plan) => ({ value: plan.key, label: plan.name }))}
        onChange={(event) => setPlanKey(event.target.value)}
      />
      <Select
        id={trialId}
        label="Ends"
        value={trial}
        options={TRIALS}
        onChange={(event) => setTrial(event.target.value)}
      />
      <ReasonAction
        label={trial === "" ? "Put on this plan" : "Start trial"}
        title={
          trial === ""
            ? `Put this organisation on ${chosen}?`
            : `Start a ${trial}-day ${chosen} trial?`
        }
        description={
          trial === ""
            ? "Its limits change at once. Usage this month is kept."
            : "At the end it returns to the default plan by itself."
        }
        confirm="Apply"
        variant="primary"
        run={(reason) =>
          assignPlanAction({
            organisationId,
            planKey,
            trialDays: trial === "" ? null : Number(trial),
            reason,
          })
        }
      />
    </div>
  );
}

export function OverrideLimit({
  organisationId,
  feature,
}: {
  readonly organisationId: string;
  readonly feature: BillingFeatureStandingDto;
}) {
  const fieldId = useId();
  const [value, setValue] = useState(
    feature.limit === null ? "" : String(feature.limit),
  );
  const parsed = value.trim() === "" ? null : Number(value);
  const valid =
    parsed === null ||
    (Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Input
        id={fieldId}
        label={`${feature.name} limit`}
        labelHidden
        inputMode="numeric"
        placeholder="Unlimited"
        value={value}
        error={valid ? undefined : "A whole number, or empty for unlimited."}
        onChange={(event) => setValue(event.target.value)}
        className="sm:w-32"
      />
      <ReasonAction
        label="Set limit"
        title={`Set ${feature.name.toLowerCase()} for this organisation?`}
        description={
          parsed === null
            ? "Unlimited for this organisation until reset."
            : `${String(parsed)} ${feature.kind === "MONTHLY" ? "a month " : ""}for this organisation until reset.`
        }
        confirm="Set limit"
        disabled={!valid}
        run={(reason) =>
          overrideLimitAction({
            organisationId,
            featureKey: feature.key,
            limit: parsed,
            revoke: false,
            reason,
          })
        }
      />
      {feature.overridden ? (
        <ReasonAction
          label="Back to plan"
          title={`Return ${feature.name.toLowerCase()} to the plan's limit?`}
          confirm="Reset"
          variant="quiet"
          run={(reason) =>
            overrideLimitAction({
              organisationId,
              featureKey: feature.key,
              limit: null,
              revoke: true,
              reason,
            })
          }
        />
      ) : null}
    </div>
  );
}

export function AccrueFees() {
  const { perform, pending, result } = useConsoleAction();
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        size="compact"
        disabled={pending}
        onClick={() => perform(() => accrueFeesAction())}
      >
        {pending ? "Updating…" : "Update from commitments"}
      </Button>
      <ResultLine result={result} />
    </div>
  );
}

export function SetFeeRate({ current }: { readonly current: number | null }) {
  const fieldId = useId();
  const [value, setValue] = useState(current === null ? "" : String(current));
  const parsed = Number(value);
  const valid =
    value.trim() !== "" &&
    Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= 10_000;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Input
        id={fieldId}
        label="Rate (basis points; 100 = 1%)"
        inputMode="numeric"
        value={value}
        error={
          value.trim() === "" || valid ? undefined : "Between 0 and 10,000."
        }
        onChange={(event) => setValue(event.target.value)}
        className="sm:w-40"
      />
      <ReasonAction
        label="Set rate"
        title={`Set the facilitation fee to ${valid ? `${(parsed / 100).toFixed(2)}%` : "this rate"}?`}
        description="A new schedule version. Entries without a rate are priced now; invoiced entries never change."
        confirm="Set rate"
        variant="primary"
        disabled={!valid}
        run={(reason) => setFeeRateAction({ rateBps: parsed, reason })}
      />
    </div>
  );
}
