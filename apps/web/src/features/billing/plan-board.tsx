"use client";

import { useId, useRef, useState } from "react";

import type {
  BillingAccountPlanDto,
  BillingCatalogueDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Check, ICON_SIZE, ICON_STROKE, X } from "@capital-q/ui/icons";

import { CrmSheet, Tag } from "@/features/relationships/crm-kit";
import { requestReviewAction } from "@/features/reviews/review-actions";
import {
  accountButton,
  Field,
  fieldClassName,
  Pending,
  useAccountToast,
} from "@/features/settings/account-kit";
import { useT } from "@/features/i18n/language";

import { checkoutAction, portalAction } from "./billing-actions";
import { PLAN_TIERS, tierPrice, type PlanTier } from "./plan-tiers";

/**
 * Plan and billing (chosen design "Three plans side by side",
 * 2026-10-21): the three tiers in one row, the same kind of rows in each
 * (included or not, limits as plain numbers), the person's own plan marked
 * in words. The tier names and prices are the labelled preview in
 * plan-tiers.ts; what each includes is the billing catalogue's own answer
 * (ADR 0034). Checkout and the billing portal are the payment provider's
 * hosted pages; "Talk to us" goes to a person at Capital Q as a request
 * they answer, and nothing is charged by asking.
 */

export type PlanSide = "FOUNDER" | "INVESTOR" | null;

type Row = {
  readonly key: string;
  readonly name: string;
  readonly value: string;
  readonly included: boolean;
};

/** A tier's rows: the catalogue's features for its plan, else its highlights. */
export function tierRows(
  tier: PlanTier,
  catalogue: BillingCatalogueDto | null,
): readonly Row[] {
  const plan = catalogue?.plans.find((candidate) =>
    tier.planKeys.includes(candidate.key),
  );
  if (plan === undefined) {
    return tier.highlights.map((line) => ({
      key: line,
      name: line,
      value: "Included",
      included: true,
    }));
  }
  return plan.features.map((feature) => ({
    key: feature.key,
    name: feature.name,
    included: feature.included,
    value: !feature.included
      ? "Not included"
      : feature.kind === "ACCESS"
        ? "Included"
        : feature.limit === null
          ? feature.kind === "VALUE"
            ? "No limit"
            : "Unlimited"
          : `Up to ${String(feature.limit)}`,
  }));
}

/** Which mark a tier carries, in words: never colour alone. */
export function tierMark(
  tier: PlanTier,
  current: boolean,
  side: PlanSide,
): "YOURS" | "TEAMS" | "OTHER_SIDE" | "YOUR_SIDE" {
  if (current) return "YOURS";
  if (tier.key === "fund") return "TEAMS";
  if (side !== null && tier.suits !== side) return "OTHER_SIDE";
  return "YOUR_SIDE";
}

export function PlanBoard({
  plan,
  catalogue,
  side,
  accountName,
  reviewSheet,
}: {
  readonly plan: BillingAccountPlanDto;
  readonly catalogue: BillingCatalogueDto | null;
  readonly side: PlanSide;
  /** The company or firm the plan belongs to, for the billing sheet. */
  readonly accountName: string | null;
  /** Design review only (/dev/account-review): a sheet, open. */
  readonly reviewSheet?: "billing" | "talk" | undefined;
}) {
  const t = useT();
  const toast = useAccountToast();
  const [sheet, setSheet] = useState<
    | { readonly kind: "billing" }
    | { readonly kind: "talk"; readonly tier: PlanTier }
    | null
  >(
    reviewSheet === "billing"
      ? { kind: "billing" }
      : reviewSheet === "talk"
        ? { kind: "talk", tier: PLAN_TIERS.tiers[2] }
        : null,
  );
  return (
    <>
      <ul
        className="cq-crm-stagger m-0 grid list-none grid-cols-1 items-stretch gap-4 p-0 lg:grid-cols-3"
        data-plan-tiers
      >
        {PLAN_TIERS.tiers.map((tier) => {
          const current = (tier.planKeys as readonly string[]).includes(
            plan.plan.key,
          );
          const mark = tierMark(tier, current, side);
          return (
            <li
              key={tier.key}
              className={cx(
                "relative flex flex-col gap-3 rounded-[14px] border bg-(--cq-surface-raised) p-[22px]",
                current
                  ? "border-(--cq-accent)/60 shadow-[inset_0_3px_0_var(--cq-accent)]"
                  : "border-(--cq-border-subtle)",
              )}
              data-plan-tier={tier.key}
              data-plan-current={current ? "" : undefined}
            >
              <span className="self-start">
                {mark === "YOURS" ? (
                  <Tag tone="accent" icon={<Check aria-hidden="true" />}>
                    {t("Your plan")}
                  </Tag>
                ) : mark === "TEAMS" ? (
                  <Tag tone="stone">{t("For teams")}</Tag>
                ) : mark === "OTHER_SIDE" ? (
                  <Tag tone="dash">{t("Other side")}</Tag>
                ) : (
                  <Tag tone="stone">{t("For you")}</Tag>
                )}
              </span>
              <h2 className="m-0 text-xl font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
                {t(tier.name)}
              </h2>
              <p className="m-0 min-h-10 text-sm text-(--cq-text-secondary)">
                {t(tier.forWhom)}
              </p>
              <span className="text-[22px] font-semibold tracking-[-0.01em] text-(--cq-text-primary) tabular-nums">
                {tier.monthly === null
                  ? t("Talk to us")
                  : `${tierPrice(tier.monthly)} ${t("a month")}`}
              </span>
              <ul className="m-0 flex list-none flex-col p-0">
                {tierRows(tier, catalogue).map((row) => (
                  <li
                    key={row.key}
                    className={cx(
                      "flex items-start gap-2.5 border-t border-(--cq-border-subtle) py-2 text-sm",
                      row.included
                        ? "text-(--cq-text-primary)"
                        : "text-(--cq-text-tertiary)",
                    )}
                    data-plan-row={row.included ? "included" : "not-included"}
                  >
                    <span
                      className={cx(
                        "mt-px inline-flex",
                        row.included
                          ? "text-(--cq-positive)"
                          : "text-(--cq-text-tertiary)",
                      )}
                    >
                      {row.included ? (
                        <Check
                          size={ICON_SIZE.compact}
                          strokeWidth={ICON_STROKE}
                          aria-hidden="true"
                        />
                      ) : (
                        <X
                          size={ICON_SIZE.compact}
                          strokeWidth={ICON_STROKE}
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="min-w-0">{row.name}</span>
                    <span className="ms-auto text-[13px] whitespace-nowrap text-(--cq-text-secondary)">
                      {t(row.value)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-1">
                {mark === "YOURS" ? (
                  <button
                    type="button"
                    className={accountButton("secondary", "regular", "w-full")}
                    onClick={() => setSheet({ kind: "billing" })}
                    data-plan-manage
                  >
                    {t("Manage billing")}
                  </button>
                ) : mark === "OTHER_SIDE" ? (
                  <button
                    type="button"
                    className={accountButton("secondary", "regular", "w-full")}
                    onClick={() =>
                      toast(
                        side === "INVESTOR"
                          ? t(
                              "Founder plans are for companies raising. Your workspace is an investor workspace.",
                            )
                          : t(
                              "Investor plans are for people investing. Your workspace is a company workspace.",
                            ),
                      )
                    }
                    data-plan-other-side
                  >
                    {t("Not for your side")}
                  </button>
                ) : mark === "YOUR_SIDE" &&
                  plan.checkoutAvailable &&
                  plan.canManage ? (
                  <CheckoutButton tier={tier} catalogue={catalogue} />
                ) : (
                  <button
                    type="button"
                    className={accountButton("primary", "regular", "w-full")}
                    onClick={() => setSheet({ kind: "talk", tier })}
                    disabled={!plan.canManage}
                    data-plan-talk={tier.key}
                  >
                    {t("Talk to us")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {plan.canManage ? null : (
        <p className="mt-3 text-xs text-(--cq-text-tertiary)">
          {t("An admin of your organisation can change its plan.")}
        </p>
      )}
      <BillingSheet
        open={sheet?.kind === "billing"}
        onClose={() => setSheet(null)}
        plan={plan}
        accountName={accountName}
      />
      <TalkSheet
        tier={sheet?.kind === "talk" ? sheet.tier : null}
        planName={plan.plan.name}
        onClose={() => setSheet(null)}
        onSent={() => {
          setSheet(null);
          toast(t("Sent. A person at Capital Q will reply."));
        }}
      />
    </>
  );
}

/** Self-serve checkout for the tier's plan, on the provider's own page. */
function CheckoutButton({
  tier,
  catalogue,
}: {
  readonly tier: PlanTier;
  readonly catalogue: BillingCatalogueDto | null;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const planKey =
    catalogue?.plans.find(
      (candidate) =>
        candidate.selfServe && tier.planKeys.includes(candidate.key),
    )?.key ?? null;
  if (planKey === null) return null;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={accountButton("primary", "regular", "w-full")}
        disabled={pending}
        aria-busy={pending}
        data-plan-checkout={planKey}
        onClick={() => {
          setPending(true);
          setMessage(null);
          void checkoutAction(planKey).then((result) => {
            if (result.ok) {
              window.location.assign(result.url);
              return;
            }
            setPending(false);
            setMessage(result.message);
          });
        }}
      >
        {pending ? (
          <Pending>{t("Opening checkout…")}</Pending>
        ) : (
          `${t("Choose")} ${t(tier.name)}`
        )}
      </button>
      {message === null ? null : (
        <p role="alert" className="m-0 text-xs text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * Payment method and invoices live with the payment provider; this sheet
 * says so and opens its page in a new tab. Without a provider account it
 * says plainly that none is on file.
 */
function BillingSheet({
  open,
  onClose,
  plan,
  accountName,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly plan: BillingAccountPlanDto;
  readonly accountName: string | null;
}) {
  const t = useT();
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const portal = plan.hasBillingCustomer && plan.canManage;
  const openPortal = () => {
    setPhase("pending");
    setMessage(null);
    // The tab opens on the press, so no blocker stops it; the address
    // arrives when the provider has minted it.
    const tab = window.open("", "_blank");
    void portalAction().then((result) => {
      if (!result.ok) {
        tab?.close();
        setPhase("idle");
        setMessage(result.message);
        return;
      }
      if (tab === null) window.location.assign(result.url);
      else tab.location.href = result.url;
      setPhase("done");
    });
  };
  const portalButton = (label: string) => (
    <button
      type="button"
      className={accountButton(
        phase === "done" ? "done" : "secondary",
        "sm",
        "self-start",
      )}
      disabled={phase !== "idle"}
      aria-busy={phase === "pending"}
      onClick={openPortal}
      data-plan-portal
    >
      {phase === "pending" ? (
        <Pending>{t("Opening checkout…")}</Pending>
      ) : phase === "done" ? (
        <>
          <Check size={14} aria-hidden="true" />
          {t("Checkout opened in a new tab")}
        </>
      ) : (
        label
      )}
    </button>
  );
  return (
    <CrmSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          setPhase("idle");
        }
      }}
      title={t("Billing")}
      sub={accountName ?? undefined}
      data-plan-billing-sheet
    >
      <section className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]">
        <h3 className="m-0 text-[13px] font-medium text-(--cq-text-secondary)">
          {t("Payment method")}
        </h3>
        {portal ? (
          <>
            <p className="m-0 text-[15px] text-(--cq-text-primary)">
              {t("Kept by our payment provider. Capital Q never sees a card.")}
            </p>
            {portalButton(t("Update in checkout"))}
          </>
        ) : (
          <p className="m-0 text-[15px] text-(--cq-text-secondary)">
            {plan.hasBillingCustomer
              ? t("An admin of your organisation manages payment.")
              : t(
                  "None on file. Online payment isn't switched on yet, and nothing is charged.",
                )}
          </p>
        )}
      </section>
      <section className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]">
        <h3 className="m-0 text-[13px] font-medium text-(--cq-text-secondary)">
          {t("Invoices")}
        </h3>
        <p className="m-0 text-[15px] text-(--cq-text-secondary)">
          {portal
            ? t("Your invoices are kept with our payment provider, as PDFs.")
            : t("None yet.")}
        </p>
      </section>
      {message === null ? null : (
        <p role="alert" className="m-0 text-sm text-(--cq-text-primary)">
          {message}
        </p>
      )}
    </CrmSheet>
  );
}

/**
 * "Talk to us": a short request a person at Capital Q answers (the human
 * review queue, as "something else"), so the plan changes only when they
 * agree it with the person. Nothing is charged by asking.
 */
function TalkSheet({
  tier,
  planName,
  onClose,
  onSent,
}: {
  readonly tier: PlanTier | null;
  readonly planName: string;
  readonly onClose: () => void;
  readonly onSent: () => void;
}) {
  const t = useT();
  const seatsId = useId();
  const notesId = useId();
  const [seats, setSeats] = useState("");
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const attempt = useRef<string | null>(null);
  const [seen, setSeen] = useState<PlanTier | null>(null);
  if (tier !== seen) {
    setSeen(tier);
    setSeats("");
    setNotes("");
    setPhase("idle");
    setMessage(null);
  }
  const people = Number.parseInt(seats, 10);
  const ready = Number.isInteger(people) && people >= 1 && people <= 10_000;
  return (
    <CrmSheet
      open={tier !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={
        tier === null
          ? t("Talk to us")
          : `${t("Talk to us about")} ${t(tier.name)}`
      }
      sub={tier?.key === "fund" ? t("Seats for the whole team") : t(planName)}
      data-plan-talk-sheet
    >
      <p className="m-0 text-[15px] leading-[1.55] text-(--cq-text-primary)">
        {t(
          "A person at Capital Q replies within 3 days. Your current plan keeps working meanwhile, and nothing is charged by asking.",
        )}
      </p>
      <Field label={t("How many people would use it?")} htmlFor={seatsId}>
        <input
          id={seatsId}
          inputMode="numeric"
          value={seats}
          onChange={(event) =>
            setSeats(event.target.value.replace(/[^\d]/gu, "").slice(0, 5))
          }
          className={fieldClassName}
        />
      </Field>
      <Field label={t("Anything we should know?")} htmlFor={notesId}>
        <textarea
          id={notesId}
          value={notes}
          maxLength={1500}
          placeholder={t("Optional")}
          onChange={(event) => setNotes(event.target.value)}
          className={cx(fieldClassName, "min-h-[84px] resize-y")}
        />
      </Field>
      {message === null ? null : (
        <p role="alert" className="m-0 text-sm text-(--cq-text-primary)">
          {message}
        </p>
      )}
      <button
        type="button"
        className={accountButton(phase === "done" ? "done" : "primary")}
        disabled={phase !== "idle" || !ready || tier === null}
        aria-busy={phase === "pending"}
        data-plan-talk-send
        onClick={() => {
          if (tier === null) return;
          attempt.current ??= crypto.randomUUID();
          setPhase("pending");
          setMessage(null);
          void requestReviewAction({
            subjectType: "OTHER",
            subjectRef: `plan:${tier.key}`,
            reason: planEnquiry(tier.name, people, notes),
            attemptKey: attempt.current,
          }).then((result) => {
            if (!result.ok) {
              setPhase("idle");
              setMessage(result.message);
              return;
            }
            attempt.current = null;
            setPhase("done");
            setTimeout(onSent, 700);
          });
        }}
      >
        {phase === "pending" ? (
          <Pending>{t("Sending…")}</Pending>
        ) : phase === "done" ? (
          <>
            <Check size={14} aria-hidden="true" />
            {t("Sent")}
          </>
        ) : (
          t("Send")
        )}
      </button>
    </CrmSheet>
  );
}

/** The request in the person's terms, for the person who answers it. */
export function planEnquiry(
  tierName: string,
  people: number,
  notes: string,
): string {
  const line = `Plan enquiry: ${tierName}, for ${String(people)} ${people === 1 ? "person" : "people"}.`;
  const extra = notes.trim();
  return (extra === "" ? line : `${line} ${extra}`).slice(0, 2000);
}
