/* global process, console */
/**
 * Recovery G: the "no live provider calls" guarantee for the local stack.
 *
 *   node --import ./scripts/recovery/egress-guard.mjs dist/main.js
 *
 * Disabled API keys are not enough: a service holding a disabled key still
 * opens a connection to the vendor and sends a request (verified in this VM:
 * a fetch to api.deepgram.com came back 401 through the agent proxy). Every
 * outbound TCP connection in Node goes through `net.Socket#connect`, so this
 * refuses any destination that is not loopback, before a byte is sent. That
 * covers fetch (undici), http/https, the vendor SDKs and WebSocket clients.
 *
 * A refusal is logged as one JSON line ("recovery egress refused") so the
 * evidence shows what tried to leave; the caller gets ECONNREFUSED, which
 * every adapter already treats as a provider outage.
 */
import net from "node:net";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::"]);

function destination(args) {
  const [first, second] = args;
  if (Array.isArray(first)) return destination(first);
  if (first !== null && typeof first === "object") {
    if (typeof first.path === "string") return { path: first.path };
    return { host: first.host ?? "localhost", port: first.port };
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) {
    // A unix socket path (e.g. the docker or postgres socket).
    return { path: first };
  }
  return {
    host: typeof second === "string" ? second : "localhost",
    port: first,
  };
}

/**
 * LIVE mode only (local-stack.sh with CQ_RECOVERY_MODE=live): the vendor
 * hosts the operator approved for this run, e.g. "api.openai.com". Empty in
 * MOCK mode, which is the default and the CI mode.
 */
const ALLOWED = new Set(
  (process.env.CQ_EGRESS_ALLOW ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0),
);

function isLoopback(host) {
  if (LOOPBACK.has(host)) return true;
  if (ALLOWED.has(host.toLowerCase())) return true;
  return /^127\./u.test(host) || /^::ffff:127\./u.test(host);
}

const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const target = destination(args);
  if (target.path !== undefined || isLoopback(String(target.host))) {
    return original.apply(this, args);
  }
  console.error(
    JSON.stringify({
      level: 50,
      time: Date.now(),
      msg: "recovery egress refused",
      host: String(target.host),
      port: target.port,
      pid: process.pid,
    }),
  );
  const error = Object.assign(
    new Error(`recovery egress guard: ${String(target.host)} is not loopback`),
    { code: "ECONNREFUSED" },
  );
  process.nextTick(() => this.destroy(error));
  return this;
};

// The agent proxy hides the real destination inside a CONNECT, so guarded
// processes never use it. A LIVE run on a machine that can only reach the
// vendor through a proxy sets CQ_EGRESS_KEEP_PROXY=1 and lists the proxy
// host in CQ_EGRESS_ALLOW; the report then says the guard was proxy-wide.
for (const name of process.env.CQ_EGRESS_KEEP_PROXY === "1"
  ? []
  : [
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "https_proxy",
      "http_proxy",
      "ALL_PROXY",
      "all_proxy",
    ]) {
  delete process.env[name];
}
