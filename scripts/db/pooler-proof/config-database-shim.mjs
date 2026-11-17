// Used only by the transaction-pooler proof (vitest.config.mjs).
//
// The integration suites build their app clients from a hand-written env
// (DATABASE_URL = the local database, direct mode). For the proof, any such
// client is moved onto Supavisor's transaction port with the production
// pooler settings: DATABASE_CONNECTION_MODE=transaction_pooler (prepare off,
// max_pipeline 1, set_config per transaction, client deadlines) and LISTEN
// on a separate session connection. Fixture and cleanup SQL that the suites
// run through their own raw clients stays direct. Everything else is the
// real module.
import { parseDatabaseConfig as realParseDatabaseConfig } from "../../../packages/config/dist/database.js";

export * from "../../../packages/config/dist/database.js";

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `pooler proof: ${name} is not set (run scripts/db/pooler-proof/run.sh)`,
    );
  }
  return value;
}

export function parseDatabaseConfig(env, defaults) {
  const direct = required("POOLER_PROOF_DIRECT_URL");
  if (env?.["DATABASE_URL"] !== direct) {
    return realParseDatabaseConfig(env, defaults);
  }
  return realParseDatabaseConfig(
    {
      ...env,
      DATABASE_URL: required("POOLER_PROOF_POOLER_URL"),
      DATABASE_CONNECTION_MODE: "transaction_pooler",
      DATABASE_LISTEN_URL: required("POOLER_PROOF_LISTEN_URL"),
    },
    defaults,
  );
}
