"use client";

import { useState, useTransition } from "react";

import { Button } from "@capital-q/ui/button";

import { checkoutAction, portalAction } from "./billing-actions";

/**
 * BILLING (ADR 0034): the plan page's two writes. Both leave for the
 * payment provider's own hosted page; Capital Q never sees a card.
 */
export function ChoosePlanButton({
  planKey,
  planName,
}: {
  readonly planKey: string;
  readonly planName: string;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="compact"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          start(async () => {
            const result = await checkoutAction(planKey);
            if (result.ok) window.location.assign(result.url);
            else setMessage(result.message);
          });
        }}
      >
        {pending ? "Opening checkout…" : `Choose ${planName}`}
      </Button>
      {message === null ? null : (
        <p role="alert" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}

export function ManageBillingButton() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        size="compact"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          start(async () => {
            const result = await portalAction();
            if (result.ok) window.location.assign(result.url);
            else setMessage(result.message);
          });
        }}
      >
        {pending ? "Opening…" : "Manage billing"}
      </Button>
      {message === null ? null : (
        <p role="alert" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}
