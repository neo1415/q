/**
 * @capital-q/security/postgres
 *
 * Production adapters for the security ports, backed by PostgreSQL through
 * @capital-q/database. Kept off the package's root entrypoint so that code
 * which only needs the pure security primitives -- including browser-reachable
 * code -- never pulls a database driver into its graph.
 *
 * Composition roots construct these with the executor they consider
 * appropriate; the adapters never open their own pools.
 */

export {
  createPostgresActorContextResolver,
  type PostgresActorContextResolverOptions,
} from "./actor-context-resolver.js";

export {
  createPostgresActiveOrganisationContextStore,
  type ActiveOrganisationContextResult,
  type ActiveOrganisationContextSelection,
  type ActiveOrganisationContextStore,
  type PostgresActiveOrganisationContextStoreOptions,
} from "./active-context-store.js";

export {
  createPostgresAuthorizationPolicySource,
  type PolicyIntegrityFailure,
  type PostgresAuthorizationPolicySourceOptions,
} from "./authorization-policy-source.js";
