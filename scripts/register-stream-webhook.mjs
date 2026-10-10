#!/usr/bin/env node
/**
 * Register the api's Cloudflare Stream webhook URL (CQ-MEDIA-012).
 *
 *   node scripts/register-stream-webhook.mjs <notification-url> --secret-out <file>
 *   node scripts/register-stream-webhook.mjs <notification-url> --dry-run
 *
 * <notification-url> is the deployed api's
 * `https://<api-host>/v1/webhooks/cloudflare-stream`. Run at deploy time by
 * whoever holds the Stream API token; nothing in the product runs this.
 *
 * Reads CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN (or the older
 * CLOUDFLARE_API_KEY spelling) from the shell or from .env.local.
 *
 * Cloudflare answers with the webhook SIGNING SECRET. It is a secret: this
 * script never prints it. It is written to the file named by --secret-out
 * (created owner-only, refused if it already exists or lies inside this
 * repository, so it cannot be committed), and the script says where to
 * store it: CLOUDFLARE_STREAM_WEBHOOK_SECRET on the api service. Delete the
 * file once it is stored.
 *
 * Cloudflare allows ONE webhook per account. Registering replaces whatever
 * URL the account delivered to before — if staging and production share an
 * account, only the last one registered receives deliveries.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const root = resolve(
  new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const WEBHOOK_PATH = "/v1/webhooks/cloudflare-stream";

function fail(message) {
  console.error(`[stream-webhook] ${message}`);
  process.exit(1);
}

function fileValue(key) {
  const file = resolve(root, ".env.local");
  if (!existsSync(file)) return undefined;
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(
    readFileSync(file, "utf8"),
  );
  return match === null
    ? undefined
    : match[1].trim().replace(/^["']|["']$/g, "");
}

const env = (key) => process.env[key] ?? fileValue(key);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outIndex = args.indexOf("--secret-out");
const secretOut = outIndex === -1 ? undefined : args[outIndex + 1];
const positional = args.filter(
  (arg, index) =>
    !arg.startsWith("--") && (outIndex === -1 || index !== outIndex + 1),
);

const [notificationUrl] = positional;
if (notificationUrl === undefined) {
  fail(
    `usage: node scripts/register-stream-webhook.mjs https://<api-host>${WEBHOOK_PATH} --secret-out <file>`,
  );
}
let target;
try {
  target = new URL(notificationUrl);
} catch {
  fail("the notification URL is not a URL.");
}
if (target.protocol !== "https:") {
  fail(
    "the notification URL must be https: Cloudflare delivers to the internet, not to this machine.",
  );
}
if (["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
  fail(
    "the notification URL names this machine; register the deployed api instead.",
  );
}
if (target.pathname.replace(/\/$/, "") !== WEBHOOK_PATH) {
  fail(`the notification URL must end in ${WEBHOOK_PATH}.`);
}

const accountId = env("CLOUDFLARE_ACCOUNT_ID");
const token = env("CLOUDFLARE_STREAM_API_TOKEN") ?? env("CLOUDFLARE_API_KEY");
if (accountId === undefined || !/^[0-9a-f]{32}$/.test(accountId)) {
  fail("CLOUDFLARE_ACCOUNT_ID is missing or is not an account id.");
}
if (token === undefined || token.length < 16) {
  fail("CLOUDFLARE_STREAM_API_TOKEN (or CLOUDFLARE_API_KEY) is missing.");
}

if (!dryRun) {
  if (secretOut === undefined) {
    fail(
      "--secret-out <file> is required: the signing secret is never printed.",
    );
  }
  const out = resolve(secretOut);
  const inside = relative(root, out);
  if (!inside.startsWith("..") && !isAbsolute(inside)) {
    fail(
      "--secret-out must be outside this repository, so the secret cannot be committed.",
    );
  }
  if (existsSync(out)) {
    fail("--secret-out already exists; name a new file.");
  }
}

console.log(
  `[stream-webhook] ${dryRun ? "would register" : "registering"} ${target.origin}${WEBHOOK_PATH} for account …${accountId.slice(-6)}`,
);
console.log(
  "[stream-webhook] this REPLACES any webhook URL the account already has (one per account).",
);
if (dryRun) {
  process.exit(0);
}

let response;
try {
  response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/webhook`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ notificationUrl: target.href }),
      signal: AbortSignal.timeout(15_000),
    },
  );
} catch {
  fail("Cloudflare could not be reached.");
}

const payload = await response.json().catch(() => null);
if (!response.ok || payload?.success !== true) {
  // Status and Cloudflare's own error codes only; never the request.
  const codes = Array.isArray(payload?.errors)
    ? payload.errors
        .map((error) => error?.code)
        .filter(Boolean)
        .join(", ")
    : "";
  fail(
    `Cloudflare refused the registration (HTTP ${String(response.status)}${codes ? `; codes ${codes}` : ""}).`,
  );
}
const secret = payload?.result?.secret;
if (typeof secret !== "string" || secret.length < 16) {
  fail("Cloudflare answered without a signing secret; nothing was written.");
}

writeFileSync(resolve(secretOut), `${secret}\n`, { mode: 0o600, flag: "wx" });
console.log("[stream-webhook] registered. A signing secret was returned.");
console.log(
  `[stream-webhook] it was written to ${resolve(secretOut)} (not printed).`,
);
console.log(
  "[stream-webhook] store it as CLOUDFLARE_STREAM_WEBHOOK_SECRET on the api service (Railway → api → Variables), redeploy, then delete that file.",
);
