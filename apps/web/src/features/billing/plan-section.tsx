import "server-only";

import { getMyPlan, getPlanCatalogue } from "@capital-q/api-client";

import { serverT } from "@/features/i18n/server";
import { apiSession, resolveOwnContext } from "@/features/q/context";

import type { PlanSide } from "./plan-board";
import { PlanView } from "./plan-view";

/**
 * The Plan screen with its reads (BILLING, ADR 0034), shared by Settings →
 * Plan and Organisation → Plan and billing. The account's plan comes from
 * the billing service; nothing here charges anyone.
 */
export async function PlanSection({
  checkoutDone,
  back,
}: {
  readonly checkoutDone: boolean;
  readonly back?: { readonly href: string; readonly label: string } | null;
}) {
  const t = await serverT();
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  const [plan, catalogue] =
    session === null
      ? [null, null]
      : await Promise.all([
          getMyPlan(session).catch(() => null),
          getPlanCatalogue(session).catch(() => null),
        ]);
  const side: PlanSide =
    context.kind === "FOUNDER" || context.kind === "INVESTOR"
      ? context.kind
      : null;
  return (
    <PlanView
      t={t}
      plan={plan}
      catalogue={catalogue}
      side={side}
      accountName={context.kind === "NONE" ? null : context.label}
      checkoutDone={checkoutDone}
      {...(back === undefined ? {} : { back })}
    />
  );
}
