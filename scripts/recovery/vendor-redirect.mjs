/* global process, URL, Request */
/**
 * Recovery G, MOCK mode only: the voice credential calls go to the fake.
 *
 * q-api mints voice credentials with plain fetch to fixed vendor URLs
 * (apps/q-api/src/voice/providers/deepgram.ts:16, packages/model-gateway/
 * src/realtime/openai.ts:28). Request G-R2 asked for a local/test base-URL
 * override in product code; until it exists, this preload rewrites exactly
 * those two URLs to scripts/recovery/fake-vendors.mjs, so the duplex and
 * standard lines can open against the local stack with no vendor. The
 * browser half (WebRTC to /v1/realtime/calls, the Deepgram agent socket)
 * is faked in the page by tests/recovery/support/{duplex,deepgram}-fake.ts.
 *
 * Loaded by scripts/recovery/local-stack.sh before the egress guard; it
 * does nothing unless CQ_FAKE_VOICE_VENDORS=1 (never set in LIVE mode).
 */
const FAKE = process.env.CQ_FAKE_VENDOR_ORIGIN ?? "http://127.0.0.1:3990";
const REDIRECTS = [
  "https://api.openai.com/v1/realtime/client_secrets",
  "https://api.deepgram.com/v1/auth/grant",
];

if (process.env.CQ_FAKE_VOICE_VENDORS === "1") {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input?.url;
    const match = REDIRECTS.find((prefix) => href?.startsWith(prefix));
    if (match === undefined) return original(input, init);
    const target = `${FAKE}${new URL(href).pathname}`;
    return typeof input === "string" || input instanceof URL
      ? original(target, init)
      : original(new Request(target, input), init);
  };
}
