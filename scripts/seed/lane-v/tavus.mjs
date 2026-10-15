// Tavus client for the lane-V pitch videos. The owner's keys are read at
// runtime from a mode-600 file and live only in this process; they are never
// printed, logged or written. Everything else names a key only as `key#N`.
import { readFileSync } from "node:fs";

export const KEY_FILE = process.env.CQ_TAVUS_KEY_FILE ?? "/root/.cq-tavus-keys";

let cache = null;
export const keys = () =>
  (cache ??= readFileSync(KEY_FILE, "utf8").split(/\s+/).filter(Boolean));
export const tag = (i) => `key#${i + 1}`;
export const keyIndex = (t) => Number(String(t).replace(/^key#/, "")) - 1;

export async function tv(i, method, path, body) {
  const r = await fetch(`https://tavusapi.com${path}`, {
    method,
    headers: {
      "x-api-key": keys()[i],
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON error pages stay as text for the ledger.
  }
  return { status: r.status, body: parsed };
}

/**
 * True when Tavus refused for quota or credit, which moves the batch to the
 * next key. Any other failure (a bad replica, a script error) stays on the
 * same key: switching would only burn the next key's credits on a bad job.
 */
export function isQuotaRefusal(r) {
  if (r.status === 402 || r.status === 429) return true;
  if (r.status < 400) return false;
  const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  return /credit|quota|insufficient|billing|out of (minutes|videos)|limit (reached|exceeded)|exceeded .*limit|upgrade your plan/i.test(
    text,
  );
}

/** Tavus video-generation price estimate used for the ledger only. */
export const USD_PER_MINUTE = Number(process.env.CQ_TAVUS_USD_PER_MIN ?? "1");
export const estimateUsd = (seconds) =>
  Math.round((seconds / 60) * USD_PER_MINUTE * 100) / 100;
