"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";

import type { SiteBlock } from "@capital-q/contracts";

type PricingBlock = Extract<SiteBlock, { type: "pricing" }>;
type Interval = "monthly" | "annual";

/** "2990" → "2,990" in the block's currency, without inventing decimals. */
function formatPrice(amount: string, currency: string): string {
  const [whole = "0", cents] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const symbol =
    currency === "USD" ? "$" : currency === "NGN" ? "₦" : `${currency} `;
  return `${symbol}${grouped}${cents === undefined ? "" : `.${cents.padEnd(2, "0")}`}`;
}

/**
 * Plans side by side with a monthly / yearly switch (decision 107). The
 * switch is a radio group, so it is one Tab stop with arrow keys; the
 * indicator slides between the two (the one motion here, and none when
 * the person asks for reduced motion). A highlighted plan is marked by its
 * border and the words "Most chosen" are not used: the page makes no
 * popularity claim it cannot evidence.
 */
export function PricingPlans({ block }: { readonly block: PricingBlock }) {
  const [interval, setPeriod] = useState<Interval>("monthly");
  const reduce = useReducedMotion();
  const group = useId();
  const hasAnnual = block.plans.some((plan) => plan.annual !== null);
  const showToggle = block.showIntervalToggle && hasAnnual;
  const options: readonly [Interval, string][] = [
    ["monthly", "Monthly"],
    ["annual", "Yearly"],
  ];

  return (
    <section className="flex flex-col gap-5" aria-labelledby={`${group}-title`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2
          id={`${group}-title`}
          className="cq-title-lg text-(--cq-text-primary)"
        >
          {block.title}
        </h2>
        {showToggle ? (
          <div
            role="radiogroup"
            aria-label="Billing period"
            className="relative inline-flex rounded-(--cq-radius-full) border border-(--cq-border) bg-(--cq-surface-subtle) p-1"
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                  event.key,
                )
              ) {
                event.preventDefault();
                const next = interval === "monthly" ? "annual" : "monthly";
                setPeriod(next);
                event.currentTarget
                  .querySelector<HTMLButtonElement>(`[data-interval="${next}"]`)
                  ?.focus();
              }
            }}
          >
            {options.map(([value, label]) => {
              const on = interval === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  data-interval={value}
                  onClick={() => setPeriod(value)}
                  className={`cq-label relative min-h-10 min-w-24 rounded-(--cq-radius-full) px-4 transition-colors duration-(--cq-motion-fast) ${
                    on
                      ? "text-(--cq-text-primary)"
                      : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
                  }`}
                >
                  {on ? (
                    <motion.span
                      layoutId={`${group}-pill`}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-(--cq-radius-full) border border-(--cq-border-subtle) bg-(--cq-surface) shadow-(--cq-shadow-xs)"
                      transition={
                        reduce === true
                          ? { duration: 0 }
                          : { type: "spring", duration: 0.32, bounce: 0.12 }
                      }
                    />
                  ) : null}
                  <span className="relative">{label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <ul
        className={`grid gap-4 ${block.plans.length >= 3 ? "@5xl:grid-cols-3" : "@3xl:grid-cols-2"}`}
      >
        {block.plans.map((plan) => {
          const amount =
            interval === "annual" && plan.annual !== null
              ? plan.annual
              : plan.monthly;
          const per =
            amount === null || amount === "0"
              ? ""
              : interval === "annual" && plan.annual !== null
                ? "a year"
                : "a month";
          return (
            <li
              key={plan.id}
              className={`flex flex-col gap-5 rounded-(--cq-radius-lg) border bg-(--cq-surface) p-6 ${
                plan.highlight
                  ? "border-(--cq-accent) shadow-(--cq-shadow-sm)"
                  : "border-(--cq-border-subtle)"
              }`}
            >
              <div className="flex flex-col gap-2">
                <h3 className="cq-title-sm text-(--cq-text-primary)">
                  {plan.name}
                </h3>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="cq-numeric text-[2rem] leading-none font-semibold tracking-[-0.02em] text-(--cq-text-primary)">
                    {amount === null
                      ? "On request"
                      : formatPrice(amount, block.currency)}
                  </span>
                  {per === "" ? null : (
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {per}
                      {plan.priceNote === "" ? "" : `, ${plan.priceNote}`}
                    </span>
                  )}
                </p>
                {plan.description === "" ? null : (
                  <p className="cq-body-sm text-(--cq-text-secondary)">
                    {plan.description}
                  </p>
                )}
              </div>
              <ul className="flex flex-1 flex-col gap-2.5">
                {plan.perks.map((perk, i) => (
                  <li
                    key={i}
                    className="cq-body-sm flex gap-2.5 text-(--cq-text-primary)"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className="mt-[3px] size-4 shrink-0 text-(--cq-positive)"
                    >
                      <path
                        d="M3.5 8.5l3 3 6-7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
              {plan.ctaLabel !== "" && plan.ctaHref !== "" ? (
                <a
                  href={plan.ctaHref}
                  className={`cq-body-sm inline-flex min-h-11 items-center justify-center rounded-(--cq-radius-md) px-4 font-medium transition-[background-color,transform] duration-(--cq-motion-fast) active:scale-[0.98] ${
                    plan.highlight
                      ? "bg-(--cq-accent) text-(--cq-text-inverse) hover:bg-(--cq-accent-hover)"
                      : "border border-(--cq-border) text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
                  }`}
                >
                  {plan.ctaLabel}
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">
        {interval === "annual"
          ? "Showing yearly prices"
          : "Showing monthly prices"}
      </p>
    </section>
  );
}
