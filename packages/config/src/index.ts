/**
 * @capital-q/config
 *
 * Owns: the single boundary where the process environment is validated and
 * turned into typed configuration (ERA-048). Application and domain code
 * receives typed config and does not read `process.env` itself (ERA-049).
 * Does not own: provider behaviour, feature policy, or security policy.
 *
 * Each deployable has its own schema and loader, reached through a subpath
 * export:
 *
 *   @capital-q/config/api
 *   @capital-q/config/q-api
 *   @capital-q/config/workers
 *   @capital-q/config/web
 *
 * There is deliberately no single schema covering every variable: the API must
 * not require the worker's credentials, and the browser must not require the
 * API's. Provider configuration -- database, model providers, video, queues --
 * is added by the packet that introduces the provider, not declared in advance.
 *
 * Security policy is code, not configuration. Nothing here may become an
 * environment switch that disables RLS, authorization, the Context Firewall or
 * Q approval.
 */

export {
  DEPLOYMENT_ENVIRONMENTS,
  LOG_LEVELS,
  NODE_ENVS,
  type DeploymentEnvironment,
  type EnvironmentInput,
  type LogLevel,
  type NetworkConfig,
  type NodeEnv,
  type ObservabilityConfig,
  type RuntimeConfig,
} from "./common.js";

export { ConfigurationError, type ConfigurationIssue } from "./errors.js";

/**
 * Bumped when the shape of configuration changes in a way operators must act
 * on. Reported in startup metadata once the observability layer exists.
 */
export {
  DATABASE_ACCESS_CLASSES,
  DATABASE_CONNECTION_MODES,
  type DatabaseAccessClass,
  type DatabaseConfig,
  type DatabaseConnectionMode,
} from "./database.js";

export const CONFIG_SCHEMA_VERSION = 1;
