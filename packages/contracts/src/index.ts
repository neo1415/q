/**
 * @capital-q/contracts
 *
 * Owns: the code-first TypeScript + Zod contracts shared across every Capital Q
 * deployable — HTTP API, domain events, jobs, Q runs, integrations, providers.
 * Does not own: domain behaviour, persistence, or transport.
 *
 * Every runtime schema here is the authority for its type: the TypeScript type
 * is inferred from the schema so the two cannot drift.
 *
 * These are technical wire primitives. They deliberately carry no product
 * semantics: there is no generic Score, no base Entity every domain extends, no
 * universal response wrapper and no metadata escape hatch, because Capital Q
 * depends on keeping Readiness, Fit, Interest and Outcome distinct rather than
 * collapsing them into shared shapes.
 *
 * Validation is not authorization. A well-formed identifier, cursor, tenant
 * UUID or Money value proves shape only; permission is resolved separately from
 * authenticated identity, membership and resource ownership.
 *
 * The package has no dependency on apps, the database, or observability, so it
 * can be imported anywhere without a cycle.
 */

export * from "./common/index.js";
export * from "./http/index.js";
export * from "./messaging/index.js";
export * from "./evidence/index.js";
export * from "./events/index.js";
export * from "./jobs/index.js";

export const PACKAGE_NAME = "@capital-q/contracts" as const;

/**
 * Version of the contract surface the consuming service was built against.
 * Reported in service readiness metadata (doc 21, 129) so a deployed process
 * can be traced back to the contracts it compiled with.
 */
export const CONTRACTS_VERSION = "0.0.0" as const;
