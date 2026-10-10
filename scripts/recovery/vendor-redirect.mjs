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
  // V: GPT-Live's WebRTC session creation.
  "https://api.openai.com/v1/live/sessions",
  // V2: the public people search (Serper.dev), only when the stack was
  // started with CQ_RECOVERY_SEARCH=1 (a disabled key makes q-api build the
  // adapter). Answered by the fake, which logs every call: a prepared
  // entity must cost none, and an unknown person gets a scripted profile.
  "https://google.serper.dev/search",
  "https://scrape.serper.dev",
];
// Where a redirected URL lands on the fake when its own path would clash.
const TARGET_PATHS = {
  "https://google.serper.dev/search": "/__fake/serper/search",
  "https://scrape.serper.dev": "/__fake/serper/scrape",
};

if (process.env.CQ_FAKE_VOICE_VENDORS === "1") {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input?.url;
    // A real GPT-Live key (the developer preview) goes to the real vendor.
    const realLive =
      (process.env.CQ_VOICE_LIVE_OPENAI_API_KEY ?? "").length > 0;
    const match = REDIRECTS.find(
      (prefix) =>
        href?.startsWith(prefix) &&
        !(realLive && prefix.endsWith("/v1/live/sessions")),
    );
    if (match === undefined) return original(input, init);
    const target = `${FAKE}${TARGET_PATHS[match] ?? new URL(href).pathname}`;
    return typeof input === "string" || input instanceof URL
      ? original(target, init)
      : original(new Request(target, input), init);
  };
}
