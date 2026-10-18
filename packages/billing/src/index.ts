/**
 * @capital-q/billing (ADR 0034, docs/specs/2026-10/billing.md)
 *
 * Owns: the `billing` schema -- plans, features and limits as versioned
 * reference data, plan assignments and overrides, the usage meter and its
 * atomic consume, payment-provider state, and the facilitation-fee ledger;
 * the payment-provider port with its Stripe adapter and a fake.
 *
 * Does not own, and must never decide: what Q may know, what a person may
 * see, or how anything ranks. Entitlement only decides whether metered
 * work starts (PADL #85: Layer 1 diagnosis is never gated; no pay-to-rank).
 * Server-only.
 */

export * from "./catalogue.js";
export * from "./entitlements.js";
export * from "./accounts.js";
export * from "./provider.js";
export * from "./webhooks.js";
export * from "./fees.js";
export * from "./credits.js";

export const PACKAGE_NAME = "@capital-q/billing" as const;
