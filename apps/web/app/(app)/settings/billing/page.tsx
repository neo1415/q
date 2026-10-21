import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Billing · Settings" };

/**
 * Settings → Billing is now part of Plan and billing (chosen design
 * "Three plans side by side", 2026-10-21): the plans, the person's own
 * plan, payment and invoices are one page. Old links land there.
 */
export default function BillingPage(): never {
  redirect("/settings/plan");
}
