/* eslint-disable no-console -- a developer CLI whose whole purpose is to report what it seeded */
import {
  DOCUMENTS_PATH,
  DOCUMENT_UPLOAD_SESSIONS_PATH,
} from "@capital-q/contracts";

import { lazyTaxonomy, seedCompany } from "./accounts.js";
import {
  applicantPlan,
  assertFictionalEmail,
  assertRunId,
  newRunId,
  type ApplicantPlan,
} from "./gateq-applicant-plan.js";
import { SeedError, asRecord, createSeedHttp, type SeedHttp } from "./http.js";

/**
 * A run-scoped fictional GateQ applicant founder (see gateq-applicant-plan):
 *
 *   node scripts/seed-fictional-world.mjs --gateq-applicant [--run <id>] [--dry-run] [--local-stack | --hosted]
 *
 * Creates founder.gq-<run>@fictional.capitalq.local (password from
 * CQ_SEED_ACCOUNT_PASSWORD), walks the founder journey for one fictional
 * company through the product's own API under that founder's session,
 * keeps the company organisation-private (never in investors' Discover)
 * and uploads one plain-text one-pager the founder owns. Then sign in as
 * that founder, open a published gateway's /g/<publicId> and apply with
 * the account email: it confirms without a code.
 *
 * Privileged access is exactly the fictional world's: the Supabase admin
 * API (CQ_SEED_SUPABASE_SECRET_KEY) to create the synthetic account and
 * mint its session, nothing else. It never touches a table. So it must
 * run where that key may be read: an operator's machine against the local
 * stack, or the attested synthetic project with --hosted. A target that is
 * not loopback is refused without --hosted, and --hosted is refused unless
 * the Supabase URL is the project CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF
 * names. No model is called. Key and token values are never printed.
 */

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const present = (name: string): boolean =>
  (process.env[name]?.trim() ?? "").length > 0;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new SeedError(
      `${name} is required (the seed never guesses its target)`,
    );
  }
  return value;
}

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname;
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
}

const NEEDED = [
  "CQ_SEED_SUPABASE_URL",
  "CQ_SEED_SUPABASE_PUBLISHABLE_KEY",
  "CQ_SEED_SUPABASE_SECRET_KEY",
  "CQ_SEED_API_URL",
  "CQ_SEED_ACCOUNT_PASSWORD",
] as const;

function printPlan(plan: ApplicantPlan): void {
  console.log(`run:      ${plan.runId}`);
  console.log(`founder:  ${plan.email}`);
  console.log(`company:  ${plan.company.name} (organisation-private)`);
  console.log(
    `document: ${plan.document.title} (${plan.document.documentType}, ${plan.document.mimeType})`,
  );
}

/** The founder's own one-pager: found by title, else uploaded once. */
async function ensureDocument(
  http: SeedHttp,
  token: string,
  companyId: string,
  plan: ApplicantPlan,
): Promise<{ readonly documentId: string; readonly created: boolean }> {
  const listed = asRecord(
    await http.apiOk(
      token,
      "GET",
      `${DOCUMENTS_PATH}?companyId=${companyId}&limit=50`,
    ),
  );
  const documents = Array.isArray(listed["documents"])
    ? listed["documents"]
    : [];
  for (const one of documents) {
    const document = asRecord(one);
    if (
      document["title"] === plan.document.title &&
      typeof document["id"] === "string"
    ) {
      return { documentId: document["id"], created: false };
    }
  }
  const bytes = new TextEncoder().encode(plan.document.body);
  const created = asRecord(
    await http.apiOk(
      token,
      "POST",
      DOCUMENT_UPLOAD_SESSIONS_PATH,
      {
        companyId,
        documentType: plan.document.documentType,
        title: plan.document.title,
        filename: plan.document.filename,
        declaredMimeType: plan.document.mimeType,
        declaredSizeBytes: bytes.byteLength,
      },
      // Stable: a rerun of the same run replays, never a second document.
      `gq-applicant-doc-${plan.runId}`,
    ),
  );
  const session = asRecord(created["uploadSession"]);
  const upload = asRecord(created["upload"]);
  const sessionId = session["id"];
  const url = upload["url"];
  if (typeof sessionId !== "string" || typeof url !== "string") {
    throw new SeedError(
      "the upload session gave no target (it may already be finished)",
    );
  }
  // Bytes go straight to storage on the short-lived target, as a browser's do.
  const headers = asRecord(upload["headers"]);
  const put = await fetch(url, {
    method: "PUT",
    headers: Object.fromEntries(
      Object.entries(headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    body: bytes,
  });
  if (!put.ok) {
    throw new SeedError(`document upload: HTTP ${String(put.status)}`);
  }
  const completed = asRecord(
    await http.apiOk(
      token,
      "POST",
      `${DOCUMENT_UPLOAD_SESSIONS_PATH}/${sessionId}/complete`,
      {},
      `gq-applicant-doc-complete-${plan.runId}`,
    ),
  );
  const documentId = asRecord(completed["document"])["id"];
  if (typeof documentId !== "string") {
    throw new SeedError("the completed upload named no document");
  }
  return { documentId, created: true };
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  const hosted = process.argv.includes("--hosted");
  const runId = assertRunId(argument("--run") ?? newRunId());
  const plan = applicantPlan(runId);
  assertFictionalEmail(plan.email);

  if (dryRun) {
    console.log("GateQ applicant (dry run: nothing is written)");
    printPlan(plan);
    for (const name of NEEDED) {
      console.log(`  ${name}: ${present(name) ? "set" : "MISSING"}`);
    }
    return 0;
  }

  const target = {
    supabaseUrl: required("CQ_SEED_SUPABASE_URL").replace(/\/$/, ""),
    publishableKey: required("CQ_SEED_SUPABASE_PUBLISHABLE_KEY"),
    secretKey: required("CQ_SEED_SUPABASE_SECRET_KEY"),
    apiUrl: required("CQ_SEED_API_URL").replace(/\/$/, ""),
  };
  for (const [name, url] of [
    ["CQ_SEED_SUPABASE_URL", target.supabaseUrl],
    ["CQ_SEED_API_URL", target.apiUrl],
  ] as const) {
    if (!isLoopback(url) && !hosted) {
      throw new SeedError(
        `${name} is not loopback (${new URL(url).hostname}); pass --hosted only if you mean the attested synthetic project`,
      );
    }
  }
  if (hosted) {
    const declared = process.env["CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF"]
      ?.trim()
      .toLowerCase();
    const ref = /^([a-z0-9]{16,})\.supabase\.(co|com|net)$/i
      .exec(new URL(target.supabaseUrl).hostname)?.[1]
      ?.toLowerCase();
    if (declared === undefined || declared.length === 0) {
      throw new SeedError(
        "--hosted needs CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF naming the synthetic project",
      );
    }
    if (ref !== declared) {
      throw new SeedError(
        "--hosted: CQ_SEED_SUPABASE_URL must be the attested synthetic project",
      );
    }
  }
  const password = process.env["CQ_SEED_ACCOUNT_PASSWORD"];
  if (password === undefined || password.length < 12) {
    throw new SeedError(
      "CQ_SEED_ACCOUNT_PASSWORD (12+ characters) is required",
    );
  }

  console.log(
    `GateQ applicant: supabase ${new URL(target.supabaseUrl).host} · api ${new URL(target.apiUrl).host}${hosted ? " (HOSTED)" : ""}`,
  );
  printPlan(plan);
  const http = createSeedHttp(target);
  const seeded = await seedCompany(
    http,
    plan.company,
    lazyTaxonomy(http),
    password,
    (line) => console.log(line),
    { discoverable: false, requestVerification: false },
  );
  const document = await ensureDocument(
    http,
    seeded.token,
    seeded.companyId,
    plan,
  );
  console.log(
    `  company ${seeded.companyId} · document ${document.documentId} (${document.created ? "uploaded" : "existing"})`,
  );
  console.log(
    `sign in as ${plan.email} with CQ_SEED_ACCOUNT_PASSWORD, open /g/<publicId>, apply with the account email.`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      `GateQ applicant: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  },
);
