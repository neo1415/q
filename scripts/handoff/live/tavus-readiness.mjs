// Read existing backend state only. No starts, ends, provider calls, variables or mutations.
// CQ_TAVUS_SESSION_FILE=<private Supabase session JSON>
// CQ_TAVUS_REHEARSAL_ID=<existing UUID> (optional)
// CQ_TAVUS_ORGANISATION_ID=<canonical organisation UUID> (optional selector)
// CQ_TAVUS_CONFIG_RECEIPT_FILE=<sanitized fresh Railway receipt> (optional)
// NODE_USE_ENV_PROXY=1 node /tmp/cq-tavus-readiness-readonly.mjs --read
import { readFileSync } from "node:fs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const origin = "https://capital-qq-api-production.up.railway.app";
const checks = {};
let failed = false;
function check(name, pass, extra = {}) {
  checks[name] = { pass, ...extra };
  if (!pass) failed = true;
}
async function get(path, token, organisationId) {
  const response = await fetch(`${origin}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      ...(organisationId ? { "x-organisation-id": organisationId } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { status: response.status, value: null };
  return { status: response.status, value: await response.json() };
}
function privateRoom(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "tavus.daily.co" &&
      Boolean(parsed.searchParams.get("t"))
    );
  } catch {
    return false;
  }
}
if (!process.argv.includes("--read")) {
  console.log(
    "Read-only preparation. Pass --read with an existing private session to inspect catalogue/recovery/review. This script never allocates a room.",
  );
  process.exit(0);
}
try {
  const session = JSON.parse(
    readFileSync(process.env.CQ_TAVUS_SESSION_FILE, "utf8"),
  );
  if (
    typeof session.access_token !== "string" ||
    session.access_token.length < 32
  )
    throw new Error("session requirement");
  const organisationId = process.env.CQ_TAVUS_ORGANISATION_ID;
  if (organisationId && !UUID.test(organisationId))
    throw new Error("organisation requirement");
  const receiptPath = process.env.CQ_TAVUS_CONFIG_RECEIPT_FILE;
  check("configurationReceiptPresent", Boolean(receiptPath));
  if (receiptPath) {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    const receiptAge = Date.now() - Date.parse(receipt.observedAt);
    check(
      "freshRootConfigurationReceipt",
      receiptAge >= 0 && receiptAge < 600_000,
    );
    check(
      "exactServiceRevision",
      /^[0-9a-f]{40}$/u.test(receipt.expectedCodeSha ?? "") &&
        receipt.actualCodeSha === receipt.expectedCodeSha,
    );
    check("testMode", receipt.testMode === true);
    check("oneReplica", receipt.replicas === 1);
    check(
      "oneProviderAccount",
      receipt.keyCount === 1 && receipt.keyPresent === true,
    );
    check(
      "canonicalSingleProfileAdmission",
      receipt.paidProfileCount === 1 && receipt.paidProfileIdMatches === true,
    );
    check("stableCipherSecret", receipt.stableCipherSecretPresent === true);
    check("publicBridgeOrigin", receipt.publicBaseOrigin === origin);
  }
  const catalogue = await get(
    "/v1/q/rehearsals/video/interviewers",
    session.access_token,
    organisationId,
  );
  check("authenticatedCatalogue", catalogue.status === 200, {
    status: catalogue.status,
  });
  if (catalogue.value)
    check(
      "admittedCatalogue",
      catalogue.value.videoAvailable === true &&
        catalogue.value.maxSeconds === 180,
      {
        enabledInterviewers: catalogue.value.interviewers
          .filter((item) => item.available)
          .map((item) => item.id),
      },
    );
  const id = process.env.CQ_TAVUS_REHEARSAL_ID;
  if (id) {
    if (!UUID.test(id)) throw new Error("rehearsal requirement");
    const canonical = await get(
      `/v1/q/rehearsals/${id}`,
      session.access_token,
      organisationId,
    );
    check(
      "ownedCanonicalRehearsal",
      canonical.status === 200 && canonical.value?.id === id,
      { status: canonical.status },
    );
    const first = await get(
      `/v1/q/rehearsals/${id}/video`,
      session.access_token,
      organisationId,
    );
    const second = await get(
      `/v1/q/rehearsals/${id}/video`,
      session.access_token,
      organisationId,
    );
    check(
      "sameRoomRecovery",
      first.status === 200 &&
        second.status === 200 &&
        first.value?.id === second.value?.id &&
        first.value?.endsAt === second.value?.endsAt &&
        first.value?.joinUrl === second.value?.joinUrl,
    );
    if (second.value) {
      const room = second.value;
      const duration = Date.parse(room.endsAt) - Date.parse(room.startedAt);
      check(
        "fixedThreeMinuteDeadline",
        room.maxSeconds === 180 && duration > 0 && duration <= 180_000,
      );
      if (room.status === "LIVE")
        check("privateExistingJoin", privateRoom(room.joinUrl), {
          pending: room.joinUrl === null,
        });
      else check("closedJoinCredential", room.joinUrl === null);
      checks.lifecycle = {
        videoStatus: room.status,
        canonicalStatus: canonical.value?.status ?? "UNAVAILABLE",
        transcriptTurns: canonical.value?.turns?.length ?? 0,
        reviewPresent:
          canonical.value?.review !== null &&
          canonical.value?.review !== undefined,
        reviewProvisional: canonical.value?.review?.provisional === true,
      };
      // Test mode proves recovery/lifecycle only. Remote video/audio and a
      // nonprovisional transcript-backed review remain human acceptance.
    }
  }
  console.log(
    JSON.stringify(
      { mode: "READ_ONLY", checks, audiovisualAcceptance: "NOT_RUN" },
      null,
      2,
    ),
  );
  process.exitCode = failed ? 1 : 0;
} catch {
  // Do not echo remote bodies, private links, session contents or transport request headers.
  console.error(
    "Read-only readiness check failed; inspect required file presence, authorization and connectivity without printing secrets.",
  );
  process.exitCode = 1;
}
