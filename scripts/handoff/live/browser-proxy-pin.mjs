/** Optional, process-local trust for the cloud's installed OpenAI proxy CA.
 * Use only for an authorized browser rehearsal. No persistent trust-store
 * change; no blanket ignoreHTTPSErrors or ignore-certificate-errors flag.
 *
 * CQ_BROWSER_PROXY_CA_FILE=/usr/local/share/ca-certificates/environment-proxy-ca.crt
 * NODE_OPTIONS=--import=./scripts/handoff/live/browser-proxy-pin.mjs
 */
import { readFileSync } from "node:fs";
import { X509Certificate, createHash } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";
import { URL } from "node:url";

const certificateFile = process.env["CQ_BROWSER_PROXY_CA_FILE"];
if (
  certificateFile !==
  "/usr/local/share/ca-certificates/environment-proxy-ca.crt"
)
  throw new Error(
    "Explicitly select the installed cloud proxy CA for this run",
  );
if (!process.env["HTTPS_PROXY"])
  throw new Error("This rehearsal helper requires the configured cloud proxy");
const certificate = new X509Certificate(readFileSync(certificateFile));
if (
  !certificate.ca ||
  !certificate.subject.includes("O=OpenAI") ||
  !certificate.verify(certificate.publicKey) ||
  Date.now() < Date.parse(certificate.validFrom) ||
  Date.now() > Date.parse(certificate.validTo)
)
  throw new Error("The configured cloud proxy CA is not valid");
const pin = createHash("sha256")
  .update(certificate.publicKey.export({ type: "spki", format: "der" }))
  .digest("base64");
const require = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const launch = chromium.launch.bind(chromium);
chromium.launch = (options) =>
  launch({
    ...options,
    args: [
      ...(options?.args ?? []),
      `--ignore-certificate-errors-spki-list=${pin}`,
    ],
  });
