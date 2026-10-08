import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Where the local recovery stack is (scripts/recovery/local-stack.sh) and
 * who is in it. Every value is loopback or synthetic; the suite refuses to
 * run against anything else.
 */
const ROOT = resolve(import.meta.dirname, "../../..");
const RUN_DIR =
  process.env["CQ_RECOVERY_RUN_DIR"] ??
  resolve(ROOT, ".playwright/recovery-stack");

function stackEnv(): Record<string, string> {
  const file = resolve(RUN_DIR, "stack.env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

const env = stackEnv();
// The stack's own file wins over the shell: a cloud shell can carry hosted
// values under the same names (CQ_SEED_ACCOUNT_PASSWORD is set for the
// hosted seed accounts here), and this suite must only ever see the local ones.
const pick = (name: string, fallback: string): string =>
  env[name] ?? process.env[name] ?? fallback;

export const WEB_URL = pick("CQ_WEB_ORIGIN", "http://127.0.0.1:3200");
export const API_URL = pick("CQ_API_URL", "http://127.0.0.1:3201");
export const Q_API_URL = pick("CQ_Q_API_URL", "http://127.0.0.1:3202");
export const FAKE_URL = `http://127.0.0.1:${pick("CQ_FAKE_PORT", "3990")}`;
export const SUPABASE_URL = pick("SUPABASE_URL", "http://127.0.0.1:54321");
export const SUPABASE_PUBLISHABLE_KEY = pick("SUPABASE_PUBLISHABLE_KEY", "");
export const RUN_PATH = RUN_DIR;
/** "mock" or "live": how local-stack.sh started the running stack. */
export const STACK_MODE = (() => {
  const file = resolve(RUN_DIR, "mode");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "unknown";
})();

for (const url of [WEB_URL, API_URL, Q_API_URL, SUPABASE_URL]) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/u.test(url)) {
    throw new Error(`recovery suite runs on loopback only, refused ${url}`);
  }
}

export type WorldCompany = {
  readonly key: string;
  readonly name: string;
  readonly companyId: string;
  readonly founderEmail: string;
  readonly deck?: { readonly artifactId: string; readonly title: string };
};
export type WorldInvestor = {
  readonly key: string;
  readonly name: string;
  readonly investorOrganisationId: string;
  readonly mandateId: string;
  readonly email: string;
};

/** The seed's manifest (`local-stack.sh seed`): ids of the fictional world. */
export function world(): {
  readonly companies: readonly WorldCompany[];
  readonly investors: readonly WorldInvestor[];
  company: (key: string) => WorldCompany;
  investor: (key: string) => WorldInvestor;
} {
  const file = resolve(RUN_DIR, "fictional-world/manifest.json");
  if (!existsSync(file)) {
    throw new Error(
      `no seeded world at ${file}: run scripts/recovery/local-stack.sh seed`,
    );
  }
  const manifest = JSON.parse(readFileSync(file, "utf8")) as {
    companies: WorldCompany[];
    investors: WorldInvestor[];
  };
  const find = <T extends { key: string }>(
    list: readonly T[],
    key: string,
  ): T => {
    const found = list.find((entry) => entry.key === key);
    if (found === undefined) throw new Error(`seed has no ${key}`);
    return found;
  };
  return {
    companies: manifest.companies,
    investors: manifest.investors,
    company: (key) => find(manifest.companies, key),
    investor: (key) => find(manifest.investors, key),
  };
}

/** The fictional world's synthetic password (scripts/dev-bootstrap.mjs:52). */
export const PASSWORD = pick("CQ_SEED_ACCOUNT_PASSWORD", "CapitalQ-dev-2026!");

const DOMAIN = "fictional.capitalq.local";
export const founderOf = (key: string) => `founder.${key}@${DOMAIN}`;
export const investorOf = (key: string) => `investor.${key}@${DOMAIN}`;

/**
 * Cast. Savanna Seed and Ledgerfold have an ACCEPTED relationship in the
 * seed; Lagoon Angels declined Ajopot; Rift Valley Seed is PENDING with
 * Maji Loop. Tarmacly's founder is the other tenant for negative tests.
 */
export const CAST = {
  founder: founderOf("ledgerfold"),
  founderCompanyKey: "ledgerfold",
  otherFounder: founderOf("tarmacly"),
  investor: investorOf("savanna-seed"),
  unrelatedInvestor: investorOf("lagoon-angels"),
  pendingInvestor: investorOf("rift-valley-seed"),
} as const;
