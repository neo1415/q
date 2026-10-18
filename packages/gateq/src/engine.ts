/**
 * `@capital-q/gateq/engine` — the deterministic engine and its contracts,
 * without the application or Postgres layers the root entrypoint carries.
 *
 * For callers that must not pull infrastructure into their bundle: the
 * landing page runs `qualify` in the visitor's browser against a static
 * demo policy, so no answer leaves the device. Same engine, same contracts,
 * no second implementation to drift.
 */

export * from "./contracts/index.js";
export {
  qualify,
  GateQPolicyNotPublishedError,
  QUALIFICATION_POLICY_VERSION,
  ALL_CRITERION_REASON_CODES,
  type QualifyInput,
} from "./domain/qualification.js";
export { publicProjectionOf } from "./domain/public-projection.js";
